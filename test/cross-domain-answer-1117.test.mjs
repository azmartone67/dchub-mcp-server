// cross-domain-answer-1117.test.mjs — planner 5.39 (Grok cross-domain head-to-head, 2026-11-17 night).
//
// Grok scored DC Hub 35/60 on two keyless, compact cross-domain questions:
//   (a) 50 MW of colocation or powered capacity with power in under 24 months in the US, plus headroom and the queue:
//       routed to interconnection_queue, named no market, no MW, no headroom or queue figure, and led "DC Hub ran 3
//       lookups";
//   (b) Northern Virginia capacity vs wholesale power prices, headroom and the PJM queue: never read a price, and its
//       POWER SIDE line said no figure came back while facts[] held PJM's live demand from that step.
// Unit checks on lib/cross-domain-answer.mjs and the lead/pair/compact changes, then both questions end to end
// through the real /mcp handler (every step a real loopback) against a stub backend shaped like the live keyless
// payloads of 2026-11-18 04:17Z (taste headlines, withheld fields).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { capacityGridAsk, capacityGridSequence, energyPriceAsk, energyPriceStep, wholesaleAsked, buildCrossDomainAnswer,
  WHOLESALE_SCOPE_NOTE, HEADLINE_MAX } from '../lib/cross-domain-answer.mjs';
import { planLeadText, PLAN_LEAD_MAX } from '../lib/plan-lead-text.mjs';
import { pairLines } from '../lib/plan-pairs.mjs';
import { compactPlanObject } from '../lib/plan-compact.mjs';

const QA = 'Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do grid headroom and the interconnection queue look like there?';
const QB = 'For new data center capacity in Northern Virginia, how do wholesale power prices, grid headroom and the PJM queue affect it?';

// Live keyless shapes (2026-11-18 04:17Z), trimmed.
const CANVAS_KEYLESS = { ok: true, product: 'Site Selection Canvas', max_months_applied: false,
  max_months_note: 'max_months was not applied: it filters on time to power, which this caller\'s access does not open.',
  shortlist: [
    { market: 'Midland–Odessa', state: 'TX', iso: 'ERCOT', slug: 'midland-tx', verdict: 'BUILD', time_to_power_months: null, _time_to_power_months_withheld: true },
    { market: 'Upper Peninsula MI', state: 'MI', iso: 'MISO', slug: 'upper-michigan', verdict: 'BUILD', time_to_power_months: null, _time_to_power_months_withheld: true },
    { market: 'Williston, ND', state: 'ND', iso: 'MISO', slug: 'williston-nd', verdict: 'BUILD', time_to_power_months: null, _time_to_power_months_withheld: true },
  ] };
const queueKeyless = (iso, gw, report) => ({ ok: true, tool: 'get_interconnection_queue', iso, as_of: '2026-11-17',
  last_refreshed: '2026-11-17T06:03:39.923279+00:00',
  taste: { headline: { name: 'queued_generation_gw', value: gw, unit: 'GW', ...(report ? { as_of: report } : {}) },
    project_count: { value: 1766 } }, _projects_withheld: true });
const gridKeyless = (iso, mw) => ({ ok: true, tool: 'get_grid_intelligence', iso, as_of: '2026-11-18T03:00:00Z',
  taste: { headline: { name: 'demand_mw', value: mw, unit: 'MW', as_of: '2026-11-18T03:00:00Z' } },
  _queue_depth_gw_withheld: true, _build_rate_pct_withheld: true, _operating_reserve_mw_withheld: true });
const LISTINGS_EMPTY = { ok: true, count: 0, items: [], empty_reason: { code: 'no_live_listings' },
  retrieval_receipt: { retrieved_at: '2026-11-18T04:17:48.553938+00:00' } };
const ENERGY_VA = { ok: true, tool: 'get_energy_prices', filter: { state: 'VA' }, as_of: '2026-08-31',
  taste: { headline: { name: 'retail_rate_cents_kwh', value: 10.63, unit: 'cents/kWh', sector: 'all-sector average', window: '2026', as_of: '2026-08-31' } } };
const INTEL_NOVA = { success: true, market: { id: 'northern-virginia', name: 'Ashburn' }, as_of: '2026-11-03T21:06:18',
  stats: { facility_count: 587, total_power_mw: 11313, mw_reporting_count: 200 }, siting: { dcpi: { verdict: 'AVOID', as_of: '2026-11-18T00:34:29Z' } } };

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));
// Every number in a sentence (not dates, not the "24 months" / "50 MW" echoed from the question).
const figures = (s) => (String(s).replace(/\d{4}-\d{2}-\d{2}/g, '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,/g, ''));

describe('detection', () => {
  it('question (a) is a capacity + grid ask with no place', () => {
    expect(capacityGridAsk(QA, { mw: 50 })).toBe(true);
  });
  it('a named place, no size, or no grid side is not', () => {
    expect(capacityGridAsk(QA, { mw: 50, state: 'TX' })).toBe(false);
    expect(capacityGridAsk(QA, { mw: 50, __outlook: { slug: 'dallas' } })).toBe(false);
    expect(capacityGridAsk(QA, {})).toBe(false);
    expect(capacityGridAsk('Where can I get 50 MW of colocation in the US?', { mw: 50 })).toBe(false);
  });
  it('the sequence: shortlist, each finalist grid\'s queue and headroom, Capacity Source last', () => {
    const seq = capacityGridSequence({ mw: 50, deadline: { months: 24, by: '2028-11' } });
    // 5.41: a deadline adds each finalist state's power timeline before Capacity Source.
    expect(seq.map((s) => s.tool)).toEqual(['site_selection_canvas', 'get_interconnection_queue', 'get_grid_intelligence', 'get_power_availability_timeline', 'source_capacity']);
    expect(seq[0].args_hint).toMatchObject({ capacity_mw: 50, max_months: 24 });
    expect(seq[1].args_hint.iso).toBe('<ISO serving the finalist market>');
    expect(seq[4].args_hint).toMatchObject({ min_mw: 50, region: 'north_america', available_by: '2028-11' });
  });
  it('power-price wording, and wholesale/LMP wording', () => {
    expect(energyPriceAsk(QB)).toBe(true);
    expect(energyPriceAsk('what is the electricity cost in Ohio')).toBe(true);
    expect(energyPriceAsk('grid headroom in PJM')).toBe(false);
    expect(wholesaleAsked(QB)).toBe(true);
    expect(wholesaleAsked('LMP at the Dominion hub')).toBe(true);
    expect(wholesaleAsked('retail power prices in Virginia')).toBe(false);
  });
  it('the price step reads the place\'s state, once', () => {
    const st = energyPriceStep(QB, { state: 'VA', label: 'Northern Virginia' }, ['get_grid_intelligence']);
    expect(st).toMatchObject({ tool: 'get_energy_prices', args_hint: { state: 'VA' } });
    expect(st.why).toContain(WHOLESALE_SCOPE_NOTE);
    expect(energyPriceStep(QB, { state: 'VA' }, ['get_energy_prices'])).toBeNull();
    expect(energyPriceStep(QB, { state: null }, [])).toBeNull();
    expect(energyPriceStep('grid headroom in PJM', { state: 'VA' }, [])).toBeNull();
  });
});

describe('the answer for (a), keyless', () => {
  const executed = [
    ex(1, 'site_selection_canvas', { capacity_mw: 50, max_months: 24 }, CANVAS_KEYLESS),
    ex(2, 'get_interconnection_queue', { iso: 'ERCOT' }, queueKeyless('ERCOT', 461.4, '2026-10-31')),
    ex(2, 'get_interconnection_queue', { iso: 'MISO' }, queueKeyless('MISO', 290.2, null)),
    ex(3, 'get_grid_intelligence', { iso: 'ERCOT' }, gridKeyless('ERCOT', 52574)),
    ex(3, 'get_grid_intelligence', { iso: 'MISO' }, gridKeyless('MISO', 81000)),
    ex(4, 'source_capacity', { min_mw: 50, region: 'north_america' }, LISTINGS_EMPTY),
  ];
  const ia = buildCrossDomainAnswer({ intent: QA, intent_class: 'capacity_grid', requested_mw: 50, deadline_months: 24 }, executed, asMap(executed));

  it('names the top 3 markets with their grids', () => {
    expect(ia.kind).toBe('cross_domain');
    expect(ia.headline).toMatch(/^Top DCPI BUILD markets for 50 MW \(24-month cut not applied\): Midland–Odessa TX \(ERCOT\), Upper Peninsula MI \(MISO\), Williston, ND \(MISO\)/);
    expect(ia.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });
  it('gives each grid\'s queue depth with its date, and says headroom is withheld (never estimated)', () => {
    expect(ia.headline).toContain('ERCOT queue 461.4 GW (as of 2026-10-31)');
    expect(ia.headline).toContain('MISO queue 290.2 GW (collected 2026-11-17)');
    expect(ia.headline).toContain('Headroom figures withheld at this access level.');
    for (const e of ia.evidence.slice(0, 3)) expect(e).toMatch(/Queue: .*GW.*Headroom: /);
    expect(ia.evidence[3]).toMatch(/^DC Hub Capacity Source has no live listing/);
    // The reading is 2026-11-18T03:00Z, 20:00 on 2026-11-17 in Phoenix: said as its America/Phoenix day (GDL 2026-11-25 item 5).
    expect(ia.evidence[0]).toContain('live demand was 52,574 MW (EIA-930 hourly, as of 2026-11-17), a load reading, not headroom');
  });
  it('says the 24-month cut was not applied and the shortlist is not sized in MW', () => {
    expect(ia.not_established.join(' ')).toMatch(/"under 24 months" was not applied/);
    expect(ia.not_established.join(' ')).toMatch(/not sized to 50 MW/);
  });
  it('the Capacity Source side: none live yet, said plainly', () => {
    expect(ia.facts.some((f) => f.tool === 'source_capacity' && /no live listing of 50 MW or more/.test(f.text))).toBe(true);
  });
  it('the lead starts with the answer, fits, and every figure in it is in facts[]', () => {
    const plan = { _entity: 'plan_execution', intent: QA, executed, intent_answer: ia, human_message: 'preview' };
    const lead = planLeadText(plan);
    expect(lead).not.toMatch(/^DC Hub ran/);
    expect(lead.startsWith('Top DCPI BUILD markets for 50 MW (24-month cut not applied): Midland')).toBe(true);
    // 2026-11-18: the deadline is never claimed in the lead when the cut was not applied.
    expect(lead).not.toMatch(/with power in under 24 months/);
    expect(lead.length).toBeLessThanOrEqual(PLAN_LEAD_MAX);
    const c = compactPlanObject({ ...plan, ok: true, intent_class: 'capacity_grid' });
    const factText = c.facts.map((f) => f.text).join(' ').replace(/,(?=\d{3})/g, '');
    for (const n of figures(lead)) if (!['50', '24'].includes(n)) expect(factText, `lead figure ${n}`).toContain(n);
    expect(c.intent_answer.facts).toBeUndefined();   // one copy, in facts[]
    expect(c.intent_answer.facts_in).toBe('facts[]');
  });
  it('with time to power readable, only markets within the deadline are named, with their months', () => {
    const paid = { ...CANVAS_KEYLESS, max_months_applied: true, shortlist: [
      { market: 'Abilene', state: 'TX', iso: 'ERCOT', verdict: 'BUILD', time_to_power_months: 30 },
      { market: 'Midland–Odessa', state: 'TX', iso: 'ERCOT', verdict: 'BUILD', time_to_power_months: 18 },
      { market: 'Upper Peninsula MI', state: 'MI', iso: 'MISO', verdict: 'BUILD', time_to_power_months: 22 },
    ] };
    const ex2 = [ex(1, 'site_selection_canvas', {}, paid), ...executed.slice(1)];
    const a = buildCrossDomainAnswer({ intent: QA, intent_class: 'capacity_grid', requested_mw: 50, deadline_months: 24 }, ex2, asMap(ex2));
    // The cut was applied, so the lead may claim the deadline.
    expect(a.headline).toMatch(/^50 MW with power in under 24 months, US: Midland–Odessa TX \(ERCOT, 18 mo\)/);
    expect(a.headline).toContain('Midland–Odessa TX (ERCOT, 18 mo), Upper Peninsula MI (MISO, 22 mo)');
    expect(a.headline).not.toContain('Abilene');
    expect(a.not_established.join(' ')).not.toMatch(/was not applied/);
    expect(a.not_established.join(' ')).toMatch(/returned 2 markets within 24 months, not three/);
  });
  it('readable headroom is quoted with its date', () => {
    const g = { iso: 'ERCOT', as_of: '2026-11-16T00:00:00Z', avg_time_to_power_months: 32.6, build_rate_pct: 41 };
    const ex3 = executed.map((e) => (e.tool === 'get_grid_intelligence' && e.args.iso === 'ERCOT' ? { ...e, result: g } : e));
    const a = buildCrossDomainAnswer({ intent: QA, intent_class: 'capacity_grid', requested_mw: 50, deadline_months: 24 }, ex3, asMap(ex3));
    expect(a.evidence[0]).toContain('average time to power 32.6 months, 41% of its scored markets rated BUILD (DC Hub grid intelligence, as of 2026-11-16)');
    expect(a.headline).toContain('ERCOT headroom: average time to power 32.6 months (as of 2026-11-16)');
  });
});

describe('the answer for (b), keyless', () => {
  const executed = [
    ex(1, 'get_grid_intelligence', { iso: 'PJM' }, gridKeyless('PJM', 98081)),
    ex(2, 'get_interconnection_queue', { iso: 'PJM' }, queueKeyless('PJM', 373.5, null)),
    ex(3, 'get_refined_queue', { iso: 'PJM', state: 'VA' }, { ok: true }),
    { ...ex(4, 'get_market_intel', { market: 'northern-virginia' }, INTEL_NOVA), pair_side: 'data_center' },
    ex(5, 'get_energy_prices', { state: 'VA' }, ENERGY_VA),
  ];
  const ia = buildCrossDomainAnswer({ intent: QB, intent_class: 'grid_headroom', place: { label: 'Northern Virginia', state: 'VA', iso: 'PJM' } }, executed, asMap(executed));

  it('names both sides with figures and dates, and says what DC Hub prices are', () => {
    // The DCPI date is said as the America/Phoenix day (lib/cite-day.mjs): siting.dcpi.as_of 00:34Z on 11-18 is 11-17.
    expect(ia.headline).toBe('Northern Virginia (PJM). Data centers: 587 facilities, 11,313 MW tracked (as of 2026-11-03); DCPI AVOID (as of 2026-11-17).'
      + ' Power: PJM queue 373.5 GW (collected 2026-11-17); PJM headroom withheld;'
      + ' VA retail rate 10.63 cents/kWh (EIA 2026 average, as of 2026-08-31; not wholesale/LMP).');
    expect(ia.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
    expect(ia.not_established).toContain(WHOLESALE_SCOPE_NOTE);
  });
  it('the lead names no figure that facts[] does not hold', () => {
    const plan = { _entity: 'plan_execution', intent: QB, executed, intent_answer: ia };
    const lead = planLeadText(plan);
    const c = compactPlanObject({ ...plan, ok: true, intent_class: 'grid_headroom' });
    const factText = c.facts.map((f) => f.text).join(' ').replace(/,(?=\d{3})/g, '');
    for (const n of figures(lead)) expect(factText, `lead figure ${n}`).toContain(n);
  });
  it('the POWER SIDE line reads the step\'s fact instead of saying no figure came back', () => {
    const ps = pairLines(executed, (e) => e.result);
    expect(ps.power.line).not.toMatch(/no figure this caller can read came back/);
    expect(ps.power.line).toContain('98,081 MW');
  });
  it('a question that asks no price gets no price note', () => {
    const a = buildCrossDomainAnswer({ intent: 'data center capacity and grid headroom in Northern Virginia', intent_class: 'grid_headroom',
      place: { label: 'Northern Virginia', state: 'VA', iso: 'PJM' } }, executed.slice(0, 4), asMap(executed.slice(0, 4)));
    expect(a.not_established).not.toContain(WHOLESALE_SCOPE_NOTE);
    expect(a.headline).not.toMatch(/wholesale/i);
  });
  it('a one-sided plan is not a cross-domain answer', () => {
    const one = executed.slice(0, 2);
    expect(buildCrossDomainAnswer({ intent: QB, intent_class: 'grid_headroom' }, one, asMap(one))).toBeNull();
  });
});

describe('the lead fallback never starts "DC Hub ran"', () => {
  it('says how many lookups ran and where the figures are', () => {
    const lead = planLeadText({ _entity: 'plan_execution', intent: 'x', executed: [ex(1, 'get_refined_queue', {}, {})] });
    expect(lead).toMatch(/^For "x": 1 lookup ran \(get_refined_queue\)/);
  });
});

// ---------------- end to end ----------------
const SECRET = 'cross-domain-1117-internal-key-not-real';
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
      if (p === '/api/v1/site-selection/canvas') return send(CANVAS_KEYLESS);
      if (p === '/api/v1/interconnection-queue/by-iso') {
        const iso = (u.searchParams.get('iso') || 'ERCOT').toUpperCase();
        return send(queueKeyless(iso, iso === 'ERCOT' ? 461.4 : iso === 'PJM' ? 373.5 : 290.2, iso === 'ERCOT' ? '2026-10-31' : null));
      }
      if (p.startsWith('/api/v1/grid/intelligence/')) {
        const iso = p.split('/').pop().toUpperCase();
        // The backend's own grid row; the tool shapes it (as in planner-538-pairs-e2e).
        return send({ iso, iso_name: iso, demand_mw: iso === 'PJM' ? 98081 : 52574, demand_period: '2026-11-18T03' });
      }
      if (p === '/api/v1/listings') return send(LISTINGS_EMPTY);
      if (p === '/api/v1/energy/summary') return send(ENERGY_VA);
      if ((m = /^\/api\/v1\/markets\/([^/]+)$/.exec(p))) return m[1] === 'northern-virginia' ? send(INTEL_NOVA) : send({ error: 'not found' }, 404);
      if (p === '/api/v1/interconnection-queue/refined') {
        // The VA slice shaped like the live keyless PJM OH payload (2026-11-18), with the live VA count (312).
        if (u.searchParams.get('state') === 'VA') {
          const rq = JSON.parse(fs.readFileSync(new URL('./fixtures/xd-energy-1118/refined-queue-pjm-oh.json', import.meta.url), 'utf8'));
          const { _min_mw_not_applied, ...fa } = rq.filters_applied || {};
          return send({ ...rq, count_total_matching: 312, filters_applied: { ...fa, state: 'VA' } });
        }
        return send({ ok: true, results: [], count_total_matching: null });
      }
      if (p.startsWith('/api/v1/mcp/full-cap/')) return send({ ok: false });
      return send({});
    });
    stub.listen(0, '127.0.0.1', resolve);
  });
  process.env.DCHUB_API_BASE = `http://127.0.0.1:${stub.address().port}`;
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  delete process.env.DCHUB_PLAN_COMPACT;
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
let ipN = 20;
async function plan(args) {
  const h0 = { 'x-forwarded-for': `198.18.94.${ipN++}` };
  const init = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'Mozilla/5.0', ...h0 },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cursor', version: '1.0' } } }) });
  await init.text();
  const sid = init.headers.get('mcp-session-id');
  const h = { ...h0, ...(sid ? { 'mcp-session-id': sid } : {}) };
  if (sid) await post(h, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const body = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'execute_plan', arguments: args } });
  const r = JSON.parse(body).result;
  return { o: r.structuredContent || JSON.parse(r.content[r.content.length > 1 ? 1 : 0].text), lead: r.content[0].text };
}

function noContradiction(o) {
  const factTools = new Set((o.facts || []).map((f) => f.tool));
  for (const side of ['data_center', 'power']) {
    const x = o.paired_sides && o.paired_sides[side];
    if (x && factTools.has(x.tool)) expect(x.line, side).not.toMatch(/no figure this caller can read came back/);
  }
}

describe('end to end, keyless, compact', () => {
  describe('(a) 50 MW, US, under 24 months, headroom and queue', () => {
    let o, lead;
    beforeAll(async () => { ({ o, lead } = await plan({ intent: QA, detail: 'compact' })); }, 120_000);
    it('routes to capacity_grid on planner 5.40', () => {
      expect(o.intent_class).toBe('capacity_grid');
      expect(o.planner_version).toBe('5.63');
    });
    it('reads the shortlist, both finalist grids\' queue and headroom, and Capacity Source; nothing failed', () => {
      const ran = o.executed.filter((e) => e.status === 'executed' || e.status === 'gated_preview');
      expect(ran.filter((e) => e.tool === 'site_selection_canvas')).toHaveLength(1);
      expect(ran.filter((e) => e.tool === 'get_interconnection_queue').map((e) => e.args.iso).sort()).toEqual(['ERCOT', 'MISO']);
      expect(ran.filter((e) => e.tool === 'get_grid_intelligence').map((e) => e.args.iso).sort()).toEqual(['ERCOT', 'MISO']);
      expect(ran.some((e) => e.tool === 'source_capacity')).toBe(true);
      expect(o.executed.filter((e) => e.status === 'failed')).toEqual([]);
    });
    it('the lead names the three markets, the queue figures with dates, and never starts "DC Hub ran"', () => {
      expect(lead).not.toMatch(/^DC Hub ran/);
      expect(lead).toMatch(/^Top DCPI BUILD markets for 50 MW \(24-month cut not applied\): Midland–Odessa TX \(ERCOT\), Upper Peninsula MI \(MISO\), Williston, ND \(MISO\)/);
      expect(lead).toContain('ERCOT queue 461.4 GW (as of 2026-10-31)');
      expect(o.intent_answer.kind).toBe('cross_domain');
    });
    it('every figure in the lead is in facts[]', () => {
      const factText = (o.facts || []).map((f) => f.text).join(' ').replace(/,(?=\d{3})/g, '');
      for (const n of figures(lead.split(' Source: ')[0])) if (!['50', '24'].includes(n)) expect(factText, `lead figure ${n}`).toContain(n);
      noContradiction(o);
    });
  });

  describe('(b) Northern Virginia: wholesale prices, headroom, PJM queue', () => {
    let o, lead;
    beforeAll(async () => { ({ o, lead } = await plan({ intent: QB, detail: 'compact' })); }, 120_000);
    it('reads the VA power price', () => {
      const ep = o.executed.find((e) => e.tool === 'get_energy_prices');
      expect(ep && ep.status).toMatch(/^(executed|gated_preview)$/);
      expect(ep.args.state).toBe('VA');
    });
    it('the lead names both sides with figures and says DC Hub serves retail, not wholesale', () => {
      expect(lead).not.toMatch(/^DC Hub ran/);
      expect(lead).toMatch(/^Northern Virginia \(PJM\)\. Data centers: 587 facilities, 11,313 MW tracked/);
      // 5.40: a DC noun, a power noun and a bound place make dc_power_place, whose queue read is the VA slice of PJM's.
      expect(o.intent_class).toBe('dc_power_place');
      expect(lead).toContain('Power: PJM queue (VA): 312 active requests (as of 2026-11-17); PJM headroom withheld; VA retail rate 10.63 cents/kWh (EIA 2026 average, as of 2026-08-31; not wholesale/LMP)');
      expect(o.answer_guide).toContain(WHOLESALE_SCOPE_NOTE);
      expect(o.intent_answer.not_established).toContain(WHOLESALE_SCOPE_NOTE);
    });
    it('every figure in the lead is in facts[], and no side line contradicts facts[]', () => {
      const factText = (o.facts || []).map((f) => f.text).join(' ').replace(/,(?=\d{3})/g, '');
      for (const n of figures(lead.split(' Source: ')[0])) expect(factText, `lead figure ${n}`).toContain(n);
      noContradiction(o);
    });
  });
});
