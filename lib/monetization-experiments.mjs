// lib/monetization-experiments.mjs — the Nov 22 monetization tests with holdouts (owner relay from Grok's funnel
// review, 2026-11-22). DRAFT: every flag defaults OFF; a test goes live only on the owner's word.
//
// SHARED (both sides compute the same arm; dchub-backend routes/monetization_experiments.py is the other copy):
//   bucket  = first 16 hex of sha256(identity + test_name), as an integer, % 100
//   arm     = bucket below the test's treatment share 'treatment', else 'holdout' (80/20 by default;
//             exp_email_ask_ab is 50/50, TREATMENT_BUCKETS_BY_TEST)
//   identity = 'pk-' + sha256(api key) when the caller has a key, else the canonical keyless identity
//              (lib/keyless-wall.mjs capWallIdentity: 'ip-' + sha256(ip), else the session hash 'sk-...').
// Exposure and outcome rows go to POST /api/v1/mcp/experiments/exposure (internal key), fire-and-forget; the backend
// recomputes the arm and refuses a mismatch. Readout: GET /api/v1/mcp/funnel/experiments.
//
// TESTS ON THIS SERVER
//   exp_upgrade_block    DCHUB_EXP_UPGRADE_BLOCK. Slot reserved here (name, flag, arm); its treatment is the
//                        commercial wall `access` block built by the "Agent handoff" work, which imports this module.
//   exp_save_key_prompt  DCHUB_EXP_SAVE_KEY_PROMPT (lib/save-key-prompt.mjs + server.mjs _expSaveKeyStep).
//   exp_email_ask_ab     DCHUB_EMAIL_ASK_AB (F4, lib/email-ask-ab.mjs + server.mjs _emailAskAbStep). 50/50, not 80/20:
//                        treatment = arm B (the unlock ask names the call's market or ISO), holdout = arm A (today's
//                        copy). Outcome email_captured: a successful email entry by an exposed identity within 24 h.
//   exp_next_ask_v2      DCHUB_NEXT_ASK_V2 (Grok spec item 5, lib/next-ask-v2.mjs + server.mjs _nextAskV2Step). 50/50:
//                        treatment = one followable next_call {tool, arguments, why} chosen from the question and the
//                        answer; holdout = today's next_ask. Outcomes (both arms, same definitions):
//                        next_ask_followed  the session's later call took the next_ask the answer served (_via_next_ask)
//                        workflow_saved     a successful save (save_site, save_to_shortlist, set_*_alert,
//                                           register_standing_intent) by the exposed identity within 24 h
//                        session_3_calls    the exposure's session made 3 more calls after it (calls-per-session read)
//
// OUTCOMES (the tracker below; in-memory per replica, so a restart forgets exposures: it loses outcomes in BOTH arms
// alike, which keeps the comparison fair but undercounts both):
//   continued          a later tool call in the session of an exposure (Test A guardrail)
//   returned_next_day  a call by an exposed identity on the UTC day after its exposure (Test B guardrail)
//   key_minted         a keyless caller minted a key (claim_free_key); posted for every client test whose flag is on,
//                      the backend keeps it only after an exposure of that identity in the last 24 h
// /mcp/chatgpt is excluded from every test (the callers' own surface checks; nothing here runs there).
import { createHash } from 'node:crypto';
import { capWallIdentity } from './keyless-wall.mjs';

export const UPGRADE_BLOCK = 'exp_upgrade_block';
export const SAVE_KEY_PROMPT = 'exp_save_key_prompt';
export const EMAIL_ASK_AB = 'exp_email_ask_ab';
export const NEXT_ASK_V2 = 'exp_next_ask_v2';
export const CLIENT_TESTS = Object.freeze([UPGRADE_BLOCK, SAVE_KEY_PROMPT, EMAIL_ASK_AB, NEXT_ASK_V2]);
export const FLAGS = Object.freeze({ [UPGRADE_BLOCK]: 'DCHUB_EXP_UPGRADE_BLOCK', [SAVE_KEY_PROMPT]: 'DCHUB_EXP_SAVE_KEY_PROMPT',
  [EMAIL_ASK_AB]: 'DCHUB_EMAIL_ASK_AB', [NEXT_ASK_V2]: 'DCHUB_NEXT_ASK_V2' });
export const TREATMENT = 'treatment';
export const HOLDOUT = 'holdout';
export const TREATMENT_BUCKETS = 80;
// Per-test treatment share (buckets 0..n-1 are treatment). dchub-backend TREATMENT_BUCKETS_BY_TEST is the other copy.
export const TREATMENT_BUCKETS_BY_TEST = Object.freeze({ [EMAIL_ASK_AB]: 50, [NEXT_ASK_V2]: 50 });
export const EMAIL_CAPTURED = 'email_captured';
export const NEXT_ASK_FOLLOWED = 'next_ask_followed';
export const WORKFLOW_SAVED = 'workflow_saved';
export const SESSION_3_CALLS = 'session_3_calls';
export const SESSION_DEPTH_CALLS = 3;
// The save tools whose success completes a workflow (dchub-backend completed_workflows_30d uses the same list).
export const SAVE_TOOLS = Object.freeze(new Set(['save_site', 'save_to_shortlist', 'register_standing_intent',
  'set_site_alert', 'set_market_alert', 'set_shortlist_alert']));
export const EXPOSURE_PATH = '/api/v1/mcp/experiments/exposure';
export const DECIDE_PATH = '/api/v1/mcp/experiments/decide';

export function expOn(test, env = process.env) {
  const f = FLAGS[test];
  return !!f && /^(1|true|yes|on)$/i.test(String((env && env[f]) || '').trim());
}

export function bucketFor(identity, test) {
  const h = createHash('sha256').update(String(identity) + String(test)).digest('hex');
  return Number(BigInt('0x' + h.slice(0, 16)) % 100n);
}
export function armFor(identity, test) {
  const n = Object.prototype.hasOwnProperty.call(TREATMENT_BUCKETS_BY_TEST, test) ? TREATMENT_BUCKETS_BY_TEST[test] : TREATMENT_BUCKETS;
  return bucketFor(identity, test) < n ? TREATMENT : HOLDOUT;
}

export function keyRef(apiKey) {
  return 'pk-' + createHash('sha256').update(String(apiKey)).digest('hex');
}
// '' when there is nothing stable to key on (no arm, nothing recorded).
export function identityOf(c) {
  const x = (c && typeof c === 'object') ? c : {};
  if (x.api_key) return keyRef(x.api_key);
  try { return capWallIdentity(x) || ''; } catch (_) { return ''; }
}

// One row to the backend, never awaited by an answer. `post(path, body)` is server.mjs's internal-key POST.
export function postRow(post, body) {
  try {
    if (typeof post !== 'function' || !body || !CLIENT_TESTS.includes(body.test) || !body.identity) return false;
    const p = post(EXPOSURE_PATH, { ...body, arm: armFor(body.identity, body.test) });
    if (p && typeof p.catch === 'function') p.catch(() => {});
    return true;
  } catch (_) { return false; }
}

// ── outcome tracker ──────────────────────────────────────────────────────────────────────────────────────────────────
const MAX = 20000;
const DAY_MS = 86400000;
const _exposures = new Map();   // identity -> [{test, session, day, ts, continued, returned}]

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
function _bounded(map) {
  if (map.size < MAX) return;
  let i = 0; const drop = MAX / 10;
  for (const k of map.keys()) { map.delete(k); if (++i >= drop) break; }
}

// Called by a test when it records an exposure (either arm). Posts the exposure row and remembers it for outcomes.
export function noteExposure(post, { test, identity, tool = '', session_id = '', platform = '', now = Date.now() } = {}) {
  if (!CLIENT_TESTS.includes(test) || !identity) return false;
  const list = (_exposures.get(identity) || []).filter((e) => now - e.ts < 2 * DAY_MS);
  list.push({ test, session: String(session_id || ''), day: utcDay(now), ts: now, continued: false, returned: false,
    calls: 0, deep: false, followed: false, saved: false });
  _bounded(_exposures);
  _exposures.set(identity, list);
  return postRow(post, { test, identity, event: 'exposure', tool, session_id, platform });
}
// The exposure is recorded by the backend's decide call (Test B): remember it here for outcomes, post nothing.
export function rememberExposure({ test, identity, session_id = '', now = Date.now() } = {}) {
  if (!CLIENT_TESTS.includes(test) || !identity) return false;
  const list = (_exposures.get(identity) || []).filter((e) => now - e.ts < 2 * DAY_MS);
  list.push({ test, session: String(session_id || ''), day: utcDay(now), ts: now, continued: false, returned: false });
  _bounded(_exposures);
  _exposures.set(identity, list);
  return true;
}

// Every tool call (after the answer is built): the session's first later call after an exposure = continued; the
// identity's first call on the next UTC day = returned_next_day. Returns the rows posted (for tests).
export function noteCall(post, { identity, session_id = '', tool = '', now = Date.now(), exposureCall = false } = {}) {
  const out = [];
  if (!identity || exposureCall) return out;
  const list = _exposures.get(identity);
  if (!list || !list.length) return out;
  const today = utcDay(now);
  for (const e of list) {
    if (now - e.ts > DAY_MS * 2) continue;
    if (!e.continued && e.session && e.session === String(session_id || '') && now > e.ts) {
      e.continued = true;
      out.push({ test: e.test, identity, event: 'continued', tool, session_id });
    }
    if (!e.returned && today === utcDay(e.ts + DAY_MS)) {
      e.returned = true;
      out.push({ test: e.test, identity, event: 'returned_next_day', tool, session_id });
    }
    // exp_next_ask_v2: calls per session, read as "the exposure's session made 3 more calls".
    if (e.test === NEXT_ASK_V2 && e.session && e.session === String(session_id || '') && now > e.ts && !e.deep) {
      e.calls = (e.calls || 0) + 1;
      if (e.calls >= SESSION_DEPTH_CALLS) {
        e.deep = true;
        out.push({ test: e.test, identity, event: SESSION_3_CALLS, tool, session_id });
      }
    }
  }
  for (const r of out) postRow(post, r);
  return out;
}

// The key a claim_free_key answer handed out, or ''. Reads structuredContent first, then the JSON / text blocks.
const KEY_RE = /\bdch_(?:live|trial|test|free)_[A-Za-z0-9_-]{8,}\b/;
export function mintedKeyOf(result) {
  try {
    if (!result || result.isError) return '';
    const sc = result.structuredContent;
    for (const f of ['api_key', 'key']) if (sc && typeof sc[f] === 'string' && KEY_RE.test(sc[f])) return sc[f].match(KEY_RE)[0];
    for (const b of (Array.isArray(result.content) ? result.content : [])) {
      const m = b && typeof b.text === 'string' ? b.text.match(KEY_RE) : null;
      if (m) return m[0];
    }
  } catch (_) { /* no key */ }
  return '';
}
// A keyless caller minted a key: one key_minted row per client test whose flag is on (the backend keeps it only
// after that identity's exposure in the last 24 h). ref = pk-sha256(new key); the raw key never leaves.
export function noteMint(post, { identity, result, tool = 'claim_free_key', session_id = '', env = process.env } = {}) {
  const k = mintedKeyOf(result);
  if (!identity || !k) return [];
  const rows = CLIENT_TESTS.filter((t) => expOn(t, env))
    .map((test) => ({ test, identity, event: 'key_minted', tool, session_id, ref: keyRef(k) }));
  for (const r of rows) postRow(post, r);
  return rows;
}

// F4 (DCHUB_EMAIL_ASK_AB): a successful email entry (bind_email, claim_free_key with an email, subscribe_digest) by
// the caller. One email_captured row per identity given (the keyless identity and, when different, the keyed one); the
// backend keeps a row only after an exp_email_ask_ab exposure of that identity in the last 24 h, in either arm. No
// email, key or IP in the row.
export function noteEmailCaptured(post, { identities = [], tool = '', session_id = '', env = process.env } = {}) {
  if (!expOn(EMAIL_ASK_AB, env)) return [];
  const rows = [...new Set((identities || []).filter(Boolean))]
    .map((identity) => ({ test: EMAIL_ASK_AB, identity, event: EMAIL_CAPTURED, tool, session_id }));
  for (const r of rows) postRow(post, r);
  return rows;
}

// exp_next_ask_v2 outcomes, after a tool call by an exposed identity (either arm; flag on only).
//   followed  this call took the next_ask the session's previous answer served (same session as the exposure)
//   saved     this call was a successful save (any session, within 24 h of the exposure)
// One row per exposure per event; the backend keeps one per identity per 7 days. Returns the rows posted.
export function noteNextAskOutcome(post, { identity, session_id = '', tool = '', followed = false, saved = false,
  now = Date.now(), env = process.env } = {}) {
  const out = [];
  if (!identity || !expOn(NEXT_ASK_V2, env) || (!followed && !saved)) return out;
  const list = _exposures.get(identity);
  if (!list || !list.length) return out;
  for (const e of list) {
    if (e.test !== NEXT_ASK_V2 || now - e.ts > DAY_MS || now < e.ts) continue;
    if (followed && !e.followed && e.session && e.session === String(session_id || '')) {
      e.followed = true;
      out.push({ test: NEXT_ASK_V2, identity, event: NEXT_ASK_FOLLOWED, tool, session_id });
    }
    if (saved && !e.saved) {
      e.saved = true;
      out.push({ test: NEXT_ASK_V2, identity, event: WORKFLOW_SAVED, tool, session_id });
    }
  }
  for (const r of out) postRow(post, r);
  return out;
}

export function _resetForTests() { _exposures.clear(); }
