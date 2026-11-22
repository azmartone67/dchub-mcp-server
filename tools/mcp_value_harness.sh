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
PASSED=0
PAUSE="${DCHUB_HARNESS_PAUSE:-1}"   # seconds between calls (retries wait 3x); the test sets 0

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

# Classify a tool response: tools/value_harness_classify.py (verdicts and why are in its docstring).
# The harness exists to prove a PAID key gets full data. It must NOT red on CI infra noise (GitHub runner
# IPs hit a per-IP rate limit: empty/garbled/{error} bodies are TRANSIENT), but a refused key (AUTH) or a
# gated preview (GATED) is the thing it is here to catch, so those fail. Until 2026-11-22 a walled answer
# read as 'text-not-json' noise and the job stayed green while the key was refused.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
classify() {  # $1=resp $2=reqkey
  printf '%s' "$1" | python3 "$HERE/value_harness_classify.py" "$2" 2>/dev/null || echo 'TRANSIENT:classifier-error'
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
    [[ "$verdict" == PASS || "$verdict" == REGRESSION:* || "$verdict" == AUTH:* || "$verdict" == GATED:* ]] && break
    sleep $((PAUSE * 3))
  done
  if [[ "$verdict" == AUTH:* ]]; then
    # Every later call would be refused the same way: stop here, with one clear line (never the key itself).
    printf '  \033[31m✗\033[0m %-26s %s\n' "$tool" "$verdict"
    echo "::error::value-harness: DC Hub refused the DCHUB_MCP_PAID_KEY key (${verdict#AUTH:}); every call is served anonymously behind the quota wall. Rotate the repo secret to a live paid/enterprise key."
    exit 1
  fi
  if [[ "$verdict" == PASS ]]; then
    printf '  \033[32m✓\033[0m %-26s %s\n' "$tool" "($reqkey)"; PASSED=$((PASSED+1))
  elif [[ "$verdict" == TRANSIENT:* ]]; then
    printf '  \033[33m~\033[0m %-26s SKIP (%s — CI infra/rate-limit, not a regression)\n' "$tool" "${verdict#TRANSIENT:}"
    echo "::warning::value-harness: $tool skipped (${verdict#TRANSIENT:}) — likely CI per-IP rate-limit, not a tool regression"
  else
    printf '  \033[31m✗\033[0m %-26s %s\n' "$tool" "$verdict"; FAILED=1
    [[ "$verdict" == GATED:* ]] && echo "::error::value-harness: $tool answered a paid key with a gated preview (${verdict#GATED:})"
  fi
  sleep "$PAUSE"   # spread requests to avoid bursting the per-IP rate limit
done <<< "$CHECKS"

# A run where no tool passed checked nothing: every answer was skipped as noise. Fail it rather than
# report green (2026-11-22: 0-1 of 10 passed in every run from 11-13 on, and the job stayed green).
if [ "$FAILED" -eq 0 ] && [ "$PASSED" -eq 0 ]; then
  echo "::error::value-harness: no tool passed (every answer skipped as transient), so nothing was checked"
  FAILED=1
fi
if [ "$FAILED" -eq 0 ]; then echo "ALL GREEN ($PASSED passed; transient infra skips warned)"; else echo "HARNESS FAIL — a flagship tool returned an empty, gated or refused answer, or none passed"; fi
exit $FAILED
