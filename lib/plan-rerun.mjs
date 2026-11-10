// lib/plan-rerun.mjs — re-run a plan and get back only what changed (move 3, owner-approved 2026-11-09).
//
// WHY. Saved-workflow completion is 0% (11-08 definition: an agent returning within 7 days to complete
// a saved workflow), and owner priority 2 is continuity between sessions. Every existing return path
// (save_site, shortlists, standing intents, alerts) needs a key and usually an email, and most plan
// traffic is anonymous. An agent that already ran a plan has no way to ask "has any of that moved?"
// short of running the whole thing again and diffing it by eye.
//
// WHAT. Stateless, no account, no email, nothing stored server-side:
//   * every execute_plan answer carries `rerun.token`: a signed, compact record of WHAT THE CALLER SAW,
//     per step: the step's identity (tool + args), its status, a keyed fingerprint of its figures, its
//     as_of, a fingerprint of its depth (which fields were withheld), and per-row fingerprints for the
//     step's main row list (capped);
//   * calling execute_plan again with the same intent and `context.rerun_token` (plan_and_answer on
//     /mcp/core: `rerun_token`) returns only the steps whose fingerprints changed, plus explicit
//     `unchanged`, `not_compared` and `removed` lists and both as_of dates per step.
//
// HONESTY RULES (each one pinned by test/plan-rerun.test.mjs):
//   * A step that failed, timed out or did not run is `not_compared`, never `unchanged`. A run with any
//     such step reports status `partly_compared`, never `unchanged`.
//   * A step that came back at a different depth than last time (a preview vs a full answer, a different
//     set of withheld fields) is `not_compared`: its figures differ because the view differs.
//   * Fingerprints are taken over each step's own tool answer AT THE CALLER'S TIER: the tools/call
//     execute_plan made under the caller's key, before execute_plan's 6 KB size cut (_slimStepResult).
//     The size cut is not a tier: whether it fires depends on plumbing such as a once-per-session
//     next_session block (measured in the e2e harness: the same data slimmed on a session's first plan
//     and not on its second), so fingerprinting the cut view reported false changes. The caller can read
//     every figure fingerprinted by calling that tool directly. Fingerprints are HMACs under a server
//     key, so a small number cannot be brute-forced back out of a token.
//   * A re-run runs every step for real under the caller's own key and tier (same quotas and depth as a
//     fresh run) and then returns a SUBSET of what a fresh run returns. It adds no data access.
//
// The signing key is derived from DCHUB_INTERNAL_KEY (the secret the relay and /go links already sign
// with, shared by both Railway services and the backend), domain-separated so a rerun MAC can never be
// confused with a relay signature. No secret -> no token (the feature is silent, never unsigned).
//
// Pure: no ctx, no network. server.mjs owns the hooks (one call before the planner-quality telemetry
// row, one before the response is stringified). Kill switch DCHUB_PLAN_RERUN=0.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { collectTimestamps } from './attribution.mjs';
import { CORE_PROFILE, DROP_KEY as CORE_DROP_KEY } from './core-profile.mjs';

export const RERUN_FLAG = 'DCHUB_PLAN_RERUN';
export const RERUN_TOKEN_PREFIX = 'pr1.';
export const RERUN_TOKEN_VERSION = 1;
export const RERUN_MAX_AGE_DAYS = 90;
export const RERUN_MAX_ROWS = 25;
export const RERUN_MAX_STEPS = 16;
export const RERUN_MAX_TOKEN_CHARS = 8192;
// The 11-08 seven-day return window, in hours: a re-run inside it is a "returned within 7 days".
export const RERUN_RETURN_WINDOW_H = 168;
// The context key the token rides in on /mcp (execute_plan's `context` is already an open object, so
// no input schema moves on any profile).
export const RERUN_CONTEXT_KEY = 'rerun_token';

export function planRerunOn(env = process.env) {
  return !/^(0|off|false|no)$/i.test(String((env && env[RERUN_FLAG]) || '').trim());
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function _subkey(secret) {
  return createHmac('sha256', String(secret)).update('dchub-plan-rerun-v1').digest();
}
function _mac(key, s, bytes) {
  return b64u(createHmac('sha256', key).update(String(s)).digest().subarray(0, bytes));
}

// Canonical JSON: sorted object keys, so key order never reads as a change.
export function canon(v) {
  return JSON.stringify(v, (k, x) => ((x && typeof x === 'object' && !Array.isArray(x))
    ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
}

// ── What counts as a figure ────────────────────────────────────────────────
// Measured on two live keyless runs of the same plan two seconds apart (2026-11-09,
// "rank markets for a 200 MW AI campus"): every difference was in a key below — relay links and the
// sentences quoting them (human_url, for_your_human, upgrade.*_url, continuation urls, human_message,
// user_message), serve times (retrieved_at, computed_at, evaluated_at), and next_session riding one
// response but not the other. None is a figure. Keys starting "_" are gating markers and agent
// plumbing: the depth fingerprint reads the markers separately.
const META_KEY_RE = new RegExp('^(' + [
  'human_.*', 'for_your_human', 'upgrade.*', '.*_url', 'urls?', 'links?', 'user_message', 'messages?',
  'notes?', 'hints?', '.*_hint', 'citation', 'cite_as', 'provenance', 'evidence', 'identity', 'quota.*',
  'continuations?', 'next_.*', 'agent_.*', 'truncation', 'ms', '.*_ms', 'session.*', '.*_session_?id',
  'request_id', 'trace_id', '.*_at', 'as_of', '.*_as_of', 'as_of_.*', 'timestamp', 'last_updated',
  'tier', 'credential_source', 'means', 'upsell.*', 'show_to_user', 'render', 'markdown', 'relay.*',
  'cta.*', 'access', 'access_.*', 'source', 'sources', 'data_source', 'license', 'attribution',
].join('|') + ')$', 'i');
// Plus every key /mcp/core already strips as commerce, session or agent plumbing (core-profile DROP_KEY):
// that list is maintained against the live shapes, and a once-per-session block it knows (starter_pack,
// measured in the e2e harness: present on a session's first plan, absent on its second) is not a figure.
const _isPlumbing = (k) => k.startsWith('_') || META_KEY_RE.test(k) || CORE_DROP_KEY.test(k);
const PROSE_MAX = 300;          // longer strings are prose about the data, not a figure
const MAX_DEPTH = 12;

export function figuresOf(v, depth = 0) {
  if (depth > MAX_DEPTH) return undefined;
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v.length > PROSE_MAX || /^https?:\/\//i.test(v)) return undefined;
    return v;
  }
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) { const y = figuresOf(x, depth + 1); if (y !== undefined) out.push(y); }
    return out;
  }
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (_isPlumbing(k)) continue;
      const y = figuresOf(x, depth + 1);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  return undefined;
}

// The depth a step was served at: which gating markers it carried. Two runs whose markers differ were
// served different views, and their figures are not comparable.
const DEPTH_MARK_RE = /(_in_pro|_withheld|_locked)$/i;
const DEPTH_FLAG_KEYS = new Set(['preview_is_partial', '_gated', 'gated_preview', '_preview_only', '_teaser', 'preview']);
export function depthOf(v) {
  const marks = new Set();
  const rec = (x, d) => {
    if (!x || typeof x !== 'object' || d > MAX_DEPTH) return;
    if (Array.isArray(x)) { for (const y of x) rec(y, d + 1); return; }
    for (const [k, y] of Object.entries(x)) {
      if (DEPTH_MARK_RE.test(k)) marks.add(k);
      else if (DEPTH_FLAG_KEYS.has(k) && y === true) marks.add(k);
      else if (k === 'completeness' && typeof y === 'string') marks.add('completeness:' + y);
      rec(y, d + 1);
    }
  };
  rec(v, 0);
  return [...marks].sort().join('|');
}

// The step's main row list: the longest array of objects at the top level of the result (or one level
// down under data/results). Rows get their own fingerprints so a changed step returns only its changed
// rows.
const ROW_ID_KEYS = ['slug', 'market_slug', 'market', 'metro', 'facility_id', 'candidate_id', 'id',
  'iso', 'region_id', 'region', 'code', 'name', 'title'];
export function rowListOf(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  let best = null;
  // A data row names itself (slug, market, id, iso, name ...). Lists of withheld-field descriptors,
  // upgrade options or hand-off hints do not, and are never treated as rows (measured on live steps:
  // get_grid_intelligence's longest list was `withheld`).
  const consider = (arr, pth) => {
    if (!Array.isArray(arr) || arr.length < 2) return;
    const named = arr.filter((x) => x && typeof x === 'object' && !Array.isArray(x)
      && ROW_ID_KEYS.some((k) => (typeof x[k] === 'string' && x[k].trim()) || typeof x[k] === 'number')).length;
    if (named < arr.length * 0.8) return;
    if (!best || arr.length > best.rows.length) best = { path: pth, rows: arr };
  };
  for (const [k, v] of Object.entries(result)) {
    if (_isPlumbing(k)) continue;
    consider(v, k);
    if ((k === 'data' || k === 'results') && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) if (!_isPlumbing(k2)) consider(v2, k + '.' + k2);
    }
  }
  return best;
}
export function rowIdOf(row, i) {
  for (const k of ROW_ID_KEYS) {
    const v = row && row[k];
    if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return k + '=' + String(v).trim().toLowerCase();
  }
  return '#' + i;
}
function _getPath(obj, pth) {
  let cur = obj;
  for (const seg of String(pth).split('.')) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[seg]; }
  return cur;
}
function _setPath(obj, pth, val) {
  const segs = String(pth).split('.');
  let cur = obj;
  for (const seg of segs.slice(0, -1)) { if (!cur || typeof cur !== 'object') return; cur = cur[seg]; }
  if (cur && typeof cur === 'object') cur[segs[segs.length - 1]] = val;
}

// as_of a step reports: the newest collection-level data date in what the caller received (the same
// collector the envelope citation uses), else null. Never the serve time.
export function stepAsOf(result) {
  try {
    const st = collectTimestamps(result);
    if (!st.length) return null;
    const top = st.reduce((a, b) => (b.ms > a.ms ? b : a));
    return String(top.shown || top.iso).slice(0, 25);
  } catch (_) { return null; }
}

const STATUS_CODE = { executed: 'e', gated_preview: 'g', failed: 'f', timed_out: 't' };
const COMPARABLE = new Set(['e', 'g']);
const _statusCode = (s) => STATUS_CODE[s] || 'n';

// One token entry per executed step: [stepKey, tool, status, fp, as_of, depth, rowPath, rows, rowsCut].
// `full` is the step's tool answer before execute_plan's size cut (see the honesty rules above);
// without one, the step's result as returned.
export function fingerprintStep(key, e, full) {
  const tool = String((e && e.tool) || '');
  const sk = _mac(key, 'K|' + tool + '|' + canon((e && e.args) || {}), 6);
  const sc = _statusCode(e && e.status);
  if (!COMPARABLE.has(sc)) return [sk, tool, sc, 0, 0, 0, 0, 0, 0];
  const res = (full && typeof full === 'object') ? full : e.result;
  const fp = _mac(key, 'S|' + canon(figuresOf(res)), 9);
  const dp = _mac(key, 'D|' + depthOf(res), 3);
  let rp = 0, rows = 0, cut = 0;
  const rl = rowListOf(res);
  if (rl) {
    rp = rl.path;
    cut = rl.rows.length > RERUN_MAX_ROWS ? 1 : 0;
    rows = rl.rows.slice(0, RERUN_MAX_ROWS)
      .map((r, i) => _mac(key, 'R|' + rowIdOf(r, i), 4) + ':' + _mac(key, 'F|' + canon(figuresOf(r)), 6)).join(',');
  }
  return [sk, tool, sc, fp, stepAsOf(res) || 0, dp, rp, rows, cut];
}

export function normIntent(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function planHash(key, intent, context) {
  const ctx = (context && typeof context === 'object' && !Array.isArray(context)) ? { ...context } : {};
  delete ctx[RERUN_CONTEXT_KEY]; delete ctx.cohort;
  return _mac(key, 'P|' + normIntent(intent) + '|' + canon(ctx), 6);
}

// What the caller could see: surface, keyed or keyless steps, tier word. No key, no PII.
export function accessOf(c, profile) {
  const keyed = !!(c && c.api_key && !c.plan_steps_keyless);
  return [String(profile || 'mcp'), keyed ? 'key' : 'anon', String((c && c.tier) || '-').toLowerCase().slice(0, 16)].join(':');
}

// Take the token out of the arguments BEFORE the planner reads them, so it can never steer a plan or
// reach a step's args. Returns the token string or null; `a.context` loses the key.
export function takeRerunToken(a) {
  if (!a || typeof a !== 'object') return null;
  const ctx = a.context;
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx) || !(RERUN_CONTEXT_KEY in ctx)) return null;
  const { [RERUN_CONTEXT_KEY]: tok, ...rest } = ctx;
  a.context = Object.keys(rest).length ? rest : undefined;
  return typeof tok === 'string' && tok.trim() ? tok.trim() : null;
}

export function mintToken(secret, { plan, access, steps, now = Date.now() }) {
  const key = _subkey(secret);
  const body = b64u(JSON.stringify({ v: RERUN_TOKEN_VERSION, t: Math.floor(now / 1000), p: plan, a: access,
    s: steps.slice(0, RERUN_MAX_STEPS) }));
  return RERUN_TOKEN_PREFIX + body + '.' + _mac(key, 'T|' + body, 12);
}

// { ok: true, payload } or { ok: false, reason } — reasons are fixed codes, never an echo of input.
export function readToken(secret, token, now = Date.now()) {
  const t = typeof token === 'string' ? token.trim() : '';
  if (!t || t.length > RERUN_MAX_TOKEN_CHARS || !t.startsWith(RERUN_TOKEN_PREFIX)) return { ok: false, reason: 'not_a_rerun_token' };
  const rest = t.slice(RERUN_TOKEN_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot < 1) return { ok: false, reason: 'not_a_rerun_token' };
  const body = rest.slice(0, dot), sig = rest.slice(dot + 1);
  const want = _mac(_subkey(secret), 'T|' + body, 12);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return { ok: false, reason: 'not_a_rerun_token' }; }
  if (!p || p.v !== RERUN_TOKEN_VERSION || !Array.isArray(p.s)) return { ok: false, reason: 'unknown_version' };
  const ageS = Math.floor(now / 1000) - Number(p.t);
  if (!Number.isFinite(ageS) || ageS < -300) return { ok: false, reason: 'not_a_rerun_token' };
  if (ageS > RERUN_MAX_AGE_DAYS * 86400) return { ok: false, reason: 'expired' };
  return { ok: true, payload: p, age_h: Math.max(0, Math.round(ageS / 360) / 10) };
}

const REASON_TEXT = {
  not_a_rerun_token: 'the rerun_token was not one this server issued',
  bad_signature: 'the rerun_token failed its signature check (altered or cut short)',
  unknown_version: 'the rerun_token is from an older format',
  expired: 'the rerun_token is older than ' + RERUN_MAX_AGE_DAYS + ' days',
  different_plan: 'the rerun_token was issued for a different question or different hints',
  different_access: 'the rerun_token was issued at a different access level (surface, key or tier), so the figures are not comparable',
  step_failed: 'the step failed this time',
  step_timed_out: 'the step timed out this time',
  step_not_run: 'the step did not run this time',
  no_previous_result: 'the step had no result last time (it failed, timed out or did not run)',
  depth_changed: 'the step came back at a different depth than last time (for example a preview one time and a full answer the other), so its figures are not comparable',
};
export function reasonText(code) { return REASON_TEXT[code] || code; }

function _nowReason(status) {
  if (status === 'failed') return 'step_failed';
  if (status === 'timed_out') return 'step_timed_out';
  return 'step_not_run';
}
const _iso = (sec) => new Date(Number(sec) * 1000).toISOString();

// The whole computation, from the finished executed[] list. Never throws on caller input.
// Returns null when the feature does not apply (switch off, surface not allowed, no secret).
export function computeRerun({ token = null, intent, context, executed, fullOf = null, c = null, profile = null,
  surfaceOk = true, secret = '', env = process.env, now = Date.now() }) {
  if (!planRerunOn(env) || !surfaceOk || !secret) return null;
  const key = _subkey(secret);
  const plan = planHash(key, intent, context);
  const access = accessOf(c, profile);
  const list = (Array.isArray(executed) ? executed : []).filter((e) => e && e.status !== 'skipped_meta');
  const _full = (e) => { try { return typeof fullOf === 'function' ? fullOf(e) : undefined; } catch (_) { return undefined; } };
  const fps = list.map((e) => fingerprintStep(key, e, _full(e)));
  const newToken = mintToken(secret, { plan, access, steps: fps, now });
  const base = { newToken, profile, telemetry: { rerun_token_issued: true } };
  if (!token) return { ...base, mode: 'fresh' };

  const rd = readToken(secret, token, now);
  const notCompared = (reason, age_h = null) => ({ ...base, mode: 'rerun', status: 'not_compared', reason,
    previous: rd.ok ? { issued_at: _iso(rd.payload.t), age_hours: rd.age_h } : null,
    telemetry: { ...base.telemetry, rerun: 'not_compared', rerun_reason: reason,
      ...(age_h !== null ? { rerun_age_h: age_h } : {}) } });
  if (!rd.ok) return notCompared(rd.reason);
  const prev = rd.payload;
  if (prev.p !== plan) return notCompared('different_plan', rd.age_h);
  if (prev.a !== access) return notCompared('different_access', rd.age_h);

  // Match steps by identity (tool + args), in order, so two identical calls pair one-to-one.
  const pool = new Map();
  for (const pe of prev.s) {
    if (!Array.isArray(pe)) continue;
    const arr = pool.get(pe[0]) || [];
    arr.push(pe); pool.set(pe[0], arr);
  }
  const verdicts = new Map();   // executed entry -> verdict
  const unchanged = [], changed = [], added = [], notcmp = [];
  list.forEach((e, i) => {
    const cur = fps[i];
    const cand = pool.get(cur[0]);
    const pe = cand && cand.length ? cand.shift() : null;
    const base1 = { step: e.step, tool: e.tool, args: e.args || {} };
    const asNow = cur[4] || null, asThen = pe ? (pe[4] || null) : null;
    let v;
    if (!COMPARABLE.has(cur[2])) v = { kind: 'not_compared', reason: _nowReason(e.status) };
    else if (!pe) v = { kind: 'added' };
    else if (!COMPARABLE.has(pe[2])) v = { kind: 'not_compared', reason: 'no_previous_result' };
    else if (pe[2] !== cur[2] || pe[5] !== cur[5]) v = { kind: 'not_compared', reason: 'depth_changed' };
    else if (pe[3] === cur[3]) v = { kind: 'unchanged' };
    else {
      v = { kind: 'changed' };
      if (pe[6] && pe[6] === cur[6] && typeof pe[7] === 'string' && typeof cur[7] === 'string') {
        const pm = new Map(pe[7].split(',').filter(Boolean).map((x) => x.split(':')));
        const f = _full(e);
        const rl = rowListOf((f && typeof f === 'object') ? f : e.result);
        const rowsNow = rl ? rl.rows.slice(0, RERUN_MAX_ROWS) : [];
        const curPairs = cur[7].split(',').filter(Boolean).map((x) => x.split(':'));
        const keep = [], rc = [], ra = [], ru = [];
        curPairs.forEach(([rk, rf], j) => {
          const id = rowIdOf(rowsNow[j], j);
          if (!pm.has(rk)) { ra.push(id); keep.push(j); } else if (pm.get(rk) !== rf) { rc.push(id); keep.push(j); } else ru.push(id);
          pm.delete(rk);
        });
        // Rows past the cap were never fingerprinted: they stay in the answer, uncompared.
        const beyond = rl && rl.rows.length > RERUN_MAX_ROWS;
        v.rows = { path: cur[6], changed: rc, added: ra, unchanged: ru, removed_count: pm.size,
          ...(beyond || pe[8] ? { not_compared_past_row: RERUN_MAX_ROWS } : {}) };
        v.keepRows = keep; v.beyond = !!beyond;
      }
    }
    verdicts.set(e, v);
    const row = { ...base1, as_of_previous: asThen, as_of_now: asNow };
    if (v.kind === 'unchanged') unchanged.push(row);
    else if (v.kind === 'changed') changed.push({ ...row, ...(v.rows ? { rows: v.rows } : {}) });
    else if (v.kind === 'added') added.push({ step: e.step, tool: e.tool, args: e.args || {}, as_of_now: asNow });
    else notcmp.push({ ...row, reason: v.reason, why: reasonText(v.reason) });
  });
  const removed = [];
  for (const arr of pool.values()) for (const pe of arr) removed.push({ tool: pe[1], as_of_previous: pe[4] || null });
  const status = notcmp.length ? 'partly_compared'
    : ((changed.length || added.length || removed.length) ? 'changed' : 'unchanged');
  return {
    ...base, mode: 'rerun', status, verdicts,
    previous: { issued_at: _iso(prev.t), age_hours: rd.age_h },
    unchanged, changed, added, not_compared: notcmp, removed,
    telemetry: { ...base.telemetry, rerun: status, rerun_age_h: rd.age_h,
      rerun_within_7d: rd.age_h <= RERUN_RETURN_WINDOW_H,
      rerun_unchanged: unchanged.length, rerun_changed: changed.length + added.length + removed.length,
      rerun_not_compared: notcmp.length },
  };
}

// The `how` line: the tool the caller re-runs with, per surface. On /mcp/core the prose names
// plan_and_answer only (core drops any sentence naming a tool it does not list).
export function howText(profile) {
  return profile === CORE_PROFILE
    ? 'To see only what changed later, call plan_and_answer again with the same question and hints and rerun_token set to this token. No account is needed; the token holds no personal data.'
    : 'To see only what changed later, call execute_plan again with the same intent and hints, adding context.rerun_token set to this token. No account is needed; the token holds no personal data.';
}

// Apply to the finished envelope (mutates `out`). Fresh run: adds `rerun: {token, how}`. Re-run:
// executed[] keeps only changed / added / not-compared steps (a changed step keeps only its changed and
// added rows), and `rerun` lists everything else.
export function applyRerun(out, rr) {
  if (!out || typeof out !== 'object' || !rr) return out;
  const block = { token: rr.newToken, how: howText(rr.profile) };
  if (rr.mode !== 'rerun') { out.rerun = block; return out; }
  if (rr.status === 'not_compared') {
    out.rerun = { status: 'not_compared', reason: rr.reason, why: reasonText(rr.reason),
      note: 'Nothing was compared; this is a full fresh answer. Use the new token below next time.',
      ...(rr.previous ? { previous_run: rr.previous } : {}), ...block };
    return out;
  }
  const ex = Array.isArray(out.executed) ? out.executed : [];
  out.executed = ex.filter((e) => {
    const v = rr.verdicts && rr.verdicts.get(e);
    return !v || v.kind !== 'unchanged';
  }).map((e) => {
    const v = rr.verdicts && rr.verdicts.get(e);
    if (!v || v.kind !== 'changed' || !v.rows || !Array.isArray(v.keepRows)) return e;
    const arr = _getPath(e.result, v.rows.path);
    if (!Array.isArray(arr)) return e;
    // Row indices are positions in the step's tool answer; the returned result may be cut to its
    // first rows, so an index past the cut has nothing to keep here.
    const kept = v.keepRows.filter((j) => j < arr.length).map((j) => arr[j])
      .concat(v.beyond ? arr.slice(RERUN_MAX_ROWS) : []);
    if (kept.length === arr.length) return e;
    const res = JSON.parse(JSON.stringify(e.result));
    _setPath(res, v.rows.path, kept);
    return { ...e, result: res, rows_trimmed_to_changed: true };
  });
  const since = rr.previous ? rr.previous.issued_at.slice(0, 16).replace('T', ' ') + ' UTC' : 'your previous run';
  const lead = rr.status === 'unchanged'
    ? 'NO CHANGE since your previous run (' + since + '): every step returned the same figures, so the answer composed from that run still stands. Each step\'s as_of then and now is in rerun.unchanged. '
    : rr.status === 'changed'
      ? 'RE-RUN since ' + since + ': executed[] holds only what changed (' + (rr.changed.length + rr.added.length) + ' step(s)); '
        + rr.unchanged.length + ' step(s) returned the same figures and are listed in rerun.unchanged. '
      : 'RE-RUN since ' + since + ': ' + rr.not_compared.length + ' step(s) could not be compared (see rerun.not_compared) and are returned as they came back; do not describe them as unchanged. '
        + rr.unchanged.length + ' step(s) returned the same figures (rerun.unchanged). ';
  out.answer_guide = lead + (out.answer_guide || '');
  if (rr.status === 'unchanged') {
    // The composed blocks are built from the same unchanged figures; the caller already has them.
    for (const k of ['ranked_answer', 'intent_answer', 'power_evidence']) delete out[k];
  }
  out.rerun = {
    status: rr.status,
    previous_run: rr.previous,
    unchanged: rr.unchanged,
    changed: rr.changed,
    added: rr.added,
    not_compared: rr.not_compared,
    removed: rr.removed,
    ...block,
  };
  return out;
}
