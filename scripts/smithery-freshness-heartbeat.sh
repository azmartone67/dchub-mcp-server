#!/usr/bin/env bash
# DC Hub MCP — Smithery freshness heartbeat.
#
# Re-publishes the Smithery listing on a cadence so our FRESHNESS signal never
# decays below a competitor's. Smithery ranks partly on recency, so a stale-but-
# better server gets passed by a merely-fresher one (e.g. ByteAsk — an embedded-
# systems docs server — briefly tied us on "interconnection" purely on freshness).
# This is the PREVENTIVE lever: keep refreshing so we don't slip in the first place,
# instead of only detecting slips after the fact (that's registry_monitor.py's job).
#
# Run by LaunchAgent cloud.dchub.smithery-freshness (~/Library/LaunchAgents),
# ~2x/week. `smithery mcp publish` re-scans the live MCP server and refreshes the
# listing's freshness timestamp — no version bump or code change required.
#
# Auth: the smithery CLI token lives in a FILE
# (~/Library/Application Support/smithery/settings.json), not the macOS keychain,
# so this runs headless under launchd with no keychain-unlock prompt.
set -uo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"   # launchd has a minimal PATH; smithery needs node

LOG="$HOME/Library/Logs/dchub-smithery-freshness.log"
TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"

# --config-schema advertises the optional apiKey field so Smithery stops warning
# "No config schema provided" and offers users the (optional) key input. Guarded so
# a missing file never breaks the publish.
SCHEMA="/Users/jonathanmartone/dchub-mcp-server/smithery-config-schema.json"
SCHEMA_FLAG=""; [ -f "$SCHEMA" ] && SCHEMA_FLAG="--config-schema $SCHEMA"

echo "[$TS] freshness heartbeat → smithery mcp publish https://dchub.cloud/mcp -n azmartone67/dchub $SCHEMA_FLAG" >> "$LOG"
OUT="$(smithery mcp publish https://dchub.cloud/mcp -n azmartone67/dchub $SCHEMA_FLAG 2>&1)"
RC=$?
echo "$OUT" >> "$LOG"
echo "[$TS] exit=$RC" >> "$LOG"
echo "----" >> "$LOG"
exit $RC
