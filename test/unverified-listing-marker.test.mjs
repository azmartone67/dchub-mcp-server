// unverified-listing-marker.test.mjs — r-unverified-agent-surfaces (2026-09-28)
//
// Growth audit #4. The backend marks a third-party directory row (backend
// #5784, util/unverified_listings.py) v="unverified" +
// listing="Unverified directory listing" and serves it with no status.
// MEASURED LIVE 2026-09-28 before this change: /api/v1/facilities?q=STACK
// Portland&state=OR served id 568 "Stack Portland 1" with both markers, and
// search_facilities showed the same query with NO marker on any row — the
// keyed/anonymous free mask (_FACILITY_FREE_FIELDS) dropped `v` and `listing`.
//
// This file drives the REAL express app against a stub backend that serves one
// marked row and one verified row, on every rung (anonymous, keyed free,
// developer), for search_facilities and get_facility, and asserts on the
// model-visible text. The stub also leaves a status on the marked row (an
// older backend path) to prove the MCP side never presents it as Operational.
//
// HARD gate: deterministic, only 127.0.0.1 listeners.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_FREE = 'dch_live_unvmark_freekey01';
const K_DEV = 'dch_live_unvmark_develop01';
const KEY_TIER = { [K_FREE]: 'free', [K_DEV]: 'developer' };
const OVER_CAP_IP = '198.51.100.8';
const ANON_CAP = 5;
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_TRIAL_PREVIEW_ROWS'];
const prevEnv = {};

const UNVERIFIED = {
  id: 568, name: 'Stack Portland 1', slug: 'stack-stack-portland-1-16218a74',
  provider: 'Stack', city: 'Hillsboro', state: 'OR', country: 'US',
  status: 'Operational', latitude: 45.54, longitude: -122.95,
  v: 'unverified', listing: 'Unverified directory listing', power_mw: 9.5,
};
const VERIFIED = {
  id: 899, name: 'Stack Portland', slug: 'stack-infrastructure-stack-portland-6c5c4092',
  provider: 'Stack Infrastructure', city: 'Hillsboro', state: 'OR', country: 'US',
  status: 'Operational', latitude: 45.54, longitude: -122.95, v: 'verified', power_mw: 9.5,
};

let S, PORT, httpServer, stub;
const depleted = new Set();      // session ids whose pack is spent (credits 0, had_pack)
const holding = new Set();       // session ids holding pack credits
const facilityLimits = [];       // the `limit` each /api/v1/facilities call carried

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const u = new URL(req.url, 'http://_');
      const p = u.pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/keys/validate') {
        let b = '';
        for await (const ch of req) b += ch;
        let key = '';
        try { key = JSON.parse(b || '{}').api_key || ''; } catch (_) { /* empty body */ }
        res.end(JSON.stringify(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_anonmask', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: true, prior_calls: 1 })); return; }
      if (p === '/api/v1/mcp/anon-usage') {
        res.end(JSON.stringify({ count: u.searchParams.get('ip') === OVER_CAP_IP ? ANON_CAP : 0 }));
        return;
      }
      if (p === '/api/v1/mcp/credits/balance') {
        const sid = u.searchParams.get('session') || '';
        res.end(JSON.stringify(holding.has(sid) ? { credits: 1000, had_pack: true }
          : depleted.has(sid) ? { credits: 0, had_pack: true } : { credits: 0, had_pack: false }));
        return;
      }
      if (p === '/api/v1/facilities/568') { res.end(JSON.stringify({ success: true, data: UNVERIFIED })); return; }
      if (p === '/api/v1/facilities/899') { res.end(JSON.stringify({ success: true, data: VERIFIED })); return; }
      if (p === '/api/v1/facilities') {
        facilityLimits.push(u.searchParams.get('limit'));
        res.end(JSON.stringify({ success: true, data: [UNVERIFIED, VERIFIED],
          pagination: { page: 1, limit: 50, total: 2, pages: 1 } }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  process.env.DCHUB_ANON_DAILY_CAP = String(ANON_CAP);   // arms the over-cap branch; every other IP reads 0
  delete process.env.DCHUB_TRIAL_PREVIEW_ROWS;
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
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'anonmask-test', version: '1.0' } },
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

const rowsOf = (lead) => (Array.isArray(lead.data) ? lead.data : [lead.data]).filter(Boolean);

function expectMarked(rows, label) {
  const u = rows.find((r) => r.name === 'Stack Portland 1');
  expect(u, `${label}: the unverified row did not come back — the assertions below would be vacuous`).toBeTruthy();
  expect(u.verification, `${label}: verification`).toBe('unverified_directory_listing');
  expect(u.listing, `${label}: listing label`).toBe('Unverified directory listing');
  expect(u.v, `${label}: v`).toBe('unverified');
  expect(u.status ?? null, `${label}: an unverified row still carries a status`).toBe(null);
  return u;
}

const RUNGS = [
  ['anonymous', {}],
  ['keyed free', { 'x-api-key': K_FREE }],
  ['developer', { 'x-api-key': K_DEV }],
];

describe('r-unverified-agent-surfaces — the directory-listing marker reaches the model on every rung', () => {
  for (const [label, headers] of RUNGS) {
    it(`search_facilities (${label}): marker + verification kept, no status on the unverified row`, async () => {
      const out = await (await openSession(headers)).call('search_facilities', { query: 'STACK Portland', state: 'OR' });
      const rows = rowsOf(out.lead);
      expectMarked(rows, `search_facilities/${label}`);
      const ok = rows.find((r) => r.name === 'Stack Portland');
      expect(ok, `search_facilities/${label}: the verified control row is missing`).toBeTruthy();
      expect(ok.verification, `search_facilities/${label}: verified row`).toBe('verified');
      expect(ok.listing, `search_facilities/${label}: a verified row was labelled`).toBeUndefined();
      expect(ok.status, `search_facilities/${label}: the verified row lost its status`).toBe('Operational');
      expect(out.text).toContain('Unverified directory listing');
    });

    it(`get_facility (${label}): the unverified record says so`, async () => {
      const s = await openSession(headers);
      const out = await s.call('get_facility', { id: '568' });
      const rows = rowsOf(out.lead);
      if (label === 'anonymous' && !rows.length) {
        // get_facility is paywalled for a keyless caller: no record, nothing to mark.
        expect(out.text).not.toMatch(/"status":"Operational"/);
        return;
      }
      expectMarked(rows, `get_facility/${label}`);
    });
  }
});

describe('_markUnverifiedListings — pure transform', () => {
  it('marks only rows the backend marked, never invents a marker', async () => {
    const S2 = await import('../server.mjs');
    const got = S2._markUnverifiedListings({ data: [
      { name: 'a', v: 'unverified', status: 'Operational' },
      { name: 'b', listing: 'Unverified directory listing', lifecycle_status: 'Announced' },
      { name: 'c', v: 'tracked', status: 'Operational' },
      { name: 'd', status: 'Operational' },
      { title: 'not a facility', v: 'unverified', status: 'x' },
    ] });
    const [a, b, c, d, e] = got.data;
    expect(a).toMatchObject({ verification: 'unverified_directory_listing', status: null });
    expect(b).toMatchObject({ verification: 'unverified_directory_listing', lifecycle_status: null, v: 'unverified' });
    expect(c).toEqual({ name: 'c', v: 'tracked', status: 'Operational', verification: 'tracked' });
    expect(d).toEqual({ name: 'd', status: 'Operational' });
    expect(e).toEqual({ title: 'not a facility', v: 'unverified', status: 'x' });
  });
});
