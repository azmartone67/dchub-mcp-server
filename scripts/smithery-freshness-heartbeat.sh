#!/usr/bin/env bash
# DC Hub MCP — Smithery freshness heartbeat (LOCAL agent).
#
# Re-publishes the Smithery listing so the structural signals — `verified`, the
# deployment record and the TOOL CATALOGUE — never rot. `smithery mcp publish`
# re-scans the live MCP server; no version bump or code change required.
#
# ★ RECENCY IS NOT A RANK LEVER, and this file used to imply it was. Smithery's
#   `score` is reciprocal rank fusion over two lists (k=30, fitted 231/240 obs
#   2026-09-03); `createdAt` is frozen at first publish and recency carries ~0
#   weight. Republishing keeps the listing CORRECT; it does not keep it #1.
#   Relevance does, and that remedy is owner-gated. So the cadence below is
#   sized for "don't let the catalogue rot", not for "outrun a competitor".
#
# Run by LaunchAgent cloud.dchub.smithery-freshness (~/Library/LaunchAgents),
# daily. .github/workflows/smithery-freshness.yml does the same publish daily at
# 14:23 UTC — this local agent is the redundant backup for a laptop that may be
# asleep at that hour.
#
# ★★ WHAT WAS WRONG HERE (measured 2026-09-05)
# ────────────────────────────────────────────
# `smithery mcp publish` exits 0 on {"status":"PENDING"} — the release being
# ACCEPTED, not the listing being UPDATED. This script beat the dead-man ledger
# `success` off that exit code, so the lane COULD NOT FAIL:
#
#     639 runs since 2026-06-21 · 637 of 637 releases report PENDING
#     · no terminal status has ever been observed · every beat: success
#
# The CI lane learned this on 2026-07-28 and verifies the OUTCOME. This one did
# not. It now runs the SAME check, from the same file both lanes share:
# scripts/verify_smithery_converged.py compares the registry's `tools` array
# against our live tools/list (names AND descriptions) and reports three
# outcomes, not two. See feedback: a guard that cannot fail is not a guard.
#
# Auth: the smithery CLI token lives in a FILE
# (~/Library/Application Support/smithery/settings.json), not the macOS keychain,
# so this runs headless under launchd with no keychain-unlock prompt.
set -uo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"   # launchd has a minimal PATH; smithery needs node

REPO="${SMITHERY_HEARTBEAT_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="${SMITHERY_HEARTBEAT_LOG:-$HOME/Library/Logs/dchub-smithery-freshness.log}"
PY="${SMITHERY_HEARTBEAT_PY:-$(command -v python3 || echo /usr/bin/python3)}"
# ★ The CLI is resolved through a VARIABLE so this file can be EXERCISED by a
# test instead of only read by one. The PATH line above prepends /usr/local/bin
# (where the real `smithery` lives), so a test that merely prepends a stub dir to
# PATH would still run a REAL publish against the live listing. Same pattern as
# RANK_DEFENSE_PY / RANK_DEFENSE_REPO in rank_defense_master_shell.sh.
SMITHERY_BIN="${SMITHERY_BIN:-smithery}"
TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"

# Convergence budget. Measured at ~60s when the CI lane was written; 20 x 30s
# gives the re-crawl 9m30s before this is called a failure.
CONVERGE_CHECKS="${SMITHERY_CONVERGE_CHECKS:-20}"
CONVERGE_INTERVAL="${SMITHERY_CONVERGE_INTERVAL:-30}"

# NO --config-schema: DC Hub is KEYLESS-FIRST (connect with zero config, then call
# claim_free_key in-session). Advertising the apiKey config turned into a "Connection
# settings" step that Smithery flagged Required — forcing a key to connect and breaking
# the no-signup funnel. The "No config schema provided" warning is cosmetic; leave it.
echo "[$TS] freshness heartbeat → smithery mcp publish https://dchub.cloud/mcp -n azmartone67/dchub" >> "$LOG"
OUT="$("$SMITHERY_BIN" mcp publish https://dchub.cloud/mcp -n azmartone67/dchub 2>&1)"
RC=$?
echo "$OUT" >> "$LOG"
echo "[$TS] publish exit=$RC" >> "$LOG"

# ── DID THE LISTING ACTUALLY CHANGE? ─────────────────────────────────────────
# Only asked when the publish itself succeeded: verifying convergence after a
# failed publish would report the PREVIOUS release's (correct) listing and call
# a broken run green. That ordering is the whole defect this block fixes.
CRC=-1
if [ "$RC" -eq 0 ]; then
  echo "[$TS] verifying the listing converged (budget ${CONVERGE_CHECKS}x${CONVERGE_INTERVAL}s)" >> "$LOG"
  "$PY" "$REPO/scripts/verify_smithery_converged.py" \
      --checks "$CONVERGE_CHECKS" --interval "$CONVERGE_INTERVAL" >> "$LOG" 2>&1
  CRC=$?
  echo "[$TS] converge exit=$CRC" >> "$LOG"
fi

# ── DEAD-MAN BEAT (2026-09-03) ───────────────────────────────────────────────
# This agent is the freshness INSURANCE for the Smithery listing, and until now
# its only record was this local file. If it silently stopped — a moved binary, a
# revoked credential, an unloaded plist — the listing would go stale with nothing
# anywhere saying so. It beats /api/v1/ops/deadman now, like every other loop.
#
# ★ THREE OUTCOMES, and the ledger has a status for each (routes/ingest_runs.py):
#     success           publish landed AND the listing serves what we serve
#     run_failed        the publish failed, or it was accepted and the listing
#                       never caught up — the lane is broken, page it
#     awaiting_upstream published fine, but we could not read our own tools/list
#                       so there was nothing to compare. NOT in _OK_STATUS: it
#                       shows as unhealthy without paging, which is what "we ran
#                       and could not verify" deserves. Green would be a lie and
#                       red would be a false alarm.
# shellcheck source=scripts/agent_beat.sh
. "$(dirname "$0")/agent_beat.sh" 2>/dev/null || agent_beat() { :; }
if [ "$RC" -ne 0 ]; then
  BEAT_ST="run_failed"; BEAT_NOTE="smithery mcp publish rc=$RC"
elif [ "$CRC" -eq 0 ]; then
  BEAT_ST="success"; BEAT_NOTE="published + listing converged"
elif [ "$CRC" -eq 2 ]; then
  BEAT_ST="awaiting_upstream"; BEAT_NOTE="published; convergence UNVERIFIED (own tools/list unreadable)"
else
  BEAT_ST="run_failed"; BEAT_NOTE="publish ACCEPTED but listing did not converge (converge rc=$CRC)"
fi
# cadence 48h, not the 24h tick: laptop agent, alarm when it has been gone ~4
# days rather than when one closed lid delays a daily run. See the cadence note
# in rank_defense_master_shell.sh.
agent_beat "agent:smithery-freshness" "$BEAT_ST" 48 "$BEAT_NOTE" \
  | while IFS= read -r l; do echo "[$TS] $l" >> "$LOG"; done

echo "[$TS] result=$BEAT_ST ($BEAT_NOTE)" >> "$LOG"
echo "----" >> "$LOG"
# The EXIT CODE is the lane's verdict, not the CLI's: a publish that was accepted
# and never landed must be non-zero for `launchctl`, for a human running this by
# hand, and for anything that ever wraps it.
[ "$BEAT_ST" = "run_failed" ] && exit 1
exit 0
