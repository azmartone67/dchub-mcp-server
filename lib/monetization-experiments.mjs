// lib/monetization-experiments.mjs — the Nov 22 monetization tests with holdouts (owner relay from Grok's funnel
// review, 2026-11-22). DRAFT: every flag defaults OFF; a test goes live only on the owner's word.
//
// SHARED (both sides compute the same arm; dchub-backend routes/monetization_experiments.py is the other copy):
//   bucket  = first 16 hex of sha256(identity + test_name), as an integer, % 100
//   arm     = bucket 0-79 'treatment', 80-99 'holdout' (80/20)
//   identity = 'pk-' + sha256(api key) when the caller has a key, else the canonical keyless identity
//              (lib/keyless-wall.mjs capWallIdentity: 'ip-' + sha256(ip), else the session hash 'sk-...').
// Exposure and outcome rows go to POST /api/v1/mcp/experiments/exposure (internal key), fire-and-forget; the backend
// recomputes the arm and refuses a mismatch. Readout: GET /api/v1/mcp/funnel/experiments.
//
// TESTS ON THIS SERVER
//   exp_upgrade_block    DCHUB_EXP_UPGRADE_BLOCK. Slot reserved here (name, flag, arm); its treatment is the
//                        commercial wall `access` block built by the "Agent handoff" work, which imports this module.
//   exp_save_key_prompt  DCHUB_EXP_SAVE_KEY_PROMPT (lib/save-key-prompt.mjs + server.mjs _expSaveKeyStep).
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
export const CLIENT_TESTS = Object.freeze([UPGRADE_BLOCK, SAVE_KEY_PROMPT]);
export const FLAGS = Object.freeze({ [UPGRADE_BLOCK]: 'DCHUB_EXP_UPGRADE_BLOCK', [SAVE_KEY_PROMPT]: 'DCHUB_EXP_SAVE_KEY_PROMPT' });
export const TREATMENT = 'treatment';
export const HOLDOUT = 'holdout';
export const TREATMENT_BUCKETS = 80;
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
  return bucketFor(identity, test) < TREATMENT_BUCKETS ? TREATMENT : HOLDOUT;
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
  list.push({ test, session: String(session_id || ''), day: utcDay(now), ts: now, continued: false, returned: false });
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

export function _resetForTests() { _exposures.clear(); }
