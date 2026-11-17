// plan-proof-1116-e2e.test.mjs — Grok's live execute_plan proof run (2026-11-16 ~22:30Z, planner 5.31),
// items 1, 6 and 8, through the real /mcp handler on a real port (every plan step is a real loopback).
//
//   1. the keyless first full answer led with the queue rows' 50.5 months while its grid step said
//      avg_time_to_power_months 44.9, and intent_answer.not_established said the month estimate was
//      "not part of this answer". The answer now states ONE figure and names its field.
//   6. get_market_dcpi_rank's description said it "INCLUDES a `narrative` block"; the live backend
//      (/api/v1/dcpi/scores/<slug>) returned no narrative for any tier on 2026-11-16.
//   8. the keyless first full answer dropped `replay` (the description promises it on the envelope) and
//      no envelope carried a plan id.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const SECRET = 'plan-proof-1116-internal-key-not-real';
const ROW = { iso: 'ERCOT', market_count: 12, avg_constraint: 41.2, avg_excess: 63.5, avg_time_to_power_months: 44.9,
  avg_queue_wait_months: 52, avg_kwh_cents: 8.1, sum_emergency_30d: 2 };
const LOCKED = { iso: 'ERCOT', market_count: 12, locked: true, avg_constraint: null, avg_excess: null,
  avg_time_to_power_months: null, avg_queue_wait_months: null, avg_kwh_cents: null, sum_emergency_30d: null };
const REFINED = {
  _entity: 'queue_results', count_total_matching: 827, count_returned: 3,
  filters_applied: { iso: 'ERCOT', min_mw: 100, status: 'active' },
  freshness_by_iso: { ERCOT: { source_as_of: '2026-10-31', source_as_of_basis: 'published_report' } },
  source_as_of: '2026-10-31', total_queued_mw: 446266,
  results: [1, 2, 3].map((i) => ({ candidate_id: 'cand_' + i, iso: 'ERCOT', state: 'TX', capacity_mw: 200 + i,
    estimated_ttp_months: 50.5, fuel_type: 'GAS', queue_status: 'active' })),
};
const PLAN = { intent: 'how soon can a 100 MW load get power in ERCOT', capacity_mw: 100 };

let S, stub, httpServer, PORT, TOOLS;
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const p = new URL(req.url, 'http://stub').pathname;
      const tier = String(req.headers['x-dchub-caller-tier'] || '');
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (p === '/api/v1/dcpi/iso-comparison') return send({ isos: [['pro', 'enterprise', 'admin'].includes(tier) ? ROW : LOCKED] });
      if (p.startsWith('/api/v1/grid/intelligence/')) {
        return send({ iso: 'ERCOT', demand_mw: 52000, as_of: '2026-11-16T00:00:00Z', generation_mix: { NG: { mw: 27000 } } });
      }
      if (p === '/api/v1/interconnection-queue/refined') return send(REFINED);
      if (p.startsWith('/api/v1/interconnection-queue/')) return send({ iso: 'ERCOT', total_projects: 10, total_gw: 400, projects: [] });
      if (p.startsWith('/api/v1/mcp/full-cap/')) return send({ ok: false });
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  process.env.PORT = String(await freePort());
  S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
  const { body } = await post({}, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  TOOLS = (JSON.parse(body).result || {}).tools || [];
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => (httpServer ? httpServer.close(resolve) : resolve()));
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
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
  return async (args = PLAN) => {
    const { body } = await post(h, { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name: 'execute_plan', arguments: args } });
    const r = JSON.parse(body).result;
    // execute_plan's block 0 is the plain-language lead since 2026-11-17 (lib/plan-lead-text.mjs); the JSON is block 1.
    return { sc: r.structuredContent || {}, block0: r.content.map((b) => b.text).find((t) => typeof t === 'string' && t.trimStart().startsWith('{')) };
  };
}

describe('item 8: replay and a stable plan id on every execute_plan envelope', () => {
  let first, second;
  beforeAll(async () => {
    const run = await session('198.18.91.10');
    first = await run();
    second = await run();
  }, 180_000);

  it('the keyless first full answer carries replay with each decision\'s executed/failed status', () => {
    expect(first.sc.first_full_answer, 'this is the compact first full answer').toMatchObject({ used: 1, limit: 1 });
    const rp = first.sc.replay;
    expect(rp, 'replay was dropped from the first full answer').toBeTruthy();
    const steps = rp.decisions.filter((d) => d.kind === 'step');
    expect(steps.length).toBeGreaterThan(0);
    for (const d of steps) expect(['executed', 'failed', 'timed_out', 'skipped_unresolved', 'not_run', 'gated_preview']).toContain(d.status);
    expect(steps.some((d) => d.status === 'executed')).toBe(true);
    expect(JSON.parse(first.block0).replay, 'block 0 carries it too').toBeTruthy();
  });

  it('plan_id is on the envelope and inside replay, and the same question gets the same id on the preview run', () => {
    expect(first.sc.plan_id).toMatch(/^plan_[0-9a-f]{16}$/);
    expect(first.sc.replay.plan_id).toBe(first.sc.plan_id);
    expect(second.sc.first_full_answer, 'the second run is the preview').toBeUndefined();
    expect(second.sc.replay && second.sc.replay.decisions.length).toBeGreaterThan(0);
    expect(second.sc.plan_id).toBe(first.sc.plan_id);
  });

  it('a different question gets a different plan id', async () => {
    const run = await session('198.18.91.11');
    const other = await run({ intent: 'how soon can a 300 MW load get power in ERCOT', capacity_mw: 300 });
    expect(other.sc.plan_id).toMatch(/^plan_[0-9a-f]{16}$/);
    expect(other.sc.plan_id).not.toBe(first.sc.plan_id);
  }, 120_000);
});

describe('item 1: one time-to-power figure, named by its field, and no "not part of this answer"', () => {
  it('the first full answer leads with the grid DCPI average and says which field it is', async () => {
    const run = await session('198.18.91.12');
    const { sc, block0 } = await run();
    expect(sc.first_full_answer).toMatchObject({ used: 1 });
    expect(sc.answer).toMatch(/average time-to-power 44\.9 months \(get_grid_intelligence\.avg_time_to_power_months\)/);
    expect(sc.answer).not.toMatch(/50\.5/);
    expect(sc.intent_answer.headline).toBe(sc.answer);
    expect(sc.intent_answer.time_to_power_basis).toMatchObject({ field: 'get_grid_intelligence.avg_time_to_power_months' });
    expect(block0).not.toMatch(/not part of this answer/);
  }, 120_000);
});

describe('item 6: get_market_dcpi_rank does not promise a narrative the backend does not send', () => {
  const descOf = (n) => (TOOLS.find((t) => t.name === n) || {}).description || '';
  it('the narrative is conditional, and the owner listing sentence stays', () => {
    const d = descOf('get_market_dcpi_rank');
    expect(d.length).toBeGreaterThan(100);
    expect(d).not.toMatch(/INCLUDES a `narrative`/);
    expect(d).not.toMatch(/ready-to-cite prose/);
    expect(d).toMatch(/When DC Hub has written one, a `narrative` block/);
    expect(d).toContain('numeric sub-scores and the narrative come with a full-access key.');
  });
});
