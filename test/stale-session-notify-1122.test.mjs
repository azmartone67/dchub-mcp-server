import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

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



let S, PORT, httpServer, stub, prevBase;

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
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
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
  return { status: res.status, headers: res.headers, json, raw };
}

// DCHUB_STALE_SESSION_NOTIFY_ACCEPT (default OFF, 2026-11-22). A notification bearing a session id this process does
// not hold got the spec's 404 (reason session_unknown): every Mistral 404 in the [mcp-4xx] log 2026-11-18..23 was
// notifications/initialized right after its initialize. With the flag on it gets 202; a request that needs an answer
// keeps the 404.
const DEAD = '00000000-dead-4000-8000-000000000000';
const NOTE = { jsonrpc: '2.0', method: 'notifications/initialized' };
const MISTRAL = { 'user-agent': 'MistralAI-MCPClient/1.0', 'mcp-session-id': DEAD };
const prev = process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT;
afterAll(() => { if (prev === undefined) delete process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT; else process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT = prev; });

describe('a notification on an unknown session id', () => {
  it('off (default): 404, as today', async () => {
    delete process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT;
    const r = await post('/mcp', NOTE, MISTRAL);
    expect(r.status).toBe(404);
  });
  it('on: notifications/initialized gets 202 with no body', async () => {
    process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT = '1';
    const r = await post('/mcp', NOTE, MISTRAL);
    expect(r.status).toBe(202);
    expect(r.raw).toBe('');
  });
  it('on: a batch of only notifications gets 202', async () => {
    process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT = '1';
    const r = await post('/mcp', [NOTE, { jsonrpc: '2.0', method: 'notifications/roots/list_changed' }], MISTRAL);
    expect(r.status).toBe(202);
  });
  it('on: a request that needs an answer (resources/list) keeps the 404', async () => {
    process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT = '1';
    const r = await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} }, MISTRAL);
    expect(r.status).toBe(404);
  });
  it('on: a batch mixing a notification and a request keeps the 404', async () => {
    process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT = '1';
    const r = await post('/mcp', [NOTE, { jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} }], MISTRAL);
    expect(r.status).toBe(404);
  });
  it('on: tools/call on the unknown id is still served (unchanged stateless path)', async () => {
    process.env.DCHUB_STALE_SESSION_NOTIFY_ACCEPT = '1';
    const r = await post('/mcp', { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'discover_tools', arguments: {} } }, MISTRAL);
    expect(r.status).toBe(200);
  });
});

describe('no foreign network', () => {
  it('nothing left the loopback', () => { expect(foreign).toEqual([]); });
});
