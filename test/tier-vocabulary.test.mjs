// A4 tier-gating (owner 2026-10-03): one tier vocabulary in responses.
//   no key -> anonymous, a key with no bound email -> free,
//   a key with a bound email -> identified, then plan names.
// quota.tier and identity.tier read 'free' for an anonymous caller (the
// anonymous ctx carries tier 'free'), and rank_markets passed through the
// backend's descriptive tier:"developer" to every caller. Driven end to end
// through a real session against a stub backend.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_FREE = 'dch_live_vocab_unbound0001';
const K_BOUND = 'dch_live_vocab_bound00001';
const K_DEV = 'dch_live_vocab_devel00001';
const KEYS = {
  [K_FREE]: { tier: 'free', email: null },
  [K_BOUND]: { tier: 'free', email: 'bound@example.test' },
  [K_DEV]: { tier: 'developer', email: 'dev@example.test' },
};
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_QUOTA_HINT'];
const prevEnv = {};
let S, PORT, httpServer, stub;

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
      if (url.pathname === '/api/v1/keys/validate') {
        const k = KEYS[(await readBody(req)).api_key || ''];
        res.end(JSON.stringify(k ? { valid: true, tier: k.tier, developer_id: 'dev_vocab', email: k.email }
          : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname === '/api/v1/mcp/tools/rank_markets') {
        res.end(JSON.stringify({ _entity: 'market_ranking', criteria: 'best_overall', region: 'us',
          result_count: 2, tier: 'developer',
          results: [{ rank: 1, market: 'Vocab A', slug: 'vocab-a', score: 9 },
                    { rank: 2, market: 'Vocab B', slug: 'vocab-b', score: 8 }] }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  process.env.DCHUB_QUOTA_HINT = '1';   // on in production (the live envelope carries quota)
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
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, json };
}

async function rankMarkets(key) {
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vocab-test', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const h = { ...headers, 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const { json } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'rank_markets', arguments: {} } });
  const r = JSON.parse(json).result || {};
  return { sc: r.structuredContent || {}, text: (r.content || []).map((c) => c.text || '').join('') };
}

describe('_canonicalTier', () => {
  it('maps credential + email to the vocabulary', () => {
    expect(S._canonicalTier({ tier: 'free' })).toBe('anonymous');
    expect(S._canonicalTier({})).toBe('anonymous');
    expect(S._canonicalTier({ tier: 'free', api_key: 'k' })).toBe('free');
    expect(S._canonicalTier({ tier: 'trial', api_key: 'k' })).toBe('free');
    expect(S._canonicalTier({ tier: 'free', api_key: 'k', email: 'a@b.test' })).toBe('identified');
    expect(S._canonicalTier({ tier: 'identified', api_key: 'k' })).toBe('identified');
    expect(S._canonicalTier({ tier: 'pro', api_key: 'k' })).toBe('pro');
    expect(S._canonicalTier({ tier: 'free' }, true)).toBe('free');
  });
});

describe('three fixtures through a real session (rank_markets)', () => {
  const CASES = [[null, 'anonymous'], [K_FREE, 'free'], [K_BOUND, 'identified'], [K_DEV, 'developer']];
  for (const [key, want] of CASES) {
    it(`${key ? key.slice(0, 22) : 'no key'} -> ${want}`, async () => {
      const { sc } = await rankMarkets(key);
      expect(sc.identity && sc.identity.tier, 'identity.tier').toBe(want);
      expect(sc.quota && sc.quota.tier, 'quota.tier').toBe(want);
      // The backend's descriptive tier:"developer" no longer reaches a caller
      // who is not on Developer. The key stays (additive rule).
      expect(Object.prototype.hasOwnProperty.call(sc, 'tier')).toBe(true);
      expect(sc.tier).toBe(want);
    });
  }

  it('anonymous carries a quota block (non-vacuous) and no tier:"developer" anywhere', async () => {
    const { sc, text } = await rankMarkets(null);
    expect(sc.quota, 'rank_markets anonymous lost its quota block').toBeTruthy();
    expect(JSON.stringify(sc)).not.toMatch(/"tier":\s*"developer"/);
    expect(text).not.toMatch(/"tier":\s*"developer"/);
  });
});
