// nodata-trial-side-effects.test.mjs — r-nodata-side-effects (2026-09-24)
//
// mcp#539 made a no-data answer on the anonymous trial path come back with no
// commerce. But the trial path started trackPaidHit, mintAutoTrial and
// shouldMintClaim CONCURRENTLY with the handler (r-latency), so the same
// no-data call still counted a paid hit, bumped the high-intent claim counter
// and minted a dch_trial_ key nobody saw. This pins that none of those three
// backend writes happens unless the handler answered with data. The control
// proves the harness reaches all three when it does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const foreign = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  let o = args[0];
  if (Array.isArray(o)) o = o[0];                        // net.connect's normalized form
  if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
  const host = String(o.host || 'localhost');
  if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
    foreign.push(`${host}:${o.port}`);
    process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
    return this;
  }
  return realConnect.apply(this, args);
};
let prevBase, prevSecret;
let S, PORT, httpServer, stub;
let backend = 'down';
// The three hops the trial path fires that change state on the backend.
const SIDE_EFFECTS = ['/api/v1/mcp/track-paid-hit', '/api/v1/mcp/should-mint-claim', '/api/v1/keys/auto-mint'];
let hits = {};           // 'down' -> 503 on data routes, 'up' -> real-looking data
const SECRET = 'test-internal-key-not-a-real-secret';

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
      if (SIDE_EFFECTS.includes(p)) hits[p] = (hits[p] || 0) + 1;
      if (p === '/api/v1/mcp/track-paid-hit') return send(200, { ok: true });
      if (p === '/api/v1/mcp/should-mint-claim') return send(200, { mint: false });
      if (p === '/api/v1/mcp/trial-check') return send(200, { trial_used: false, prior_calls: 0 });
      if (p === '/api/v1/mcp/session-key') return send(404, { error: 'not found' });
      if (p === '/api/v1/keys/auto-mint') return send(200, { ok: false });
      if (p === '/api/v1/keys/validate') return send(200, { valid: false, tier: 'free' });
      if (backend === 'up') {
        return send(200, { success: true, count: 1, data: [{ id: 1, name: 'x' }],
                           demand_mw: 18000, generation_mix: { NG: { mw: 9000 } } });
      }
      return send(503, { error: 'upstream unavailable (test)' });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, body: b };
}

let rpcId = 10;
async function freshSession() {
  const init = await post({}, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {},
              clientInfo: { name: 'nodata-side-effects', version: '1.0' } },
  });
  const sid = init.headers.get('mcp-session-id');
  expect(sid, 'initialize did not mint a session id').toBeTruthy();
  const h = { 'mcp-session-id': sid };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return h;
}
async function callFresh(name, args) {
  const h = await freshSession();
  const { body } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
                                   params: { name, arguments: args } });
  let msg; try { msg = JSON.parse(body); } catch { return null; }
  return msg.result ? { result: msg.result, body } : null;   // protocol errors carry no result
}

const settle = () => new Promise((r) => setTimeout(r, 400));   // fire-and-forget hops land

async function sideEffectsOf(name, args) {
  hits = {};
  const r = await callFresh(name, args);
  await settle();
  return { r, hits: { ...hits } };
}

function firstBlockIsNoData(result) {
  const t = result && result.content && result.content[0] && result.content[0].text;
  if (typeof t !== 'string') return false;
  let p; try { p = JSON.parse(t); } catch { return false; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  return !!p._error_mitigation || (typeof p.error === 'string' && /^API \d{3}$/.test(p.error))
    || p.source_unavailable === true;
}

describe('no data, no trial-path side effects (r-nodata-side-effects)', () => {
  it('CONTROL: a served preview DOES fire all three side-effect hops', async () => {
    backend = 'up';
    try {
      const { r, hits: h } = await sideEffectsOf('get_grid_intelligence', { region_id: 'PJM' });
      expect(r, 'no result').toBeTruthy();
      expect(firstBlockIsNoData(r.result)).toBe(false);
      for (const p of SIDE_EFFECTS) expect(h[p] || 0, `${p} not reached on a real answer`).toBeGreaterThan(0);
    } finally { backend = 'down'; }
  });

  it('a no-data answer counts no paid hit, bumps no claim counter, mints no trial', async () => {
    const { r, hits: h } = await sideEffectsOf('get_grid_intelligence', { region_id: 'PJM' });
    expect(r, 'no result').toBeTruthy();
    expect(firstBlockIsNoData(r.result), 'the backend-down call did not produce a no-data answer').toBe(true);
    expect(h).toEqual({});
  });
});
