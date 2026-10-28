// keyless-full-trial-http.test.mjs — the keyless full-answer trial over the real HTTP surfaces.
// test/keyless-full-trial.test.mjs pins the behaviour per caller seat; this pins the paths, where
// the profile, the QA header and the response filters are decided:
//   * /mcp, /mcp/claude: a keyless get_grid_data is the full answer with the flag on, the preview
//     with it off;
//   * /mcp/core: grid_power include=telemetry delegates get_grid_data and is charged; with X-DCHub-QA: 1 it is not;
//   * /mcp with X-DCHub-QA: 1 or UA dchub-qa-readonly: the preview, nothing charged;
//   * /mcp/chatgpt (frozen during the OpenAI review): byte-identical with the flag on and off, for
//     all three tools, and nothing charged.
// Real handler over loopback HTTP, a 127.0.0.1 stub backend, off-loopback connects refused.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
process.env.DCHUB_TOP_METROS_FREE = '0';
process.env.DCHUB_LEAN_RESPONSES = '0';

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

const SECRET = 'keyless-full-trial-http-internal-key-not-real';
const GI = {
  demand_mw: 95021, demand_period: '2026-10-07T23', generation_mix: { COL: { mw: 13136 }, NG: { mw: 33582 } },
  peak_mw: 95021, min_mw: 74723,
  demand_24h: Array.from({ length: 8 }, (_, i) => ({ period: `2026-10-07T${String(i + 1).padStart(2, '0')}`, mw: 80000 + i * 500 })),
};
const PHX = { id: 1346, market_slug: 'phoenix', market_name: 'Phoenix', state: 'AZ', iso: 'WECC', verdict: 'CAUTION',
  excess_power_score: 58.2, constraint_score: 62.1, composite_score: 41.9, time_to_power_months: 42.5, avg_kwh_cents: '13.024' };
const FACILITY = { id: 'fac_77', slug: 'trial-dc-77', name: 'Trial DC 77', operator: 'Equinix', provider: 'Equinix',
  city: 'Phoenix', state: 'AZ', country: 'US', market: 'phoenix', status: 'operational',
  latitude: 33.451234, longitude: -112.071234, power_mw: 48.5 };
const ARGS = { get_grid_data: { iso: 'PJM' }, get_facility: { facility_id: 'trial-dc-77' }, get_market_dcpi_rank: { market_slug: 'phoenix' } };

let S, PORT, httpServer, stub, prevBase, prevSecret;
const consumes = [];
const tracks = [];
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
      const send = (o) => res.end(JSON.stringify(o));
      if (p === '/api/v1/keys/validate') return send({ valid: false, tier: 'free' });
      if (p === '/api/v1/mcp/full-cap/consume') { consumes.push(await readBody(req)); return send({ ok: false }); }
      if (p === '/api/v1/mcp/full-cap/peek') return send({ ok: false });
      if (p === '/api/v1/mcp/track') { tracks.push(await readBody(req)); return send({ ok: true }); }
      if (p === '/api/v1/mcp/trial-check') return send({ trial_used: false, prior_calls: 0 });
      if (p.startsWith('/api/v1/mcp/credits/balance')) return send({ credits: 0, had_pack: false });
      if (p.startsWith('/api/v1/grid/intelligence/')) return send(GI);
      if (p.startsWith('/api/v1/dcpi/scores/')) return send(PHX);
      if (p.startsWith('/api/v1/facilities/') || p.startsWith('/api/v1/facility/')) return send(FACILITY);
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  S = await import('../server.mjs');
  prevSecret = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  await new Promise((resolve) => { httpServer = S.app.listen(0, '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);
afterEach(() => { delete process.env.DCHUB_KEYLESS_FULL_TRIAL; });
afterAll(async () => {
  if (prevSecret === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevSecret;
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
  net.Socket.prototype.connect = realConnect;
});

let ipN = 1;
let rpcId = 1;
async function rpc(path, name, args, { ip = null, headers = {} } = {}) {
  const addr = ip || `198.51.100.${ipN++}`;
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'user-agent': 'cursor/1.0', 'x-forwarded-for': addr, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  const result = (JSON.parse(b) || {}).result || {};
  return { result, text: (result.content || []).map((c) => c.text || '').join('\n'), addr };
}
const kft = () => consumes.filter((w) => String(w.identity || '').startsWith('kft:'));
const settle = () => new Promise((r) => setTimeout(r, 50));
const FULL = '"demand_mw":95021';
function norm(r, addr) {
  return JSON.stringify(r.result).split(addr).join('IP')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, 'TS')
    .replace(/\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]+/g, '/upgrade/h/TOKEN');
}

describe('the paths in the trial', () => {
  for (const path of ['/mcp', '/mcp/claude']) {
    it(`${path}: keyless get_grid_data is full with the flag on, the preview with it off`, async () => {
      const off = await rpc(path, 'get_grid_data', ARGS.get_grid_data);
      expect(off.text, 'flag off: the preview').not.toContain(FULL);
      process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
      const before = kft().length;
      const on = await rpc(path, 'get_grid_data', ARGS.get_grid_data);
      expect(on.text, 'flag on: the free key answer').toContain(FULL);
      expect(kft().length).toBe(before + 1);
      await settle();
      expect(tracks.some((t) => t.tool === 'get_grid_data' && t.status === 'keyless_full_trial' && t.keyless_full_trial === true)).toBe(true);
    });
  }
  it('/mcp/core: grid_power charges the trial; with X-DCHub-QA: 1 it charges nothing', async () => {
    process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
    let before = kft().length;
    await rpc('/mcp/core', 'grid_power', { iso: 'PJM', include: ['telemetry'] });
    const charged = kft().slice(before).filter((w) => w.tool === 'get_grid_data');
    expect(charged.length, 'the delegated get_grid_data was a trial answer').toBe(1);
    before = kft().length;
    await rpc('/mcp/core', 'grid_power', { iso: 'PJM', include: ['telemetry'] }, { headers: { 'x-dchub-qa': '1' } });
    expect(kft().slice(before)).toEqual([]);
  });
});

describe('QA callers on /mcp', () => {
  for (const [label, headers] of [['X-DCHub-QA: 1', { 'x-dchub-qa': '1' }], ['UA dchub-qa-readonly', { 'user-agent': 'dchub-qa-readonly/1.0' }]]) {
    it(`${label}: the preview, nothing charged, nothing tagged`, async () => {
      process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
      const before = kft().length;
      const nt = tracks.length;
      const r = await rpc('/mcp', 'get_grid_data', ARGS.get_grid_data, { headers });
      expect(r.text).not.toContain(FULL);
      await settle();
      expect(kft().length).toBe(before);
      expect(tracks.slice(nt).filter((t) => t.status === 'keyless_full_trial')).toEqual([]);
    });
  }
  it('no header turns on the QA override (it is a test-only ctx field)', async () => {
    process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
    const r = await rpc('/mcp', 'get_grid_data', ARGS.get_grid_data, {
      headers: { 'x-dchub-qa': '1', 'keyless-full-trial-qa-override': 'true', 'x-keyless-full-trial-qa-override': 'true' } });
    expect(r.text).not.toContain(FULL);
  });
});

describe('/mcp/chatgpt is unaffected', () => {
  for (const tool of Object.keys(ARGS)) {
    it(`${tool}: byte-identical with the flag on and off, nothing charged`, async () => {
      const ip = `198.51.100.${200 + Object.keys(ARGS).indexOf(tool)}`;
      const off = await rpc('/mcp/chatgpt', tool, ARGS[tool], { ip, headers: { 'user-agent': 'openai-mcp/1.0.0' } });
      process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
      const before = kft().length;
      const on = await rpc('/mcp/chatgpt', tool, ARGS[tool], { ip, headers: { 'user-agent': 'openai-mcp/1.0.0' } });
      expect(norm(on, ip)).toBe(norm(off, ip));
      expect(kft().length).toBe(before);
    });
  }
  it('the comparison is not vacuous: /mcp/chatgpt served the grid preview', async () => {
    process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
    const r = await rpc('/mcp/chatgpt', 'get_grid_data', ARGS.get_grid_data, { headers: { 'user-agent': 'openai-mcp/1.0.0' } });
    expect(r.text.length).toBeGreaterThan(50);
    expect(r.text).not.toContain(FULL);
  });
  it('no off-loopback connection was attempted', () => { expect(foreign).toEqual([]); });
});
