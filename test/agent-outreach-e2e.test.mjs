// Agent outreach through the REAL /mcp handler: the outer step is wired, next_ask
// and cite_as reach the result, and the follow-up call is logged with
// _via_next_ask. lib/agent-outreach.mjs carries the unit tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const realConnect = net.Socket.prototype.connect;
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

const ROWS = Array.from({ length: 3 }, (_, i) => ({ iso: `ISO${i}`, demand_mw: 1000 + i, renewable_pct: 30 + i }));
const tracked = [];
let S, PORT, httpServer, stub, prevBase;

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
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/v1/mcp/track') { tracked.push(await readBody(req)); res.end('{}'); return; }
      if (url.pathname === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: ROWS.length, data: ROWS, results: ROWS, grids: ROWS }));
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
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}

describe('agent outreach over the real /mcp handler', () => {
  it('stamps next_ask + cite_as, and logs the follow-up call with _via_next_ask', async () => {
    const h0 = { 'x-forwarded-for': '203.0.113.77', 'user-agent': 'Mozilla/5.0 Safari/605' };
    const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
    expect(JSON.parse(init.body).result.instructions).toMatch(/^For any question about data center markets/);
    const sid = init.headers.get('mcp-session-id');
    const h = { ...h0, 'mcp-session-id': sid };
    await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });

    const first = JSON.parse((await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'get_grid_scoreboard', arguments: {} } })).body).result;
    expect(first.isError).not.toBe(true);
    const sc = first.structuredContent;
    expect(sc.next_ask && sc.next_ask.tool).toBe('get_grid_intelligence');
    expect(sc.cite_as).toMatch(/^DC Hub \(dchub\.cloud\).*, as of \d{4}-\d{2}-\d{2}$/);
    const text = first.content.map((c) => c.text || '').join('\n');
    expect(text).toContain(sc.next_ask.question);

    await post(h, { jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'get_grid_intelligence', arguments: { region_id: 'ERCOT' } } });
    for (let i = 0; i < 40 && !tracked.some((t) => t.tool === 'get_grid_intelligence'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const follow = tracked.find((t) => t.tool === 'get_grid_intelligence');
    const firstRow = tracked.find((t) => t.tool === 'get_grid_scoreboard');
    expect(follow, 'follow-up call was tracked').toBeTruthy();
    const params = typeof follow.params === 'string' ? JSON.parse(follow.params) : follow.params;
    expect(params._via_next_ask).toBe('get_grid_scoreboard');
    const p0 = firstRow && (typeof firstRow.params === 'string' ? JSON.parse(firstRow.params) : firstRow.params);
    expect(p0 && p0._via_next_ask).toBeUndefined();
  }, 60_000);
});
