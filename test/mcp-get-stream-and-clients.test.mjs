// mcp-get-stream-and-clients.test.mjs — GET /mcp never 405s, /mcp 4xx counted per client, and
// the clients the platform tagging now names (2026-11-11).
//
// Every GET/HEAD shape goes over a real HTTP round trip through the express app, and the chosen
// answers are proven with the real @modelcontextprotocol/sdk Client: connect, listTools, close,
// with no error raised and no reconnect loop.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  getVerdict, mcpGetDescription, sseDeclineFrame, chunkText, failureReason, describeRequest,
  SSE_DECLINE_RETRY_MS, MCP_DISCOVERY_LINKS,
} from '../lib/mcp-request-shape.mjs';
import { createMcp4xxCounter, mcp4xxEventOn } from '../lib/mcp-4xx-event.mjs';
import { recognizedClientFromName, recognizedClientFromUa } from '../lib/client-recognition.mjs';

// No network: only loopback sockets connect.
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
const BASE = () => `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const INIT = (id = 1) => ({
  jsonrpc: '2.0', id, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dchub-qa-readonly', version: '1' } },
});
async function initSession(ua = 'Claude-User') {
  const res = await fetch(`${BASE()}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': ua },
    body: JSON.stringify(INIT()),
  });
  await res.text();
  expect(res.status).toBe(200);
  return res.headers.get('mcp-session-id');
}
async function get(path, headers = {}, method = 'GET') {
  const res = await fetch(`${BASE()}${path}`, { method, headers });
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
}

describe('GET / HEAD shapes at the origin', () => {
  it('Claude-style: live session + Accept text/event-stream opens the SDK stream (200, held open)', async () => {
    const sid = await initSession();
    const ac = new AbortController();
    const res = await fetch(`${BASE()}/mcp`, {
      headers: { accept: 'text/event-stream', 'mcp-session-id': sid, 'mcp-protocol-version': '2025-06-18', 'user-agent': 'Claude-User' },
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('mcp-session-id')).toBe(sid);
    expect(res.headers.get('x-dc-hub-mcp-get')).toBe('sse');
    expect(S._sseOpenForTest.has(sid)).toBe(true);
    // A second GET on the same session is declined (200 + retry), not the SDK's 409.
    const dup = await get('/mcp', { accept: 'text/event-stream', 'mcp-session-id': sid });
    expect(dup.status).toBe(200);
    expect(dup.headers.get('x-dc-hub-mcp-get-reason')).toBe('stream_open');
    expect(dup.body).toMatch(/^retry: 300000$/m);
    ac.abort();
    for (let i = 0; i < 50 && S._sseOpenForTest.has(sid); i++) await sleep(20);
    expect(S._sseOpenForTest.has(sid)).toBe(false);
    // Once the first stream is gone a new GET gets a stream again.
    const ac2 = new AbortController();
    const again = await fetch(`${BASE()}/mcp`, { headers: { accept: 'text/event-stream', 'mcp-session-id': sid }, signal: ac2.signal });
    expect(again.status).toBe(200);
    expect(again.headers.get('x-dc-hub-mcp-get')).toBe('sse');
    ac2.abort();
  });

  it('a live session with an MCP-Protocol-Version newer than ours still gets the stream', async () => {
    const sid = await initSession();
    const ac = new AbortController();
    const res = await fetch(`${BASE()}/mcp`, {
      headers: { accept: 'text/event-stream', 'mcp-session-id': sid, 'mcp-protocol-version': '2099-01-01' }, signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-dc-hub-mcp-get')).toBe('sse');
    ac.abort();
  });

  it('a live session without text/event-stream in Accept: 200 JSON description, not the SDK 406', async () => {
    const sid = await initSession();
    const r = await get('/mcp', { accept: 'application/json', 'mcp-session-id': sid });
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.endpoint).toBe('https://dchub.cloud/mcp');
  });

  it('Grok-style probes: no session, any Accept: never a 405', async () => {
    for (const accept of ['text/event-stream', 'application/json, text/event-stream', '*/*', '']) {
      const r = await get('/mcp', { accept, 'user-agent': 'grok-connectors-manager/0.1.0' });
      expect(r.status, accept).toBe(200);
      if (/event-stream/.test(accept)) {
        expect(r.headers.get('content-type')).toMatch(/text\/event-stream/);
        expect(r.headers.get('x-dc-hub-mcp-get-reason')).toBe('no_session');
        expect(r.body).toMatch(/^retry: 300000$/m);
        expect(r.body).not.toMatch(/^data:/m);   // nothing a client could parse as a message
      } else {
        expect(r.headers.get('content-type')).toMatch(/application\/json/);
      }
    }
  });

  it('browser GET: 200 JSON naming the endpoint, how to connect, and the discovery documents', async () => {
    const r = await get('/mcp', { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': 'Mozilla/5.0' });
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.endpoint).toBe('https://dchub.cloud/mcp');
    expect(j.how_to_connect).toMatch(/POST JSON-RPC/);
    expect(j.how_to_connect).toMatch(/initialize first/);
    expect(j.links).toEqual(MCP_DISCOVERY_LINKS);
    expect(j.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('HEAD: 200 with no body (was 405: 104 of 139 origin 4xx lines on 11-10/11)', async () => {
    const r = await get('/mcp', { 'user-agent': 'node' }, 'HEAD');
    expect(r.status).toBe(200);
    expect(r.body).toBe('');
    const sse = await get('/mcp', { accept: 'text/event-stream' }, 'HEAD');
    expect(sse.status).toBe(200);
  });

  it('stateless paths never open a stream, even with a /mcp session id', async () => {
    const sid = await initSession();
    for (const path of ['/mcp/core', '/mcp/chatgpt']) {
      const r = await get(path, { accept: 'text/event-stream', 'mcp-session-id': sid });
      expect(r.status, path).toBe(200);
      expect(r.headers.get('x-dc-hub-mcp-get-reason'), path).toBe('stateless_path');
      const d = await get(path, { accept: 'application/json' });
      expect(d.status, path).toBe(200);
      expect(JSON.parse(d.body).endpoint, path).toBe('https://dchub.cloud' + path);
    }
  });

  it('DELETE: an unknown session id is 200 (already ended); no session id is still 404', async () => {
    const gone = await get('/mcp', { 'mcp-session-id': 'gone-del-0001' }, 'DELETE');
    expect(gone.status).toBe(200);
    const none = await get('/mcp', {}, 'DELETE');
    expect(none.status).toBe(404);
    const sid = await initSession();
    const live = await get('/mcp', { 'mcp-session-id': sid }, 'DELETE');
    expect(live.status).toBe(200);
  });
});

// The real SDK client against the real app. A GET request counter wraps fetch.
function countingFetch(log) {
  return async (url, init = {}) => {
    const res = await fetch(url, init);
    if ((init.method || 'GET') === 'GET') log.push({ status: res.status, type: res.headers.get('content-type') || '', verdict: res.headers.get('x-dc-hub-mcp-get') });
    return res;
  };
}

describe('real SDK Client handshake (connect, listTools, close)', () => {
  it('/mcp: the GET stream opens once (200 SSE), no error, no reconnect', async () => {
    const gets = [];
    const errors = [];
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE()}/mcp`), { fetch: countingFetch(gets) });
    transport.onerror = (e) => errors.push(String(e && e.message));
    const client = new Client({ name: 'dchub-qa-readonly', version: '1' });
    client.onerror = (e) => errors.push(String(e && e.message));
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(10);
    await sleep(1500);
    expect(gets.length).toBe(1);
    expect(gets[0]).toMatchObject({ status: 200, verdict: 'sse' });
    expect(gets[0].type).toMatch(/text\/event-stream/);
    await client.close();
    await sleep(100);
    expect(errors.filter((m) => !/abort/i.test(m))).toEqual([]);
  }, 30000);

  it('a declined GET (no live session): one GET, no error, the next one only after the retry hint', async () => {
    // /mcp/core mints no session, so the SDK's post-initialize GET carries none: the decline path.
    const gets = [];
    const errors = [];
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE()}/mcp/core`), { fetch: countingFetch(gets) });
    transport.onerror = (e) => errors.push(String(e && e.message));
    const client = new Client({ name: 'dchub-qa-readonly', version: '1' });
    client.onerror = (e) => errors.push(String(e && e.message));
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    await sleep(2500);   // the SDK's own default would have reconnected after 1 s
    expect(gets.length).toBe(1);
    expect(gets[0]).toMatchObject({ status: 200, verdict: 'decline' });
    expect(transport._serverRetryMs).toBe(SSE_DECLINE_RETRY_MS);
    await client.close();
    expect(transport._reconnectionTimeout).toBeUndefined();   // close() cleared the one pending retry
    expect(errors).toEqual([]);
  }, 30000);
});

describe('the decline frame against the SDK client, in isolation', () => {
  // A bare server answering every GET with the decline frame at a short retry, so the cadence is
  // measurable: the client must reconnect once per retry interval, never faster, never erroring.
  it('reconnects once per retry interval and raises nothing', async () => {
    let gets = 0;
    const srv = http.createServer((req, res) => {
      if (req.method === 'GET') {
        gets += 1;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return res.end(sseDeclineFrame({ retryMs: 1000 }));
      }
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const m = JSON.parse(raw || '{}');
        if (m.id === undefined) { res.writeHead(202); return res.end(); }
        const result = m.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't', version: '1' } }
          : { tools: [] };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const errors = [];
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.address().port}/mcp`));
    transport.onerror = (e) => errors.push(String(e && e.message));
    const client = new Client({ name: 'dchub-qa-readonly', version: '1' });
    await client.connect(transport);
    await client.listTools();
    await sleep(2600);
    await client.close();
    await new Promise((r) => srv.close(r));
    // t=0 first GET, ~1 s, ~2 s: three, and certainly not a loop.
    expect(gets).toBeGreaterThanOrEqual(2);
    expect(gets).toBeLessThanOrEqual(4);
    expect(errors).toEqual([]);
  }, 30000);
});

describe('getVerdict / helpers', () => {
  it('maps every shape', () => {
    expect(getVerdict({ method: 'HEAD', accept: 'text/event-stream', sessionId: 's', sessionKnown: true })).toBe('describe');
    expect(getVerdict({ method: 'GET', accept: 'application/json', sessionId: 's', sessionKnown: true })).toBe('describe');
    expect(getVerdict({ method: 'GET', accept: '*/*' })).toBe('describe');
    expect(getVerdict({ method: 'GET', accept: 'text/event-stream' })).toBe('decline');
    expect(getVerdict({ method: 'GET', accept: 'text/event-stream', sessionId: 's', sessionKnown: false })).toBe('decline');
    expect(getVerdict({ method: 'GET', accept: 'text/event-stream', sessionId: 's', sessionKnown: true, streamOpen: true })).toBe('decline');
    expect(getVerdict({ method: 'GET', accept: 'text/event-stream', sessionId: 's', sessionKnown: true, stateless: true })).toBe('decline');
    expect(getVerdict({ method: 'GET', accept: 'Text/Event-Stream', sessionId: 's', sessionKnown: true })).toBe('sse');
  });
  it('description endpoint is pinned to dchub.cloud MCP paths', () => {
    expect(mcpGetDescription({ path: '/mcp/' }).endpoint).toBe('https://dchub.cloud/mcp');
    expect(mcpGetDescription({ path: '/mcp/grok' }).endpoint).toBe('https://dchub.cloud/mcp/grok');
    expect(mcpGetDescription({ path: '/evil.com' }).endpoint).toBe('https://dchub.cloud/mcp');
  });
  it('chunkText decodes what @hono/node-server writes (Uint8Array), not "123,34,..."', () => {
    const u8 = new TextEncoder().encode('{"jsonrpc":"2.0"}');
    expect(chunkText(u8)).toBe('{"jsonrpc":"2.0"}');
    expect(chunkText(Buffer.from('x'))).toBe('x');
    expect(chunkText('y')).toBe('y');
    expect(chunkText(null)).toBe('');
  });
  it('failureReason names 409 and a DELETE 405', () => {
    const rec = describeRequest({ method: 'DELETE', path: '/mcp', headers: {} });
    expect(failureReason(405, rec)).toBe('delete_not_allowed');
    expect(failureReason(409, rec)).toBe('sse_stream_open');
  });
});

describe('[mcp-4xx] reason read from the SDK body, and the per-client counter', () => {
  it('an unsupported MCP-Protocol-Version is logged protocol_version (was "other")', async () => {
    const lines = [];
    const orig = console.log;
    console.log = (...a) => { const s = a.join(' '); if (s.startsWith('[mcp-4xx]')) lines.push(s); else orig(...a); };
    try {
      const res = await fetch(`${BASE()}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '1999-01-01', 'user-agent': 'grok-connectors-manager/0.1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list' }),
      });
      expect(res.status).toBe(400);
      const j = await res.json();
      expect(j.error.message).toMatch(/Unsupported protocol version/);   // tells the caller how to fix it
      await sleep(50);
    } finally { console.log = orig; }
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0].slice('[mcp-4xx] '.length));
    expect(rec.reason).toBe('protocol_version');
    expect(rec.path).toBe('/mcp');
    const rows = S._mcp4xxCounterForTest.rows();
    expect(rows.some((r) => r.client === 'grok' && r.status === 400 && r.reason === 'protocol_version' && r.n >= 1)).toBe(true);
  });

  it('QA callers are counted as dchub-internal, never as a platform', () => {
    expect(S._mcp4xxClient({ headers: { 'user-agent': 'dchub-qa-readonly' } })).toBe('dchub-internal');
    expect(S._mcp4xxClient({ headers: { 'user-agent': 'Claude-User', 'x-dchub-qa': '1' } })).toBe('dchub-internal');
    expect(S._mcp4xxClient({ headers: { 'user-agent': 'Claude-User' } })).toBe('claude');
  });

  it('counts per {day, client, status, reason}, posts one batched mcp_4xx event, holds no identity', async () => {
    const sent = [];
    const c = createMcp4xxCounter({ apiBase: 'http://backend.invalid', internalKey: 'k', flushMs: 0,
      now: () => new Date('2026-11-11T08:00:00Z'),
      fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true }; } });
    c.note({ client: 'Claude', status: 400, reason: 'protocol_version' });
    c.note({ client: 'claude', status: 400, reason: 'protocol_version' });
    c.note({ client: 'grok', status: 404, reason: 'session_unknown' });
    c.note({ client: 'grok', status: 200, reason: 'x' });   // not a 4xx: ignored
    await c.flush();
    expect(sent.length).toBe(1);
    expect(sent[0].url).toBe('http://backend.invalid/api/v1/mcp/track');
    expect(sent[0].init.headers['X-Internal-Key']).toBe('k');
    const body = JSON.parse(sent[0].init.body);
    expect(body.event).toBe('mcp_4xx');
    expect(body.tool).toBeUndefined();   // deploy-skew safe: an older backend drops it
    expect(body.rows).toEqual([
      { day: '2026-11-11', client: 'claude', status: 400, reason: 'protocol_version', n: 2 },
      { day: '2026-11-11', client: 'grok', status: 404, reason: 'session_unknown', n: 1 },
    ]);
    expect(c.size()).toBe(0);
    expect(c.flush()).toBeNull();   // nothing left: no empty POST
  });

  it('bounded keys and a kill switch', async () => {
    const c = createMcp4xxCounter({ apiBase: 'http://x.invalid', internalKey: 'k', flushMs: 0, maxKeys: 2, fetchImpl: async () => ({}) });
    c.note({ client: 'a', status: 400, reason: 'r1' });
    c.note({ client: 'b', status: 400, reason: 'r2' });
    c.note({ client: 'c', status: 400, reason: 'r3' });
    expect(c.rows().map((r) => r.reason)).toEqual(['r1', 'r2', 'overflow']);
    const off = createMcp4xxCounter({ apiBase: 'http://x.invalid', internalKey: 'k', flushMs: 0, env: { DCHUB_MCP_4XX_EVENT: '0' } });
    expect(off.note({ client: 'a', status: 400, reason: 'r' })).toBe(false);
    expect(mcp4xxEventOn({ DCHUB_MCP_4XX_EVENT: 'off' })).toBe(false);
    expect(mcp4xxEventOn({})).toBe(true);
  });
});

describe('client recognition (names and UAs from each client\'s public source)', () => {
  const init = (name) => ({ method: 'initialize', params: { clientInfo: { name } } });
  it('new: VS Code (Copilot), Codeium, MiniMax, Google ADK', () => {
    expect(S.detectPlatformFromInit(init('Visual Studio Code'), 'node')).toBe('copilot');
    expect(S.detectPlatformFromInit(init('Visual Studio Code - Insiders'), 'node')).toBe('copilot');
    expect(S.detectPlatformFromInit(init('Visual-Studio-Code'), 'node')).toBe('copilot');
    expect(S.detectPlatformFromInit(null, 'Visual Studio Code/1.106.0')).toBe('copilot');
    expect(S.detectPlatformFromInit(init('mavis-local-runtime-mcp'), 'node')).toBe('minimax');
    expect(S.detectPlatformFromInit(null, 'MiniMaxAgent')).toBe('minimax');
    expect(S.detectPlatformFromInit(init('google-adk'), 'python-httpx/0.28.1')).toBe('google-adk');
    expect(S.detectPlatformFromInit(null, 'google-adk/1.18.0 gl-python/3.12.7')).toBe('google-adk');
    expect(S.detectPlatformFromInit(init('codeium'), 'node')).toBe('windsurf');
    // the explicit platform header uses the same vocabulary
    expect(S.detectPlatformFromInit(null, 'node', 'google-adk')).toBe('google-adk');
  });
  it('new: opencode, WorkBuddy, Clono by User-Agent and by clientInfo name', () => {
    expect(S.detectPlatformFromInit(null, 'opencode/2.2.4/cli')).toBe('opencode');
    expect(S.detectPlatformFromInit(init('opencode'), 'node')).toBe('opencode');
    expect(S.detectPlatformFromInit(null, 'WorkBuddy/5.9.6')).toBe('workbuddy');
    expect(S.detectPlatformFromInit(init('WorkBuddy'), 'node')).toBe('workbuddy');
    expect(S.detectPlatformFromInit(null, 'Clono (+https://clono.sh)')).toBe('clono');
    expect(S.detectPlatformFromInit(init('clono'), 'node')).toBe('clono');
    // Copilot CLI and Codex CLI were already named
    expect(S.detectPlatformFromInit(null, 'copilot-cli/1.0.34')).toBe('copilot');
    expect(S.detectPlatformFromInit(null, 'codex-mcp-client/0.121.0')).toBe('codex');
    // a name that merely contains the word is not claimed
    expect(S.detectPlatformFromInit(init('my-opencode-fork-tool'), 'node')).not.toBe('opencode');
  });
  it('existing labels do not move', () => {
    expect(S.detectPlatformFromInit(init('gemini-cli-mcp-client'), 'node')).toBe('gemini');
    expect(S.detectPlatformFromInit(init('windsurf-client'), 'node')).toBe('windsurf');
    expect(S.detectPlatformFromInit(init('Windsurf'), 'node')).toBe('windsurf');
    expect(S.detectPlatformFromInit(init('github-copilot-developer'), 'node')).toBe('copilot');
    expect(S.detectPlatformFromInit(null, 'copilot-cli/1.0.108-0')).toBe('copilot');
    expect(S.detectPlatformFromInit(init('claude-ai'), 'node')).toBe('claude');
    expect(S.detectPlatformFromInit(init('claude-code'), 'node')).toBe('claude');
    expect(S.detectPlatformFromInit(init('cursor-vscode'), 'node')).toBe('cursor');
    expect(S.detectPlatformFromInit(init('ChatGPT'), 'node')).toBe('chatgpt');
    expect(S.detectPlatformFromInit(null, 'grok-connectors-manager/0.1.0')).toBe('grok');
    expect(S.detectPlatformFromInit(init('Roo-Code'), 'node')).toBe('roo-code');
    expect(S.detectPlatformFromInit(init('opencode'), 'node')).toBe('opencode');
    expect(S.detectPlatformFromInit(init('mcp'), 'node')).toBe('mcp-generic-client');
    expect(S.detectPlatformFromInit(init('MCPClient'), 'node')).toBe('mcp-generic-client');   // ADK for TypeScript
  });
  it('the rule tables do not over-match', () => {
    expect(recognizedClientFromName('vscode-extension-x')).toBe('');
    expect(recognizedClientFromName('roadkill')).toBe('');
    expect(recognizedClientFromName('sadk')).toBe('');
    expect(recognizedClientFromUa('node')).toBe('');
    expect(recognizedClientFromUa('Mozilla/5.0 (Windows NT 10.0) Code/1.0')).toBe('');
  });
});

it('no test reached the network', () => {
  expect(foreign).toEqual([]);
});
