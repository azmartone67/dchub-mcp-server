// keyless-first-full.test.mjs — one full answer a day before any wall, keyless (owner 2026-11-14, Grok S1/S2;
// lib/keyless-first-full.mjs, flag DCHUB_KEYLESS_FIRST_FULL, default OFF).
//
// Real /mcp handler over loopback HTTP, a 127.0.0.1 stub backend that records the counter writes and the track
// rows, off-loopback connects refused. Pins:
//   1) flag OFF: every lane tool's first keyless call is today's preview, nothing is charged, no meter, and the
//      relay line says what it said before ("free-tier limit");
//   2) flag ON: the first keyless call of get_grid_intelligence / get_interconnection_queue / get_energy_prices /
//      get_grid_data is the full answer with one meter, tagged keyless_first_full, charged once on 'kff:'; the
//      second call is the preview and only THEN says "free-tier limit"; a first-call preview elsewhere does not;
//   3) flag ON, execute_plan: the first plan runs its grid/queue steps in full (tagged keyless_first_full_step,
//      charging nothing of their own), leads with `answer`, never headlines "not measurable", and the whole tool
//      result is under 15,000 bytes; the second plan is today's (large, preview-step) answer;
//   4) QA callers and /mcp/chatgpt (frozen) are untouched: byte-identical with the flag on and off;
//   5) the first-plan step token: single use, unknown tokens refused, a header from a caller does nothing.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
process.env.DCHUB_TOP_METROS_FREE = '0';

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

const SECRET = 'keyless-first-full-test-internal-key-not-real';
// Fixtures: shaped like the live backend reads (2026-11-14), sized so an unshaped plan answer is far over budget.
const GI = {
  iso: 'PJM', demand_mw: 93825, demand_period: '2026-11-14T06',
  generation_mix: { NG: { mw: 33582 }, NUC: { mw: 31010 }, COL: { mw: 13136 }, WND: { mw: 4100 } },
  peak_mw: 95021, min_mw: 74723,
  demand_24h: Array.from({ length: 24 }, (_, i) => ({ period: `2026-11-13T${String(i).padStart(2, '0')}`, mw: 80000 + i * 400 })),
};
const QUEUE = {
  iso: 'PJM', queued_generation_gw: 373.6, project_count: 1242, source_as_of: '2026-11-14', refresh_cadence: 'daily',
  projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: 'AF2-' + (100 + i), name: 'Generation project number ' + i + ' in the PJM serial queue',
    mw: 100 + i * 7, fuel: i % 2 ? 'Solar' : 'Storage', status: 'Active', county: 'Loudoun', state: 'VA', requested_cod: '2028-06-01' })),
};
const REFINED = {
  count_total_matching: 1174, count_returned: 50, source_as_of: '2026-11-14',
  results: Array.from({ length: 50 }, (_, i) => ({ candidate_id: 'cand_' + i, name: 'Refined queue survivor ' + i, iso: 'PJM', state: 'VA',
    capacity_mw: 150 + i, fuel: 'Solar', status: 'Active', estimated_ttp_months: null, county: 'Prince William', poi: 'Substation ' + i })),
};
const ENERGY = { retail_rates: { avg_cents_kwh: 9.87, min_cents_kwh: 7.1, max_cents_kwh: 14.2, latest_period: '2026-08', states_covered: 14 },
  avg_rate_kwh: 0.0987, retail_rate_kwh: 0.0987, industrial_rate_kwh: 0.0712, natural_gas_usd_mmbtu: 3.21,
  natural_gas: { period: '2026-11-12', as_of: '2026-11-13' } };

const LANE = {
  get_grid_intelligence: { region_id: 'PJM' },
  get_interconnection_queue: { iso: 'PJM' },
  get_energy_prices: { iso: 'PJM' },
  get_grid_data: { iso: 'PJM' },
};
// A data marker each FULL answer carries and its preview does not.
const FULL_MARK = {
  get_grid_intelligence: '"NUC":31010',
  get_interconnection_queue: 'AF2-110',
  get_energy_prices: '"industrial_rate_kwh":0.0712',
  get_grid_data: '"period":"2026-11-13T10"',
};
const PLAN = { intent: 'how soon can a 100 MW load get power in PJM' };

let S, PORT, httpServer, stub;
const consumes = [];
const tracks = [];
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });
}
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
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
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/sources/') || p.startsWith('/api/v1/keys/')) return send({ ok: true });
      if (p.startsWith('/api/v1/grid/intelligence/') || p.startsWith('/api/v1/grid/')) return send(GI);
      if (p === '/api/v1/interconnection-queue/refined') return send(REFINED);
      if (p.startsWith('/api/v1/interconnection-queue/')) return send(QUEUE);
      if (p === '/api/v1/energy/summary') return send(ENERGY);
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  // execute_plan's steps loop back to 127.0.0.1:PORT, read once at import.
  process.env.PORT = String(await freePort());
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
}, 60_000);
afterEach(() => { delete process.env.DCHUB_KEYLESS_FIRST_FULL; });
afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  net.Socket.prototype.connect = realConnect;
});

let ipN = 1;
let rpcId = 1;
const nextIp = () => `198.51.100.${ipN++}`;
async function rpc(path, name, args, { ip, headers = {} } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'user-agent': 'cursor/1.0', 'x-forwarded-for': ip || nextIp(), ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  const result = (JSON.parse(b) || {}).result || {};
  return { result, all: JSON.stringify(result), text: (result.content || []).map((c) => c.text || '').join('\n'),
    bytes: Buffer.byteLength(JSON.stringify(result), 'utf8') };
}
const kff = () => consumes.filter((w) => String(w.identity || '').startsWith('kff:'));
const settle = () => new Promise((r) => setTimeout(r, 60));
const LIMIT = /free-tier limit/;
function norm(r, ip) {
  return r.all.split(ip).join('IP')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, 'TS')
    .replace(/\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]+/g, '/upgrade/h/TOKEN')
    .replace(/\/u\/[A-Za-z0-9]+/g, '/u/SHORT')
    .replace(/\\?"(ms|duration_ms|elapsed_ms)\\?":\d+/g, '"$1":N');
}

describe('flag OFF (the default): today\'s path', () => {
  for (const tool of Object.keys(LANE)) {
    it(`${tool}: the keyless first call is the preview, nothing charged, no meter, the old relay line`, async () => {
      const before = kff().length;
      const r = await rpc('/mcp', tool, LANE[tool]);
      expect(r.all).not.toContain(FULL_MARK[tool]);
      expect(r.all).not.toContain('first_full_answer');
      expect(r.all).toMatch(LIMIT);
      expect(kff().length).toBe(before);
    });
  }
  it('execute_plan: steps are previews, no `answer` lead, no first-answer shaping', async () => {
    const r = await rpc('/mcp', 'execute_plan', PLAN);
    const sc = r.result.structuredContent || {};
    expect(sc.answer).toBeUndefined();
    expect(sc.shaped_for_first_answer).toBeUndefined();
    expect(sc.executed.filter((e) => e.tool === 'get_grid_intelligence').map((e) => e.status)).toEqual(['gated_preview']);
    expect(r.bytes, 'the unshaped plan answer is over the first-answer budget (control)').toBeGreaterThan(15_000);
  });
});

describe('flag ON: the four single tools', () => {
  for (const tool of Object.keys(LANE)) {
    it(`${tool}: call 1 is full with one meter and charged once; call 2 is the preview and says free-tier limit`, async () => {
      process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
      const ip = nextIp();
      const before = kff().length;
      const nt = tracks.length;
      const one = await rpc('/mcp', tool, LANE[tool], { ip });
      expect(one.all, 'the full answer').toContain(FULL_MARK[tool]);
      expect(one.result.isError).not.toBe(true);
      const meter = (one.result.structuredContent || {}).first_full_answer;
      expect(meter).toMatchObject({ call: 1, of: 1, remaining_today: 0, allowance: 'keyless_first_full' });
      expect(one.all, 'no limit was hit on call 1').not.toMatch(LIMIT);
      const charged = kff().slice(before);
      expect(charged.map((w) => w.tool)).toEqual([tool]);
      expect(charged[0].cap).toBe(1);
      await settle();
      expect(tracks.slice(nt).some((t) => t.tool === tool && t.status === 'keyless_first_full' && t.keyless_first_full === true)).toBe(true);

      const two = await rpc('/mcp', tool, LANE[tool], { ip });
      expect(two.all, 'the preview').not.toContain(FULL_MARK[tool]);
      expect(two.all).not.toContain('first_full_answer');
      expect(two.all, 'a limit WAS hit on call 2').toMatch(LIMIT);
      expect(kff().slice(before).length, 'call 2 charged nothing').toBe(1);
    });
  }
  it('the day is per caller IP: another IP gets its own first answer', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    const a = await rpc('/mcp', 'get_grid_intelligence', LANE.get_grid_intelligence);
    const b = await rpc('/mcp', 'get_grid_intelligence', LANE.get_grid_intelligence);
    expect(a.all).toContain(FULL_MARK.get_grid_intelligence);
    expect(b.all).toContain(FULL_MARK.get_grid_intelligence);
  });
  it('a first-call preview that hit no limit does not say "free-tier limit" (QA caller, not seated)', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    const r = await rpc('/mcp', 'get_interconnection_queue', LANE.get_interconnection_queue, { headers: { 'user-agent': 'dchub-qa-readonly/1.0' } });
    expect(r.all).not.toContain(FULL_MARK.get_interconnection_queue);
    expect(r.all).not.toMatch(LIMIT);
    expect(r.all).toContain('with some fields held back at its access level');
  });
});

describe('flag ON: execute_plan', () => {
  it('the first plan: full steps, a direct answer first, no "not measurable" headline, under 15,000 bytes', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    const ip = nextIp();
    const before = kff().length;
    const nt = tracks.length;
    const r = await rpc('/mcp', 'execute_plan', PLAN, { ip });
    expect(r.bytes).toBeLessThanOrEqual(15_000);
    const block0 = JSON.parse(r.result.content[0].text);
    expect(Object.keys(block0)[0]).toBe('answer');
    expect(Object.keys(r.result.structuredContent)[0]).toBe('answer');
    expect(block0.answer).not.toMatch(/not measurable/i);
    expect(block0.answer).toMatch(/374 GW of generation in the interconnection queue/);
    expect(block0.as_of).toBeTruthy();
    expect(block0.cite_as).toMatch(/DC Hub/);
    if (block0.intent_answer) expect(block0.intent_answer.headline).not.toMatch(/not measurable/i);
    const st = Object.fromEntries(block0.executed.map((e) => [e.tool, e.status]));
    expect(st.get_grid_intelligence).toBe('executed');
    expect(st.get_interconnection_queue).toBe('executed');
    expect(block0.first_full_answer).toMatchObject({ allowance: 'keyless_first_full' });
    expect(r.text).toMatch(/^Source: /m);
    // Charged once, on the plan; its steps spent nothing of their own.
    expect(kff().slice(before).map((w) => w.tool)).toEqual(['execute_plan']);
    await settle();
    const rows = tracks.slice(nt);
    expect(rows.filter((t) => t.tool === 'execute_plan' && t.status === 'keyless_first_full')).toHaveLength(1);
    expect(rows.filter((t) => t.status === 'keyless_first_full_step').map((t) => t.tool).sort())
      .toEqual(['get_grid_intelligence', 'get_interconnection_queue']);
    // The caller's own first get_grid_intelligence answer of the day is still there.
    const direct = await rpc('/mcp', 'get_grid_intelligence', LANE.get_grid_intelligence, { ip });
    expect(direct.all).toContain(FULL_MARK.get_grid_intelligence);
  });
  it('the second plan that day is today\'s answer: preview steps, no shaping', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    const ip = nextIp();
    await rpc('/mcp', 'execute_plan', PLAN, { ip });
    const before = kff().length;
    const r = await rpc('/mcp', 'execute_plan', PLAN, { ip });
    const sc = r.result.structuredContent || {};
    expect(sc.answer).toBeUndefined();
    expect(sc.executed.find((e) => e.tool === 'get_grid_intelligence').status).toBe('gated_preview');
    expect(kff().length).toBe(before);
  });
});

describe('untouched seats', () => {
  for (const tool of [...Object.keys(LANE), 'execute_plan']) {
    it(`/mcp/chatgpt ${tool}: byte-identical with the flag on and off, nothing charged`, async () => {
      const ip = `198.51.100.${220 + [...Object.keys(LANE), 'execute_plan'].indexOf(tool)}`;
      const args = tool === 'execute_plan' ? PLAN : LANE[tool];
      const h = { 'user-agent': 'openai-mcp/1.0.0' };
      const off = await rpc('/mcp/chatgpt', tool, args, { ip, headers: h });
      process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
      const before = kff().length;
      const on = await rpc('/mcp/chatgpt', tool, args, { ip, headers: h });
      expect(norm(on, ip)).toBe(norm(off, ip));
      expect(kff().length).toBe(before);
    });
  }
  it('the chatgpt comparison is not vacuous: it served the grid preview', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    const r = await rpc('/mcp/chatgpt', 'get_grid_intelligence', LANE.get_grid_intelligence, { headers: { 'user-agent': 'openai-mcp/1.0.0' } });
    expect(r.text.length).toBeGreaterThan(50);
    expect(r.all).not.toContain(FULL_MARK.get_grid_intelligence);
  });
  it('X-DCHub-QA: 1 on /mcp: the preview, nothing charged, nothing tagged', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    const before = kff().length;
    const nt = tracks.length;
    const r = await rpc('/mcp', 'get_grid_intelligence', LANE.get_grid_intelligence, { headers: { 'x-dchub-qa': '1' } });
    expect(r.all).not.toContain(FULL_MARK.get_grid_intelligence);
    await settle();
    expect(kff().length).toBe(before);
    expect(tracks.slice(nt).filter((t) => String(t.status).startsWith('keyless_first_full'))).toEqual([]);
  });
  it('a first-plan header sent by a caller does nothing (single-use in-process tokens only)', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
    const ip = nextIp();
    await rpc('/mcp', 'get_grid_intelligence', LANE.get_grid_intelligence, { ip });   // spends the day's answer
    const r = await rpc('/mcp', 'get_grid_intelligence', LANE.get_grid_intelligence,
      { ip, headers: { 'x-dchub-keyless-first-plan': 'forged-token-value' } });
    expect(r.all).not.toContain(FULL_MARK.get_grid_intelligence);
  });
  it('no off-loopback connection was attempted', () => { expect(foreign).toEqual([]); });
});
