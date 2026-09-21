// bind-midcall-facility-mask.test.mjs — r-bind-midcall-mask (2026-09-21)
//
// ★THE DEFECT. callAPI reaches the backend with X-Internal-Key, so the backend
// hands every facility record over whole and the MCP server's own mask is the
// only thing between a free caller and power_mw / specs / the raw row. For a
// KEYED free/identified caller that mask is _keyedFreeFacilityResult, and it
// had one call site, after the paywall branch in trackedTool. The keystone
// session-bind lives INSIDE that branch: an anonymous session whose claimed key
// is bound mid-call re-gates to {allowed, masked:true} on get_facility and used
// to return the raw handler result, so the first call after a claim got the
// full record. Measured through this file's harness before the fix:
//   keystone bind  get_facility  power_mw 48.5, total_sqft, raw_data, jv_partners
//   early bind     get_facility  masked (it falls through to the free-path mask)
//
// The keystone is the bind that runs when the early session→key bind does not:
// a miss on this session in the last 60 s throttles it (so the claim-then-retry
// flow reaches the keystone), or DCHUB_SESSION_TIER_BIND=off. search_facilities
// is not PAID_ONLY, so an anonymous call to it never enters the paywall branch:
// the early bind is the only mid-call bind it can meet, and it is pinned here.
//
// ★Why the control: every assertion below is an ABSENCE. The developer-key test
// proves the stub really serves each paid field, so an absence is the mask's
// doing and not a stub that never sent it. The `_upgrade.message` signature
// proves the answer came from the KEYED mask (the bind happened) and not from
// the anonymous preview, which also strips power_mw.
//
// HARD gate: deterministic, and its only network is two 127.0.0.1 listeners
// (a stub backend and the real express app), the shape paid-lift-in-session
// already runs there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_CLAIM = 'dch_live_bindmask_claimed01';
const K_DEV = 'dch_live_bindmask_develop01';
const KEY_TIER = { [K_CLAIM]: 'identified', [K_DEV]: 'developer' };
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_SESSION_TIER_BIND'];
const prevEnv = {};

// Every value a free caller must not see, each distinctive enough to grep for.
const PAID = {
  power_mw: 48.5, total_sqft: 250001, raw_data: { source_row: 'bindmask-raw-row' },
  address: '1 Bindmask Example Road', jv_partners: 'Bindmask JV Partner',
  power_procurement_notes: 'bindmask procurement note', confidence_score: 0.93,
};
const PAID_NEEDLES = ['power_mw', '48.5', 'total_sqft', '250001', 'raw_data', 'bindmask-raw-row',
  'Bindmask Example Road', 'jv_partners', 'Bindmask JV Partner', 'procurement', 'confidence_score'];
const record = (i) => ({
  id: `fac-${i}`, name: `Bindmask DC ${i}`, slug: `bindmask-dc-${i}`, provider: 'Bindmask Provider',
  city: 'Ashburn', state: 'VA', country: 'US', status: 'operational',
  latitude: 39.1, longitude: -77.5, ...PAID,
});
const KEYED_SIGNATURE = 'Free tier: facility capacity (MW)';

let S, PORT, httpServer, stub;
const claimed = new Map();     // session id → key claim_free_key stamped onto it (on another replica)
const trialHits = new Map();
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

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
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_bindmask', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') {
        const sid = (await readBody(req)).session_id;
        bump(trialHits, sid);
        // The backend's keystone handoff: the claimed key and ITS tier, 'identified'
        // for a claim_free_key mint (flask_mcp_endpoints trial_check).
        res.end(JSON.stringify(claimed.has(sid)
          ? { trial_used: true, prior_calls: 1, session_api_key: claimed.get(sid),
              tier_upgrade: 'identified', session_bound_free: true }
          : { trial_used: true, prior_calls: 1 }));
        return;
      }
      if (p === '/api/v1/mcp/credits/balance') { res.end(JSON.stringify({ credits: 0, had_pack: false })); return; }
      if (p === '/api/v1/facilities/fac-1') { res.end(JSON.stringify(record(1))); return; }
      if (p === '/api/v1/facilities') {
        res.end(JSON.stringify({ facilities: [record(1), record(2)], total: 2 }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  delete process.env.DCHUB_SESSION_TIER_BIND;
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

async function openSession(headers = {}) {
  const init = await post(headers, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bindmask-test', version: '1.0' } },
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
      const text = (r.content || []).map((c) => c.text || '').join('');
      return { text, sc: r.structuredContent || null, lead: leadingJson(text) || {} };
    },
  };
}

/** The JSON object a data tool leads its text with (prose may follow it). */
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

/** The facility row an answer carries: the object itself, or the first row of a list. */
const rowOf = (lead) => (Array.isArray(lead.facilities) ? lead.facilities[0] : lead) || {};

function expectKeyedFreeMask(out, label) {
  const row = rowOf(out.lead);
  expect(row.name, `${label}: no facility row came back — the absences below would be vacuous`).toMatch(/^Bindmask DC /);
  expect(row.provider, `${label}: a free field went missing`).toBe('Bindmask Provider');
  for (const needle of PAID_NEEDLES) {
    expect(out.text.includes(needle), `${label}: paid field "${needle}" reached the text`).toBe(false);
    expect(JSON.stringify(out.sc || {}).includes(needle), `${label}: paid field "${needle}" reached structuredContent`).toBe(false);
  }
  expect(String((out.lead._upgrade || {}).message || ''), `${label}: not the KEYED free mask`).toContain(KEYED_SIGNATURE);
}

describe('r-bind-midcall-mask — a claim bound mid-call gets the keyed-free facility mask', () => {
  it('THE REPRO: keystone bind (early bind throttled by the call before the claim) — get_facility is masked', async () => {
    const s = await openSession();
    await s.call('get_news', {});                 // early-bind miss → 60 s throttle on this session
    expect(trialHits.get(s.sid), 'the early bind never polled — the throttle this test needs is not set').toBe(1);
    claimed.set(s.sid, K_CLAIM);                  // the claim lands (on another replica)
    const out = await s.call('get_facility', { id: 'fac-1' });
    expect(trialHits.get(s.sid), 'the paywall trial-check did not run — the keystone was not exercised').toBe(2);
    expectKeyedFreeMask(out, 'keystone get_facility');
    // The bind persisted: the next call is keyed from its first line, and still masked.
    expectKeyedFreeMask(await s.call('get_facility', { id: 'fac-1' }), 'next call after the keystone bind');
  });

  it('keystone bind with the early bind switched off — the first get_facility after the claim is masked', async () => {
    process.env.DCHUB_SESSION_TIER_BIND = 'off';
    try {
      const s = await openSession();
      claimed.set(s.sid, K_CLAIM);
      const out = await s.call('get_facility', { id: 'fac-1' });
      expect(trialHits.get(s.sid), 'only the paywall trial-check should have run').toBe(1);
      expectKeyedFreeMask(out, 'keystone get_facility (early bind off)');
    } finally {
      delete process.env.DCHUB_SESSION_TIER_BIND;
    }
  });

  for (const [tool, args] of [['get_facility', { id: 'fac-1' }], ['search_facilities', { state: 'VA' }]]) {
    it(`early bind (fresh session, claim already landed) — ${tool} is masked`, async () => {
      const s = await openSession();
      claimed.set(s.sid, K_CLAIM);
      const out = await s.call(tool, args);
      expect(trialHits.get(s.sid), 'the early bind did not poll').toBe(1);
      expectKeyedFreeMask(out, `early-bind ${tool}`);
    });
  }

  it('CONTROL: a developer key gets every paid field the stub serves', async () => {
    const s = await openSession({ 'x-api-key': K_DEV });
    for (const [tool, args] of [['get_facility', { id: 'fac-1' }], ['search_facilities', { state: 'VA' }]]) {
      const out = await s.call(tool, args);
      const row = rowOf(out.lead);
      expect(row.power_mw, `${tool}: power_mw`).toBe(48.5);
      expect(row.total_sqft, `${tool}: total_sqft`).toBe(250001);
      expect(row.jv_partners, `${tool}: jv_partners`).toBe('Bindmask JV Partner');
      expect(row.power_procurement_notes, `${tool}: procurement notes`).toBe('bindmask procurement note');
      expect(row.confidence_score, `${tool}: confidence_score`).toBe(0.93);
      expect((row.raw_data || {}).source_row, `${tool}: raw_data`).toBe('bindmask-raw-row');
      expect(row.address, `${tool}: address`).toBe('1 Bindmask Example Road');
      expect(String((out.lead._upgrade || {}).message || '')).not.toContain(KEYED_SIGNATURE);
    }
  });
});
