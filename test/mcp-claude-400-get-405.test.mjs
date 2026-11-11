// mcp-claude-400-get-405.test.mjs — Claude POST /mcp 400s and GET /mcp 405s (2026-11-10).
//
// Cloudflare, week to 11-10: ~1,552 Claude 400s on POST /mcp, rising three weeks running, and
// 217 Grok + 108 Claude 405s on GET /mcp. Each shape below was a 400 when replayed against
// production on 11-10 (QA marker on):
//   1. initialize re-sent WITH a live Mcp-Session-Id -> SDK "Server already initialized"
//      (Railway: Claude-User 400 after the bearer lookup, then 200 on the retry without it);
//   2. a notification with no session id;
//   3. resources/list, prompts/list, ... with no session id;
//   4. a batch with no session id.
// Every arm goes over a real HTTP round trip through the express app, because the defect lived
// in the seam between our routing and the SDK transport, not in a function.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import {
  rpcShape, isReinitWithSession, isNotificationsOnly, isStatelessServable,
  protocolHeaderVerdict, authKind, failureReason, describeRequest,
} from '../lib/mcp-request-shape.mjs';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

// No network: only loopback sockets connect (same gate as init-clientinfo-version-error).
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

let S, PORT, httpServer, prevBase;

beforeAll(async () => {
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
  await new Promise((r) => { httpServer = S.app.listen(0, '127.0.0.1', r); });
  PORT = httpServer.address().port;
}, 60000);

afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

const ACCEPT = 'application/json, text/event-stream';
const INIT = (id = 1, protocolVersion = '2025-06-18') => ({
  jsonrpc: '2.0', id, method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'dchub-qa-readonly', version: '1' } },
});

async function post(body, headers = {}, path = '/mcp') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: ACCEPT, 'user-agent': 'Claude-User', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const raw = await res.text();
  const frames = raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
  let json = null;
  if (frames.length) json = frames.length === 1 ? frames[0] : frames;
  else if (raw.trim()) { try { json = JSON.parse(raw); } catch (_) { json = raw; } }
  return { status: res.status, sid: res.headers.get('mcp-session-id'), json, raw, headers: res.headers };
}

describe('cause 1: initialize re-sent with a session id', () => {
  it('a live session id: a NEW session (200), not "Server already initialized" (400)', async () => {
    const first = await post(INIT(1));
    expect(first.status).toBe(200);
    expect(first.sid).toBeTruthy();
    const again = await post(INIT(2), { 'mcp-session-id': first.sid });
    expect(again.status, again.raw).toBe(200);
    expect(again.json.result.serverInfo).toBeTruthy();
    expect(again.sid).toBeTruthy();
    expect(again.sid).not.toBe(first.sid);
    // both sessions answer: the old one is left to the idle sweeper, not torn down mid-flight
    const onOld = await post({ jsonrpc: '2.0', id: 3, method: 'ping' }, { 'mcp-session-id': first.sid });
    const onNew = await post({ jsonrpc: '2.0', id: 4, method: 'ping' }, { 'mcp-session-id': again.sid });
    expect([onOld.status, onNew.status]).toEqual([200, 200]);
  });
  it('an unknown session id: a new session (unchanged behaviour, pinned)', async () => {
    const r = await post(INIT(5), { 'mcp-session-id': 'no-such-session-0000' });
    expect(r.status, r.raw).toBe(200);
    expect(r.sid).toBeTruthy();
  });
});

describe('cause 2: notifications with no session id', () => {
  it('a notification is accepted with 202', async () => {
    const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(r.status, r.raw).toBe(202);
  });
  it('a batch of notifications is accepted with 202', async () => {
    const r = await post([{ jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }]);
    expect(r.status, r.raw).toBe(202);
  });
  it('an UNKNOWN session id still gets the spec 404 (client re-initializes)', async () => {
    const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': 'gone-0000' });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe(-32001);
  });
});

describe('cause 3: other requests with no session id are served statelessly', () => {
  it('resources/list: 200 with resources', async () => {
    const r = await post({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
    expect(r.status, r.raw).toBe(200);
    expect(Array.isArray(r.json.result.resources)).toBe(true);
    expect(r.json.id).toBe(7);
  });
  it('prompts/list: 200', async () => {
    const r = await post({ jsonrpc: '2.0', id: 8, method: 'prompts/list' });
    expect(r.status, r.raw).toBe(200);
    expect(r.json.result).toBeTruthy();
  });
  it('an unknown method: an in-band JSON-RPC -32601, not an HTTP 400', async () => {
    const r = await post({ jsonrpc: '2.0', id: 9, method: 'no/such_method' });
    expect(r.status, r.raw).toBe(200);
    expect(r.json.error.code).toBe(-32601);
  });
  it('an unknown session id keeps the 404', async () => {
    const r = await post({ jsonrpc: '2.0', id: 10, method: 'resources/list' }, { 'mcp-session-id': 'gone-0001' });
    expect(r.status).toBe(404);
  });
});

describe('cause 4: batches with no session id', () => {
  it('a batch of requests is answered, one result per id', async () => {
    const r = await post([{ jsonrpc: '2.0', id: 11, method: 'resources/list' },
      { jsonrpc: '2.0', id: 12, method: 'prompts/list' }]);
    expect(r.status, r.raw).toBe(200);
    const all = [].concat(r.json).flat();
    expect(all.map((m) => m.id).sort()).toEqual([11, 12]);
    expect(all.every((m) => m.result)).toBe(true);
  });
  it('initialize inside a batch: a 400 that says what to do, as JSON-RPC', async () => {
    const r = await post([INIT(13), { jsonrpc: '2.0', id: 14, method: 'tools/list' }]);
    expect(r.status).toBe(400);
    expect(r.json.jsonrpc).toBe('2.0');
    expect(r.json.error.code).toBe(-32600);
    expect(r.json.error.message).toMatch(/initialize on its own/);
  });
  it('a body that is not JSON-RPC: a 400 that says so', async () => {
    const r = await post([1, 2]);
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/not a JSON-RPC 2\.0 message/);
  });
});

describe('protocol versions', () => {
  it('initialize negotiates: a supported older version is kept, an unknown newer one gets ours', async () => {
    const old = await post(INIT(20, '2024-11-05'));
    expect(old.json.result.protocolVersion).toBe('2024-11-05');
    const newer = await post(INIT(21, '2099-01-01'));
    expect(newer.status).toBe(200);
    expect(newer.json.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });
  it('an in-session MCP-Protocol-Version newer than ours is served (negotiated down), garbage still 400s', async () => {
    const init = await post(INIT(22));
    const ok = await post({ jsonrpc: '2.0', id: 23, method: 'ping' },
      { 'mcp-session-id': init.sid, 'mcp-protocol-version': '2099-01-01' });
    expect(ok.status, ok.raw).toBe(200);
    for (const v of ['2025-06-18', '2025-03-26', '2024-11-05', LATEST_PROTOCOL_VERSION]) {
      const r = await post({ jsonrpc: '2.0', id: 24, method: 'ping' }, { 'mcp-session-id': init.sid, 'mcp-protocol-version': v });
      expect(r.status, v).toBe(200);
    }
    const bad = await post({ jsonrpc: '2.0', id: 25, method: 'ping' },
      { 'mcp-session-id': init.sid, 'mcp-protocol-version': 'not-a-version' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/Unsupported protocol version/);
  });
});

describe('GET /mcp (2026-11-11: no 405; full matrix in test/mcp-get-stream-and-clients.test.mjs)', () => {
  it('no session, asking for the stream: 200 event stream holding only a retry hint, closed', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { headers: { accept: 'text/event-stream' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(await res.text()).toMatch(/^retry: \d+$/m);
  });
  it('an unknown session id, asking for the stream: the same 200 decline, not a 404', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { headers: { accept: 'text/event-stream', 'mcp-session-id': 'gone-0002' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-dc-hub-mcp-get-reason')).toBe('unknown_session');
  });
});

describe('[mcp-4xx] log line', () => {
  it('names the reason and masks every credential', async () => {
    const lines = [];
    const orig = console.log;
    console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[mcp-4xx]')) lines.push(s); else orig(...a); };
    try {
      await post([INIT(30)], { 'x-api-key': 'dch_live_SECRETVALUE_should_not_log', authorization: 'Bearer eyJSECRETTOKEN' });
      await new Promise((r) => setTimeout(r, 50));
    } finally { console.log = orig; }
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0].slice('[mcp-4xx] '.length));
    expect(rec.status).toBe(400);
    expect(rec.reason).toBe('batch_with_initialize');
    expect(rec.rpc).toBe('batch');
    expect(rec.ua).toBe('Claude-User');
    expect(lines[0]).not.toMatch(/SECRETVALUE|SECRETTOKEN/);
  });
});

describe('pure helpers', () => {
  it('rpcShape / predicates', () => {
    expect(rpcShape(undefined).kind).toBe('empty');
    expect(rpcShape({}).kind).toBe('empty');
    expect(rpcShape([1]).kind).toBe('invalid');
    const n = rpcShape({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(isNotificationsOnly(n)).toBe(true);
    expect(isStatelessServable(n)).toBe(false);
    const b = rpcShape([{ id: 1, method: 'ping' }, { method: 'notifications/x' }]);
    expect([b.kind, b.requests, b.notifications]).toEqual(['batch', 1, 1]);
    expect(isStatelessServable(b)).toBe(true);
    expect(isStatelessServable(rpcShape([{ id: 1, method: 'initialize' }, { id: 2, method: 'ping' }]))).toBe(false);
    expect(isReinitWithSession({ method: 'initialize' }, 'abc')).toBe(true);
    expect(isReinitWithSession({ method: 'initialize' }, undefined)).toBe(false);
    expect(isReinitWithSession([{ method: 'initialize' }], 'abc')).toBe(false);
  });
  it('protocolHeaderVerdict', () => {
    expect(protocolHeaderVerdict(undefined)).toBe('ok');
    expect(protocolHeaderVerdict('2025-06-18')).toBe('ok');
    expect(protocolHeaderVerdict('2099-01-01')).toBe('newer');
    expect(protocolHeaderVerdict('2023-01-01')).toBe('unsupported');
    expect(protocolHeaderVerdict('garbage')).toBe('unsupported');
  });
  it('authKind never returns a value', () => {
    expect(authKind({ authorization: 'Bearer dch_live_x' })).toBe('bearer-key');
    expect(authKind({ authorization: 'Bearer eyJ' })).toBe('bearer-oauth');
    expect(authKind({ 'x-api-key': 'dch_x' })).toBe('x-api-key');
    expect(authKind({})).toBe('none');
  });
  it('failureReason covers the SDK messages', () => {
    const rec = describeRequest({ method: 'POST', path: '/mcp', headers: {}, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(failureReason(400, rec, 'Invalid Request: Server already initialized')).toBe('reinit_live_session');
    expect(failureReason(400, rec, 'Bad Request: Unsupported protocol version: x')).toBe('protocol_version');
    expect(failureReason(400, rec, 'No session: send initialize first')).toBe('request_no_session');
    expect(failureReason(404, rec, '')).toBe('session_unknown');
    expect(failureReason(406, rec, '')).toBe('accept_header');
  });
});

it('no test reached the network', () => {
  expect(foreign).toEqual([]);
});
