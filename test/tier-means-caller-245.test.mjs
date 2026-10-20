// tier-means-caller-245.test.mjs — mcp#245 (owner-approved 2026-10-20).
// The top-level `tier` meant the caller's plan on search_facilities and the plan that
// unlocks depth on rank_markets (the backend's `tier: "developer"`, passed through), so an
// anonymous agent read itself as a Developer customer. Every envelope that states a tier
// now carries an unambiguous pair: caller_tier (served at) and required_tier (the set that
// returns what was withheld, from `_<k>_total_unlocks_at`), and `tier` is the caller's only.
// Driven over the REAL /mcp handler with a loopback backend stub (no network).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { stampTierPair, requiredTierOf } from '../lib/honest-tier.mjs';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};

const GOOD = 'dch_live_245goodkeyaaaaaaaaaaaaaaaaaaaa';
const MARKETS = Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, market: 'm' + i, city: 'City' + i, score: 50 + i, total_mw: 100 + i }));
const FAC = Array.from({ length: 5 }, (_, i) => ({ id: 1 + i, name: 'F' + i, city: 'Ashburn', state: 'VA', country: 'US', slug: 'f' + i, power_mw: 10 }));
let S, PORT, httpServer, stub, prevBase, prevSkip;
let ipN = 20;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
        if (u.pathname === '/api/v1/keys/validate') {
          const k = (JSON.parse(b || '{}').api_key) || '';
          return send(k === GOOD ? { valid: true, tier: 'free', developer_id: 'd', email: null } : { valid: false });
        }
        // the backend stamps its OWN gate word as `tier` (what #245 measured live)
        if (u.pathname.includes('rank_markets') || u.pathname.startsWith('/api/v1/markets')) {
          return send({ criteria: 'best_overall', region: 'us', result_count: MARKETS.length, results: MARKETS, tier: 'developer' });
        }
        if (u.pathname === '/api/v1/facilities') return send({ success: true, count: FAC.length, data: FAC });
        if (u.pathname === '/api/v1/interconnection-queue/by-iso' || u.pathname === '/api/v1/interconnection-queue/snapshot') {
          return send({ iso: 'PJM', as_of: '2026-10-07', queued_load_total_gw: 135.1, project_count: 25,
            projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: 'AG1-' + i, project_name: 'P' + i, capacity_mw: 100 + i, state: 'VA' })) });
        }
        if (u.pathname === '/api/v1/mcp/session-key') return send({}, 404);
        if (u.pathname === '/api/v1/mcp/trial-check') return send({ trial_used: true, prior_calls: 9 });
        return send({ error: 'not found' }, 404);
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  prevSkip = process.env.DCHUB_MINT_SKIP_INTERNAL;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevSkip === undefined) delete process.env.DCHUB_MINT_SKIP_INTERNAL; else process.env.DCHUB_MINT_SKIP_INTERNAL = prevSkip;
  net.Socket.prototype.connect = realConnect;
});

const decode = (raw) => (raw.includes('data: ')
  ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw);
async function call(name, args, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'x-forwarded-for': '198.51.100.' + (ipN++), ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const r = JSON.parse(decode(await res.text())).result || {};
  let block0 = null;
  try { block0 = JSON.parse((r.content || [])[0].text); } catch (_) { block0 = null; }
  return { sc: r.structuredContent || {}, block0 };
}

describe('#245 one meaning for tier, plus caller_tier / required_tier', () => {
  it('anonymous rank_markets: tier is the caller (not the backend gate word); required_tier names the gate', async () => {
    const { sc, block0 } = await call('rank_markets', { limit: 50 });
    expect(sc._results_total_unlocks_at, 'not a gated preview — the assertions would be vacuous').toBeTruthy();
    expect(sc.tier).toBe('anonymous');
    expect(sc.caller_tier).toBe('anonymous');
    expect(sc.required_tier).toBe(sc._results_total_unlocks_at);
    expect(sc.tier).toBe(sc.identity && sc.identity.tier);
    if (block0 && Object.prototype.hasOwnProperty.call(block0, 'tier')) {
      expect(block0.tier).toBe('anonymous');
      expect(block0.caller_tier).toBe('anonymous');
      expect(block0.required_tier).toBe(sc.required_tier);
    }
  });

  it('anonymous search_facilities: same vocabulary (it used to say tier "free" for an anonymous seat)', async () => {
    const { sc } = await call('search_facilities', { query: 'Ashburn', limit: 25 });
    expect(sc._data_total_unlocks_at).toBe('free');
    if ('tier' in sc) expect(sc.tier).toBe('anonymous');
    expect(sc.caller_tier).toBe('anonymous');
    expect(sc.required_tier).toBe('free');
  });

  it('the two tools agree on what `tier` means', async () => {
    const a = (await call('rank_markets', { limit: 50 })).sc;
    const b = (await call('search_facilities', { query: 'Ashburn', limit: 25 })).sc;
    expect(a.caller_tier).toBe('anonymous');
    expect(b.caller_tier).toBe(a.caller_tier);
    for (const x of [a, b]) if ('tier' in x) expect(x.tier).toBe(x.caller_tier);
  });

  it('a keyed free caller is told its own tier, never the gate word', async () => {
    const { sc } = await call('rank_markets', { limit: 50 }, { 'x-api-key': GOOD });
    expect(sc.caller_tier).toBe('free');
    if ('tier' in sc) expect(sc.tier).toBe('free');
    expect(sc.tier).not.toBe('developer');
  });

  // mcp#830(c): the agent_autonomous hint named claim_free_key to a caller that had presented a key.
  it('#830(c): a keyed wall continuation does not tell a key holder to claim_free_key', async () => {
    const keyed = (await call('get_interconnection_queue', { iso: 'PJM' }, { 'x-api-key': GOOD })).sc;
    const anon = (await call('get_interconnection_queue', { iso: 'PJM' })).sc;
    const how = (sc) => ((sc.continuation && sc.continuation.continuations) || [])
      .filter((a) => a.type === 'agent_autonomous').map((a) => a.how);
    expect(how(keyed).length, 'keyed wall carried no continuation; the check would be vacuous').toBe(1);
    expect(how(keyed)[0]).not.toMatch(/claim_free_key/);
    expect(how(anon)[0]).toMatch(/claim_free_key/);
  });

  it('no foreign connection', () => { expect(foreign).toEqual([]); });
});

describe('stampTierPair / requiredTierOf (pure)', () => {
  it('highest unlocks_at rung wins; nothing withheld -> null', () => {
    expect(requiredTierOf({ _a_total_unlocks_at: 'free', _b_total_unlocks_at: 'pro' })).toBe('pro');
    expect(requiredTierOf({ _results_total_unlocks_at: 'developer' })).toBe('developer');
    expect(requiredTierOf({ results: [] })).toBe(null);
  });
  it('a facility "Tier III" rating is data, never rewritten', () => {
    const r = { structuredContent: { name: 'x', tier: 'Tier III' }, content: [{ type: 'text', text: '{"name":"x","tier":"Tier III"}' }] };
    expect(stampTierPair(r, { tier: 'free' })).toBe(r);
  });
  it('rewrites both channels; an envelope with no tier claim is untouched', () => {
    const r = { structuredContent: { tier: 'developer', _results_total_unlocks_at: 'developer' },
                content: [{ type: 'text', text: '{"tier":"developer","_results_total_unlocks_at":"developer"}' }] };
    const o = stampTierPair(r, { tier: 'anonymous' });
    expect(o.structuredContent).toMatchObject({ tier: 'anonymous', caller_tier: 'anonymous', required_tier: 'developer' });
    expect(JSON.parse(o.content[0].text)).toMatchObject({ tier: 'anonymous', caller_tier: 'anonymous', required_tier: 'developer' });
    const prose = stampTierPair({ content: [{ type: 'text', text: '{"tier":"developer","a":"}"}\n\nTell your human: x' }] }, { tier: 'free' });
    expect(prose.content[0].text).toBe('{"tier":"free","a":"}","caller_tier":"free","required_tier":null}\n\nTell your human: x');
    const plain = { structuredContent: { results: [1] }, content: [{ type: 'text', text: '{"results":[1]}' }] };
    expect(stampTierPair(plain, { tier: 'free' })).toBe(plain);
  });
});
