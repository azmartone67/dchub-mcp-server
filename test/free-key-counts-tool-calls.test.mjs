// free-key-counts-tool-calls.test.mjs — r-free-key-per-call (2026-09-27)
//
// The published rule (canon `free_tier`): a free key with no email gets "10
// calls to try", lifetime. The backend keeps that count, and it used to be
// spent by every /keys/validate hop — but this gateway validates on initialize
// and on each stateless request, then caches the answer for 5 minutes, and a
// stateful session never re-validates at all. So the count measured handshakes
// and cache windows, and a free key made far more than 10 tool calls.
//
// These tests drive the real HTTP server against a stub backend that keeps the
// counter the way dchub-backend does (count_call:false resolves without
// spending; true/absent spends one — pinned there by
// tests/test_free_key_counts_tool_calls.py) and pin:
//
//   * /mcp stateless: the 10th tool call is served in full and the 11th falls
//     back to a preview with credential_refused 'bind_email_required' — all
//     inside ONE key-cache window (the cache is never cleared between calls);
//   * /mcp stateful session: the same, although the session validated once;
//   * one counted hop per tool call, and none for a resolve or an exempt tool;
//   * /mcp/chatgpt: unchanged (frz-chatgpt-toolset) — its resolve is still the
//     counted validate it always was, cached, and no per-call count is added.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';

let S, PORT, httpServer, stub;
const prev = {};
const KEY = 'dch_live_freekey_percall_test';
const ALLOWANCE = 10;
const ROWS = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1, slug: `ashburn-${i + 1}`, name: `Ashburn Campus ${i + 1}`,
  city: 'Ashburn', country: 'US', provider: 'Acme', capacity_mw: 100 + i,
}));
// The backend's counter for KEY, and a log of every validate hop.
let used = 0;
let hops = [];
let validateTier = 'free';
let plainReject = false;
let bound = false;   // the key has an email bound → no lifetime gate, no per-call count
// B1 (D4, live 2026-10-03): the backend no longer refuses an unbound key for its
// count. true models the pre-B1 / kill-switch backend (the /mcp/chatgpt tests).
let lifetimeGate = true;
const HINT = `This DC Hub key used its ${ALLOWANCE} free unbound calls.`;

function backendValidate(body) {
  const count = body.count_call !== false;           // absent = counted (legacy)
  hops.push({ key: body.api_key, count });
  if (validateTier !== 'free') {
    return { valid: true, tier: validateTier, email: 'x@acme-dc.com', developer_id: 1, counts_tool_calls: false };
  }
  if (plainReject) return { valid: false, tier: 'free' };
  if (bound) {
    return { valid: true, tier: 'free', email: 'human@acme-dc.com', developer_id: 7, counts_tool_calls: false };
  }
  let gated;
  if (count) { used += 1; gated = used > ALLOWANCE; } else { gated = used + 1 > ALLOWANCE; }
  if (!lifetimeGate) gated = false;
  if (gated) return { valid: false, tier: 'free', reason: 'bind_email_required', upgrade_hint: HINT };
  return { valid: true, tier: 'free', email: null, developer_id: 7, counts_tool_calls: true };
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        if (p === '/api/v1/keys/validate') {
          let b = {}; try { b = JSON.parse(raw || '{}'); } catch (_) {}
          return send(200, backendValidate(b));
        }
        if (p === '/api/v1/mcp/anon-usage') return send(200, { ok: true, count: 0 });
        if (p === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
        if (p === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
        if (p === '/api/v1/keys/auto-mint') return send(503, { ok: false });
        if (p === '/api/v1/mcp/credits/balance') return send(200, { credits: 0, had_pack: false });
        if (p.startsWith('/api/v1/mcp/full-cap')) return send(200, { ok: true, n: 1, remaining: 1, exceeded: false });
        return send(200, { success: true, count: ROWS.length, total: ROWS.length, data: ROWS, facilities: ROWS });
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_ANON_DAILY_CAP']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  delete process.env.DCHUB_ANON_DAILY_CAP;
  S = await import('../server.mjs');
  S._readDeadline.signal = () => AbortSignal.timeout(120_000);
  S._setQuotaFetchImpl(async () => ({ allowed: true, reason: 'enforcement_off', remaining: null }));
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  S._setQuotaFetchImpl(null);
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// Each test starts from a fresh key: nothing spent, nothing cached.
beforeEach(() => { used = 0; hops = []; validateTier = 'free'; bound = false; plainReject = false; S._dropKeyCache(KEY); S._dropQuotaCache(KEY); });

let rpcId = 1;
function parse(raw) {
  const body = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return JSON.parse(body);
}
async function rpc(path, method, params, { key = KEY, sid = null } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (key) headers['x-api-key'] = key;
  if (sid) headers['mcp-session-id'] = sid;
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  const raw = await res.text();
  return { res, raw };
}
async function call(path, name, args, opts) {
  const { raw } = await rpc(path, 'tools/call', { name, arguments: { ...args } }, opts);
  const r = parse(raw).result || {};
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  return { r, sc: r.structuredContent || {}, text };
}
async function openSession(key = KEY) {
  const { res } = await rpc('/mcp', 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest-free-key', version: '1' },
  }, { key });
  const sid = res.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
                    'mcp-session-id': sid };
  if (key) headers['x-api-key'] = key;
  await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  return sid;
}

function rowCount(sc, text) {
  for (const src of [sc, (() => { try { return JSON.parse(text.split('\n\n')[0]); } catch { return {}; } })()]) {
    for (const k of ['data', 'facilities', 'results']) if (Array.isArray(src && src[k])) return src[k].length;
  }
  return -1;
}
const refused = (sc) => (sc.identity || {}).credential_refused || null;
const counted = () => hops.filter((h) => h.count).length;
const Q = { query: 'Ashburn', limit: 25 };

describe('/mcp stateless — one counted hop per tool call (B1: no lifetime refusal)', () => {
  it('CONTROL: a keyed free call is served deeper than an anonymous one', async () => {
    const keyed = await call('/mcp', 'search_facilities', Q);
    const anon = await call('/mcp', 'search_facilities', Q, { key: null });
    expect(rowCount(keyed.sc, keyed.text)).toBeGreaterThan(rowCount(anon.sc, anon.text));
  }, 60_000);

  it('B1: calls 1..12 all served keyed, each counted once (no lifetime refusal)', async () => {
    lifetimeGate = false;
    try {
      const anon = await call('/mcp', 'search_facilities', Q, { key: null });
      const anonRows = rowCount(anon.sc, anon.text);
      for (let i = 1; i <= ALLOWANCE + 2; i++) {
        const { sc, text } = await call('/mcp', 'search_facilities', Q);
        expect(refused(sc), `call ${i}`).toBeNull();
        expect(rowCount(sc, text), `call ${i}`).toBeGreaterThan(anonRows);
      }
      expect(used).toBe(ALLOWANCE + 2);   // the usage record still counts every call
    } finally { lifetimeGate = true; }
  }, 120_000);

  it('exactly one counted hop per tool call; resolves spend nothing', async () => {
    for (let i = 0; i < 3; i++) await call('/mcp', 'search_facilities', Q);
    expect(counted()).toBe(3);
    expect(used).toBe(3);
    expect(hops.filter((h) => !h.count).length).toBeGreaterThan(0);   // the request-level resolve
  }, 60_000);

  it('an exempt tool (why_dchub) does not spend the allowance', async () => {
    for (let i = 0; i < 3; i++) await call('/mcp', 'why_dchub', {});
    expect(counted()).toBe(0);
    expect(used).toBe(0);
  }, 60_000);

  it('a paid-class key pays no per-call hop', async () => {
    validateTier = 'paid';
    for (let i = 0; i < 3; i++) await call('/mcp', 'search_facilities', Q);
    expect(counted()).toBe(0);
    expect(hops.length).toBe(1);                         // one cached resolve
  }, 60_000);
});

describe('/mcp stateful session — the same, though the session validated once', () => {
  it('B1: in a session too, calls 1..12 all served keyed', async () => {
    lifetimeGate = false;
    try {
      const anon = await call('/mcp', 'search_facilities', Q, { key: null });
      const anonRows = rowCount(anon.sc, anon.text);
      const sid = await openSession();
      expect(used).toBe(0);                                // initialize is not a call
      for (let i = 1; i <= ALLOWANCE + 2; i++) {
        const { sc, text } = await call('/mcp', 'search_facilities', Q, { sid });
        expect(refused(sc), `call ${i}`).toBeNull();
        expect(rowCount(sc, text), `call ${i}`).toBeGreaterThan(anonRows);
      }
    } finally { lifetimeGate = true; }
  }, 120_000);

  it('a key refused for a reason that is not a counting gate is left alone (as before)', async () => {
    const anon = await call('/mcp', 'search_facilities', Q, { key: null });
    const sid = await openSession();
    plainReject = true;              // the backend now answers a bare valid:false
    S._dropKeyCache(KEY); hops = [];
    const { sc, text } = await call('/mcp', 'search_facilities', Q, { sid });
    expect(counted()).toBe(0);
    expect(refused(sc)).toBeNull();
    expect(rowCount(sc, text)).toBeGreaterThan(rowCount(anon.sc, anon.text));
  }, 60_000);
});

describe('/mcp/chatgpt — unchanged (frz-chatgpt-toolset)', () => {
  it('its resolve is still a COUNTED validate, cached, and no per-call count is added', async () => {
    const n = ALLOWANCE + 3;
    const depths = [];
    for (let i = 0; i < n; i++) {
      const { sc, text } = await call('/mcp/chatgpt', 'search_facilities', Q);
      expect(refused(sc), `call ${i + 1}`).toBeNull();
      depths.push(rowCount(sc, text));
    }
    // Pre-fix semantics, byte for byte: one counted validate per cache window.
    expect(hops.length).toBe(1);
    expect(hops[0].count).toBe(true);
    expect(used).toBe(1);
    expect(new Set(depths).size).toBe(1);
  }, 120_000);

  it('a key whose allowance is spent is refused there exactly as before', async () => {
    const keyed = await call('/mcp/chatgpt', 'search_facilities', Q);
    const anon = await call('/mcp/chatgpt', 'search_facilities', Q, { key: null });
    S._dropKeyCache(KEY); hops = [];
    used = ALLOWANCE;
    const spent = await call('/mcp/chatgpt', 'search_facilities', Q);
    expect(hops).toEqual([{ key: KEY, count: true }]);
    expect(rowCount(spent.sc, spent.text)).toBe(rowCount(anon.sc, anon.text));
    expect(rowCount(keyed.sc, keyed.text)).toBeGreaterThan(rowCount(anon.sc, anon.text));
  }, 60_000);
});
