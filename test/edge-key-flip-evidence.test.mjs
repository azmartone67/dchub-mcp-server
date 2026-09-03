// ── /internal/edge-key must answer the question the flip actually asks ──────
//
// THE DEFECT. The enforcement flip criterion is "flip only once
// /internal/edge-key shows `missing` at zero for a full traffic day". The
// payload could not support that call:
//
//   1. The counters are in-memory and die with the process, and the payload said
//      only `since`. Measured live 2026-09-03, the endpoint returned
//      {ok:0, missing:0, bad:1, since:<4 min ago>} while the deploy log for the
//      SAME process carried dozens of `bad` events. Not wrong — young, and
//      silent about it.
//   2. `last_missing_ua` holds ONE user-agent, the most recent. The live logs
//      showed the offenders were FIRST-PARTY (DCHub-CatalogSync/1.0, DCHub/1.0,
//      python-httpx2) calling the origin URL directly with a stale key. Flipping
//      on a zero would have 403'd our own jobs with no warning in this payload.
//
// ★ WHY THIS TEST IS TRANSPORT-DRIVEN, per test/auth-source.test.mjs's lesson:
// asserting _edgeKeyFlipVerdict() directly would prove the arithmetic and
// nothing about the wiring — whether the middleware actually records a UA,
// whether the route actually returns the verdict. Stage 0a shipped inert for
// eight days behind exactly that kind of test. So every case below drives a real
// HTTP request through the real express app.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let S, PORT, httpServer;
const KEY = 'test-edge-key-value';
const INTERNAL = 'test-internal-key';

beforeAll(async () => {
  process.env.DCHUB_EDGE_KEY = KEY;
  process.env.DCHUB_INTERNAL_KEY = INTERNAL;
  delete process.env.DCHUB_EDGE_KEY_ENFORCE;
  const prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';   // unroutable: no upstream
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
});
afterAll(() => { httpServer?.close(); });

const rpc = (headers = {}) => fetch(`http://127.0.0.1:${PORT}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
});
const evidence = () => fetch(`http://127.0.0.1:${PORT}/internal/edge-key`, { headers: { 'x-internal-key': INTERNAL } }).then((r) => r.json());

describe('edge-key flip evidence', () => {
  it('the endpoint is closed to callers without the internal key', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/internal/edge-key`);
    expect(r.status).toBe(403);
  });

  it('states its WINDOW, so {missing:0} can never be read as "clean for a day"', async () => {
    const e = await evidence();
    expect(typeof e.window_seconds).toBe('number');
    expect(e.window_started).toBeTruthy();
    // A freshly-started process cannot meet a full-traffic-day criterion.
    expect(e.window_meets_criterion).toBe(false);
  });

  it('a fresh, CLEAN window is still not safe to enforce — and says why', async () => {
    const e = await evidence();
    expect(e.missing + e.bad).toBe(0);          // nothing has failed yet
    expect(e.safe_to_enforce).toBe(false);      // ...and it still refuses
    expect(e.reason).toMatch(/window/i);
  });

  it('names WHO would break, by user-agent, not just how many', async () => {
    await rpc({ 'user-agent': 'DCHub-CatalogSync/1.0' });                        // missing
    await rpc({ 'user-agent': 'DCHub-CatalogSync/1.0' });                        // missing
    await rpc({ 'user-agent': 'python-httpx2/2.7.0', 'x-dc-edge-key': 'wrong' }); // bad
    const e = await evidence();
    expect(e.by_user_agent['DCHub-CatalogSync/1.0'].missing).toBe(2);
    expect(e.by_user_agent['python-httpx2/2.7.0'].bad).toBe(1);
    expect(e.safe_to_enforce).toBe(false);
    // The reason must point at the breakdown, or the operator has a number again.
    expect(e.reason).toMatch(/by_user_agent/);
    expect(e.reason).toMatch(/missing=2/);
    expect(e.reason).toMatch(/bad=1/);
  });

  it('a request carrying the RIGHT key passes and is not counted as a failure', async () => {
    const before = await evidence();
    const r = await rpc({ 'x-dc-edge-key': KEY, 'user-agent': 'edge-proxied/1.0' });
    expect(r.headers.get('x-dc-edge-key')).toBe('ok');
    const after = await evidence();
    expect(after.ok).toBe(before.ok + 1);
    expect(after.by_user_agent['edge-proxied/1.0']).toBeUndefined();  // only failures are named
  });

  it('observe mode SERVES the request — it must not close the door early', async () => {
    const r = await rpc({ 'user-agent': 'observe-mode-check/1.0' });
    expect(r.status).not.toBe(403);
    expect(r.headers.get('x-dc-edge-key')).toBe('missing');
  });
});

// ── must-fail controls. A verdict that cannot say "unsafe" is decoration. ────
describe('flip verdict must-fail controls', () => {
  const V = (...a) => S._edgeKeyFlipVerdict(...a);
  it('CONTROL: unconfigured is never safe', () => {
    expect(V({ missing: 0, bad: 0 }, 999999, false, false).safe_to_enforce).toBe(false);
  });
  it('CONTROL: a long window with ONE failure is not safe', () => {
    expect(V({ missing: 0, bad: 1 }, 999999, true, false).safe_to_enforce).toBe(false);
  });
  it('CONTROL: a clean but SHORT window is not safe', () => {
    expect(V({ missing: 0, bad: 0 }, 60, true, false).safe_to_enforce).toBe(false);
  });
  it('CONTROL: clean AND long IS safe — or the verdict could never say yes', () => {
    expect(V({ missing: 0, bad: 0 }, 999999, true, false).safe_to_enforce).toBe(true);
  });
});
