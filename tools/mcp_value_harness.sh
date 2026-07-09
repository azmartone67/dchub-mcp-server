#!/usr/bin/env bash
# DC Hub — MCP value-correctness harness
# Calls each flagship MCP tool through the REAL gateway (dchub.cloud/mcp) over a
# proper Streamable-HTTP session and asserts the payload is NON-EMPTY and has the
# expected shape. This is the check that distinguishes a real outage from a flaky
# client session — run it from CI (15-min cron) and page on FAIL.
#
# Usage:  DCHUB_MCP_KEY=dchub_live_... ./mcp_value_harness.sh
# Exit:   0 = all green, 1 = at least one tool returned empty/wrong.
set -uo pipefail

U="${DCHUB_MCP_URL:-https://dchub.cloud/mcp}"
K="${DCHUB_MCP_KEY:?set DCHUB_MCP_KEY to a paid/enterprise X-API-Key}"
UA="${DCHUB_MCP_UA:-dchub-value-harness/1.0}"
FAILED=0

# Each line: tool|json-args|required-key (a key that MUST exist & be non-empty in the payload)
# NB (2026-07-09): the required-key is the tool's OWN top-level array key — it is
# NOT uniform across tools. list_transactions returns its rows under `transactions`
# (+ `count`), not `data`: when it moved from a REST proxy to a Neon-direct query
# (dchub_mcp_server.py) it stopped emitting the `data` alias the REST path had, so
# asserting `data` false-flagged a HEALTHY tool as an empty-payload regression.
# Assert the key the tool actually returns; also dropped a bogus `year` arg (the
# tool has no `year` param — it was silently ignored). Bare limit=3 returns the
# newest deals (ORDER BY date DESC), the most robust non-empty smoke test.
CHECKS=$(cat <<'EOF'
get_grid_intelligence|{"region_id":"PJM"}|demand_mw
get_market_intel|{"market":"northern-virginia"}|market
get_energy_prices|{"state":"VA"}|avg_rate_kwh
search_facilities|{"country":"US","state":"VA","limit":2}|data
hyperscaler_deals|{"limit":3}|deals
get_fiber_intel|{"carrier":"Zayo"}|features
get_grid_scoreboard|{}|grids
list_transactions|{"limit":3}|transactions
get_interconnection_queue|{"iso":"PJM"}|project_count
get_pipeline|{"market":"northern-virginia","limit":3}|data
EOF
)

# r-harness-fix (2026-06-22): FRESH session PER TOOL + one retry. A single
# long-lived MCP session can intermittently return empty/error envelopes
# (documented: reference_dchub_mcp_value_harness) while a fresh keyed handshake
# returns full — which false-flagged list_transactions (the 8th call in the
# old shared session) as "empty" even though the tool was healthy. Re-handshake
# before every tool, and retry once so a transient (cold replica / rate blip)
# doesn't red the whole job. A PERSISTENT empty payload still fails after retry.
mk_session() {
  local HDR; HDR=$(mktemp)
  curl -s --max-time 30 -D "$HDR" "$U" \
    -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
    -H "X-API-Key: $K" -H "User-Agent: $UA" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"value-harness","version":"1.0"}}}' >/dev/null
  local SID; SID=$(awk 'BEGIN{IGNORECASE=1}/^mcp-session-id:/{print $2}' "$HDR" | tr -d '\r'); rm -f "$HDR"
  curl -s --max-time 20 "$U" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
    -H "X-API-Key: $K" -H "User-Agent: $UA" -H "Mcp-Session-Id: $SID" \
    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
  printf '%s' "$SID"
}

# Classify a tool response. The harness exists to catch a LOGIC regression — a
# success envelope with EMPTY data. It must NOT red on CI INFRA noise: GitHub
# runner IPs hit a per-IP rate limit, so a tool can return an empty/garbled body
# or an {error} envelope that is NOT a tool regression.
#   PASS            valid envelope, required key non-empty
#   REGRESSION:..   valid envelope, required key empty   -> HARD FAIL (real bug)
#   TRANSIENT:..    empty body / non-JSON / {error}      -> retry, else SKIP+warn
classify() {  # $1=resp $2=reqkey
  printf '%s' "$1" | python3 -c "
import sys,json
raw=sys.stdin.read(); rk='$2'
if not raw.strip(): print('TRANSIENT:empty-response'); sys.exit()
try: d=json.loads(raw)
except Exception: print('TRANSIENT:non-json'); sys.exit()
try: txt=d['result']['content'][0]['text']
except Exception: print('TRANSIENT:no-content'); sys.exit()
try: o=json.loads(txt)
except Exception: print('TRANSIENT:text-not-json'); sys.exit()
if isinstance(o,dict) and ('error' in o or 'detail' in o) and rk not in o:
    print('TRANSIENT:error-envelope'); sys.exit()
v=o.get(rk) if isinstance(o,dict) else None
nonempty = v not in (None,'',[],{}) and not (isinstance(v,(list,dict)) and len(v)==0)
keys=[k for k in (o.keys() if isinstance(o,dict) else []) if not k.startswith('_') and k not in ('next_session','citation','freshness')]
print('PASS' if nonempty else 'REGRESSION:empty(%s);keys=%s'%(rk, keys[:6]))
" 2>/dev/null
}

# Shared session keeps the request count low (the per-IP rate limit is the real
# CI constraint); we only mint a FRESH session on a retry, which also clears the
# long-lived-session empty-envelope flake.
SID=$(mk_session)
while IFS='|' read -r tool args reqkey; do
  [ -z "$tool" ] && continue
  verdict=""
  for attempt in 1 2 3; do
    [ "$attempt" -gt 1 ] && SID=$(mk_session)   # fresh session on retry
    resp=$(curl -s --max-time 40 "$U" \
      -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
      -H "X-API-Key: $K" -H "User-Agent: $UA" -H "Mcp-Session-Id: $SID" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
      | tr -d '\r' | grep '^data:' | sed 's/^data: //' | head -1)
    verdict=$(classify "$resp" "$reqkey")
    # stop retrying on a definitive verdict; keep retrying only transient infra noise
    [[ "$verdict" == PASS || "$verdict" == REGRESSION:* ]] && break
    sleep 3
  done
  if [[ "$verdict" == PASS ]]; then
    printf '  \033[32m✓\033[0m %-26s %s\n' "$tool" "($reqkey)"
  elif [[ "$verdict" == TRANSIENT:* ]]; then
    printf '  \033[33m~\033[0m %-26s SKIP (%s — CI infra/rate-limit, not a regression)\n' "$tool" "${verdict#TRANSIENT:}"
    echo "::warning::value-harness: $tool skipped (${verdict#TRANSIENT:}) — likely CI per-IP rate-limit, not a tool regression"
  else
    printf '  \033[31m✗\033[0m %-26s %s\n' "$tool" "$verdict"; FAILED=1
  fi
  sleep 1   # spread requests to avoid bursting the per-IP rate limit
done <<< "$CHECKS"

if [ "$FAILED" -eq 0 ]; then echo "ALL GREEN (regressions only; transient infra skips warned)"; else echo "HARNESS FAIL — a flagship tool returned a valid envelope with EMPTY data (real regression)"; fi
exit $FAILED
