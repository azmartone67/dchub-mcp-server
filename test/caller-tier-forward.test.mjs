// Caller tier forwarding (owner 2026-11-03, "pass caller tier through").
//
// ★THE DEFECT. callAPI reaches the backend with THIS server's X-Internal-Key,
// and the backend's shared paid checks (routes/dcpi._dcpi_caller_plan ->
// util/dcpi_gate.caller_is_paid, util/substation_detail.
// caller_sees_substation_detail) counted that credential as Pro, so every
// below-Pro mask on those surfaces had to be repeated in this layer.
//
// callAPI / callAPIWrite now send X-DCHub-Caller-Tier: the end user's tier as
// this server resolved it (no key = anonymous). The backend reads it only next
// to a valid X-Internal-Key (dchub-backend util/mcp_caller_tier.py).
//
// Drives the REAL module against a stub backend on 127.0.0.1 that records the
// headers of every request. No network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_FORWARD_CALLER_TIER'];
const INTERNAL = 'test-internal-key-not-a-real-secret';
const prevEnv = {};
let S, PORT, httpServer, stub;
const seen = [];   // { path, q, headers }

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      let body = '';
      if (req.method === 'POST') { for await (const ch of req) body += ch; }
      const q = u.searchParams.get('q') || (body ? (JSON.parse(body || '{}').question || null) : null);
      seen.push({ path: u.pathname, q, headers: req.headers });
      if (u.pathname === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
      if (u.pathname.startsWith('/api/v1/dcpi/scores/')) {
        res.end(JSON.stringify({ market_slug: 'northern-virginia', verdict: 'CAUTION', composite_score: 20 }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = INTERNAL;
  delete process.env.DCHUB_FORWARD_CALLER_TIER;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

const hitFor = (q) => {
  const h = seen.filter((s) => s.q === q).pop();
  expect(h, `stub never saw a request for ${q}`).toBeTruthy();
  return h.headers;
};
const read = (c, q, opts) => S._ctxALS.run(c, () => S._callAPIForTest('/api/v1/rag/search', { q }, opts));
const write = (c, q) => S._ctxALS.run(c, () => S._callAPIWriteForTest('/api/v1/agentic/research', { question: q }));

describe('_callerTierFor', () => {
  it('no key is anonymous; a key forwards its resolved tier; junk reads free', () => {
    expect(S.CALLER_TIER_HEADER).toBe('X-DCHub-Caller-Tier');
    expect(S._callerTierFor({})).toBe('anonymous');
    expect(S._callerTierFor(null)).toBe('anonymous');
    expect(S._callerTierFor({ tier: 'pro' })).toBe('anonymous');        // a tier without a key is not a caller's plan
    expect(S._callerTierFor({ api_key: 'dch_live_x' })).toBe('free');
    expect(S._callerTierFor({ api_key: 'dch_live_x', tier: 'identified' })).toBe('identified');
    expect(S._callerTierFor({ api_key: 'dch_live_x', tier: 'paid' })).toBe('paid');
    expect(S._callerTierFor({ api_key: 'dch_live_x', tier: ' PRO ' })).toBe('pro');
    expect(S._callerTierFor({ api_key: 'dch_live_x', tier: 'pro; enterprise' })).toBe('free');
  });
});

describe('callAPI forwards the end user tier next to the internal key', () => {
  it('keyless caller: anonymous', async () => {
    await read({ session_id: 's1' }, 'tier anon');
    const h = hitFor('tier anon');
    expect(h['x-internal-key']).toBe(INTERNAL);
    expect(h['x-dchub-caller-tier']).toBe('anonymous');
    expect(h['x-api-key']).toBeUndefined();
  });
  it('free key: free, and the key itself is forwarded so the backend can resolve it', async () => {
    await read({ api_key: 'dch_live_free', tier: 'free' }, 'tier free');
    const h = hitFor('tier free');
    expect(h['x-dchub-caller-tier']).toBe('free');
    expect(h['x-api-key']).toBe('dch_live_free');
  });
  it('pro key: pro', async () => {
    await read({ api_key: 'dch_live_pro', tier: 'pro' }, 'tier pro');
    expect(hitFor('tier pro')['x-dchub-caller-tier']).toBe('pro');
  });
  it('internal:true reads forward it too (they are relayed to the caller)', async () => {
    await read({}, 'tier internal flag', { internal: true });
    expect(hitFor('tier internal flag')['x-dchub-caller-tier']).toBe('anonymous');
  });
  it('serverView skips it (a shared cache masked per caller on the way out)', async () => {
    await read({}, 'tier server view', { serverView: true });
    const h = hitFor('tier server view');
    expect(h['x-internal-key']).toBe(INTERNAL);
    expect(h['x-dchub-caller-tier']).toBeUndefined();
  });
  it('DCHUB_FORWARD_CALLER_TIER=0 turns it off', async () => {
    process.env.DCHUB_FORWARD_CALLER_TIER = '0';
    try { await read({}, 'tier killed'); } finally { delete process.env.DCHUB_FORWARD_CALLER_TIER; }
    expect(hitFor('tier killed')['x-dchub-caller-tier']).toBeUndefined();
  });
});

describe('callAPIWrite carries the same header', () => {
  it('keyless: anonymous; keyed: its tier', async () => {
    await write({}, 'write anon');
    await write({ api_key: 'dch_live_id', tier: 'identified' }, 'write identified');
    expect(hitFor('write anon')['x-dchub-caller-tier']).toBe('anonymous');
    expect(hitFor('write identified')['x-dchub-caller-tier']).toBe('identified');
  });
});

describe('end to end: a keyless tools/call reaches the backend as anonymous', () => {
  it('get_market_dcpi_rank sends X-DCHub-Caller-Tier: anonymous on its DCPI read', async () => {
    const before = seen.length;
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'user-agent': 'dchub-qa-readonly/0.1 (QA - exclude)' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'get_market_dcpi_rank', arguments: { market_slug: 'northern-virginia' } } }),
    });
    await res.text();
    const hit = seen.slice(before).filter((s) => s.path === '/api/v1/dcpi/scores/northern-virginia').pop();
    expect(hit, 'the tool never read /api/v1/dcpi/scores/<slug>').toBeTruthy();
    expect(hit.headers['x-internal-key']).toBe(INTERNAL);
    expect(hit.headers['x-dchub-caller-tier']).toBe('anonymous');
  });
});

// The two reads that keep the server view, each because THIS layer masks the
// answer per caller afterwards: find_sites (_findSitesForCaller: anchor lock,
// coordinate/time-to-power ladder with the pack balance) and the scoreboard's
// shared DCPI join (one cache entry for every caller, _scoreboardForCaller).
async function toolCall(name, args, id) {
  const before = seen.length;
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'user-agent': 'dchub-qa-readonly/0.1 (QA - exclude)' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  await res.text();
  return seen.slice(before);
}

describe('server-view reads that this layer masks per caller', () => {
  it('find_sites reads /api/v1/sites/find without the header', async () => {
    const hits = (await toolCall('find_sites', { lat: 39.04, lon: -77.48 }, 4))
      .filter((s) => s.path === '/api/v1/sites/find');
    expect(hits.length, 'find_sites never read /api/v1/sites/find').toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.headers['x-internal-key']).toBe(INTERNAL);
      expect(h.headers['x-dchub-caller-tier']).toBeUndefined();
    }
  });
  it('the scoreboard build reads /api/v1/dcpi/iso-comparison without the header', async () => {
    const hits = (await toolCall('get_grid_scoreboard', {}, 5))
      .filter((s) => s.path === '/api/v1/dcpi/iso-comparison');
    expect(hits.length, 'the scoreboard never read /api/v1/dcpi/iso-comparison').toBeGreaterThan(0);
    for (const h of hits) expect(h.headers['x-dchub-caller-tier']).toBeUndefined();
  });
});
