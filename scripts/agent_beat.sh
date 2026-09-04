#!/usr/bin/env bash
# ============================================================================
# DC Hub — local LaunchAgent → dead-man ledger
#
# WHY THIS EXISTS (2026-09-03)
# ---------------------------------------------------------------------------
# /api/v1/ops/deadman tracks 203 feeds and alarms when one stops beating. NOT
# ONE of them was a local LaunchAgent, so the three agents on this Mac were
# outside every watcher the project has.
#
# What that cost, measured: rank_defense_master_shell.sh failed to write its
# staged paste file 516 consecutive times between 2026-07-12 and 2026-09-03 —
# macOS TCC denies a launchd agent ~/Downloads — and nothing anywhere noticed.
# The shell even wrote state/rank_defense_heartbeat.json "so a stalled loop is
# itself detectable (dead-man sentinel)"; a grep of both repos found NO READER.
# A heartbeat nobody reads is a comment, not a sentinel.
#
# So these agents now beat the SAME ledger as everything else. No new endpoint:
# POST /api/v1/admin/ingest-runs/beat already exists and the off-worker watcher
# (.github/workflows/deadman-watch.yml) already alarms on 2x cadence.
#
# CONTRACT
#   agent_beat <feed> <status> <cadence_hours> [note]
#     returns 0 = beat recorded · 1 = beat FAILED · 2 = unconfigured (no key)
#   Always echoes exactly one line describing what happened, so the caller can
#   log it. It NEVER exits the caller and never prints the key.
#
# ★ `status` answers "did the LOOP run and do its job", never "is the product
#   healthy". A rank slip is a success beat: the loop worked. A staging write
#   that failed is `run_failed`, because that is the loop breaking.
#   Anything not in the ledger's _OK_STATUS set becomes a RED `run_failed`.
#
# ★ THE KEY IS NEVER PASSED IN argv. `curl -H "X-Admin-Key: $key"` would put
#   the admin key in the process table for anyone running `ps`. It goes in on
#   stdin via `curl --config -` instead.
# ============================================================================

# ── SETUP (one time, by the owner — nothing here can do it) ─────────────────
#   mkdir -p ~/.config/dchub
#   printf 'DCHUB_ADMIN_KEY=%s\n' "<the DCHUB_ADMIN_KEY value>" > ~/.config/dchub/agent.env
#   chmod 600 ~/.config/dchub/agent.env
#
# Until that file exists every beat prints "BEAT SKIPPED … INVISIBLE" into the
# agent's own log and the feeds never appear on the board. That is deliberate:
# an agent that cannot beat should SAY so on every run, not fail quietly — the
# whole reason this file exists is a failure that stayed quiet 516 times.
#
# The first successful beat REGISTERS the feed on /api/v1/ops/deadman; from then
# on the off-worker watcher alarms whenever it goes quiet. Verify with:
#   curl -s https://dchub.cloud/api/v1/ops/deadman | grep -o 'agent:[a-z-]*'
# ─────────────────────────────────────────────────────────────────────────────

AGENT_BEAT_URL="${AGENT_BEAT_URL:-https://dchub.cloud/api/v1/admin/ingest-runs/beat}"
AGENT_BEAT_ENV="${AGENT_BEAT_ENV:-$HOME/.config/dchub/agent.env}"

# Resolve the admin key WITHOUT echoing it. Env first, then a mode-restricted
# file the owner places (launchd gives an agent no shell profile, so an env var
# alone is not enough in practice).
_agent_beat_key() {
  if [ -n "${DCHUB_ADMIN_KEY:-}" ]; then printf '%s' "$DCHUB_ADMIN_KEY"; return 0; fi
  if [ -r "$AGENT_BEAT_ENV" ]; then
    # shellcheck disable=SC1090
    . "$AGENT_BEAT_ENV" 2>/dev/null || true
    if [ -n "${DCHUB_ADMIN_KEY:-}" ]; then printf '%s' "$DCHUB_ADMIN_KEY"; return 0; fi
  fi
  return 1
}

agent_beat() {
  local feed="$1" status="${2:-success}" cad="${3:-24}" note="${4:-}" key code body
  # note is free text from a caller; keep it JSON-safe rather than trusting it.
  note="$(printf '%s' "$note" | tr -d '"\\' | tr '\n' ' ' | cut -c1-200)"
  if ! key="$(_agent_beat_key)"; then
    echo "⚠ BEAT SKIPPED — no DCHUB_ADMIN_KEY in env and none in ${AGENT_BEAT_ENV}."
    echo "  '${feed}' is INVISIBLE to /api/v1/ops/deadman until that file exists."
    return 2
  fi
  body="$(printf '{"feed":"%s","status":"%s","cadence_hours":%s,"note":"%s"}' \
          "$feed" "$status" "$cad" "$note")"
  code="$(printf 'url = "%s"\nrequest = "POST"\nuser-agent = "dchub-agent-beat/1.0"\nheader = "Content-Type: application/json"\nheader = "X-Admin-Key: %s"\ndata = "%s"\n' \
            "$AGENT_BEAT_URL" "$key" "${body//\"/\\\"}" \
          | curl -s -m 12 -o /dev/null -w '%{http_code}' --config - 2>/dev/null)"
  unset key
  if [ "$code" = "200" ]; then
    echo "beat → ${feed} status=${status} cadence=${cad}h (deadman recorded)"
    return 0
  fi
  echo "🚨 BEAT FAILED — ${feed} got HTTP ${code:-000} from ${AGENT_BEAT_URL}."
  echo "  This agent is UNWATCHED until a beat succeeds."
  return 1
}
