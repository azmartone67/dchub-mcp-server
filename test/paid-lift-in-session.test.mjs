// paid-lift-in-session.test.mjs — r-paid-lift (2026-09-14)
//
// ★THE DEFECT (read on mcp c9bae40 / backend f553ba9b4, reproduced here through the real
// /mcp handler). A keyed caller's Pro link is /go/c pro|k-<sha256(key)>|sid. The webhook's
// k- branch stamps mcp_dev_keys.tier and writes no mcp_session_upgrades row (Fix E skips
// k- refs), so trial-check has nothing to hand back for the purchase. The server fixed a
// session's tier at initialize, re-validated only when a DIFFERENT header key arrived, and
// cached validation for 5 minutes. The paid_only wall said "this key unlocks — just call
// X again"; the next call was walled again.
//
// ★SESSION-BOUND PURCHASES (Fix E) had two more holes. trial-check hands back plan names
// ('pro') and applyTierGate knows Pro-class only as 'paid', so a 'pro' session was refused
// every PAID_ONLY tool — and a preview tool fell from its free preview to a hard wall. The
// early tier-bind poll read the upgrade and dropped it, and the preview tools never call
// trial-check themselves.
//
// ★WHY THE COUNTERS. /keys/validate is not free: each call spends part of an unbound
// dch_live_ key's free allowance and of a dch_trial_ key's daily count. The lift
// re-reads /mcp/monthly-usage (read-only, already on the keyed path) and validates only
// when that read shows an upgrade. The no-payment test pins that down, and its k- link
// assertion proves each key was really handed a link — "no validate" is also what a path
// that never probes at all produces.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const SECRET = 'test-internal-key-not-a-real-secret';
const PROBE_MS = 150;
const K_PAY = 'dch_live_paidlift_pays00001';
const K_NEW = 'dch_live_paidlift_newsess01';
const K_IDLE = 'dch_live_paidlift_nopay0001';
const K_SPLIT = 'dch_live_paidlift_split0001';   // monthly-usage says pro, validate says free
const K_TRIAL = 'dch_trial_paidlift_trial001';
const K_TRIAL2 = 'dch_trial_paidlift_trialhdr1';
const K_AUTO = 'dch_live_paidlift_autobnd01';
const K_MASK = 'dch_live_paidlift_masked001';
const K_BLIP = 'dch_live_paidlift_blip00001';
const LIVE_KEYS = new Set([K_PAY, K_NEW, K_IDLE, K_SPLIT, K_AUTO, K_MASK, K_BLIP]);
const COMPARE = { locations: '33.45,-112.07;39.04,-77.48' };
const sha = (k) => createHash('sha256').update(k).digest('hex');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

let S, PORT, httpServer, stub;
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_KEY_TIER_PROBE_MS'];
const prevEnv = {};
const paid = new Set();         // keys the webhook's k- branch has stamped
const fixE = new Map();          // session id → tier_upgrade a session-bound purchase returns
const keystone = new Map();      // session id → key claim_free_key stamped onto the session
const validateHits = new Map();
const quotaHits = new Map();
const trialHits = new Map();     // session id → trial-check calls
const blipOnce = new Set();      // keys whose next validate answers 503
let dataHits = 0;
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const hits = (m, k) => m.get(k) || 0;

const ROWS = Array.from({ length: 6 }, (_, i) => ({
  id: 100 + i, name: `Site ${i}`, slug: `site-${i}`, provider: 'P', city: 'Ashburn',
  state: 'VA', country: 'US', region: 'PJM', score: 60 + i, power_mw: 10 * (i + 1),
}));

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        bump(validateHits, key);
        if (blipOnce.delete(key)) { res.statusCode = 503; res.end('{}'); return; }
        let out = { valid: false, tier: 'free' };
        if (LIVE_KEYS.has(key)) {
          out = { valid: true, tier: paid.has(key) ? 'paid' : 'free', developer_id: 'dev_t', email: null };
        }
        if (key === K_TRIAL || key === K_TRIAL2) out = { valid: true, tier: 'free', developer_id: null, email: null, source: 'auto_trial' };
        res.end(JSON.stringify(out));
        return;
      }
      if (p === '/api/v1/mcp/monthly-usage') {
        // The backend returns the HIGHER of the tier passed and its own read of the key.
        const key = url.searchParams.get('api_key') || '';
        bump(quotaHits, key);
        const tier = (paid.has(key) || key === K_SPLIT) ? 'pro' : (url.searchParams.get('tier') || 'free');
        res.end(JSON.stringify({ allowed: true, blocked: false, enforce: false, reason: 'enforcement_off',
          used: 3, quota: 300, remaining: 297, tier, quota_tier: tier }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') {
        const sid = (await readBody(req)).session_id;
        bump(trialHits, sid);
        let out = { trial_used: true, prior_calls: 1 };
        if (fixE.has(sid)) out = { ...out, tier_upgrade: fixE.get(sid), fix_e_session_bound: true };
        else if (keystone.has(sid)) {
          out = { ...out, session_api_key: keystone.get(sid), tier_upgrade: 'free', session_bound_free: true };
        }
        res.end(JSON.stringify(out));
        return;
      }
      if (p === '/api/v1/keys/auto-mint') { res.end(JSON.stringify({ ok: false })); return; }
      if (p === '/api/v1/mcp/credits/balance') { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      const tool = p.startsWith('/api/v1/mcp/tools/');   // a data tool served through the backend
      if ((p.startsWith('/api/v1/mcp/') && !tool) || p.startsWith('/api/v1/sources/')) { res.end('{}'); return; }
      dataHits += 1;
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  // Held for the whole file, not just the import: _goUrl reads DCHUB_INTERNAL_KEY per call,
  // and without it the wall hands out the raw Stripe link instead of the signed /go/c one.
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.DCHUB_KEY_TIER_PROBE_MS = String(PROBE_MS);
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, json };
}

async function openSession(headers) {
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'paid-lift-test', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  let id = 1;
  return {
    sid,
    async call(name, args) {
      id += 1;
      const { json } = await post(h, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
      const r = JSON.parse(json).result || {};
      return (r.content || []).map((c) => c.text || '').join('');
    },
  };
}

// Imported, not re-derived — see the note in
// test/high-intent-needs-a-session.test.mjs. Lazy: `S` is set in beforeAll.
const walled = (text) => S.isHardWallText(text);

/** The client_reference_id each signed /go/c link in `text` carries (plan|ref|sid). */
function goRefs(text) {
  return [...String(text).matchAll(/https:\/\/dchub\.cloud\/go\/c\/([A-Za-z0-9_-]+)\.[0-9a-f]+/g)]
    .map((m) => Buffer.from(m[1], 'base64url').toString().split('|')[1] || '');
}

/** The JSON object a data tool leads its text with (a markdown block may follow it). */
function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}
const firstRow = (text) => ((leadingJson(text) || {}).data || [])[0] || {};

describe('r-paid-lift — a key that pays mid-session is served as paid', () => {
  it('THE REPRO: after a k- purchase the walled tool is served on the next call — same session, same key', async () => {
    const s = await openSession({ 'x-api-key': K_PAY });
    const before = await s.call('compare_sites', COMPARE);
    expect(walled(before), before.slice(0, 300)).toBe(true);
    expect(before).toContain('this key unlocks');
    expect(goRefs(before), 'the wall never handed this key a k- link').toContain(`k-${sha(K_PAY)}`);

    const v0 = hits(validateHits, K_PAY);
    paid.add(K_PAY);                                  // the webhook's k- branch
    await sleep(PROBE_MS + 50);
    const d0 = dataHits;
    const after = await s.call('compare_sites', COMPARE);
    expect(walled(after), after.slice(0, 300)).toBe(false);
    expect(dataHits, 'the tool handler never reached the backend').toBeGreaterThan(d0);
    expect(hits(validateHits, K_PAY), 'the lift is confirmed by exactly one validate').toBe(v0 + 1);

    const again = await s.call('compare_sites', COMPARE);
    expect(walled(again)).toBe(false);
    expect(hits(validateHits, K_PAY), 'a lifted session kept re-validating').toBe(v0 + 1);
  });

  it('a NEW session after the purchase is not held at free by the 5-minute key cache', async () => {
    const s1 = await openSession({ 'x-api-key': K_NEW });
    expect(walled(await s1.call('compare_sites', COMPARE))).toBe(true);
    paid.add(K_NEW);
    await sleep(PROBE_MS + 50);

    const v0 = hits(validateHits, K_NEW);
    const s2 = await openSession({ 'x-api-key': K_NEW });
    expect(hits(validateHits, K_NEW), 'initialize went to the backend — the stale cache was never exercised')
      .toBe(v0);
    const r = await s2.call('compare_sites', COMPARE);
    expect(walled(r), r.slice(0, 300)).toBe(false);
  });

  it('no purchase, no validate: a key handed a k- link is re-read through monthly-usage only', async () => {
    for (const key of [K_IDLE, K_TRIAL, K_SPLIT]) {
      const vStart = hits(validateHits, key);
      const s = await openSession({ 'x-api-key': key });
      const w = await s.call('compare_sites', COMPARE);
      expect(walled(w), `${key}: ${w.slice(0, 200)}`).toBe(true);
      // A trial key is sold a session-bound Pro link (a k- ref has no row to land on), so it
      // is never marked and never re-read. The other two were handed k- links.
      if (key === K_TRIAL) {
        expect(goRefs(w).length, 'the trial wall carries no /go/c link at all').toBeGreaterThan(0);
        expect(goRefs(w).some((r) => r.startsWith('k-')), 'a trial key was handed a k- link').toBe(false);
      } else {
        expect(goRefs(w), `${key} was never handed a k- link`).toContain(`k-${sha(key)}`);
      }

      const q0 = hits(quotaHits, key);
      for (let i = 0; i < 3; i += 1) {
        await sleep(PROBE_MS + 30);
        expect(walled(await s.call('compare_sites', COMPARE))).toBe(true);
      }
      // initialize validates once. K_SPLIT's monthly-usage claims pro while validate says
      // free: exactly one confirming validate, then back-off — never one per probe.
      expect(hits(validateHits, key) - vStart, `${key} re-validated with no purchase`)
        .toBe(key === K_SPLIT ? 2 : 1);
      if (key === K_IDLE) {   // K_SPLIT's cached decision already reads pro; a trial key is not marked
        expect(hits(quotaHits, key), `${key}: the cached tier was never re-read`).toBeGreaterThanOrEqual(q0 + 3);
      }
    }
  });

  it('session-bound Pro (Fix E): the walled PAID_ONLY tool is served, and a preview tool is not demoted to a wall', async () => {
    const s = await openSession({});
    expect(walled(await s.call('get_tax_incentives', { state: 'VA' }))).toBe(true);
    const preview = await s.call('rank_markets', { limit: 5 });
    expect(walled(preview), preview.slice(0, 200)).toBe(false);
    expect(firstRow(preview).score, 'the anonymous preview no longer masks score — no contrast left').toBeNull();

    fixE.set(s.sid, 'pro');
    const r = await s.call('get_tax_incentives', { state: 'VA' });
    expect(walled(r), r.slice(0, 300)).toBe(false);
    expect(walled(await s.call('get_tax_incentives', { state: 'VA' })), 'the next call lost the tier').toBe(false);

    const full = await s.call('rank_markets', { limit: 5 });
    expect(walled(full), full.slice(0, 300)).toBe(false);
    expect(firstRow(full).score).toBe(ROWS[0].score);
  });

  it('session-bound Pro (Fix E) reaches a preview tool, which never calls trial-check itself', async () => {
    const s = await openSession({});
    fixE.set(s.sid, 'pro');
    const r = await s.call('rank_markets', { limit: 5 });
    expect(walled(r), r.slice(0, 300)).toBe(false);
    expect(firstRow(r).score, 'still the masked preview').toBe(ROWS[0].score);
    // Once the session is Pro-class the poll stops: no more trial-check round trips.
    const t0 = hits(trialHits, s.sid);
    expect(t0, 'the lift did not come through trial-check').toBeGreaterThan(0);
    for (let i = 0; i < 2; i += 1) {
      expect(firstRow(await s.call('rank_markets', { limit: 5 })).score).toBe(ROWS[0].score);
    }
    expect(hits(trialHits, s.sid), 'a Pro session kept polling trial-check').toBe(t0);
  });

  it('an AUTO-bound session (claimed key) sees a session-bound purchase too', async () => {
    const s = await openSession({});
    keystone.set(s.sid, K_AUTO);
    const bound = await s.call('rank_markets', { limit: 5 });
    expect(hits(validateHits, K_AUTO) + hits(quotaHits, K_AUTO),
      'the claimed key was never bound to the session').toBeGreaterThan(0);
    fixE.set(s.sid, 'pro');
    const r = await s.call('search_facilities', { query: 'Ashburn', limit: 25 });
    expect(firstRow(r).power_mw, `${bound.slice(0, 120)} || ${r.slice(0, 200)}`).toBe(ROWS[0].power_mw);
  });

  it('a trial key sent as a header is sold session-bound links, and sees that purchase too', async () => {
    const Q = { query: 'Ashburn', limit: 25 };
    const control = await openSession({ 'x-api-key': K_TRIAL2 });
    expect(firstRow(await control.call('search_facilities', Q)).power_mw,
      'the keyed-free mask no longer strips power_mw — no contrast left').toBeUndefined();
    const s = await openSession({ 'x-api-key': K_TRIAL2 });
    fixE.set(s.sid, 'pro');
    const r = await s.call('search_facilities', Q);
    expect(firstRow(r).power_mw, r.slice(0, 200)).toBe(ROWS[0].power_mw);
  });

  it('the call that lifts is served at the lifted tier — the free facility mask does not ride along', async () => {
    const s = await openSession({ 'x-api-key': K_MASK });
    const free = await s.call('search_facilities', { query: 'Ashburn', limit: 25 });
    expect(firstRow(free).power_mw, 'the keyed-free mask no longer strips power_mw — no contrast left')
      .toBeUndefined();
    expect(walled(await s.call('compare_sites', COMPARE))).toBe(true);   // hands the key its k- link
    paid.add(K_MASK);
    await sleep(PROBE_MS + 50);
    const lifted = await s.call('search_facilities', { query: 'Ashburn', limit: 25 });
    expect(firstRow(lifted).power_mw).toBe(ROWS[0].power_mw);
  });
  it('a backend blip on the confirming validate is retried on the next probe, not backed off', async () => {
    const s = await openSession({ 'x-api-key': K_BLIP });
    expect(walled(await s.call('compare_sites', COMPARE))).toBe(true);
    paid.add(K_BLIP);
    blipOnce.add(K_BLIP);                             // the confirming validate answers 503 once
    await sleep(PROBE_MS + 50);
    expect(walled(await s.call('compare_sites', COMPARE)), 'served without a confirmed validate').toBe(true);
    await sleep(PROBE_MS + 50);
    const r = await s.call('compare_sites', COMPARE);
    expect(walled(r), r.slice(0, 300)).toBe(false);
  });
});

describe('_keyBoundSubUrl marks the key it binds', () => {
  it('a k- link built for an explicit key (not the one in ctx) opens that key\'s re-read window', () => {
    const key = 'dch_live_paidlift_explicit01';
    expect(S._keySubLinkRecent(key)).toBe(false);
    S._keyBoundSubUrl('https://buy.stripe.com/test_paidlift_explicit', key);
    expect(S._keySubLinkRecent(key)).toBe(true);
  });
});
