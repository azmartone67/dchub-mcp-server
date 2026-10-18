// rank-markets-unreadable-floor.test.mjs
//
// rank_markets takes a min_capacity_mw floor on market total MW. The
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
      if (u.pathname === '/api/v1/mcp/tools/rank_markets') {
        seen.push(Object.fromEntries(u.searchParams.entries()));
        res.end(JSON.stringify({ criteria: 'most_capacity', results: [{ market: 'ashburn-va', rank: 1, total_mw: 6000 }], tier: 'developer' }));
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

const ASK = { criteria: 'most_capacity', limit: 50, min_capacity_mw: 5000 };

describe('the rank_markets floor reaches the backend only for a caller who can read market MW', () => {
  it('CONTROL: a developer key forwards the floor and nothing is reported as ignored', async () => {
    const s = await openSession({ 'x-api-key': K_DEV });
    const out = await s.call('rank_markets', ASK);
    expect(out.upstream.length, 'the backend was never asked: the absences below would be vacuous').toBe(1);
    expect(out.upstream[0]).toMatchObject({ criteria: 'most_capacity', min_capacity_mw: '5000' });
    expect(out.text).not.toContain('_params_not_applied');
  });

  it('CONTROL: a free key holding a live pack balance forwards it too', async () => {
    const s = await openSession({ 'x-api-key': K_PACK });
    const out = await s.call('rank_markets', ASK);
    expect(out.upstream.length).toBe(1);
    expect(out.upstream[0]).toMatchObject({ min_capacity_mw: '5000' });
    expect(out.text).not.toContain('_params_not_applied');
  });

  for (const [label, headers] of [['anonymous', {}], ['free key', { 'x-api-key': K_FREE }], ['identified key', { 'x-api-key': K_ID }]]) {
    it(`${label}: the floor is not sent as a number, the rest is, and the answer names it`, async () => {
      const s = await openSession(headers);
      const out = await s.call('rank_markets', ASK);
      expect(out.upstream.length, `${label}: the backend was never asked`).toBe(1);
      expect(Number(out.upstream[0].min_capacity_mw || 0), `${label}: the floor reached the backend`).toBe(0);
      expect(out.upstream[0].criteria, `${label}: an ordinary argument went missing`).toBe('most_capacity');
      expect(out.text).toContain('_params_not_applied');
      expect(out.text).toContain('min_capacity_mw');
    });
  }

  it('the upstream request is IDENTICAL whatever floor an unentitled caller supplies', async () => {
    const s = await openSession();
    const a = (await s.call('rank_markets', { criteria: 'most_capacity', min_capacity_mw: 5000 })).upstream[0];
    const b = (await s.call('rank_markets', { criteria: 'most_capacity', min_capacity_mw: 50 })).upstream[0];
    const none = (await s.call('rank_markets', { criteria: 'most_capacity' })).upstream[0];
    expect(a).toBeTruthy();
    expect(a).toEqual(none);
    expect(b).toEqual(none);
  });

  it('a zero floor is the unset no-op: nothing is reported', async () => {
    const s = await openSession();
    const out = await s.call('rank_markets', { criteria: 'most_capacity', min_capacity_mw: 0 });
    expect(out.upstream.length).toBe(1);
    expect(out.text).not.toContain('_params_not_applied');
  });

  it('the registry covers rank_markets and leaves other tools alone', () => {
    expect(READ_GATED_FILTERS.rank_markets).toEqual(['min_capacity_mw']);
    expect(hasReadGatedFilter('rank_markets', { min_capacity_mw: 100 })).toBe(true);
    expect(hasReadGatedFilter('rank_markets', { min_capacity_mw: 0 })).toBe(false);
    expect(hasReadGatedFilter('get_pipeline', { min_capacity_mw: 100 })).toBe(false);
    const args = { criteria: 'x', min_capacity_mw: 9 };
    expect(dropUnreadableFilters('rank_markets', args, false)).toEqual(['min_capacity_mw']);
    expect(args).toEqual({ criteria: 'x' });
    expect(stripUnreadableFilters('rank_markets', { min_capacity_mw: 9 }, true).ignored).toEqual([]);
  });
});
