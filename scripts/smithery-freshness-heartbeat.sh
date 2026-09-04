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

# NO --config-schema: DC Hub is KEYLESS-FIRST (connect with zero config, then call
# claim_free_key in-session). Advertising the apiKey config turned into a "Connection
# settings" step that Smithery flagged Required — forcing a key to connect and breaking
# the no-signup funnel. The "No config schema provided" warning is cosmetic; leave it.
echo "[$TS] freshness heartbeat → smithery mcp publish https://dchub.cloud/mcp -n azmartone67/dchub" >> "$LOG"
OUT="$(smithery mcp publish https://dchub.cloud/mcp -n azmartone67/dchub 2>&1)"
RC=$?
echo "$OUT" >> "$LOG"
echo "[$TS] exit=$RC" >> "$LOG"

# ── DEAD-MAN BEAT (2026-09-03) ───────────────────────────────────────────────
# This agent is the freshness INSURANCE for the Smithery listing, and until now
# its only record was this local file. If it silently stopped — a moved binary, a
# revoked credential, an unloaded plist — the listing would go stale with nothing
# anywhere saying so. It beats /api/v1/ops/deadman now, like every other loop.
# `smithery mcp publish` returning non-zero is a LOOP failure -> RED.
# shellcheck source=scripts/agent_beat.sh
. "$(dirname "$0")/agent_beat.sh" 2>/dev/null || agent_beat() { :; }
if [ "$RC" -eq 0 ]; then BEAT_ST="success"; else BEAT_ST="run_failed"; fi
# cadence 48h, not the 24h tick: laptop agent, alarm when it has been gone ~4
# days rather than when one closed lid delays a daily run. See the cadence note
# in rank_defense_master_shell.sh.
agent_beat "agent:smithery-freshness" "$BEAT_ST" 48 "smithery mcp publish rc=$RC" \
  | while IFS= read -r l; do echo "[$TS] $l" >> "$LOG"; done

echo "----" >> "$LOG"
exit $RC
