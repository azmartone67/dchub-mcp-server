import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { mintSessionId, clientNameFromSid, KNOWN_CLIENT_NAMES } from '../lib/session-client-tag.mjs';

// 2026-11-25 (Grok "Cursor tool-list fixes" item 1): cursor-vscode got the full 98-tool catalog on 5 of 10 live list-only
// sessions. Its initialize landed on one replica and its tools/list on another, which had no record of the client name
// (Cursor names itself in clientInfo only, never in its UA). Two module instances stand in for two replicas, each with
// its own in-memory session maps. lib/session-client-tag.mjs carries the name in the session id.

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
const prevSecret = process.env.DCHUB_INTERNAL_KEY;
const prevTag = process.env.DCHUB_SID_CLIENT_TAG;

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
  process.env.DCHUB_INTERNAL_KEY = process.env.DCHUB_INTERNAL_KEY || 'test-internal-key-sid-tag';
  delete process.env.DCHUB_SID_CLIENT_TAG;
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  // A distinct specifier is a distinct ESM module instance: its own `sessions` Map, like a second replica.
  A = await listen(await import('../server.mjs?replica=sidtag-a'));
  B = await listen(await import('../server.mjs?replica=sidtag-b'));
}, 60_000);

afterAll(async () => {
  for (const r of [A, B]) await new Promise((done) => (r?.srv ? r.srv.close(done) : done()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  if (prevTag === undefined) delete process.env.DCHUB_SID_CLIENT_TAG; else process.env.DCHUB_SID_CLIENT_TAG = prevTag;
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

async function initOn(r, name = 'cursor-vscode') {
  const init = await post(r, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } } });
  expect(init.status).toBe(200);
  const sid = init.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  return sid;
}

async function listCount(r, sid, query = '') {
  const res = await fetch(`http://127.0.0.1:${r.port}/mcp${query}`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'user-agent': 'dchub-qa-readonly', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
  expect(res.status).toBe(200);
  const raw = await res.text();
  const data = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return (JSON.parse(data)?.result?.tools || []).length;
}

describe('cursor-vscode: initialize on one replica, tools/list on the other', () => {
  it('the two instances hold separate module state (else this proves nothing)', () => {
    expect(A.mod).not.toBe(B.mod);
  });
  it('the same replica serves the light list (control)', async () => {
    const n = await listCount(A, await initOn(A));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(12);
  });
  it('the OTHER replica serves the light list too', async () => {
    const n = await listCount(B, await initOn(A));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(12);
  });
  it('?catalog=full still gets the full catalog on the other replica', async () => {
    expect(await listCount(B, await initOn(A), '?catalog=full')).toBeGreaterThan(40);
  });
  it('an unnamed client still gets the full catalog on the other replica (nothing widened to light)', async () => {
    expect(await listCount(B, await initOn(A, 'some-generic-client'))).toBeGreaterThan(40);
  });
  it('with DCHUB_SID_CLIENT_TAG=0 the other replica falls back to the full catalog (the bug, reproduced)', async () => {
    process.env.DCHUB_SID_CLIENT_TAG = '0';
    try {
      expect(await listCount(B, await initOn(A))).toBeGreaterThan(40);
    } finally { delete process.env.DCHUB_SID_CLIENT_TAG; }
  });
  it('the other replica attributes the call to cursor, not the generic "mcp"', async () => {
    const sid = await initOn(A);
    expect(B.mod._recallPlatform(sid)).toBeTruthy();
    expect(B.mod._recallPlatform(sid)).not.toBe('mcp');
    expect(B.mod._recallClientName(sid)).toBe('cursor-vscode');
  });
});

describe('lib/session-client-tag.mjs', () => {
  const env = { DCHUB_INTERNAL_KEY: 'k1' };
  it('mints a v4 UUID that decodes back to the client name', () => {
    const sid = mintSessionId('cursor-vscode', { env });
    expect(sid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(clientNameFromSid(sid, { env })).toBe('cursor-vscode');
    expect(clientNameFromSid(mintSessionId('Visual Studio Code', { env }), { env })).toBe('Visual Studio Code');
  });
  it('an unknown name, no secret or the kill switch gives a plain id that decodes to nothing', () => {
    expect(clientNameFromSid(mintSessionId('my-client', { env }), { env })).toBeNull();
    expect(clientNameFromSid(mintSessionId('cursor-vscode', { env: {} }), { env })).toBeNull();
    expect(clientNameFromSid(mintSessionId('cursor-vscode', { env: { ...env, DCHUB_SID_CLIENT_TAG: '0' } }), { env })).toBeNull();
  });
  it('another secret, a flipped digit or a non-UUID decodes to nothing', () => {
    const sid = mintSessionId('cursor-vscode', { env });
    expect(clientNameFromSid(sid, { env: { DCHUB_INTERNAL_KEY: 'k2' } })).toBeNull();
    const flipped = sid.slice(0, 2) + (sid[2] === 'a' ? 'b' : 'a') + sid.slice(3);
    expect(clientNameFromSid(flipped, { env })).toBeNull();
    expect(clientNameFromSid('h-1b7b43fb', { env })).toBeNull();
  });
  it('random UUIDs essentially never decode', () => {
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (clientNameFromSid(crypto.randomUUID(), { env })) hits++;
    expect(hits).toBe(0);
  });
  it('the table is append-only: indexes already minted keep their names', () => {
    expect(KNOWN_CLIENT_NAMES.slice(0, 3)).toEqual(['cursor-vscode', 'cursor', 'Visual Studio Code']);
    expect(KNOWN_CLIENT_NAMES.length).toBeLessThanOrEqual(256);
  });
});
