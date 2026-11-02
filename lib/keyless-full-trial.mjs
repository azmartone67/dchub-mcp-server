// keyless-full-trial.mjs -- the two-week keyless full-answer trial (owner-approved 2026-10-28,
// "do 1"). Ships OFF.
//
// With DCHUB_KEYLESS_FULL_TRIAL on, a keyless caller gets the answer a FREE KEY gets on a short
// list of tools (default get_facility, get_grid_data, get_market_dcpi_rank) instead of the keyless
// preview, up to DCHUB_KEYLESS_FULL_TRIAL_CAP answers per tool per caller IP per UTC day (default
// 2). Past the cap the caller gets today's preview. "The answer a free key gets" is literal: the
// dispatch promotes the call to the free key's gate and the free key's masks, so nothing above
// free-key depth is ever served (facility MW and specs, DCPI sub-scores, kWh and risk bullets
// stay masked exactly as they are for a free key).
//
// Who is in the trial (keylessFullTrialSeat):
//   * keyless only: any key, of any tier, keeps its own path;
//   * the main /mcp profile, /mcp/claude and /mcp/core; never /mcp/chatgpt (frozen during the
//     OpenAI review; it has DCHUB_CHATGPT_FIRST_FULL) nor an execute_plan step started there;
//   * not a bot or one of our own internal callers (isBotOrInternalCtx);
//   * not a QA caller (UA dchub-qa-readonly, header X-DCHub-QA: 1, our self-test UAs). A QA
//     caller consumes nothing and is counted nowhere. It can SEE the trial path only with the
//     test-only ctx override `keyless_full_trial_qa_override: true`, which no HTTP request can
//     set (the request ctx is built field by field in server.mjs); then the answer is served
//     without charging the counter or tagging telemetry ('observe');
//   * a caller with a usable, non-loopback IP: the counter is per IP, and an execute_plan step
//     arrives from 127.0.0.1, which every caller would share.
//
// Switches (read per call, so a test can flip them):
//   DCHUB_KEYLESS_FULL_TRIAL        only 1/on/true/yes enable it; anything else is OFF.
//   DCHUB_KEYLESS_FULL_TRIAL_TOOLS  comma list; unset or blank = the three tools. A name outside
//                                   the three is ignored: the free-key parity of every other tool
//                                   has not been verified, so the list can only narrow.
//   DCHUB_KEYLESS_FULL_TRIAL_CAP    full answers per tool per IP per UTC day, default 2, 0 = none.

export const KEYLESS_FULL_TRIAL_TOOLS_DEFAULT = Object.freeze(['get_facility', 'get_grid_data', 'get_market_dcpi_rank']);
const _SUPPORTED = new Set(KEYLESS_FULL_TRIAL_TOOLS_DEFAULT);
export const KEYLESS_FULL_TRIAL_CAP_DEFAULT = 2;
// The backend's durable full-answer counter accepts caps 0-1000 (routes/mcp_full_cap.py).
const _CAP_MAX = 1000;
// The mcp_call_log.status / mcp_tool_calls.gate_status a trial-served full answer is logged with.
export const KEYLESS_FULL_TRIAL_STATUS = 'keyless_full_trial';
// The counter identity prefix (mcp_full_answer_counts.identity): 'kft:' + the per-IP identity the
// keyless cap wall uses (lib/keyless-wall.mjs capWallIdentity: 'ip-' + sha256 of the IP).
export const KEYLESS_FULL_TRIAL_ID_PREFIX = 'kft:';
// The test-only ctx field that lets a QA caller see the trial path (see above).
export const KEYLESS_FULL_TRIAL_QA_OVERRIDE = 'keyless_full_trial_qa_override';

export function keylessFullTrialOn(env = process.env) {
  return /^(1|on|true|yes)$/i.test(String((env && env.DCHUB_KEYLESS_FULL_TRIAL) || '').trim());
}

export function keylessFullTrialTools(env = process.env) {
  const raw = String((env && env.DCHUB_KEYLESS_FULL_TRIAL_TOOLS) || '').trim();
  if (!raw) return new Set(KEYLESS_FULL_TRIAL_TOOLS_DEFAULT);
  return new Set(raw.split(',').map((s) => s.trim()).filter((s) => _SUPPORTED.has(s)));
}

export function keylessFullTrialCap(env = process.env) {
  const raw = String((env && env.DCHUB_KEYLESS_FULL_TRIAL_CAP) || '').trim();
  if (!raw) return KEYLESS_FULL_TRIAL_CAP_DEFAULT;
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v)) return KEYLESS_FULL_TRIAL_CAP_DEFAULT;
  return Math.min(_CAP_MAX, Math.max(0, v));
}

const _LOOPBACK_IP_RE = /^(127\.|::1$|::ffff:127\.)/i;

// 'charge' = serve the free key's answer and charge the counter; 'observe' = a QA caller with
// the test-only override: serve it, charge nothing, tag nothing; null = today's path.
// deps: { env, directoryProfile, allowedProfiles: [..], isQa(c), isBot(c) }.
export function keylessFullTrialSeat(name, c, deps = {}) {
  const env = deps.env || process.env;
  if (!keylessFullTrialOn(env)) return null;
  if (!keylessFullTrialTools(env).has(String(name || ''))) return null;
  if (!(keylessFullTrialCap(env) > 0)) return null;
  if (!c || typeof c !== 'object' || c.api_key) return null;
  return _callerSeat(c, deps);
}

// ── The daily site lane (owner 2026-11-01, Grok growth plan item 1) ─────────────────────────
// analyze_site is a Land & Power tool: a free key has no plain gate to borrow there (it gets 3
// full runs a month from the backend counter, then the preview), so the trial above cannot reach
// it. This lane serves the FULL analyze_site answer DCHUB_KEYLESS_SITE_FULL_CAP times per caller
// IP per UTC day (default 2), on the same counter store and identity as the trial ('kft:' + IP,
// bucket analyze_site). Same caller rules as the trial (profiles, QA, bots, loopback), plus:
//   * keyless callers, from the Land & Power wall;
//   * a key below Pro (deps.keyed true) only when its monthly free runs did not serve the call
//     (spent, switched off, or the counter did not answer), so a key is never worse off than no
//     key: it gets its monthly runs first, then the same daily ones.
// Switches (read per call):
//   DCHUB_KEYLESS_SITE_FULL       ON unless 0/false/no/off (owner asked for it live 2026-11-01).
//   DCHUB_KEYLESS_SITE_FULL_CAP   full answers per IP per UTC day, default 2, 0 = none.
export const KEYLESS_SITE_FULL_TOOLS = Object.freeze(['analyze_site']);
export const KEYLESS_SITE_FULL_CAP_DEFAULT = 2;

export function keylessSiteFullOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_KEYLESS_SITE_FULL) || '').trim());
}

export function keylessSiteFullCap(env = process.env) {
  const raw = String((env && env.DCHUB_KEYLESS_SITE_FULL_CAP) || '').trim();
  if (!raw) return KEYLESS_SITE_FULL_CAP_DEFAULT;
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v)) return KEYLESS_SITE_FULL_CAP_DEFAULT;
  return Math.min(_CAP_MAX, Math.max(0, v));
}

// A daily-lane answer: structuredContent carries the daily_site_runs block the server stamps on it
// (server.mjs _withKeylessSiteRun). It is the free run the caller was promised, so it is not a wall
// even when a paid field inside it is withheld (time_to_power_months, a DCPI Pro figure): no
// "paid data boundary" relay, no "open the link, then ask again", no /mcp/claude sign-in swap.
export function isKeylessSiteRun(sc) {
  const b = sc && typeof sc === 'object' && !Array.isArray(sc) ? sc.daily_site_runs : null;
  return !!(b && typeof b === 'object' && Number.isFinite(b.used) && b.used >= 1);
}

// Same answers as keylessFullTrialSeat. deps.keyed: the caller holds a key below Pro whose
// monthly runs did not serve the call (the server decides that; a key is refused here otherwise).
export function keylessSiteFullSeat(name, c, deps = {}) {
  const env = deps.env || process.env;
  if (!keylessSiteFullOn(env)) return null;
  if (!KEYLESS_SITE_FULL_TOOLS.includes(String(name || ''))) return null;
  if (!(keylessSiteFullCap(env) > 0)) return null;
  if (!c || typeof c !== 'object') return null;
  if (c.api_key && deps.keyed !== true) return null;
  return _callerSeat(c, deps);
}

function _callerSeat(c, deps) {
  // /mcp/chatgpt, and an execute_plan step started there, are frozen.
  if (deps.directoryProfile && c.profile === deps.directoryProfile) return null;
  if (c.legacy_wall_copy === true) return null;
  // Explicit allowlist: the main /mcp profile (no profile), /mcp/claude, /mcp/core.
  const allowed = new Set(deps.allowedProfiles || []);
  if (c.profile && !allowed.has(c.profile)) return null;
  let qa = false;
  try { qa = !!(deps.isQa && deps.isQa(c)); } catch (_) { qa = true; }   // unreadable = treated as ours
  if (qa) return c[KEYLESS_FULL_TRIAL_QA_OVERRIDE] === true ? 'observe' : null;
  let bot = false;
  try { bot = !!(deps.isBot && deps.isBot(c)); } catch (_) { bot = true; }
  if (bot) return null;
  const ip = String(c.client_ip || '').trim();
  if (!ip || _LOOPBACK_IP_RE.test(ip)) return null;
  return 'charge';
}
