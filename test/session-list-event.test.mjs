// session-list-event.test.mjs — one `session_list` event per session's FIRST tools/list (2026-11-27, Change 4).
//
// The pure pieces (lib/session-list-event.mjs), then real HTTP through the express app against a
// 127.0.0.1 backend stub: initialize + tools/list on /mcp sends one event carrying the session id and
// the bytes the client actually received; a second tools/list in that session sends none; a QA caller,
// a session-less tools/list and a tools/call send none; and the response is the same with the event off.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { sessionListEventBody, sessionListEventOn, isToolsListRequest, chunkBytes, createListOnce }
  from '../lib/session-list-event.mjs';

const INIT = (name) => ({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1.0.0' } },
});
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const NOW = () => new Date('2026-11-28T03:00:00.000Z');

describe('session-list-event (pure)', () => {
  it('builds the event: session id, time, bytes, status; nothing else', () => {
    expect(sessionListEventBody({ sessionId: ' sid-1 ', listBytes: 224246, status: 200, now: NOW,
      initializedAt: new Date('2026-11-28T02:59:58.500Z') }, {})).toEqual({
      event: 'session_list', session_id: 'sid-1', initialized_at: '2026-11-28T02:59:58.500Z',
      listed_at: '2026-11-28T03:00:00.000Z', list_bytes: 224246, status: 200 });
    expect(sessionListEventBody({ sessionId: 's', listBytes: 1, initializedAt: 'garbage' }, {}).initialized_at).toBeNull();
  });
  it('is null when off, own, session-less, or not a 2xx', () => {
    expect(sessionListEventBody({ sessionId: 's', listBytes: 1 }, { DCHUB_SESSION_LIST_EVENT: '0' })).toBeNull();
    expect(sessionListEventBody({ sessionId: 's', listBytes: 1, own: true }, {})).toBeNull();
    expect(sessionListEventBody({ sessionId: '', listBytes: 1 }, {})).toBeNull();
    expect(sessionListEventBody({ sessionId: 's', listBytes: 1, status: 400 }, {})).toBeNull();
    expect(sessionListEventBody({ sessionId: 's', listBytes: 1, status: 404 }, {})).toBeNull();
    expect(sessionListEventOn({ DCHUB_SESSION_LIST_EVENT: 'off' })).toBe(false);
    expect(sessionListEventOn({})).toBe(true);
  });
  it('a bad byte count is null, never a guess', () => {
    expect(sessionListEventBody({ sessionId: 's', listBytes: NaN }, {}).list_bytes).toBeNull();
    expect(sessionListEventBody({ sessionId: 's', listBytes: -5 }, {}).list_bytes).toBeNull();
  });
  it('recognizes only a single tools/list request', () => {
    expect(isToolsListRequest(LIST)).toBe(true);
    expect(isToolsListRequest({ method: 'tools/list' })).toBe(false);          // notification: no id
    expect(isToolsListRequest([LIST])).toBe(false);                             // batch
    expect(isToolsListRequest({ ...LIST, method: 'tools/call' })).toBe(false);
    expect(isToolsListRequest(null)).toBe(false);
  });
  it('counts bytes of strings (utf8) and buffers', () => {
    expect(chunkBytes('abc')).toBe(3);
    expect(chunkBytes('é')).toBe(2);
    expect(chunkBytes(Buffer.from([1, 2, 3, 4]))).toBe(4);
    expect(chunkBytes(undefined)).toBe(0);
    expect(chunkBytes(() => {})).toBe(0);
  });
  it('once per session, bounded', () => {
    const o = createListOnce({ max: 2 });
    expect(o.note('a')).toBe(true);
    expect(o.note('a')).toBe(false);
    expect(o.note('')).toBe(false);
    o.note('b'); o.note('c');
    expect(o.size()).toBeLessThanOrEqual(2);
  });
});

// ── real HTTP ────────────────────────────────────────────────────────────────
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

let S, PORT, httpServer, stub;
const prev = {};
const events = [];
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function eventually(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(20); }
  return pred();
}
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
      const p = new URL(req.url, 'http://_').pathname;
      res.setHeader('content-type', 'application/json');
      if (p === '/api/v1/mcp/track') {
        const b = await readBody(req);
        if (b.event === 'session_list' || b.event === 'session_init') events.push({ body: b, key: req.headers['x-internal-key'] });
        res.end('{}');
        return;
      }
      if (p === '/api/v1/keys/validate') { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
      res.statusCode = 404;
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY']) prev[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-real';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  net.Socket.prototype.connect = realConnect;
});

async function post(path, headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
               'x-dc-client-ip': '203.0.113.51', ...headers },
    body: JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, bytes: buf.length, text: buf.toString('utf8') };
}
const lists = (sid) => events.filter((e) => e.body.event === 'session_list' && e.body.session_id === sid);
async function openSession(name, headers = { 'user-agent': 'node' }) {
  const { res } = await post('/mcp', headers, INIT(name));
  const sid = res.headers.get('mcp-session-id');
  await post('/mcp', { ...headers, 'mcp-session-id': sid }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return sid;
}

describe('the first tools/list of a session reaches /api/v1/mcp/track once', () => {
  it('one event with the session id and the bytes the client received', async () => {
    const sid = await openSession('acme-list-test-a');
    expect(sid).toBeTruthy();
    const r = await post('/mcp', { 'user-agent': 'node', 'mcp-session-id': sid }, LIST);
    expect(r.res.status).toBe(200);
    expect(r.text).toContain('execute_plan');
    expect(await eventually(() => lists(sid).length === 1)).toBe(true);
    const { body, key } = lists(sid)[0];
    expect(key).toBe('test-internal-key-not-real');
    expect(body.list_bytes).toBe(r.bytes);
    expect(body.status).toBe(200);
    expect(Number.isNaN(Date.parse(body.listed_at))).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['event', 'initialized_at', 'list_bytes', 'listed_at', 'session_id', 'status']);
    expect(Date.parse(body.initialized_at)).toBeLessThanOrEqual(Date.parse(body.listed_at));
    expect(Date.parse(body.listed_at) - Date.parse(body.initialized_at)).toBeLessThan(60_000);
    // second list in the same session: no second event
    await post('/mcp', { 'user-agent': 'node', 'mcp-session-id': sid }, { ...LIST, id: 3 });
    await sleep(300);
    expect(lists(sid).length).toBe(1);
  });

  it('our own QA caller sends none', async () => {
    const h = { 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1' };
    const sid = await openSession('acme-list-test-qa', h);
    await post('/mcp', { ...h, 'mcp-session-id': sid }, LIST);
    await sleep(300);
    expect(lists(sid).length).toBe(0);
  });

  it('a session-less tools/list and a tools/call send none', async () => {
    const before = events.filter((e) => e.body.event === 'session_list').length;
    const r = await post('/mcp', { 'user-agent': 'node' }, LIST);
    expect(r.text).toContain('execute_plan');
    const sid = await openSession('acme-list-test-c');
    await post('/mcp', { 'user-agent': 'node', 'mcp-session-id': sid },
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'why_dchub', arguments: {} } });
    await sleep(300);
    expect(events.filter((e) => e.body.event === 'session_list').length).toBe(before);
  });

  it('the kill switch sends none and leaves the response unchanged', async () => {
    const sidOn = await openSession('acme-list-test-on');
    const on = await post('/mcp', { 'user-agent': 'node', 'mcp-session-id': sidOn }, LIST);
    process.env.DCHUB_SESSION_LIST_EVENT = '0';
    try {
      const sidOff = await openSession('acme-list-test-off');
      const off = await post('/mcp', { 'user-agent': 'node', 'mcp-session-id': sidOff }, LIST);
      await sleep(300);
      expect(lists(sidOff).length).toBe(0);
      expect(off.res.status).toBe(on.res.status);
      expect(off.bytes).toBe(on.bytes);
    } finally { delete process.env.DCHUB_SESSION_LIST_EVENT; }
  });
});

describe('hard gate: no network', () => {
  it('no connection left 127.0.0.1', () => {
    expect(foreign).toEqual([]);
  });
});
