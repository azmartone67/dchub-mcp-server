// Internal challenge state (2026-10-25): what the anonymous-connector OAuth
// challenge would do for THIS caller, read by our own sentinel probe.
//
// WHY. dchub-backend routes/site_sentinel.py probes the challenge black-box:
// anonymous tools/call until a 401. It runs from the backend's one egress IP,
// and the server bounds challenges at CHALLENGE_MAX per caller key, in memory,
// until it restarts. After the first runs the probe can never see a 401, so it
// reported INDETERMINATE (healthy) whether the challenge worked or was switched
// off ("saw [200, 200, 200]", 2026-10-25 23:38Z). This answers the two questions
// a black box cannot: is the challenge ON, and has this caller used its budget.
//
// INTERNAL ONLY: served behind X-Internal-Key. It names no IP and no session,
// only which header the caller key came from and the counts for that key.

// The caller key the challenge bound uses (server.mjs, r-challenge-bound): the
// edge's client IP, then the first X-Forwarded-For hop. The live handler falls
// back to the session id after this; a state read has no session.
export function challengeCallerKey(headers = {}) {
  const h = headers || {};
  const edge = String(h['x-dc-client-ip'] || '').trim();
  if (edge) return { key: edge, source: 'x-dc-client-ip' };
  const xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return { key: xff, source: 'x-forwarded-for' };
  return { key: '', source: 'none' };
}

// The state body. Every input is what the live challenge reads, passed in so
// the same values drive both. `effective` is 'off' when any gate the live
// handler checks would stop every challenge, with each such gate named.
export function challengeState({ workosEnabled, killSwitch, claudeAllowed, afterN, max,
  issued, callerKeySource, replica = null, uptimeS = null } = {}) {
  const off = [];
  if (!workosEnabled) off.push('DCHUB_WORKOS_OAUTH_ENABLED is not on');
  if (killSwitch) off.push('DCHUB_OAUTH_CHALLENGE_DISABLE is on');
  if (!(Number(max) > 0)) off.push('DCHUB_CHALLENGE_MAX is 0');
  if (!claudeAllowed) off.push('DCHUB_CHALLENGE_CLIENTS does not include claude');
  const n = Number.isSafeInteger(Number(issued)) && Number(issued) > 0 ? Number(issued) : 0;
  const cap = Number.isSafeInteger(Number(max)) && Number(max) > 0 ? Number(max) : 0;
  return {
    effective: off.length ? 'off' : 'on',
    off_reasons: off,
    challenge_after_n: Number(afterN),
    challenge_max: cap,
    caller_key_source: callerKeySource || 'none',
    caller_challenges_issued: n,
    caller_budget_left: Math.max(0, cap - n),
    replica,
    uptime_s: uptimeS,
    note: 'Per replica, in memory, since this process started. Counts are for the caller key of THIS request.',
  };
}
