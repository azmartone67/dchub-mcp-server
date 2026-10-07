// The anonymous inline-full (granted free answer) path returned the rows only in
// content[0].text; structuredContent carried flags and offers but no data, so a
// client that reads structuredContent got an empty envelope, and the contract
// wrapper stamped completeness "full, withheld []" over rows whose score and
// total_mw were trimmed. Driven through the real POST /mcp handler against a
// 127.0.0.1 stub backend (no egress; asserted).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import { computeCompleteness } from '../lib/paywall-contract.mjs';

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

const decode = (raw) => (raw.includes('data: ')
  ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw);

let stub, httpServer, S, PORT, prev = {};
beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const u = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const send = (c, o) => { res.statusCode = c; res.end(JSON.stringify(o)); };
        if (u.pathname.includes('auto-mint')) {
          return send(200, { ok: true, api_key: 'dch_trial_TESTONLY00000000000000000000', tier: 'free', days_remaining: 7 });
        }
        if (u.pathname === '/api/v1/mcp/tools/rank_markets') {
          return send(200, { criteria: 'best_overall', region: 'us', result_count: 3,
            results: [1, 2, 3].map((i) => ({ rank: i, market: 'm' + i, city: 'City' + i,
              facility_count: 10 * i, operator_count: i, total_mw: 100 * i, score: 50 * i })) });
        }
        send(404, { error: 'not found', path: u.pathname });
      });
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['DCHUB_API_BASE', 'DCHUB_MINT_SKIP_INTERNAL']) prev[k] = process.env[k];
  process.env.DCHUB_MINT_SKIP_INTERNAL = '0';       // the harness would otherwise be skipped as internal
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});
afterAll(async () => {
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  net.Socket.prototype.connect = realConnect;
});

async function firstCall() {
  const H = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'x-forwarded-for': '203.0.113.' + (10 + Math.floor(Math.random() * 200)) };
  const post = (headers, body) => fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
  const init = await post(H, { jsonrpc: '2.0', id: 0, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '1' } } });
  const sid = init.headers.get('mcp-session-id'); await init.text();
  const H2 = { ...H, 'mcp-session-id': sid };
  await (await post(H2, { jsonrpc: '2.0', method: 'notifications/initialized' })).text();
  const res = await post(H2, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'rank_markets', arguments: {} } });
  const r = JSON.parse(decode(await res.text())).result || {};
  return { r, sc: r.structuredContent || {}, text: (r.content || []).map((c) => c.text || '') };
}

describe('anonymous inline-full answer carries its rows in structuredContent', () => {
  it('is the inline-full branch, and the rows are in BOTH channels', async () => {
    const { sc, text } = await firstCall();
    expect(sc.inline_full, 'not the inline-full branch — the assertions below would be vacuous').toBe(true);
    expect(text[0]).toContain('"market":"m1"');
    expect(Array.isArray(sc.results)).toBe(true);
    expect(sc.results.map((x) => x.market)).toEqual(['m1', 'm2', 'm3']);
    // envelope keys survive beside the data
    expect(sc.trial_taste).toBe(true);
    expect(typeof sc.auto_trial_key).toBe('string');
  });
  it('made no foreign connection', () => { expect(foreign).toEqual([]); });
});

describe('computeCompleteness reads row-level _in_pro markers', () => {
  const rows = (extra) => [1, 2].map((i) => ({ rank: i, market: 'm' + i, ...extra }));
  it('trimmed rows are partial and name the withheld fields', () => {
    const c = computeCompleteness({ trial_taste: true }, { results: rows({ total_mw: null, score: null, _total_mw_in_pro: true, _score_in_pro: true }) });
    expect(c.status).toBe('partial');
    expect([...c.withheld].sort()).toEqual(['score', 'total_mw']);
  });
  it('control: untrimmed rows stay full', () => {
    const c = computeCompleteness({ trial_taste: true }, { results: rows({ total_mw: 100, score: 50 }) });
    expect(c.status).toBe('full');
    expect(c.withheld).toEqual([]);
  });
});
