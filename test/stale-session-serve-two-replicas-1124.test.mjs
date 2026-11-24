import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

// DCHUB_STALE_SESSION_SERVE (default OFF, 2026-11-24). Two server instances stand in for two Railway replicas: each
// module instance has its own in-memory session map, exactly as two processes do. A client initializes on A and sends
// its follow-ups to B. Before the flag, prompts/list and resources/list on B got 404 session_unknown (4 of 12
// follow-ups, measured live 11-24 with numReplicas=2).

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

let stub, prevBase, A, B;
const prevServe = process.env.DCHUB_STALE_SESSION_SERVE;

async function listen(mod) {
  const srv = await new Promise((resolve) => { const s = mod.app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { mod, srv, port: srv.address().port };
}

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        const url = new URL(req.url, 'http://_');
        if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
        res.end('{}');
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  // A distinct specifier is a distinct ESM module instance: its own `sessions` Map, like a second replica.
  A = await listen(await import('../server.mjs?replica=a'));
  B = await listen(await import('../server.mjs?replica=b'));
}, 60_000);

afterAll(async () => {
  for (const r of [A, B]) await new Promise((done) => (r?.srv ? r.srv.close(done) : done()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevServe === undefined) delete process.env.DCHUB_STALE_SESSION_SERVE; else process.env.DCHUB_STALE_SESSION_SERVE = prevServe;
  net.Socket.prototype.connect = realConnect;
});

async function post(r, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${r.port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'user-agent': 'dchub-qa-readonly', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  let json = null;
  try { json = JSON.parse(data); } catch (_) {}
  return { status: res.status, headers: res.headers, json };
}

async function initOn(r) {
  const init = await post(r, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'two-replica-test', version: '1' } } });
  expect(init.status).toBe(200);
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  return sid;
}

const FOLLOW_UPS = ['prompts/list', 'resources/list', 'resources/templates/list'];

describe('a session started on one replica, continued on the other', () => {
  it('the two instances really hold separate session maps (the test would prove nothing otherwise)', async () => {
    expect(A.mod).not.toBe(B.mod);
    delete process.env.DCHUB_STALE_SESSION_SERVE;
    const sid = await initOn(A);
    const onA = await post(A, { jsonrpc: '2.0', id: 2, method: 'prompts/list' }, { 'mcp-session-id': sid });
    expect(onA.status).toBe(200);
    const onB = await post(B, { jsonrpc: '2.0', id: 2, method: 'prompts/list' }, { 'mcp-session-id': sid });
    expect(onB.status).toBe(404);   // flag off: the spec 404, today's production behaviour
  });

  it('flag on: every follow-up answers on either replica, alternating', async () => {
    process.env.DCHUB_STALE_SESSION_SERVE = '1';
    const sid = await initOn(A);
    let id = 10;
    for (const method of FOLLOW_UPS) {
      for (const r of [B, A, B]) {
        const res = await post(r, { jsonrpc: '2.0', id: ++id, method }, { 'mcp-session-id': sid });
        expect({ method, replica: r === A ? 'A' : 'B', status: res.status }).toEqual({ method, replica: r === A ? 'A' : 'B', status: 200 });
        expect(res.json?.error).toBeUndefined();
        expect(res.json?.result).toBeTruthy();
      }
    }
  });

  it('flag on: the foreign replica answers the same as the home replica', async () => {
    process.env.DCHUB_STALE_SESSION_SERVE = '1';
    const sid = await initOn(A);
    const home = await post(A, { jsonrpc: '2.0', id: 3, method: 'prompts/list' }, { 'mcp-session-id': sid });
    const away = await post(B, { jsonrpc: '2.0', id: 3, method: 'prompts/list' }, { 'mcp-session-id': sid });
    const names = (r) => (r.json?.result?.prompts || []).map((p) => p.name).sort();
    expect(names(home).length).toBeGreaterThan(0);
    expect(names(away)).toEqual(names(home));
  });

  it('flag on: initialize still opens a new session, and a batch holding initialize is still refused', async () => {
    process.env.DCHUB_STALE_SESSION_SERVE = '1';
    const sid = await initOn(A);
    const batch = await post(B, [{ jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }],
      { 'mcp-session-id': sid });
    expect(batch.status).not.toBe(200);
  });

  it('no request left the machine', () => { expect(foreign).toEqual([]); });
});
