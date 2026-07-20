#!/usr/bin/env bash
# ============================================================================
# DC Hub — Distribution Master Shell
#
# ONE orchestrator for the "get listed everywhere + stay fresh" loop, consolidating
# what the 07-14 audit found scattered/idle. Same house style as the Rank Defense
# master shell (kill-switch gate + dead-man heartbeat + staged logging).
#
# STAGES
#   1 DETECT     served-manifest version drift (served /.well-known/mcp.json vs the
#                canonical server.json) — catches the "source 2.5.0 but served 2.4.x"
#                self-contradiction agents can see.
#   2 ADD+REFRESH  registry-pr-submit.mjs — now ADDS to missing curated lists AND
#                REFRESHES stale existing entries (e.g. punkpeye "33 tools" → 73).
#                Fires live only when armed (REGISTRY_PR_PAT + REGISTRY_PR_LIVE=1);
#                otherwise dry-runs and reports what it WOULD do.
#   3 ALERT      pull-only surfaces with no push API (LobeHub / PulseMCP / Cursor)
#                that need an owner "Refresh Metadata" click — surfaced, not silently
#                left stale. (mcp.so is dead/404 — noted, not chased.)
#   4 HEARTBEAT  state/distribution_heartbeat.json (dead-man sentinel).
#
# KILL-SWITCHES:  DIST_MASTER_DISABLE=1 → whole shell no-ops (still heartbeats).
#                 (registry-pr-submit itself stays dry-run unless PAT + LIVE are set.)
#
# Runs from: cloud.dchub.distribution LaunchAgent (weekly) + optionally the CI
# registry-pr-submit.yml. Safe to run by hand.
# ============================================================================
set -uo pipefail
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

REPO="/Users/jonathanmartone/dchub-mcp-server"
cd "$REPO" 2>/dev/null || { echo "distribution: repo missing at $REPO" >&2; exit 0; }
PY="$(command -v python3 || echo /usr/bin/python3)"
NODE="$(command -v node || echo /usr/local/bin/node)"
LOG="${DIST_LOG:-$HOME/Library/Logs/dchub-distribution.log}"
HEARTBEAT="state/distribution_heartbeat.json"
TS="$(date '+%Y-%m-%d %H:%M:%S %Z')"
log() { echo "[$TS] $*" | tee -a "$LOG" >/dev/null; }

heartbeat() {  # $1=served_ok $2=note
  mkdir -p state 2>/dev/null
  printf '{\n "ts": "%s",\n "served_version_ok": %s,\n "note": "%s"\n}\n' \
    "$TS" "${1:-null}" "${2:-}" > "$HEARTBEAT" 2>/dev/null || true
}

if [ "${DIST_MASTER_DISABLE:-}" = "1" ]; then
  log "DISABLED (DIST_MASTER_DISABLE=1) — no-op"; heartbeat null disabled; exit 0
fi

# ---- STAGE 1: DETECT served-manifest version drift ----
CANON="$("$PY" -c "import json; print(json.load(open('server.json'))['version'])" 2>/dev/null)"
SERVED="$(curl -s https://dchub.cloud/.well-known/mcp.json 2>/dev/null | "$PY" -c "import json,sys; print(json.load(sys.stdin).get('version',''))" 2>/dev/null)"
if [ -n "$CANON" ] && [ -n "$SERVED" ] && [ "$CANON" != "$SERVED" ]; then
  SERVED_OK=false
  log "🔻 SERVED-VERSION DRIFT: /.well-known/mcp.json serves v$SERVED but canonical server.json is v$CANON — the CF worker MCP_SERVER_INFO.version const is stale; bump it + redeploy the worker."
else
  SERVED_OK=true
  log "OK — served manifest v$SERVED matches canonical v$CANON"
fi

# ---- STAGE 2: ADD + REFRESH curated lists ----
log "registry-pr-submit (add missing + refresh stale) — armed=$([ -n "${REGISTRY_PR_PAT:-}" ] && [ "${REGISTRY_PR_LIVE:-}" = "1" ] && echo yes || echo no/dry-run)"
"$NODE" scripts/registry-pr-submit.mjs >>"$LOG" 2>&1 || log "registry-pr-submit exited non-zero (continuing)"

# ---- STAGE 3: ALERT pull-only stale surfaces (owner-refresh, no push API) ----
LOBE=$(curl -s -A "Mozilla/5.0" "https://lobehub.com/mcp/azmartone67-dchub-mcp-server" 2>/dev/null | grep -oiE '[0-9]+ tools' | head -1)
[ -n "$LOBE" ] && [ "$LOBE" != "79 tools" ] && \
  log "ℹ️ LobeHub shows '$LOBE' (live=79) — owner: open the listing → 'Refresh Metadata' (no push API). Same for PulseMCP + Cursor.directory."

# ---- STAGE 4: HEARTBEAT ----
heartbeat "$SERVED_OK" "served=$SERVED canon=$CANON"
log "distribution pass complete"
exit 0
