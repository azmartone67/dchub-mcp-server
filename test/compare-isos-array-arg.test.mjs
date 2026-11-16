// Grok Note K item 6a (2026-11-15): compare_isos takes `isos` as a string OR an array, through the
// real MCP server. Before: `{"isos":["ERCOT","PJM","MISO"]}` answered JSON-RPC -32602 (the schema was
// string-only) and agents send arrays naturally. The advertised schema must stay `type: string`: the
// /mcp/chatgpt catalog is frozen (test/chatgpt-toolset-frozen) and shares this inputSchema.
//
// HARD gate: deterministic; its only network is two 127.0.0.1 listeners (a stub backend + the app).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';

const K_PRO = 'dch_live_cmpisoarr_pro0001';
const ENV_KEYS = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY'];
const prevEnv = {};
const QSNAP = { by_iso: [
  { iso: 'ERCOT', queue_kind: 'large_load', queued_load_total_gw: 474.0, queued_generation_gw: 461.4,
    queued_generation_gw_as_of: '2026-10-31', source_as_of: '2026-10-31', source_as_of_basis: 'published_report',
    source_report: 'ERCOT GIS Report, October 2026 (posted 2026-11-02), Summary sheet (generation queue); ERCOT Senate presentation Jul 29 2026, June 2026 data (large load)' },
  { iso: 'PJM', queue_kind: 'generation_queue', queued_generation_gw: 373.6, queued_generation_gw_as_of: null,
    source_as_of: '2026-11-15', source_as_of_basis: 'live_feed_fetch_date', fetched_at: '2026-11-15T06:00:51Z',
    source_name: 'PJM cycle + serial service request status (active generation requests, sum of MFO)' },
  { iso: 'MISO', queue_kind: 'generation_queue', queued_generation_gw: 260.0, queued_generation_gw_as_of: null,
    source_as_of: '2026-11-15', source_as_of_basis: 'live_feed_fetch_date', fetched_at: '2026-11-15T06:00:52Z',
    source_name: 'MISO GI Queue API (applicationStatus=Active, summer MW)' },
] };

let S, PORT, httpServer, stub;

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
      if (url.pathname === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key === K_PRO ? { valid: true, tier: 'pro', developer_id: 'dev_cmpisoarr' } : { valid: false, tier: 'free' }));
        return;
      }
      if (url.pathname === '/api/v1/interconnection-queue/snapshot') { res.end(JSON.stringify(QSNAP)); return; }
      if (url.pathname === '/api/v1/dcpi/iso-comparison') { res.end(JSON.stringify({ isos: [] })); return; }
      const gi = url.pathname.match(/^\/api\/v1\/grid\/intelligence\/([A-Za-z-]+)$/);
      if (gi) {
        res.end(JSON.stringify({ iso: gi[1].toUpperCase(), demand_mw: 50000, demand_period: '2026-11-15T10',
          generation_mix_period: '2026-11-15T06', generation_mix: { NG: 20000, WND: 10000 } }));
        return;
      }
      res.end('{}');
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const k of ENV_KEYS) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const json = raw.includes('data: ')
    ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : raw;
  return { headers: res.headers, body: json.trim() ? JSON.parse(json) : null };   // a notification answers 202, empty
}

async function session(key) {
  const headers = key ? { 'x-api-key': key } : {};
  const init = await post(headers, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cmp-iso-array-test', version: '1.0' } } });
  const h = { ...headers, 'mcp-session-id': init.headers.get('mcp-session-id') };
  await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return h;
}

async function call(args) {
  const h = await session(K_PRO);
  const { body } = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'compare_isos', arguments: args } });
  return body;
}

describe('compare_isos isos: string or array', () => {
  it('an array of codes is answered, not refused with -32602', async () => {
    const body = await call({ isos: ['ERCOT', 'PJM', 'MISO'] });
    expect(body.error, JSON.stringify(body.error || {})).toBeUndefined();
    const sc = body.result.structuredContent;
    expect(sc.isos).toEqual(['ERCOT', 'PJM', 'MISO']);
    expect(Object.keys(sc.comparison)).toEqual(['ERCOT', 'PJM', 'MISO']);
  });
  it('the comma-separated string answers the same', async () => {
    const sc = (await call({ isos: 'ERCOT,PJM,MISO' })).result.structuredContent;
    expect(sc.isos).toEqual(['ERCOT', 'PJM', 'MISO']);
  });
  it('a non-string, non-array value is still refused', async () => {
    const body = await call({ isos: 5 });
    const refused = !!body.error || (body.result && body.result.isError === true);
    expect(refused).toBe(true);
  });
  it('the advertised inputSchema stays type string', async () => {
    const h = await session(null);
    const { body } = await post(h, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
    let tools = body.result.tools;
    let cursor = body.result.nextCursor;
    while (cursor) {
      const more = (await post(h, { jsonrpc: '2.0', id: 4, method: 'tools/list', params: { cursor } })).body.result;
      tools = tools.concat(more.tools); cursor = more.nextCursor;
    }
    const t = tools.find((x) => x.name === 'compare_isos');
    expect(t, 'compare_isos not listed on /mcp').toBeTruthy();
    expect(t.inputSchema.properties.isos.type).toBe('string');
    expect(t.inputSchema.required).toEqual(['isos']);
  });
  it('each ISO names which queue its queue figure comes from, and its date', async () => {
    const cmp = (await call({ isos: ['ERCOT', 'PJM', 'MISO'] })).result.structuredContent.comparison;
    expect(cmp.ERCOT.queue_depth_basis).toBe('generation_queue');
    expect(cmp.ERCOT.queue_depth_as_of).toBe('2026-10-31');
    expect(cmp.ERCOT.queue_kinds_note).toMatch(/LARGE-LOAD/);
    for (const iso of ['PJM', 'MISO']) {
      expect(cmp[iso].queue_depth_as_of, iso).toBe(null);
      expect(cmp[iso].queue_depth_as_of_basis, iso).toMatch(/^none_published/);
      expect(cmp[iso].queue_depth_collected_at, iso).toMatch(/^2026-11-15T06:00:5/);
    }
  });
});
