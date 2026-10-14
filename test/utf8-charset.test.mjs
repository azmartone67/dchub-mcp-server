// UTF-8 charset on the JSON / SSE responses (lib/utf8-charset.mjs).
// Live before the fix (QA headers, 2026-10-14): POST /mcp initialize and tools/list with
// Accept: application/json, text/event-stream answered a bare `content-type: text/event-stream`,
// so a client that defaults to Windows-1252 decoded every em dash as three mojibake characters.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { withUtf8Charset, utf8CharsetMiddleware } from '../lib/utf8-charset.mjs';

const EM_DASH = Buffer.from([0xe2, 0x80, 0x94]);
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dchub-qa-readonly', version: '0.1' } } };

function listen(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
const close = (s) => new Promise((r) => (s ? s.close(r) : r()));

describe('withUtf8Charset', () => {
  it('adds the charset to bare SSE and JSON types', () => {
    expect(withUtf8Charset('text/event-stream')).toBe('text/event-stream; charset=utf-8');
    expect(withUtf8Charset('application/json')).toBe('application/json; charset=utf-8');
    expect(withUtf8Charset('Application/JSON ')).toBe('Application/JSON; charset=utf-8');
    expect(withUtf8Charset('application/json;')).toBe('application/json; charset=utf-8');
  });
  it('leaves a named charset, other types and non-strings alone', () => {
    expect(withUtf8Charset('application/json; charset=UTF-8')).toBe('application/json; charset=UTF-8');
    expect(withUtf8Charset('text/event-stream;charset=utf-8')).toBe('text/event-stream;charset=utf-8');
    expect(withUtf8Charset('text/html')).toBe('text/html');
    expect(withUtf8Charset('application/json-seq')).toBe('application/json-seq');
    expect(withUtf8Charset('image/png')).toBe('image/png');
    expect(withUtf8Charset(undefined)).toBeUndefined();
  });
});

describe('utf8CharsetMiddleware on every way Node writes a header', () => {
  const cases = {
    'writeHead(status, {Content-Type})': (res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('x'); },
    'writeHead(status, message, {content-type})': (res) => { res.writeHead(200, 'OK', { 'content-type': 'application/json' }); res.end('{}'); },
    'writeHead(status, flat raw array)': (res) => { res.writeHead(200, ['Content-Type', 'text/event-stream']); res.end('x'); },
    'setHeader then implicit header on end()': (res) => { res.setHeader('Content-Type', 'application/json'); res.end('{}'); },
    'setHeader then flushHeaders()': (res) => { res.setHeader('content-type', 'text/event-stream'); res.flushHeaders(); res.end('x'); },
  };
  let srv;
  beforeAll(async () => {
    srv = await listen((req, res) => utf8CharsetMiddleware(req, res, () => cases[decodeURIComponent(req.url.slice(1))](res)));
  });
  afterAll(() => close(srv));
  for (const name of Object.keys(cases)) {
    it(name, async () => {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/${encodeURIComponent(name)}`);
      await r.arrayBuffer();
      expect(r.headers.get('content-type')).toMatch(/^(text\/event-stream|application\/json); charset=utf-8$/);
    });
  }
  it('a header that already names a charset, or another type, is passed through unchanged', async () => {
    const s = await listen((req, res) => utf8CharsetMiddleware(req, res, () => {
      if (req.url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('x'); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=ISO-8859-1' }); res.end('{}');
    }));
    try {
      const a = await fetch(`http://127.0.0.1:${s.address().port}/html`); await a.arrayBuffer();
      const b = await fetch(`http://127.0.0.1:${s.address().port}/json`); await b.arrayBuffer();
      expect(a.headers.get('content-type')).toBe('text/html');
      expect(b.headers.get('content-type')).toBe('application/json; charset=ISO-8859-1');
    } finally { await close(s); }
  });
});

// The SDK transport writes its own header (webStandardStreamableHttp.js -> @hono/node-server
// res.writeHead). The control proves it is bare without the middleware, so the assertion
// with it is not passing on SDK behavior alone.
describe('the SDK Streamable HTTP transport', () => {
  async function sdkApp(withMiddleware) {
    const app = express();
    if (withMiddleware) app.use(utf8CharsetMiddleware);
    app.use(express.json());
    app.post('/mcp', async (req, res) => {
      const srv = new McpServer({ name: 't', version: '0' }, { instructions: 'answer — cited' });
      const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await srv.connect(t);
      await t.handleRequest(req, res, req.body);
    });
    return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  }
  async function init(port) {
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(INIT) });
    return { ct: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()) };
  }
  it('control: without the middleware the SDK sends a bare text/event-stream', async () => {
    const s = await sdkApp(false);
    try { expect((await init(s.address().port)).ct).toBe('text/event-stream'); } finally { await close(s); }
  });
  it('with the middleware the SSE reply names utf-8, and the em dash is UTF-8 bytes', async () => {
    const s = await sdkApp(true);
    try {
      const { ct, body } = await init(s.address().port);
      expect(ct).toBe('text/event-stream; charset=utf-8');
      expect(body.includes(EM_DASH)).toBe(true);
    } finally { await close(s); }
  });
});

// The real /mcp handler, backend stubbed on loopback.
describe('server.mjs /mcp', () => {
  const realConnect = net.Socket.prototype.connect;
  let S, httpServer, stub, prevBase;
  beforeAll(async () => {
    net.Socket.prototype.connect = function connect(...args) {
      let o = args[0];
      if (Array.isArray(o)) o = o[0];
      if (!o || typeof o !== 'object') o = { port: args[0], host: args[1] };
      const host = String(o.host || 'localhost');
      if (!o.path && !/^(127\.0\.0\.1|localhost|::1)$/.test(host)) {
        process.nextTick(() => this.destroy(new Error(`network refused by test: ${host}`)));
        return this;
      }
      return realConnect.apply(this, args);
    };
    stub = await listen((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); });
    prevBase = process.env.DCHUB_API_BASE;
    process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
    S = await import('../server.mjs');
    await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  });
  afterAll(async () => {
    await close(httpServer);
    await close(stub);
    if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
    net.Socket.prototype.connect = realConnect;
  });
  async function post(body, accept, headers = {}, path = '/mcp') {
    const r = await fetch(`http://127.0.0.1:${httpServer.address().port}${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', accept, 'user-agent': 'dchub-qa-readonly/0.1 (QA - exclude)',
        'x-dchub-qa': '1', ...headers },
      body: JSON.stringify(body) });
    return { status: r.status, ct: r.headers.get('content-type'), sid: r.headers.get('mcp-session-id'),
      body: Buffer.from(await r.arrayBuffer()) };
  }
  it('initialize over SSE names utf-8 and carries the em dash as UTF-8 bytes', async () => {
    const r = await post(INIT, 'application/json, text/event-stream');
    expect(r.status).toBe(200);
    expect(r.ct).toBe('text/event-stream; charset=utf-8');
    expect(r.body.includes(EM_DASH)).toBe(true);
  });
  it('tools/list over SSE and over JSON both name utf-8', async () => {
    const init = await post(INIT, 'application/json, text/event-stream');
    const h = init.sid ? { 'mcp-session-id': init.sid } : {};
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'application/json, text/event-stream', h);
    const sse = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'application/json, text/event-stream', h);
    expect(sse.status).toBe(200);
    expect(sse.ct).toBe('text/event-stream; charset=utf-8');
    const json = await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, 'application/json');
    expect(json.ct).toMatch(/^application\/json; charset=utf-8$/i);
  });
  // /mcp/claude answers these itself through _writeRpcResult / _writeRpcError (no SDK transport).
  it('the cached writers on /mcp/claude name utf-8: SSE result, JSON result, JSON-RPC error', async () => {
    const SSE = 'application/json, text/event-stream';
    const sse = await post({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, SSE, {}, '/mcp/claude');
    expect(sse.status).toBe(200);
    expect(sse.body.toString()).toMatch(/^event: message\ndata: .*"resources":\[\]/);
    expect(sse.ct).toBe('text/event-stream; charset=utf-8');
    const json = await post({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, 'application/json', {}, '/mcp/claude');
    expect(JSON.parse(json.body.toString()).result).toEqual({ resources: [] });
    expect(json.ct).toBe('application/json; charset=utf-8');
    const err = await post([INIT, INIT], SSE, {}, '/mcp/claude');
    expect(err.status).toBe(400);
    expect(JSON.parse(err.body.toString()).error.message).toMatch(/one JSON-RPC request per POST/);
    expect(err.ct).toBe('application/json; charset=utf-8');
  });
});
