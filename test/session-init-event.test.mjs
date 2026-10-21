// session-init-event.test.mjs — one `session_init` event per initialize (2026-10-21).
//
// The pure body builder (lib/session-init-event.mjs), then real HTTP through the
// express app against a 127.0.0.1 backend stub: a stateful /mcp initialize, the
// stateless /mcp/core and /mcp/chatgpt ones, the QA header and a declared via
// each reach /api/v1/mcp/track as one event, and a tools/call sends none.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { sessionInitEventBody, sessionInitEventOn, postSessionInitEvent } from '../lib/session-init-event.mjs';

const INIT = (name, version = '1.0.0') => ({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version } },
});
const md5 = (s) => createHash('md5').update(s).digest('hex');

describe('sessionInitEventBody (pure)', () => {
  it('carries the handshake facts and hashes the IP', () => {
    const b = sessionInitEventBody({ body: INIT('Claude Code', '2.0.14'), sessionId: 'sid-1',
      userAgent: 'claude-code/2.0.14', clientIp: '198.51.100.7', via: 'pipeworx',
      qaMarker: false, selfPath: false, platform: 'claude', path: '/mcp' }, {});
    expect(b).toEqual({
      event: 'session_init', session_id: 'sid-1', client_name: 'Claude Code', client_version: '2.0.14',
      protocol_version: '2025-06-18', user_agent: 'claude-code/2.0.14', via: 'pipeworx',
      qa_marker: false, self_path: false, platform: 'claude', path: '/mcp', source: null,
      agent_hash: md5('198.51.100.7'),
    });
    expect(JSON.stringify(b)).not.toContain('198.51.100.7');
  });

  it('is null for anything but an initialize, and when switched off', () => {
    expect(sessionInitEventBody({ body: { method: 'tools/call', params: {} } }, {})).toBeNull();
    expect(sessionInitEventBody({ body: null }, {})).toBeNull();
    expect(sessionInitEventBody({ body: INIT('x') }, { DCHUB_SESSION_INIT_EVENT: '0' })).toBeNull();
    expect(sessionInitEventOn({ DCHUB_SESSION_INIT_EVENT: 'off' })).toBe(false);
    expect(sessionInitEventOn({})).toBe(true);
  });

  it('missing clientInfo and IP become nulls, never a guess', () => {
    const b = sessionInitEventBody({ body: { method: 'initialize', params: {} } }, {});
    expect([b.client_name, b.client_version, b.agent_hash, b.session_id, b.via]).toEqual([null, null, null, null, null]);
  });

  it('posts nothing without a base, a key or a body', () => {
    let n = 0;
    const f = () => { n += 1; return Promise.resolve(); };
    expect(postSessionInitEvent(null, { apiBase: 'http://x', internalKey: 'k', fetchImpl: f })).toBeNull();
    expect(postSessionInitEvent({ a: 1 }, { apiBase: 'http://x', internalKey: '', fetchImpl: f })).toBeNull();
    expect(n).toBe(0);
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
        if (b.event === 'session_init') events.push({ body: b, key: req.headers['x-internal-key'] });
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
               'x-dc-client-ip': '203.0.113.50', ...headers },
    body: JSON.stringify(body),
  });
  await res.text();
  return res;
}
const forName = (name) => events.filter((e) => e.body.client_name === name);

describe('every initialize reaches /api/v1/mcp/track as one session_init event', () => {
  it('stateful /mcp: carries the server-minted session id and the via', async () => {
    const res = await post('/mcp?via=pipeworx', { 'user-agent': 'node' }, INIT('acme-gateway-test-a'));
    const sid = res.headers.get('mcp-session-id');
    expect(sid).toBeTruthy();
    expect(await eventually(() => forName('acme-gateway-test-a').length === 1)).toBe(true);
    const { body, key } = forName('acme-gateway-test-a')[0];
    expect(key).toBe('test-internal-key-not-real');
    expect(body.session_id).toBe(sid);
    expect(body.via).toBe('pipeworx');
    expect(body.user_agent).toBe('node');
    expect(body.agent_hash).toBe(md5('203.0.113.50'));
    expect(body.qa_marker).toBe(false);
    expect(JSON.stringify(body)).not.toContain('203.0.113.50');
  });

  it('the QA header rides the event', async () => {
    await post('/mcp', { 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1' }, INIT('acme-qa-test-b'));
    expect(await eventually(() => forName('acme-qa-test-b').length === 1)).toBe(true);
    expect(forName('acme-qa-test-b')[0].body.qa_marker).toBe(true);
  });

  it('stateless /mcp/core: one event, no session id', async () => {
    await post('/mcp/core', { 'user-agent': 'python-httpx/0.27.0' }, INIT('acme-core-test-c'));
    expect(await eventually(() => forName('acme-core-test-c').length === 1)).toBe(true);
    expect(forName('acme-core-test-c')[0].body.session_id).toBeNull();
    expect(forName('acme-core-test-c')[0].body.path).toBe('/mcp/core');
  });

  it('stateless directory profile /mcp/chatgpt: one event', async () => {
    await post('/mcp/chatgpt', { 'user-agent': 'openai-mcp/1.0.0' }, INIT('acme-dir-test-d'));
    expect(await eventually(() => forName('acme-dir-test-d').length === 1)).toBe(true);
    expect(forName('acme-dir-test-d')[0].body.session_id).toBeNull();
  });

  it('a tools/call sends no session_init event', async () => {
    const before = events.length;
    await post('/mcp', { 'user-agent': 'node' }, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'why_dchub', arguments: {} } });
    await sleep(300);
    expect(events.length).toBe(before);
  });
});

describe('hard gate: no network', () => {
  it('no connection left 127.0.0.1', () => {
    expect(foreign).toEqual([]);
  });
});
