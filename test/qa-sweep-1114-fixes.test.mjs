// QA sweep 2026-11-14 (v2.12.52), the non-planner findings, measured on the real handler chain over
// the production transport (harness copied from fiber-email-ask.test.mjs: stub backend, app.listen).
//  1. Licence: get_facility / get_infrastructure / search / fetch / search_facilities carried a blanket
//     "License CC-BY-4.0" footer, an in-payload `_cite` and provenance.license of CC-BY-4.0 over
//     composite layers (DATA-LICENSE.md sections 3-4; summarize_for_citation calls that an over-claim).
//     A response the backend itself labels "Mixed" (fiber routes) got the same flat footer.
//  2. The anonymous sweep block opened with an emoji and claimed "~20 other anonymous sessions".
//  3. dchub://methodology said get_gas_index returns an unavailable_reason; it returns the score.
//  4. get_fiber_intel market=northern-virginia was 500 routes / 3.1 MB.
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

const SECRET = 'test-internal-key-not-a-real-secret';
const ENV = { DCHUB_WALL_ISERROR: '0', DCHUB_PREVIEW_ISERROR: '0', DCHUB_INTERNAL_KEY: SECRET };
const CLEAR = ['DCHUB_LEAN_RESPONSES', 'DCHUB_IDENTIFIED_TOOL_DAILY_FULL', 'DCHUB_TRIAL_TOOL_DAILY_FULL'];
const COMPOSITE = 'Mixed — see https://dchub.cloud/data-sources';
const FLAT_FOOTER = 'License CC-BY-4.0: cite this data';
const FLAT_CITE = 'Data: DC Hub (dchub.cloud), CC-BY-4.0';
const EMOJI = /\p{Extended_Pictographic}/u;

// A NoVA-sized fiber answer: 500 routes (the backend's ceiling) of 300 jittered vertices, 2/3 of them
// carrying a 2016 source vintage, the shape measured live on 2026-11-14.
const BIG_ROUTES = 500, BIG_POINTS = 300;
function bigFiber() {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const features = Array.from({ length: BIG_ROUTES }, (_, i) => {
    let x = -77.5 + rnd(), y = 38.8 + rnd();
    const coordinates = Array.from({ length: BIG_POINTS }, () => {
      x += (rnd() - 0.5) * 0.01; y += (rnd() - 0.5) * 0.01;
      return [Number(x.toFixed(6)), Number(y.toFixed(6))];
    });
    const properties = { carrier: i % 3 === 2 ? 'FiberLight' : 'Zayo', name: 'Route ' + i, route_type: 'longhaul',
      distance_km: 50 + i, dchub_ingest_date: '2026-06-20', v: 'published' };
    if (i % 3 !== 2) properties.as_of = '2016';
    return { type: 'Feature', geometry: { type: 'LineString', coordinates }, properties };
  });
  return { type: 'FeatureCollection', total: BIG_ROUTES, _limit: 500, _truncated: true, features,
    provenance: { source: 'DC Hub fiber_routes', license: COMPOSITE, as_of: '2026-05-20' } };
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}

let S, PORT, httpServer, stub;
const prev = {};
beforeAll(async () => {
  const BIG = JSON.stringify(bigFiber());
  await new Promise((resolve) => {
    stub = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://_');
      res.setHeader('content-type', 'application/json');
      const p = url.pathname;
      if (p === '/api/v1/keys/validate') {
        const key = (await readBody(req)).api_key || '';
        res.end(JSON.stringify(key.startsWith('dch_pro_qa')
          ? { valid: true, tier: 'pro', developer_id: 'dev_' + key, email: 'qa@example.com' } : { valid: false, tier: 'free' }));
        return;
      }
      if (p === '/api/v1/fiber/routes') { res.end(BIG); return; }
      if (p.startsWith('/api/v1/facilities/') || p.startsWith('/api/v1/facility/')) {
        res.end(JSON.stringify({ success: true, data: { name: 'QA Ashburn 1', city: 'Ashburn', state: 'VA', slug: 'qa-ashburn-1' } }));
        return;
      }
      if (p === '/api/v1/infrastructure') {
        res.end(JSON.stringify({ success: true, counts: { substations: 2 }, substations: [{ name: 'Sub A', voltage_kv: 230 }] }));
        return;
      }
      if (p === '/api/v1/tax-incentives') {
        res.end(JSON.stringify({ success: true, state: 'VA', programs: [{ name: 'Sales and use tax exemption' }] }));
        return;
      }
      if (p === '/api/v1/mcp/trial-check') { res.end(JSON.stringify({ trial_used: false, prior_calls: 0 })); return; }
      if (p === '/api/v1/mcp/session-key') { res.statusCode = 404; res.end('{}'); return; }
      res.end(JSON.stringify({ success: true, count: 0, data: [], results: [], items: [] }));
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  for (const k of [...Object.keys(ENV), ...CLEAR, 'DCHUB_API_BASE']) prev[k] = process.env[k];
  for (const k of CLEAR) delete process.env[k];
  Object.assign(process.env, ENV, { DCHUB_API_BASE: `http://127.0.0.1:${stub.address().port}` });
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
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
  return { headers: res.headers, body: b, bytes: Buffer.byteLength(raw, 'utf8') };
}
let ipN = 20, rpcId = 10;
async function session(key) {
  const h0 = { 'x-forwarded-for': `198.51.100.${ipN++}`, 'user-agent': 'dchub-qa-readonly', 'x-dchub-qa': '1',
    ...(key ? { 'x-api-key': key } : {}) };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude Code', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = async (tool, args = {}) => {
    const { body, bytes } = await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name: tool, arguments: args } });
    const result = JSON.parse(body).result || {};
    const texts = (result.content || []).map((c) => c.text || '');
    let c0 = null;
    try { c0 = JSON.parse(texts[0]); } catch (_) { c0 = null; }
    return { result, texts, text: texts.join('\n'), c0, sc: result.structuredContent || {}, bytes };
  };
  call.read = async (uri) => JSON.parse((await post(h, { jsonrpc: '2.0', id: rpcId++, method: 'resources/read', params: { uri } })).body);
  return call;
}

describe('1. licence: composite layers carry the per-layer licence, end to end', () => {
  it.each([
    ['get_facility', { facility_id: 'qa-ashburn-1' }],
    ['get_infrastructure', { lat: 39.04, lon: -77.48, radius_km: 10 }],
  ])('%s: footer, _cite, citation and provenance all name the composite licence; no flat grant anywhere', async (tool, args) => {
    const r = await (await session('dch_pro_qa_1'))(tool, args);
    expect(r.c0, 'content[0] stays JSON').toBeTruthy();
    expect(r.text).not.toContain(FLAT_FOOTER);
    expect(r.text).not.toContain(FLAT_CITE);
    expect(r.texts.some((t) => t.startsWith('Source: DC Hub') && t.includes('Licence is per layer (' + COMPOSITE + ')'))).toBe(true);
    expect(r.c0._cite).toContain(COMPOSITE);
    expect(r.c0.provenance.license).toBe(COMPOSITE);
    expect(r.c0.citation.license).toBe(COMPOSITE);
    expect(r.sc.provenance.license).toBe(COMPOSITE);
    expect(r.sc.citation.license).toBe(COMPOSITE);
  });

  it('a response the backend labels composite (fiber routes) gets the composite footer too', async () => {
    const r = await (await session('dch_pro_qa_2'))('get_fiber_intel', { market: 'northern-virginia' });
    expect(r.text).not.toContain(FLAT_FOOTER);
    expect(r.c0._cite).toContain(COMPOSITE);
  });

  it('control: a DC Hub-computed layer (tax incentives) keeps the CC-BY-4.0 footer', async () => {
    const r = await (await session('dch_pro_qa_3'))('get_tax_incentives', { state: 'VA' });
    expect(r.text).toContain(FLAT_FOOTER);
  });
});

describe('2. anonymous sweep block: factual, no emoji, same next steps', () => {
  it('trips after the five signature tools and states only what this session did', async () => {
    const call = await session(null);
    const seq = [['get_agent_registry', {}], ['get_energy_prices', { iso: 'ERCOT' }], ['get_facility', { facility_id: 'qa-ashburn-1' }],
      ['get_fiber_intel', { market: 'dallas' }], ['get_grid_data', { iso: 'ERCOT' }]];
    let r;
    for (const [t, a] of seq) r = await call(t, a);
    expect(r.sc.error).toBe('scraper_pattern_blocked');
    const block = r.texts[0];
    expect(block).toContain('Automated usage detected');
    expect(block).not.toMatch(EMOJI);
    expect(block).not.toMatch(/~\s*\d+|other anonymous sessions|this week/);
    for (const name of ['get_agent_registry', 'get_energy_prices', 'get_facility', 'get_fiber_intel', 'get_grid_data']) {
      expect(block).toContain(name);
    }
    expect(block).toContain('partner@dchub.cloud');
    expect(block).toContain('Anonymous sweep blocked. Re-enable instantly with any X-API-Key.');
  });
});

describe('2b. human-facing copy carries no emoji', () => {
  it('the Deal Desk Brief link a human clicks', () => {
    const relay = S._dealDeskHumanRelay({ pdf_url: 'https://dchub.cloud/deal-desk/x.pdf' });
    expect(relay.markdown).toBe('[Open the DC Hub Deal Desk Brief](https://dchub.cloud/deal-desk/x.pdf)');
  });
});

describe('3. dchub://methodology matches what get_gas_index serves', () => {
  it('says the DCGI score and verdict are returned, keeps both correction dates, no withdrawal claim', async () => {
    const out = await (await session(null)).read('dchub://methodology');
    const text = out.result.contents[0].text;
    expect(text).not.toMatch(/no longer published|unavailable_reason/);
    expect(text).toMatch(/`get_gas_index` returns the score and verdict/);
    expect(text).toMatch(/GAS-ADVANTAGED/);
    expect(text).toMatch(/2026-08-08/);
    expect(text).toMatch(/restored 2026-08-30/);
  });
});

describe('4. get_fiber_intel: a 500-route answer fits one result and says what it cut', () => {
  it('the whole tool result is under 300 KB, with counts, omitted routes and how to get more', async () => {
    const r = await (await session('dch_pro_qa_4'))('get_fiber_intel', { market: 'northern-virginia' });
    expect(r.bytes).toBeLessThan(300_000);
    const t = r.c0.payload_trim;
    expect(t.routes_received).toBe(BIG_ROUTES);
    expect(t.routes_returned).toBe(r.c0.features.length);
    expect(t.routes_returned).toBeGreaterThan(0);
    expect(t.routes_returned + t.routes_omitted).toBe(BIG_ROUTES);
    expect(t.vertices_received).toBe(BIG_ROUTES * BIG_POINTS);
    expect(t.how_to_get_more).toContain('https://dchub.cloud/api/v1/fiber/routes?market=northern-virginia');
    expect(t.routes_received_by_carrier).toEqual({ Zayo: 334, FiberLight: 166 });
  });
  it('an answer under budget keeps every route and vertex untouched (shapeFiberPayload)', async () => {
    const { shapeFiberPayload } = await import('../lib/fiber-payload.mjs');
    const small = { type: 'FeatureCollection', total: 2, features: [0, 1].map((i) => ({ type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-97.123456, 32.1], [-97.2, 32.1], [-97.3, 32.1]] },
      properties: { carrier: 'C' + i } })) };
    const out = shapeFiberPayload(small);
    expect(out.features).toEqual(small.features);
    expect(out.payload_trim).toBeUndefined();
  });
  it('labels 2016 source-vintage routes and counts them over every route received', async () => {
    const r = await (await session('dch_pro_qa_5'))('get_fiber_intel', { market: 'northern-virginia' });
    expect(r.c0.source_vintage.by_as_of).toEqual({ 2016: 334, unstated: 166 });
    const dated = r.c0.features.filter((f) => f.properties.as_of === '2016');
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.every((f) => f.properties.as_of_kind === 'source_vintage')).toBe(true);
  });
});
