// starter-prompts-1124.test.mjs: real handler over HTTP, local stub backend, no network.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
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

const FLAG = 'DCHUB_PROMPTS_LEAN_V1';
const tracked = [];
let S, PORT, httpServer, stub, prevBase;

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url.startsWith('/api/v1/mcp/track')) {
          try { tracked.push(JSON.parse(b || '{}')); } catch (_) {}
          res.end('{"ok":true}');
          return;
        }
        if (req.url.startsWith('/api/v1/keys/validate')) { res.end(JSON.stringify({ valid: false, tier: 'free' })); return; }
        if (req.url.startsWith('/api/v1/mcp/session-key')) { res.statusCode = 404; res.end('{}'); return; }
        res.end(JSON.stringify({ success: true, data: [] }));
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

afterEach(() => { delete process.env[FLAG]; });

afterAll(async () => {
  delete process.env[FLAG];
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  await new Promise((r) => (stub ? stub.close(r) : r()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
  expect(foreign).toEqual([]);
});

async function post(path, body, headers = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const data = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  let json = null;
  try { json = JSON.parse(data); } catch (_) {}
  return { status: res.status, headers: res.headers, raw, json };
}

async function session(name, { ua = 'node', path = '/mcp' } = {}) {
  const init = await post(path, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1.0' } } }, { 'user-agent': ua });
  const sid = init.headers.get('mcp-session-id');
  const h = { 'user-agent': ua, ...(sid ? { 'mcp-session-id': sid } : {}) };
  await post(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, h);
  return {
    sid,
    list: async () => ((await post(path, { jsonrpc: '2.0', id: 2, method: 'prompts/list', params: {} }, h)).json?.result?.prompts || []),
    get: async (pn, args = {}) => (await post(path, { jsonrpc: '2.0', id: 3, method: 'prompts/get', params: { name: pn, arguments: args } }, h)).json,
  };
}


// 2026-11-24 (owner): four starter prompts on plain /mcp, each one's message tells the model to call execute_plan with
// the user's intent. Three reuse existing names (pick-a-market, power-availability, compare-markets), so prompts/get
// keeps resolving them; dcpi-verdict is new. The lean five for light-list sessions do not change.
const STARTERS = [
  ['pick-a-market', 'Rank markets for a 200 MW AI campus', {}, 'rank markets for a 200 MW AI campus'],
  ['power-availability', 'How much power is available in ERCOT for a 100 MW data center', {}, 'how much power is available in ERCOT for a 100 MW data center'],
  ['compare-markets', 'Compare Dallas vs Phoenix for a GPU cluster', {}, 'compare Dallas vs Phoenix for a GPU cluster'],
  ['dcpi-verdict', 'Data Center Power Index (DCPI) verdict for my market', { market: 'dallas' }, 'Data Center Power Index (DCPI) verdict for dallas'],
];
const textOf = (r) => r && r.result && r.result.messages && r.result.messages[0] && r.result.messages[0].content.text;

describe('starter prompts on plain /mcp (2026-11-24)', () => {
  it('prompts/list carries the four starter titles, each once, and keeps the other prompts', async () => {
    delete process.env[FLAG];
    const list = await (await session('claude-ai')).list();
    for (const [name, title] of STARTERS) {
      const hits = list.filter((p) => p.title === title);
      expect(hits.map((p) => p.name), title).toEqual([name]);
    }
    expect(list.length).toBeGreaterThanOrEqual(16);
    expect(list.map((p) => p.name)).toEqual(expect.arrayContaining(['analyze-site', 'site-report', 'fiber-plan', 'market_selection', 'grid_and_queue']));
  });

  it('each starter, called with no or minimal arguments, tells the model to call execute_plan with that intent', async () => {
    const s = await session('claude-ai');
    for (const [name, , args, intent] of STARTERS) {
      const t = textOf(await s.get(name, args));
      expect(t, name).toBe(`Call the DC Hub execute_plan tool with intent set to: "${intent}".`
        + ' Answer from its result and lead with the Data Center Power Index (DCPI) verdict when it carries one.'
        + ' Quote each figure with its as_of date and cite "DC Hub (dchub.cloud)". Report any factor returned as unavailable as unknown; never estimate it.');
    }
  });

  it('old arguments still shape the intent, and a quote in an argument cannot close the intent string', async () => {
    const s = await session('claude-ai');
    expect(textOf(await s.get('pick-a-market', { capacity_mw: '300', region: 'TX', max_months: '24' })))
      .toContain('intent set to: "rank markets for a 300 MW AI campus in TX with power within 24 months".');
    expect(textOf(await s.get('power-availability', { iso: 'PJM', capacity_mw: '250' })))
      .toContain('intent set to: "how much power is available in PJM for a 250 MW data center".');
    expect(textOf(await s.get('compare-markets', { markets: 'northern-virginia, columbus,atlanta' })))
      .toContain('intent set to: "compare northern-virginia vs columbus vs atlanta for a GPU cluster".');
    const q = textOf(await s.get('dcpi-verdict', { market: 'dal"las' }));
    expect(q).toContain('intent set to: "Data Center Power Index (DCPI) verdict for dal\'las".');
  });

  it('dcpi-verdict with no market asks for one, then names execute_plan', async () => {
    const t = textOf(await (await session('claude-ai')).get('dcpi-verdict', {}));
    expect(t.startsWith('Ask the user which data center market they mean, then call the DC Hub execute_plan tool')).toBe(true);
  });

  it('the lean five are unchanged for a light-list session (flag on)', async () => {
    process.env[FLAG] = '1';
    const names = (await (await session('codex-mcp-client')).list()).map((p) => p.name);
    expect(names).toEqual(['ask-dc-hub', 'site', 'market', 'grid-and-queue', 'what-changed']);
  });
});
