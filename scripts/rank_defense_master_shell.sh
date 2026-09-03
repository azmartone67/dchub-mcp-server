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

# Overridable so this script can be EXERCISED by a test instead of only read by one.
# Stage 3 shipped three separate defects that a source-reading test cannot catch (a
# silent redirect failure, a stale second source of truth, and a remedy fired when no
# remedy was needed); test/rank-defense-staging.test.mjs now runs the real file.
REPO="${RANK_DEFENSE_REPO:-/Users/jonathanmartone/dchub-mcp-server}"
cd "$REPO" 2>/dev/null || { echo "rank-defense: repo missing at $REPO" >&2; exit 0; }
PY="${RANK_DEFENSE_PY:-$(command -v python3 || echo /usr/bin/python3)}"
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
# The Smithery blurb has NO write API, so the fix is a human paste — but ONLY when a
# paste would ADD something. registry_monitor.py publishes `paste_pending`
# (true/false/unknown) from the monitored terms the repo carries vs the ones the LIVE
# search window already shows.
#
# ★2026-09-03 — THREE FAILURES THIS BLOCK USED TO HAVE, all found together:
#   1. It staged and said "open and paste" on EVERY slip. The live blurb already
#      carried every monitored term, so the paste was a no-op being asked of a human
#      every 90 minutes.
#   2. The write had failed SILENTLY 516 times since 2026-07-12 — macOS TCC denies a
#      launchd agent ~/Downloads. `> "$STAGED" 2>/dev/null && log ...` short-circuits
#      on a failed redirect, so there was no "staged" line AND no warning.
#   3. Because of (2) the file was frozen at a pre-#301 copy — "82 live MCP tools",
#      "20,100+ data centers" — so following the instruction would have REVERTED the
#      listing and re-introduced the drift white-glove exists to catch.
log "SLIP — CORE ${CORE_ONE}/9; remediate: ${REMEDIATE_TERMS}"
PASTE_PENDING="$(read_status paste_pending)"

if [ "$PASTE_PENDING" = "false" ]; then
  # NOT "no problem" — the slip is real. It is not a COPY problem.
  log "NO PASTE PENDING — the live Smithery window already carries every monitored term"
  log "  the repo does. A paste would change nothing; not staging a file."
  log "  This slip is a relevance loss, not a copy gap: see rrf_decode() in"
  log "  registry_monitor.py — a single-list hit cannot be walked up by adding words."
else
  [ "$PASTE_PENDING" = "unknown" ] && \
    log "  ⚠ paste_pending=UNKNOWN (live blurb unreadable) — staging anyway; an unmade"
  [ "$PASTE_PENDING" = "unknown" ] && \
    log "    paste is silent, a needless one is only noise."
  # Primary target is TCC-writable by a launchd agent. ~/Downloads is a best-effort
  # convenience copy, never the only copy.
  STAGE_DIR="${DCHUB_STAGE_DIR:-$HOME/Library/Application Support/dchub}"
  mkdir -p "$STAGE_DIR" 2>/dev/null
  STAGED="$STAGE_DIR/smithery-description-CURRENT.txt"
  DL_COPY="$HOME/Downloads/smithery-description-CURRENT.txt"
  # displayName lives in smithery.yaml — the file `smithery mcp publish` reads and the
  # one that matches the live listing. scripts/smithery_title.txt was a second copy
  # that only this block read; it had gone stale and would have dropped "Power" and
  # "Energy" from the title, two terms we hold #1 on. Deleted 2026-09-03.
  TITLE="$(sed -n 's/^displayName:[[:space:]]*"\(.*\)"[[:space:]]*$/\1/p' smithery.yaml 2>/dev/null | head -1)"
  if [ -f scripts/smithery_description.txt ] && [ -n "$TITLE" ]; then
    if {
      echo "# Paste into https://smithery.ai/servers/azmartone67/dchub → Edit"
      echo "# (the ONLY path to Smithery's rank score — no CLI/API reaches it)"
      echo "# staged $(date '+%Y-%m-%d %H:%M %Z')  paste_pending=${PASTE_PENDING}"
      echo "# terms live is missing: $(read_status paste_pending_terms)"
      echo; echo "TITLE:"; echo "$TITLE"
      echo; echo "DESCRIPTION:"; cat scripts/smithery_description.txt
    } > "$STAGED"; then
      log "REMEDY staged → $STAGED  (open, select-all, paste into the Smithery Edit form)"
      if cp -f "$STAGED" "$DL_COPY" 2>/dev/null; then
        log "  also copied → $DL_COPY"
      else
        log "  ⚠ could NOT copy to ~/Downloads (macOS TCC denies launchd agents that"
        log "    folder). Use $STAGED. Any file already in ~/Downloads is STALE — do not paste it."
      fi
    else
      log "🚨 REMEDY NOT STAGED — could not write $STAGED. Paste"
      log "   scripts/smithery_description.txt by hand. Do NOT paste an older staged copy."
    fi
  else
    log "REMEDY: paste a term-front-loaded description into smithery.ai/servers/azmartone67/dchub → Edit"
    log "  (canonical text: scripts/smithery_description.txt)"
    [ -n "$TITLE" ] || log "  ⚠ displayName not found in smithery.yaml — title not staged"
  fi
  # sanity: warn if a slipped term isn't even in the canonical text (needs adding there first)
  for t in ${REMEDIATE_TERMS//,/ }; do
    grep -qi "$t" scripts/smithery_description.txt || log "  ⚠ '$t' NOT in canonical description — add it to scripts/smithery_description.txt first"
  done
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
