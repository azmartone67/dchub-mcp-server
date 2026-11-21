// lib/lazy-auth.mjs — lazy (mixed) OAuth at the wall on the generic /mcp endpoint (owner item 3, 2026-11-21).
//
// WHY. Free answers stay keyless, and sign-in was never offered at the moment it is worth something: over 30 days
// the connector OAuth challenge count was 0 and OAuth sign-ins completed were 0. Claude starts its sign-in only when
// an HTTP request fails with 401 + `WWW-Authenticate: Bearer resource_metadata=...` (MCP authorization spec,
// "lazy authentication"): it shows an inline Connect card and, once the person signs in, retries the SAME call with
// the bearer. So a walled keyless tools/call from an allow-listed client is answered with that 401 instead of the
// preview, and the retried call (bearer -> resolveWorkosBearer -> the person's durable key) gets the answer.
//
// WHAT (behind DCHUB_LAZY_AUTH_V1, default OFF; on only for 1 / true / yes / on):
//   * only the generic /mcp path: /mcp/claude, /mcp/chatgpt, /mcp/core, the packs and the client paths never;
//   * only tools/call, only with NO credential at all (no X-API-Key, no Authorization header, no ?api_key=, no
//     inline key, no restored session key), only while WorkOS validation is on (without it the retried bearer could
//     not be validated), never for an execute_plan step;
//   * only for allow-listed clients (DCHUB_LAZY_AUTH_CLIENTS, default "claude": the claude.ai connector, recognised
//     the way the existing connector challenge recognises it). A ChatGPT / OpenAI client is never answered with
//     the 401 here, whatever the list says: ChatGPT needs the tool-level form below, held for the store resubmission;
//   * only when the call is WALLED, pre-detected before the MCP SDK runs (see lazyAuthWalled below);
//   * a stable 20% holdout of eligible callers keeps today's 200 preview (salted sha256 of the caller identity);
//   * a bound: after DCHUB_LAZY_AUTH_MAX challenges (default 3) for one identity the call is served, so a client
//     that cannot finish the sign-in is never locked out.
// The 401 names the PRM the /mcp/oauth URL already uses (MCP_OAUTH_CHALLENGE, lib/mcp-oauth-path.mjs): resource
// https://dchub.cloud/mcp, which is the audience resolveWorkosBearer enforces on bare /mcp by default, so the token
// the client brings back is accepted on /mcp with no new audience.
//
// "Walled" before the SDK runs is an APPROXIMATION (lazyAuthWalled): keyless + the tool is in the keyless-gated set
// server.mjs passes in (PAID_ONLY_TOOLS: a keyless call to one of these gets a preview or a wall) + this caller has
// already used its keyless allowance for that tool today. The allowance is the largest of: DCHUB_LAZY_AUTH_AFTER_N
// (default 1: the first keyless call to a gated tool each day is always served, "ask after value"), the keyless
// first-full cap for tools in that lane, the keyless full-trial cap (when that trial is on) and the keyless daily
// site-run cap for analyze_site (when that lane is on). It is counted in this process, per caller per tool per UTC
// day, so it does not see the backend's durable per-IP counters, the anonymous daily cap or the session's pack
// credits: after a restart, on the other service, or for a caller the backend would still serve in full, it can
// only under-count, which serves the call (fails open). A keyless session holding pack credits is read before the
// 401 (server.mjs _getCredits, the same balance read the tool gates use) and served.
//
// Identity: the MCP session (the claude.ai connector initializes once and carries its session on every call), else
// the caller IP. Not IP first: the connector egresses from a shared pool, and an IP key would count one person's
// calls against another's allowance.
//
// Recording: the challenge is counted where the retention summary reads it (server.mjs _chBump 'claude_connector'
// + 'challenge_issued', method tools/call) and in mcp_4xx_by_client_daily (origin half) with reason 'lazy_auth'.
// A served eligible call carries params._lazy_auth on its mcp_call_log row ('holdout' or 'challenge_bound') via
// withLazyAuthTrackArm, the same key-in-params pattern lib/wall-paid-line.mjs uses for _wall_paid_line.
// No network, no copy change: the 401 body is a plain sign-in sentence (no price, no plan name).
import { createHash } from 'node:crypto';
import { MCP_OAUTH_CHALLENGE } from './mcp-oauth-path.mjs';
import { KEYLESS_FIRST_FULL_TOOLS, keylessFirstFullOn, keylessFirstFullCap } from './keyless-first-full.mjs';
import { keylessFullTrialOn, keylessFullTrialTools, keylessFullTrialCap,
         KEYLESS_SITE_FULL_TOOLS, keylessSiteFullOn, keylessSiteFullCap } from './keyless-full-trial.mjs';

export const LAZY_AUTH_FLAG = 'DCHUB_LAZY_AUTH_V1';
export function lazyAuthOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[LAZY_AUTH_FLAG]) || '').trim());
}

export const LAZY_AUTH_PATH = '/mcp';
// One literal for the /mcp PRM challenge: the one /mcp/oauth already sends.
export const LAZY_AUTH_CHALLENGE = MCP_OAUTH_CHALLENGE;
export const LAZY_AUTH_MESSAGE = 'Sign in to DC Hub to see the full result of this tool.';
export const LAZY_AUTH_4XX_REASON = 'lazy_auth';

export const ARM_CHALLENGE = 'challenge';
export const ARM_HOLDOUT = 'holdout';
export const ARM_CHALLENGE_BOUND = 'challenge_bound';   // challenge arm, past the per-identity bound: served
export const LAZY_AUTH_ARMS = Object.freeze([ARM_CHALLENGE, ARM_HOLDOUT, ARM_CHALLENGE_BOUND]);
export const TRACK_FIELD = '_lazy_auth';                 // mcp_call_log.params key
export const HOLDOUT_SHARE = 0.2;

const _int = (raw, dflt, min = 0) => {
  const t = String(raw == null ? '' : raw).trim();
  if (!/^\d+$/.test(t)) return dflt;                     // never Number('') === 0
  const n = Number.parseInt(t, 10);
  return Number.isSafeInteger(n) && n >= min ? n : dflt;
};
export function lazyAuthAfterN(env = process.env) { return _int(env && env.DCHUB_LAZY_AUTH_AFTER_N, 1); }
export function lazyAuthMax(env = process.env) { return _int(env && env.DCHUB_LAZY_AUTH_MAX, 3); }

// ── Clients ──────────────────────────────────────────────────────────────────
const OPENAI_RE = /chatgpt|openai/i;
export function isOpenAiClient({ clientName = '', ua = '' } = {}) {
  return OPENAI_RE.test(String(clientName || '')) || OPENAI_RE.test(String(ua || ''));
}
// Same matching as the existing connector challenge's allow-list (server.mjs _challengeClientAllowed): "claude"
// covers the claude.ai connector by its clientInfo name or its remembered identity (isClaudeConnector); a nameless
// caller is never allowed, and '*' means every IDENTIFIED client. ChatGPT / OpenAI: never (held, see top).
export function lazyAuthClientAllowed({ clientName = '', isClaudeConnector = false, ua = '', env = process.env } = {}) {
  if (isOpenAiClient({ clientName, ua })) return false;
  const raw = (env && env.DCHUB_LAZY_AUTH_CLIENTS != null) ? env.DCHUB_LAZY_AUTH_CLIENTS : 'claude';
  const list = String(raw).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  if (isClaudeConnector && list.includes('claude')) return true;
  const n = String(clientName || '').trim().toLowerCase();
  if (!n) return false;
  if (list.includes('*')) return true;
  return list.some((e) => e === n || (e === 'claude' && (n === 'claude-ai' || n === 'claude' || n === 'claude-user')));
}

// ── Identity and arm ─────────────────────────────────────────────────────────
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export function lazyAuthIdentity({ sessionId = '', callerKey = '' } = {}) {
  const s = String(sessionId || '').trim();
  if (s && s !== 'no-session') return 's-' + sha(s);
  const k = String(callerKey || '').trim();
  return k ? 'ip-' + sha(k) : '';
}
// Its own salt, so this split is independent of every other hash split in the stack.
const ARM_SALT = 'dchub:lazy-auth-v1|';
export function lazyAuthArm(identity) {
  const id = String(identity || '').trim();
  if (!id) return null;
  const unit = createHash('sha256').update(ARM_SALT + id).digest().readUInt32BE(0) / 0x100000000;
  return unit < HOLDOUT_SHARE ? ARM_HOLDOUT : ARM_CHALLENGE;
}

// ── Walled pre-check ─────────────────────────────────────────────────────────
// The keyless answers this caller gets on `tool` per UTC day before the wall.
export function lazyAuthAllowance(tool, env = process.env) {
  let n = lazyAuthAfterN(env);
  try {
    if (KEYLESS_FIRST_FULL_TOOLS.includes(tool) && keylessFirstFullOn(env)) n = Math.max(n, keylessFirstFullCap(env));
    if (keylessFullTrialOn(env) && keylessFullTrialTools(env).has(tool)) n = Math.max(n, keylessFullTrialCap(env));
    if (KEYLESS_SITE_FULL_TOOLS.includes(tool) && keylessSiteFullOn(env)) n = Math.max(n, keylessSiteFullCap(env));
  } catch (_) { /* the floor stands */ }
  return n;
}

const MAX_KEYS = 20000;
function _bump(map, k) {
  if (map.size >= MAX_KEYS) {
    let i = 0; const drop = MAX_KEYS / 10;
    for (const key of map.keys()) { map.delete(key); if (++i >= drop) break; }
  }
  const n = (map.get(k) || 0) + 1;
  map.set(k, n);
  return n;
}
export function createLazyAuthState() {
  return { seen: new Map(), challenged: new Map() };
}
const _state = createLazyAuthState();
export function _resetLazyAuthState() { _state.seen.clear(); _state.challenged.clear(); }

// Is this keyless call walled? Counts the call (per identity, tool, UTC day) and answers whether the caller had
// already used its allowance before it.
export function lazyAuthWalled({ identity, tool, gatedTools, env = process.env, now = new Date(), state = _state }) {
  if (!identity || !tool || !gatedTools || typeof gatedTools.has !== 'function' || !gatedTools.has(tool)) return false;
  const day = now.toISOString().slice(0, 10);
  const prior = _bump(state.seen, identity + '|' + tool + '|' + day) - 1;
  return prior >= lazyAuthAllowance(tool, env);
}

// ── The decision ─────────────────────────────────────────────────────────────
// Returns { action: 'none' | 'serve' | 'challenge', arm?, reason }. 'none' touches no state (flag off, out of
// scope); 'serve' with an arm means an eligible walled call that is served (holdout, or past the bound).
export function lazyAuthDecide({
  env = process.env, path, method, tool, hasCredential, workosEnabled, planStep = false,
  clientName = '', isClaudeConnector = false, ua = '', sessionId = '', callerKey = '',
  gatedTools, now = new Date(), state = _state,
} = {}) {
  if (!lazyAuthOn(env)) return { action: 'none', reason: 'flag_off' };
  if (String(path || '') !== LAZY_AUTH_PATH) return { action: 'none', reason: 'path' };
  if (method !== 'tools/call') return { action: 'none', reason: 'method' };
  if (hasCredential) return { action: 'none', reason: 'credential' };
  if (workosEnabled !== true) return { action: 'none', reason: 'workos_off' };
  if (planStep) return { action: 'none', reason: 'plan_step' };
  if (!lazyAuthClientAllowed({ clientName, isClaudeConnector, ua, env })) return { action: 'none', reason: 'client' };
  if (!gatedTools || typeof gatedTools.has !== 'function' || !gatedTools.has(tool)) return { action: 'none', reason: 'free_tool' };
  const identity = lazyAuthIdentity({ sessionId, callerKey });
  if (!identity) return { action: 'none', reason: 'no_identity' };
  if (!lazyAuthWalled({ identity, tool, gatedTools, env, now, state })) return { action: 'serve', reason: 'under_allowance' };
  const arm = lazyAuthArm(identity);
  if (arm === ARM_HOLDOUT) return { action: 'serve', arm: ARM_HOLDOUT, reason: 'holdout' };
  if ((state.challenged.get(identity) || 0) >= lazyAuthMax(env)) {
    return { action: 'serve', arm: ARM_CHALLENGE_BOUND, reason: 'bound' };
  }
  // Not counted yet: the caller first checks the session's pack credits (a keyless session holding credits is
  // served, CLAUDE.md "read the pack credit balance"), then calls noteLazyAuthChallenge when it does send the 401.
  return { action: 'challenge', arm: ARM_CHALLENGE, reason: 'walled', identity };
}
// Counts one 401 against the identity's bound. Called only when the 401 is actually sent.
export function noteLazyAuthChallenge(identity, state = _state) {
  if (identity) _bump(state.challenged, identity);
}

// The 401 the HTTP handler writes. JSON-RPC error body (advisory: the status and header carry the signal).
export function lazyAuthResponse(id) {
  return {
    status: 401,
    headers: { 'WWW-Authenticate': LAZY_AUTH_CHALLENGE },
    body: { jsonrpc: '2.0', error: { code: -32001, message: LAZY_AUTH_MESSAGE }, id: id ?? null },
  };
}

// The track row (/api/v1/mcp/track payload) of a served eligible call gains params._lazy_auth. `la` is the ctx's
// lazy_auth ({ arm, tool }); only that tool's row is marked, never twice. Returns the payload untouched otherwise.
export function withLazyAuthTrackArm(payload, la) {
  try {
    if (!payload || typeof payload !== 'object' || !la || !LAZY_AUTH_ARMS.includes(la.arm)) return payload;
    if (!la.tool || payload.tool !== la.tool) return payload;
    const p = (payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)) ? payload.params : {};
    if (p[TRACK_FIELD]) return payload;
    return { ...payload, params: { [TRACK_FIELD]: la.arm, ...p } };
  } catch (_) { return payload; }
}

// ── ChatGPT half: INERT, held for the store resubmission ─────────────────────
// ChatGPT (Apps SDK) offers account linking from a tool's `securitySchemes` in tools/list plus a tools/call result
// with isError:true and _meta["mcp/www_authenticate"]. /mcp/chatgpt is frozen at its reviewed tool list (adding
// securitySchemes there changes its tools/list bytes and needs a resubmission), and on generic /mcp this module never
// challenges a ChatGPT / OpenAI client. These builders are not wired anywhere; they are here so the resubmission
// starts from tested shapes. Wiring them needs a tools/list hook and an owner decision.
export const CHATGPT_SECURITY_SCHEMES = Object.freeze([
  Object.freeze({ type: 'noauth' }),
  Object.freeze({ type: 'oauth2', scopes: Object.freeze(['openid', 'profile', 'email', 'offline_access']) }),
]);
export function withChatgptSecuritySchemes(tool) {
  if (!tool || typeof tool !== 'object') return tool;
  const schemes = CHATGPT_SECURITY_SCHEMES.map((s) => ({ ...s, ...(s.scopes ? { scopes: [...s.scopes] } : {}) }));
  return { ...tool, securitySchemes: schemes, _meta: { ...(tool._meta || {}), securitySchemes: schemes } };
}
export function chatgptLazyAuthResult() {
  return {
    content: [{ type: 'text', text: LAZY_AUTH_MESSAGE }],
    isError: true,
    _meta: { 'mcp/www_authenticate': [LAZY_AUTH_CHALLENGE] },
  };
}
