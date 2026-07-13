#!/usr/bin/env bash
# ============================================================================
# DC Hub — Rank Defense Master Shell
#
# ONE autonomous entry point for the "always #1" self-* loop. Consolidates what
# was scattered across registry_monitor.py (detect), the freshness heartbeat
# (insurance reflex) and registry-pr-submit (relevance auto-PR) into a single
# staged orchestrator, in the same spirit as the backend master shells
# (kill-switch gate + dead-man heartbeat + staged logging).
#
# STAGES
#   1 DETECT     registry_monitor.py --probe  → CORE/RECLAIM ranks, streak state,
#                and (inside the monitor) the insurance freshness reflex.
#   2 READ       parse state/rank_status.json (core_one, remediate, escalated).
#   3 ESCALATE   on a CORE slip, surface the RELEVANCE remedy (the ONLY Smithery
#                lever is the owner-UI description — recency/keywords barely move it).
#   4 AUTO-PR    on a ≥2-check streak AND armed (REGISTRY_PR_LIVE=1 + gh + PAT),
#                fire the automatable half: `gh workflow run registry-pr-submit.yml`.
#   5 HEARTBEAT  write state/rank_defense_heartbeat.json so a stalled loop is
#                itself detectable (dead-man sentinel).
#
# KILL-SWITCHES (DRY_RUN convention)
#   RANK_DEFENSE_DISABLE=1   → whole shell no-ops (still writes a heartbeat).
#   RANK_AUTOHEAL_DISABLE=1  → reflex + auto-PR become no-ops; detect+report stay.
#
# Runs from: cloud.dchub.rank-probe LaunchAgent (~90 min) and, as a backstop,
# registry-rank-monitor.yml (6h CI). Safe to run by hand.
# ============================================================================
set -uo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"   # launchd/CI minimal PATH

REPO="/Users/jonathanmartone/dchub-mcp-server"
cd "$REPO" 2>/dev/null || { echo "rank-defense: repo missing at $REPO" >&2; exit 0; }
PY="$(command -v python3 || echo /usr/bin/python3)"
LOG="${RANK_DEFENSE_LOG:-$HOME/Library/Logs/dchub-rank-defense.log}"
STATUS="state/rank_status.json"
HEARTBEAT="state/rank_defense_heartbeat.json"
TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"

log() { echo "[$TS] $*" | tee -a "$LOG" >/dev/null; }

heartbeat() {  # $1=core_one $2=remediate $3=note
  mkdir -p state 2>/dev/null
  printf '{\n "ts": "%s",\n "core_one": %s,\n "remediate": %s,\n "note": "%s"\n}\n' \
    "$TS" "${1:-null}" "${2:-false}" "${3:-}" > "$HEARTBEAT" 2>/dev/null || true
}

if [ "${RANK_DEFENSE_DISABLE:-}" = "1" ]; then
  log "DISABLED (RANK_DEFENSE_DISABLE=1) — no-op"
  heartbeat null false "disabled"
  exit 0
fi

# ---- STAGE 1: DETECT (monitor runs the probe + streak + insurance reflex) ----
"$PY" scripts/registry_monitor.py --probe >>"$LOG" 2>&1 || log "monitor probe exited non-zero (continuing)"

# ---- STAGE 2: READ machine-readable status ----
read_status() {  # $1 = key
  "$PY" - "$1" <<'PYEOF' 2>/dev/null
import json,sys
try:
    d=json.load(open("state/rank_status.json"))
except Exception:
    d={}
v=d.get(sys.argv[1])
if isinstance(v,bool): print("true" if v else "false")
elif isinstance(v,list): print(",".join(map(str,v)))
elif v is None: print("")
else: print(v)
PYEOF
}
CORE_ONE="$(read_status core_one)"; CORE_ONE="${CORE_ONE:-?}"
REMEDIATE_TERMS="$(read_status remediate)"
ESCALATED="$(read_status escalated)"

if [ -z "$REMEDIATE_TERMS" ]; then
  log "OK — CORE ${CORE_ONE}/9 at #1, no slip. (freshness/verified insurance healthy)"
  heartbeat "$CORE_ONE" false "ok"
  exit 0
fi

# ---- STAGE 3: ESCALATE (a CORE term slipped) ----
# The Smithery description has NO write API, so the fix is a human paste. We make it
# a ZERO-THOUGHT paste: auto-stage the current canonical description (source of truth
# scripts/smithery_description.txt, kept comprehensive + updated by the monthly
# re-teardown) to a fixed Downloads file. Human action = open + Ctrl-A + paste.
log "SLIP — CORE ${CORE_ONE}/9; remediate: ${REMEDIATE_TERMS}"
STAGED="$HOME/Downloads/smithery-description-CURRENT.txt"
if [ -f scripts/smithery_description.txt ] && [ -f scripts/smithery_title.txt ]; then
  {
    echo "# Paste into https://smithery.ai/servers/azmartone67/dchub → Edit"
    echo "# (the ONLY path to Smithery's rank score — no CLI/API reaches it)"
    echo; echo "TITLE:"; cat scripts/smithery_title.txt
    echo; echo "DESCRIPTION:"; cat scripts/smithery_description.txt
  } > "$STAGED" 2>/dev/null \
    && log "REMEDY staged → $STAGED  (open, select-all, paste into the Smithery Edit form)"
  # sanity: warn if a slipped term isn't even in the canonical text (needs adding there first)
  for t in ${REMEDIATE_TERMS//,/ }; do
    grep -qi "$t" scripts/smithery_description.txt || log "  ⚠ '$t' NOT in canonical description — add it to scripts/smithery_description.txt first"
  done
else
  log "REMEDY: paste a term-front-loaded description into smithery.ai/servers/azmartone67/dchub → Edit"
fi

# ---- STAGE 4: AUTO-PR (armed, ≥2-check streak only) ----
if [ -n "$ESCALATED" ]; then
  log "ESCALATED (≥2 consecutive checks): ${ESCALATED}"
  if [ "${RANK_AUTOHEAL_DISABLE:-}" = "1" ]; then
    log "auto-PR skipped (RANK_AUTOHEAL_DISABLE=1)"
  elif [ "${REGISTRY_PR_LIVE:-}" = "1" ] && command -v gh >/dev/null 2>&1; then
    if gh workflow run registry-pr-submit.yml >>"$LOG" 2>&1; then
      log "auto-PR: fired registry-pr-submit.yml (automatable half of the relevance fix)"
    else
      log "auto-PR: gh workflow run failed (needs REGISTRY_PR_PAT + gh auth) — owner action stands"
    fi
  else
    log "auto-PR NOT armed (set repo var REGISTRY_PR_LIVE=1 + secret REGISTRY_PR_PAT) — owner UI action is the fix"
  fi
fi

# ---- STAGE 5: HEARTBEAT ----
heartbeat "$CORE_ONE" true "slip:${REMEDIATE_TERMS}"
exit 0
