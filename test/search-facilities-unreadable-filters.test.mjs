// search-facilities-unreadable-filters.test.mjs
//
// search_facilities takes capacity (min/max_capacity_mw) and facility-tier filters. The
// backend answers this server's own credential at full depth, so the answer a free caller
// gets is shaped by the OUTPUT mask here. A filter runs on the INPUT, before any mask: it
// has to follow the same rule as the field it filters on. This test asserts on what the
// stub backend actually RECEIVES, per kind of caller, through the real express app.
//
// Who may use the filters: paid depth (developer and up), a live pack balance, or a payment
// on this call: the same test the anonymous wall uses (_anonWallPaidCall). Everyone else
// (anonymous, free, identified) has the filters left out of the upstream request, and the
// answer says which were not applied.
//
// Controls: the developer and pack-holder cases prove the filters DO reach the backend for
// an entitled caller, so an absence for the others is the gate's doing and not a stub or a
// client that never sent them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import {
  READ_GATED_FILTERS, hasReadGatedFilter, stripUnreadableFilters, dropUnreadableFilters,
} from '../lib/readable-filters.mjs';

const K_FREE = 'dch_live_rfilter_free0001';
const K_ID = 'dch_live_rfilter_ident0001';
const K_DEV = 'dch_live_rfilter_devel0001';
const K_PACK = 'dch_live_rfilter_pack00001';
const KEY_TIER = { [K_FREE]: 'free', [K_ID]: 'identified', [K_DEV]: 'developer', [K_PACK]: 'free' };
const CREDITS = { [K_PACK]: 40 };
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};

const record = (i) => ({
  id: `fac-${i}`, name: `Filter Test DC ${i}`, slug: `filter-test-dc-${i}`, provider: 'Filter Provider',
  city: 'Ashburn', state: 'VA', country: 'US', status: 'operational', latitude: 39.1, longitude: -77.5,
  power_mw: 48.5,
});

let S, PORT, httpServer, stub;
let seen = [];                                   // query params the backend received on /api/v1/facilities

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
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (u.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(KEY_TIER[key]
          ? { valid: true, tier: KEY_TIER[key], developer_id: 'dev_rfilter', email: null }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (u.pathname === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: true, prior_calls: 1 })); return; }
      if (u.pathname === '/api/v1/mcp/credits/balance') {
        const k = u.searchParams.get('key') || '';
        res.end(JSON.stringify({ credits: CREDITS[k] || 0, had_pack: !!CREDITS[k] }));
        return;
      }
      if (u.pathname === '/api/v1/facilities') {
        seen.push(Object.fromEntries(u.searchParams.entries()));
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
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body, route = '/mcp') {
  const res = await fetch(`http://127.0.0.1:${PORT}${route}`, {
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

let ipN = 0;
async function openSession(headers = {}, route = '/mcp') {
  const h0 = { ...headers, 'x-forwarded-for': `10.77.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}` };
  const init = await post(h0, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rfilter-test', version: '1.0' } },
  }, route);
  const sid = init.headers.get('mcp-session-id');
  if (route === '/mcp') expect(sid, 'initialize did not mint a session id').toBeTruthy();   // /mcp/core is stateless
  const h = sid ? { ...h0, 'mcp-session-id': sid } : h0;
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' }, route);
  let id = 1;
  return {
    async call(name, args) {
      id += 1;
      seen = [];
      const { json } = await post(h, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, route);
      const r = JSON.parse(json).result || {};
      const text = (r.content || []).map((c) => c.text || '').join('');
      return { text, sc: r.structuredContent || null, lead: leadingJson(text) || {}, upstream: seen.slice() };
    },
    async list() {
      id += 1;
      const { json } = await post(h, { jsonrpc: '2.0', id, method: 'tools/list' }, route);
      return (JSON.parse(json).result || {}).tools || [];
    },
  };
}

function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

const FILTERS = { state: 'VA', min_capacity_mw: 500, max_capacity_mw: 900, tier: 3 };
const GATED = ['min_capacity_mw', 'max_capacity_mw', 'tier'];

describe('the filters reach the backend only for a caller who can read what they filter on', () => {
  it('CONTROL: a developer key forwards every filter, and nothing is reported as ignored', async () => {
    const s = await openSession({ 'x-api-key': K_DEV });
    const out = await s.call('search_facilities', FILTERS);
    expect(out.upstream.length, 'the backend was never asked: the absences below would be vacuous').toBe(1);
    expect(out.upstream[0]).toMatchObject({ state: 'VA', min_capacity_mw: '500', max_capacity_mw: '900', tier: '3' });
    expect(out.text).not.toContain('_params_not_applied');
  });

  it('CONTROL: a free key holding a live pack balance forwards them too (the pack is paid depth)', async () => {
    const s = await openSession({ 'x-api-key': K_PACK });
    const out = await s.call('search_facilities', FILTERS);
    expect(out.upstream.length).toBe(1);
    expect(out.upstream[0]).toMatchObject({ min_capacity_mw: '500', max_capacity_mw: '900', tier: '3' });
    expect(out.text).not.toContain('_params_not_applied');
  });

  for (const [label, headers] of [['anonymous', {}], ['free key', { 'x-api-key': K_FREE }], ['identified key', { 'x-api-key': K_ID }]]) {
    it(`${label}: no gated filter is sent upstream, the rest is, and the answer names what was ignored`, async () => {
      const s = await openSession(headers);
      const out = await s.call('search_facilities', FILTERS);
      expect(out.upstream.length, `${label}: the backend was never asked`).toBe(1);
      for (const k of GATED) expect(out.upstream[0], `${label}: ${k} reached the backend`).not.toHaveProperty(k);
      expect(out.upstream[0].state, `${label}: an ordinary filter went missing`).toBe('VA');
      expect(out.text).toContain('_params_not_applied');
      for (const k of GATED) expect(out.text, `${label}: ${k} not named as ignored`).toContain(k);
    });
  }

  it('the upstream request is IDENTICAL whatever capacity value an unentitled caller supplies', async () => {
    const s = await openSession();
    const a = (await s.call('search_facilities', { state: 'VA', min_capacity_mw: 5000 })).upstream[0];
    const b = (await s.call('search_facilities', { state: 'VA', min_capacity_mw: 50 })).upstream[0];
    const c = (await s.call('search_facilities', { state: 'VA', max_capacity_mw: 30 })).upstream[0];
    const none = (await s.call('search_facilities', { state: 'VA' })).upstream[0];
    expect(a).toBeTruthy();
    expect(a).toEqual(none);
    expect(b).toEqual(none);
    expect(c).toEqual(none);
  });

  it('the min_mw alias that agents type is covered too', async () => {
    const s = await openSession();
    const out = await s.call('search_facilities', { state: 'VA', min_mw: 500 });
    expect(out.upstream.length).toBe(1);
    expect(out.upstream[0]).not.toHaveProperty('min_capacity_mw');
    expect(out.upstream[0]).not.toHaveProperty('min_mw');
  });

  it('a zero filter is the "unset" no-op: nothing is reported, nothing changes', async () => {
    const s = await openSession();
    const out = await s.call('search_facilities', { state: 'VA', min_capacity_mw: 0 });
    expect(out.upstream.length).toBe(1);
    expect(out.upstream[0]).toEqual((await s.call('search_facilities', { state: 'VA' })).upstream[0]);
    expect(out.text).not.toContain('_params_not_applied');
  });

  it('other tools that take a capacity filter on other data are left alone', async () => {
    const s = await openSession();
    const out = await s.call('get_pipeline', { min_capacity_mw: 100 });
    expect(out.text).not.toContain('_params_not_applied');   // rank_markets has its own file: rank-markets-unreadable-floor
  });

  it('the focused core profile, which delegates to the same tool, follows the same rule', async () => {
    const s = await openSession({}, '/mcp/core');
    const out = await s.call('facility_lookup', { state: 'VA', min_capacity_mw: 500 });
    expect(out.upstream.length, 'facility_lookup never reached the backend: the absence below would be vacuous').toBe(1);
    expect(out.upstream[0].state).toBe('VA');
    expect(out.upstream[0]).not.toHaveProperty('min_capacity_mw');
    const dev = await openSession({ 'x-api-key': K_DEV }, '/mcp/core');
    const ok = await dev.call('facility_lookup', { state: 'VA', min_capacity_mw: 500 });
    expect(ok.upstream.length).toBe(1);
    expect(ok.upstream[0]).toMatchObject({ state: 'VA', min_capacity_mw: '500' });
  });

  it('the declared interface is unchanged: the filters are still in search_facilities inputSchema', async () => {
    const tools = await (await openSession()).list();
    const t = tools.find((x) => x.name === 'search_facilities');
    expect(t, 'search_facilities not listed').toBeTruthy();
    for (const k of GATED) expect(Object.keys(t.inputSchema.properties || {}), `${k} left the schema`).toContain(k);
  });
});

describe('lib/readable-filters.mjs (pure)', () => {
  it('names exactly the params search_facilities filters capacity and tier on', () => {
    expect(READ_GATED_FILTERS).toEqual({ search_facilities: GATED, rank_markets: ['min_capacity_mw'], get_power_pipeline: ['min_mw'], get_refined_queue: ['min_mw', 'max_ttp_months'] });
  });

  it('hasReadGatedFilter ignores unset, zero and empty values and other tools', () => {
    expect(hasReadGatedFilter('search_facilities', { min_capacity_mw: 500 })).toBe(true);
    expect(hasReadGatedFilter('search_facilities', { tier: '3' })).toBe(true);
    for (const v of [0, '0', '', null, undefined, false]) expect(hasReadGatedFilter('search_facilities', { min_capacity_mw: v })).toBe(false);
    expect(hasReadGatedFilter('search_facilities', { state: 'VA' })).toBe(false);
    expect(hasReadGatedFilter('get_news', { min_capacity_mw: 500 })).toBe(false);
    expect(hasReadGatedFilter('search_facilities', null)).toBe(false);
  });

  it('strip returns a new object, keeps everything else, and leaves a reader untouched', () => {
    const input = { state: 'VA', min_capacity_mw: 500, max_capacity_mw: 0, tier: 3 };
    const r = stripUnreadableFilters('search_facilities', input, false);
    expect(r.params).toEqual({ state: 'VA' });
    expect(r.ignored).toEqual(['min_capacity_mw', 'tier']);         // the zero one was never a filter
    expect(input).toEqual({ state: 'VA', min_capacity_mw: 500, max_capacity_mw: 0, tier: 3 });
    const keep = stripUnreadableFilters('search_facilities', input, true);
    expect(keep.params).toBe(input);
    expect(keep.ignored).toEqual([]);
  });

  it('only a literal true counts as "can read": anything else strips (fail closed)', () => {
    for (const v of [false, undefined, null, 0, 'true', 1]) {
      expect(stripUnreadableFilters('search_facilities', { min_capacity_mw: 5 }, v).ignored).toEqual(['min_capacity_mw']);
    }
  });

  it('drop mutates the original in place and returns what it dropped', () => {
    const a = { state: 'VA', min_capacity_mw: 500, tier: 2 };
    expect(dropUnreadableFilters('search_facilities', a, false)).toEqual(['min_capacity_mw', 'tier']);
    expect(a).toEqual({ state: 'VA' });
    const b = { state: 'VA', min_capacity_mw: 500 };
    expect(dropUnreadableFilters('search_facilities', b, true)).toEqual([]);
    expect(b).toEqual({ state: 'VA', min_capacity_mw: 500 });
    expect(dropUnreadableFilters('get_news', { min_capacity_mw: 500 }, false)).toEqual([]);
  });
});
