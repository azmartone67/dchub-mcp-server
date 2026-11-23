// 2026-11-23: get_market_dcpi_rank(market:"dallas") was refused live with -32602 "market_slug undefined".
// ARG_ALIASES now renames `market` to `market_slug` for it and predict_market_trajectory, on /mcp and on the
// directory profiles. Driven over the real Express app, loopback only; the backend is a stub.
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
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dcpi-alias-test', version: '1.0' } } };
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const names = (r) => (r.json?.result?.tools || []).map((t) => t.name).sort();

async function initAndList(path) {
  const init = await post(path, INIT);
  const sid = init.headers.get('mcp-session-id');
  const list = await post(path, LIST, sid ? { 'mcp-session-id': sid } : {});
  return { init, list };
}


async function call(path, name, args) {
  const init = await post(path, INIT);
  const sid = init.headers.get('mcp-session-id');
  return post(path, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } },
    sid ? { 'mcp-session-id': sid } : {});
}
const refusedForSlug = (r) => /market_slug/.test(JSON.stringify(r.json || r.raw)) && /(-32602|Invalid arguments|expected string)/.test(JSON.stringify(r.json || r.raw));

describe('market is accepted as market_slug', () => {
  it('baseline: with neither argument the call is refused for market_slug (the check below can fail)', async () => {
    expect(refusedForSlug(await call('/mcp', 'get_market_dcpi_rank', {}))).toBe(true);
  });
  for (const path of ['/mcp', '/mcp/muse', '/mcp/claude']) {
    it(`${path}: get_market_dcpi_rank(market) is not refused`, async () => {
      expect(refusedForSlug(await call(path, 'get_market_dcpi_rank', { market: 'dallas' }))).toBe(false);
    });
  }
  it('/mcp: predict_market_trajectory(market) is not refused', async () => {
    expect(refusedForSlug(await call('/mcp', 'predict_market_trajectory', { market: 'dallas' }))).toBe(false);
  });
});
