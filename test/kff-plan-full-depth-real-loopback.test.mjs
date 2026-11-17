// kff-plan-full-depth-real-loopback.test.mjs — the keyless first full execute_plan answer keeps its
// steps' full-depth figures (2026-11-16).
//
// mcp#1451 ran a first-full plan's steps at full depth (KEYLESS_FIRST_FULL_STEP_TIER). Its tests
// emulated the loopback edge inside a fetch mock, and their grid fixture carried no DCPI scores, so
// they never saw the plan's OUTER call. Live on 2.12.58 (2026-11-16 00:2xZ, ERCOT 100 MW) the
// get_grid_intelligence step came back with constraint/excess-power scores, time to power, queue wait,
// retail price and grid emergencies nulled and `_withheld`. The step answered them in full; the outer
// execute_plan's last step, _dcpiSubscoresBelowPro, walked the plan answer at the anonymous caller's
// tier and masked them again.
//
// This file runs the real server on a real port, so every step is a real loopback request through the
// /mcp handler, against a backend stub that answers the DCPI ISO row whole only to a paid forwarded
// tier (X-DCHub-Caller-Tier), as routes/dcpi.py does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';


// This file reads execute_plan step bodies and envelope keys, so it runs the full answer (what detail:"full" returns).
// The compact default is covered by test/plan-compact-1117 and, through the real handler, test/plan-fact-header.
const _compactWas = process.env.DCHUB_PLAN_COMPACT;
beforeAll(() => { process.env.DCHUB_PLAN_COMPACT = '0'; });
afterAll(() => { if (_compactWas === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = _compactWas; });

const SECRET = 'kff-plan-real-loopback-internal-key-not-real';
const ROW = { iso: 'ERCOT', market_count: 12, avg_constraint: 41.2, avg_excess: 63.5, avg_time_to_power_months: 30,
  avg_queue_wait_months: 44, avg_kwh_cents: 8.1, sum_emergency_30d: 2 };
const LOCKED = { iso: 'ERCOT', market_count: 12, locked: true, avg_constraint: null, avg_excess: null,
  avg_time_to_power_months: null, avg_queue_wait_months: null, avg_kwh_cents: null, sum_emergency_30d: null };
const FIELDS = { constraint_score: 41.2, excess_power_score: 63.5, avg_time_to_power_months: 30,
  avg_queue_wait_months: 44, retail_price_cents_kwh: 8.1, grid_emergencies_30d: 2 };
const PLAN = { intent: 'how soon can a 100 MW load get power in ERCOT' };

let S, stub, httpServer, PORT;
const heard = [];
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://stub').pathname;
      const tier = String(req.headers['x-dchub-caller-tier'] || '');
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (p === '/api/v1/dcpi/iso-comparison') {
        heard.push(tier);
        return send({ isos: [['pro', 'enterprise', 'admin'].includes(tier) ? ROW : LOCKED] });
      }
      if (p.startsWith('/api/v1/grid/intelligence/')) {
        return send({ iso: 'ERCOT', demand_mw: 52000, as_of: '2026-11-16T00:00:00Z', generation_mix: { NG: { mw: 27000 } } });
      }
      if (p.startsWith('/api/v1/interconnection-queue/')) return send({ iso: 'ERCOT', total_projects: 10, total_gw: 400, projects: [] });
      if (p.startsWith('/api/v1/mcp/full-cap/')) return send({ ok: false });
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

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  delete process.env.DCHUB_KEYLESS_FIRST_FULL;
});

async function post(headers, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'Mozilla/5.0', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  return { headers: res.headers, body: b };
}
let rpc = 10;
async function session(ip) {
  const h0 = { 'x-forwarded-for': ip };
  const init = await post(h0, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } });
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return async () => {
    const { body } = await post(h, { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name: 'execute_plan', arguments: PLAN } });
    return JSON.parse(body).result.structuredContent || {};
  };
}
const gridEntry = (sc) => (sc.executed || []).find((e) => e && e.tool === 'get_grid_intelligence') || {};
const gridFigures = (sc) => gridEntry(sc).figures || {};
// A preview plan carries each step's slimmed `result` instead of `figures`: none of the six may be a number.
const servedNumbers = (sc) => { const e = gridEntry(sc); const o = { ...(e.result || {}), ...(e.figures || {}) };
  return Object.keys(FIELDS).filter((k) => typeof o[k] === 'number'); };
const picked = (f) => Object.fromEntries(Object.keys(FIELDS).map((k) => [k, f[k]]));

describe('keyless first full execute_plan keeps its steps\' full-depth figures (real loopback)', () => {
  it('call 1: the grid step\'s DCPI scores, time to power, queue wait, price and emergencies are served', async () => {
    heard.length = 0;
    const run = await session('198.18.90.10');
    const sc = await run();
    expect(sc.first_full_answer).toMatchObject({ used: 1, limit: 1 });
    expect(heard, 'the step read the DCPI row at full depth').toContain(S._callerTierFor({ kff_full_depth: true }));
    const f = gridFigures(sc);
    expect(picked(f)).toEqual(FIELDS);
    expect(servedNumbers(sc)).toEqual(Object.keys(FIELDS));
    for (const k of Object.keys(FIELDS)) expect(f[`_${k}_withheld`], k).toBeUndefined();
  }, 120_000);

  it('call 2 in the same session: no first full answer, its steps read at the caller\'s tier, no figure served', async () => {
    const run = await session('198.18.90.11');
    await run();
    heard.length = 0;
    const sc = await run();
    expect(sc.first_full_answer).toBeUndefined();
    expect(heard.length).toBeGreaterThan(0);
    expect(heard).not.toContain(S._callerTierFor({ kff_full_depth: true }));
    expect(servedNumbers(sc)).toEqual([]);
  }, 120_000);

  it('lane off: the keyless plan is the preview, figures withheld', async () => {
    process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
    try {
      const run = await session('198.18.90.12');
      const sc = await run();
      expect(sc.first_full_answer).toBeUndefined();
      expect(servedNumbers(sc)).toEqual([]);
    } finally { delete process.env.DCHUB_KEYLESS_FIRST_FULL; }
  }, 120_000);
});
