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
CHECKS=$(cat <<'EOF'
get_grid_intelligence|{"region_id":"PJM"}|demand_mw
get_market_intel|{"market":"northern-virginia"}|market
get_energy_prices|{"state":"VA"}|avg_rate_kwh
search_facilities|{"country":"US","state":"VA","limit":2}|data
hyperscaler_deals|{"limit":3}|deals
get_fiber_intel|{"carrier":"Zayo"}|features
get_grid_scoreboard|{}|grids
list_transactions|{"year":2026,"limit":3}|data
get_interconnection_queue|{"iso":"PJM"}|project_count
get_pipeline|{"market":"northern-virginia","limit":3}|data
EOF
)

# One fresh session per run (mirrors a real client connect).
H>/dev/null 2>&1 || true
HDR=$(mktemp)
curl -s --max-time 30 -D "$HDR" "$U" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: $K" -H "User-Agent: $UA" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"value-harness","version":"1.0"}}}' >/dev/null
SID=$(awk 'BEGIN{IGNORECASE=1}/^mcp-session-id:/{print $2}' "$HDR" | tr -d '\r'); rm -f "$HDR"
curl -s --max-time 20 "$U" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: $K" -H "User-Agent: $UA" -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null

while IFS='|' read -r tool args reqkey; do
  [ -z "$tool" ] && continue
  resp=$(curl -s --max-time 40 "$U" \
    -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
    -H "X-API-Key: $K" -H "User-Agent: $UA" -H "Mcp-Session-Id: $SID" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
    | tr -d '\r' | grep '^data:' | sed 's/^data: //' | head -1)
  verdict=$(printf '%s' "$resp" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    txt=d['result']['content'][0]['text']
    o=json.loads(txt)
    rk='$reqkey'
    v=o.get(rk)
    nonempty = v not in (None,'',[],{}) and not (isinstance(v,(list,dict)) and len(v)==0)
    keys=[k for k in o.keys() if not k.startswith('_') and k not in ('next_session','citation','freshness')]
    if nonempty: print('PASS')
    else: print('FAIL empty(%s); payload-keys=%s'%(rk, keys[:6]))
except Exception as e:
    print('FAIL parse:%s'%(repr(str(e))[:60]))
" 2>/dev/null)
  if [[ "$verdict" == PASS ]]; then
    printf '  \033[32m✓\033[0m %-26s %s\n' "$tool" "($reqkey)"
  else
    printf '  \033[31m✗\033[0m %-26s %s\n' "$tool" "$verdict"; FAILED=1
  fi
done <<< "$CHECKS"

if [ "$FAILED" -eq 0 ]; then echo "ALL GREEN"; else echo "HARNESS FAIL — at least one flagship tool returned empty/wrong"; fi
exit $FAILED
