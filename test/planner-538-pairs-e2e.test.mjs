// planner-538-pairs-e2e.test.mjs — planner 5.38 (owner via Grok, 2026-11-17): both sides of the place, through the
// real /mcp handler on a real port (every plan step is a real loopback) against a stub backend.
//
// The owner's acceptance test, run end to end: each of the ten questions (five data-center-first, five
// power-first) runs execute_plan with the compact default (mcp#1518, DCHUB_PLAN_COMPACT unset). The compact answer
// carries paired_sides with one line per side, each line from its own step and dated by that step's own as_of (the
// stub gives every source a different date, so a borrowed date would show), and answer_guide carries both lines.
// Also: a pairing step that does not fit max_steps is held back and says so in replay, and never displaces a step
// that answers the question.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';

const SECRET = 'planner-538-pairs-internal-key-not-real';
// Every source a different date: a line that borrowed another step's date would show the wrong one.
const D = {
  intel: '2026-10-13', intelDcpi: '2026-11-15', dcpi: '2026-11-14', grid: '2026-11-16', queue: '2026-10-31',
  pipeline: '2026-11-10', timeline: '2026-11-12', energy: '2026-08-31',
};
const FAC = {
  Dallas: [{ slug: 'equinix-equinix-infomart-a9d628bb', name: 'Equinix Infomart', city: 'Dallas', state: 'TX', as_of: '2026-03-30' }],
  Chicago: [{ slug: 'digital-realty-350-e-cermak-5e6f7a8b', name: '350 E Cermak', city: 'Chicago', state: 'IL', as_of: '2026-03-30' }],
  'Northern Virginia': [{ slug: 'ntt-ashburn-va7-data-center-ashburn-0809b12f', name: 'NTT Ashburn VA7 Data Center', city: 'Ashburn', state: 'VA', as_of: '2026-03-30' }],
};
const ALL_FAC = new Map(Object.values(FAC).flat().map((f) => [f.slug, f]));
const DCPI = { dallas: ['CAUTION', 42], chicago: ['AVOID', 21.9], atlanta: ['AVOID', 20.7], columbus: ['AVOID', 17.2],
  phoenix: ['CAUTION', 38], 'northern-virginia': ['AVOID', 20], ashburn: ['AVOID', 20] };
const MARKETS = { dallas: 'Dallas', columbus: 'Columbus', 'northern-virginia': 'Northern Virginia', atlanta: 'Atlanta', phoenix: 'Phoenix', chicago: 'Chicago' };
const seen = [];

let stub, httpServer, PORT;
const freePort = () => new Promise((resolve) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

beforeAll(async () => {
  await new Promise((resolve) => {
    stub = createServer((req, res) => {
      const u = new URL(req.url, 'http://stub');
      const p = u.pathname;
      seen.push(p + u.search);
      const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      let m;
      if ((m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p))) {
        const v = DCPI[m[1]];
        return v ? send({ market_slug: m[1], verdict: v[0], composite_score: v[1], computed_at: `${D.dcpi}T00:39:23Z` }) : send({ error: 'not found' }, 404);
      }
      if ((m = /^\/api\/v1\/markets\/([^/]+)$/.exec(p))) {
        const name = MARKETS[m[1]];
        if (!name) return send({ error: 'not found' }, 404);
        return send({ success: true, market: { id: m[1], name }, as_of: `${D.intel}T21:06:18`,
          stats: { facility_count: 112, total_power_mw: 2111, mw_reporting_count: 12 },
          siting: { dcpi: { verdict: (DCPI[m[1]] || ['AVOID'])[0], as_of: `${D.intelDcpi}T00:34:29Z` } } });
      }
      if (p === '/api/v1/facilities') {
        const q = u.searchParams.get('q') || '';
        const rows = FAC[q] || [];
        return send({ success: true, total_matching: rows.length ? 600 + rows.length : 0, data: rows });
      }
      if ((m = /^\/api\/v1\/facilit(?:y|ies)\/([^/]+)$/.exec(p))) {
        const f = ALL_FAC.get(decodeURIComponent(m[1]));
        return f ? send({ data: { ...f, operator: f.name.split(' ')[0] } }) : send({ error: 'Facility not found' }, 404);
      }
      if (p.startsWith('/api/v1/grid/intelligence/')) {
        const iso = p.split('/').pop().toUpperCase();
        // The shaper dates the read by the EIA demand hour and the DCPI ISO row (as the live backend does).
        return send({ iso, iso_name: iso, demand_mw: 52000, demand_period: `${D.grid}T00` });
      }
      if (p === '/api/v1/dcpi/iso-comparison') {
        return send({ isos: ['ERCOT', 'PJM'].map((iso) => ({ iso, market_count: 12, avg_constraint: 41.2, avg_excess: 63.5, avg_time_to_power_months: 44.9,
          avg_queue_wait_months: 52, avg_kwh_cents: 9.1, sum_emergency_30d: 2, latest_computed_at: `${D.grid}T00:41:02Z` })) });
      }
      if (p === '/api/v1/interconnection-queue/by-iso') {
        return send({ iso: u.searchParams.get('iso') || 'ERCOT', queued_generation_gw: 461.4, as_of: `${D.queue}T00:00:00Z` });
      }
      if (p === '/api/v1/pipeline') {
        return send({ projects: [{ name: 'Stub Campus One', capacity_mw: 300, status: 'construction' }, { name: 'Stub Campus Two', capacity_mw: null, status: 'announced' }],
          total: 2, as_of: `${D.pipeline}T00:00:00Z` });
      }
      if (p === '/api/v1/power/availability-timeline') {
        const st = u.searchParams.get('state') || '';
        return send({ state: st, as_of: `${D.timeline}T00:00:00Z`,
          queue_context: { iso_reported: [{ iso: st === 'TX' ? 'ERCOT' : 'WECC', gw: 461.4, requests: 1800, as_of: D.timeline, primary: true }] } });
      }
      if (p.startsWith('/api/v1/energy/')) {
        return send({ filter: { state: u.searchParams.get('state') || '' }, industrial_rate_kwh: 8.2, as_of: `${D.energy}T00:00:00Z` });
      }
      if (p.startsWith('/api/v1/grid/extended/')) return send({ iso: p.split('/').pop(), demand_mw: 52000, as_of: '2026-11-16T00:00:00Z' });
      if (p.startsWith('/api/v1/mcp/full-cap/')) return send({ ok: false });
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  delete process.env.DCHUB_PLAN_COMPACT;   // the compact default (mcp#1518)
  process.env.PORT = String(await freePort());
  const S = await import('../server.mjs');
  await new Promise((resolve) => { httpServer = S.app.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  PORT = httpServer.address().port;
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
  return raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
}
let ipN = 40;
async function plan(args) {
  const h0 = { 'x-forwarded-for': `198.18.93.${ipN++}` };
  const init = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'Mozilla/5.0', ...h0 },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } }) });
  await init.text();
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const body = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'execute_plan', arguments: args } });
  const r = JSON.parse(body).result;
  return r.structuredContent || JSON.parse(r.content[0].text);
}

// dc / power: the tool each side's line is read from, and that source's own date (null: the stub, like the live
// facility search, names none, and the line must say it is undated rather than borrow one).
const TEN = [
  // data-center first
  { q: 'colocation in Dallas for 2 MW', cls: 'colocation', dc: ['get_market_dcpi_rank', D.dcpi], power: ['get_grid_intelligence', D.grid] },
  { q: 'Equinix facilities in Ashburn', cls: 'facility_search', dc: ['search_facilities', null], power: ['get_grid_intelligence', D.grid], added: 'power' },
  { q: 'data center pipeline in Phoenix', cls: 'dc_capacity', dc: ['get_pipeline', D.pipeline], power: ['get_power_availability_timeline', D.timeline] },
  { q: 'is Atlanta a good data center market', cls: 'market_outlook', dc: ['get_market_dcpi_rank', D.dcpi], power: ['get_power_availability_timeline', D.timeline] },
  { q: 'colo options in Chicago 500 kW', cls: 'colocation', dc: ['get_market_dcpi_rank', D.dcpi], power: ['get_grid_intelligence', D.grid] },
  // power first
  { q: 'PJM headroom for 200 MW in Northern Virginia', cls: 'grid_headroom', dc: ['get_market_intel', D.intel], power: ['get_grid_intelligence', D.grid], added: 'data_center', energy: true },
  { q: 'how soon can 100 MW get power in Texas', cls: 'capacity_search', dc: ['get_pipeline', D.pipeline], power: ['get_power_availability_timeline', D.timeline], added: 'data_center', energy: true },
  { q: 'interconnection queue in ERCOT near Dallas', cls: 'interconnection_queue', dc: ['get_market_intel', D.intel], power: ['get_interconnection_queue', D.queue], added: 'data_center', energy: true },
  { q: 'power prices in Arizona for a data center', cls: 'price', dc: ['get_pipeline', D.pipeline], power: ['get_energy_prices', D.energy], added: 'data_center', energy: true },
  { q: 'grid capacity in Columbus Ohio', cls: 'grid_headroom', dc: ['get_market_intel', D.intel], power: ['get_grid_intelligence', D.grid], added: 'data_center', energy: true },
];
// A date that may sit in a line beside the step's own: the DCPI verdict get_market_intel carries is dated by itself.
const OWN_EXTRA = { get_market_intel: [D.intelDcpi] };

function checkSides(o, t) {
  const ps = o.paired_sides;
  expect(ps, 'paired_sides').toBeTruthy();
  expect(ps.lines).toHaveLength(2);
  expect(ps.data_center.tool).toBe(t.dc[0]);
  expect(ps.power.tool).toBe(t.power[0]);
  expect(ps.data_center.line).toMatch(/^DATA CENTER SIDE \(step \d+, /);
  expect(ps.power.line).toMatch(/^POWER SIDE \(step \d+, /);
  for (const [side, [tool, date]] of [['data_center', t.dc], ['power', t.power]]) {
    const x = ps[side];
    expect(['executed', 'gated_preview'], side).toContain(x.status);
    if (date) {
      expect(x.as_of, side).toBe(date);
      expect(x.line, side).toContain(`as of ${date}`);
    } else {
      expect(x.as_of, side).toBeUndefined();
      expect(x.line, side).toContain('undated: the step names no as_of');
    }
    for (const other of new Set(Object.values(D))) {
      if (other === date || (OWN_EXTRA[tool] || []).includes(other)) continue;
      expect(x.line, `${side} line borrowed ${other}`).not.toContain(other);
    }
    expect(x.line).toMatch(/Source: DC Hub \(dchub\.cloud\)\.$/);
  }
  for (const l of ps.lines) expect(o.answer_guide).toContain(l);
  expect(JSON.stringify(ps)).not.toMatch(/\$\s?\d|\bcredits?\b|free key|calls?\s*\/\s*day|per day|free tier/i);
}

describe('planner 5.38: both sides of the place, end to end (keyless first answer, compact)', () => {
  for (const t of TEN) {
    describe(t.q, () => {
      let o;
      beforeAll(async () => { o = await plan({ intent: t.q }); }, 120_000);

      it(`routes to ${t.cls} on planner 5.38, compact`, () => {
        expect(o.intent_class).toBe(t.cls);
        expect(o.planner_version).toBe('5.41');
        expect(o.detail).toBe('compact');
      });

      it('no step failed, and no step ran on a placeholder', () => {
        expect(o.executed.filter((e) => e.status === 'failed').map((e) => e.tool)).toEqual([]);
        for (const e of o.executed.filter((x) => x.status === 'executed' || x.status === 'gated_preview')) {
          expect(JSON.stringify(e.args || {}), e.tool).not.toMatch(/"</);
        }
      });

      if (t.added) {
        it(`the ${t.added === 'power' ? 'power' : 'data-center'} pairing step ran, and replay records it`, () => {
          const ps = o.executed.find((e) => e.pair_side === t.added);
          expect(ps, JSON.stringify(o.executed.map((e) => [e.step, e.tool, e.status]))).toBeTruthy();
          expect(ps.status).toBe('executed');
          expect(o.replay.decisions.find((d) => d.id === 'P1')).toMatchObject({ step: ps.step, status: 'executed' });
        });
      } else {
        it('both sides were already in the plan: no pairing step, and replay says so', () => {
          expect(o.executed.some((e) => e.pair_side)).toBe(false);
          expect(o.replay.decisions.find((d) => d.id === 'P1')).toMatchObject({ status: 'already_paired' });
        });
      }

      it('paired_sides: one line per side, each from its own step and dated by that step', () => checkSides(o, t));
    });
  }
});

// The same five power-first questions on the plain compact path (no keyless first answer): every step row and
// citation carries the step's own as_of, so the facility/capacity source and the grid/energy source are each cited
// with their own date.
describe('planner 5.38: power-first questions cite both sides with their own as_of (plain compact path)', () => {
  for (const t of TEN.filter((x) => x.energy)) {
    describe(t.q, () => {
      let o;
      beforeAll(async () => {
        process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
        try { o = await plan({ intent: t.q }); } finally { delete process.env.DCHUB_KEYLESS_FIRST_FULL; }
      }, 120_000);

      it('compact, both sides in paired_sides', () => {
        expect(o.detail).toBe('compact');
        expect(o.intent_class).toBe(t.cls);
        checkSides(o, t);
      });

      it('the facility/capacity step and the grid/energy step are each cited with their own as_of', () => {
        for (const [side, [tool, date]] of [['data_center', t.dc], ['power', t.power]]) {
          const x = o.paired_sides[side];
          const row = o.executed.find((e) => e.step === x.step);
          expect(row, `${side} ${JSON.stringify(row)}`).toMatchObject({ tool, as_of: date });
          expect(['executed', 'gated_preview']).toContain(row.status);
          expect((o.citations || []).find((c) => c.step === x.step), side).toMatchObject({ tool, as_of: date });
        }
        expect(['get_market_intel', 'get_pipeline']).toContain(o.paired_sides.data_center.tool);
        expect(o.paired_sides.data_center.line).toMatch(/facilities tracked|pipeline: \d+ project/);
      });
    });
  }
});

describe('planner 5.38: the pairing step never displaces a step that answers the question', () => {
  it('max_steps 3 on a three-step grid plan: the pairing step is held back and replay says why', async () => {
    const o = await plan({ intent: 'grid capacity in Columbus Ohio', max_steps: 3 });
    const ps = o.executed.find((e) => e.pair_side === 'data_center');
    expect(ps).toMatchObject({ tool: 'get_market_intel', status: 'not_run' });
    // (the keyless first answer's compact rows carry no note; replay and the side's line carry it)
    expect(o.executed.filter((e) => e.step < ps.step).map((e) => e.status)).toEqual(['executed', 'executed', 'executed']);
    const p1 = o.replay.decisions.find((d) => d.id === 'P1');
    expect(p1).toMatchObject({ step: ps.step, status: 'not_run' });
    expect(p1.status_note).toMatch(/^pairing step held back: max_steps 3 leaves no room after the steps that answer the question\. The data-center side was not read: call get_market_intel \{"market":"columbus"\} directly/);
    // the data-center side says it was not read, in the answer too
    expect(o.paired_sides.data_center.line).toMatch(/^DATA CENTER SIDE \(step \d+, get_market_intel\): not read in this run \(pairing step held back/);
    expect(o.answer_guide).toContain(o.paired_sides.data_center.line);
  }, 120_000);

  it('max_steps 3 on the queue plan: the pairing step (wave 1) does not take the slot of analyze_site (wave 2)', async () => {
    const o = await plan({ intent: 'interconnection queue in ERCOT near Dallas', max_steps: 3 });
    const ps = o.executed.find((e) => e.pair_side === 'data_center');
    expect(ps).toMatchObject({ status: 'not_run' });
    const as = o.executed.find((e) => e.tool === 'analyze_site');
    expect(as, 'analyze_site was reached').toBeTruthy();
    expect(as.status).not.toBe('not_run');
  }, 120_000);
});
