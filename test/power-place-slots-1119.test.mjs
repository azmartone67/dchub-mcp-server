// power-place-slots-1119.test.mjs — planner 5.43, Grok's daily MCP leadership note (2026-11-18) items 6, 7 and 12:
//   6  xd-b asked wholesale prices, headroom and the PJM queue; the withheld VA firm-supply line (timing, not asked) took
//      the headline room and the VA retail rate sat in evidence only. Each asked power side gets one slot first.
//   7  xd-a said 461.4 GW twice with two unlabelled counts (1,766 projects from the queue read, 1,847 requests from the
//      timeline's operator echo), Q-d said "(as of 2026-10-31) (as of 2026-10-31)", and a refined-queue fuel split
//      taken over 200 reduced rows was printed against the 1,761 total.
//  12  "Where in Texas can I get grid power the fastest" read search_facilities first (no figure keyless) and led with
//      a gap; it now reads the power side only and leads with where the returned queue requests sit.
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';
import { buildCrossDomainAnswer, mergeQueueEcho, queueFact, askedDims, HEADLINE_MAX } from '../lib/cross-domain-answer.mjs';
import { whereGridPowerAsk, dcPowerPlaceSequence } from '../lib/dc-power-place.mjs';
import { refinedQueueFacts } from '../lib/plan-step-facts.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));

// Live keyless shapes (2026-11-19 08:10Z), trimmed.
const INTEL_NOVA = { success: true, market: { id: 'northern-virginia', name: 'Ashburn' }, as_of: '2026-11-03T21:06:18',
  stats: { facility_count: 587, total_power_mw: 11313, mw_reporting_count: 200 }, siting: { dcpi: { verdict: 'AVOID', as_of: '2026-11-18T00:34:29Z' } } };
const GRID_PJM = { ok: true, tool: 'get_grid_intelligence', iso: 'PJM', as_of: '2026-11-19T07:00:00Z',
  taste: { headline: { name: 'demand_mw', value: 98081, unit: 'MW', as_of: '2026-11-19T07:00:00Z' } },
  _build_rate_pct_withheld: true, _operating_reserve_mw_withheld: true };
const RQ_VA = { count_total_matching: 312, filters_applied: { state: 'VA', iso: 'PJM', status: 'active' },
  freshness_by_iso: { PJM: { source_as_of: '2026-11-17' } } };
const TL_HELD = (st) => ({ state: st, timeline: [{ year: 2026, cumulative_firm_signal_mw: null, under_construction_mw: null, units: 41 }] });
const ENERGY_VA = { ok: true, tool: 'get_energy_prices', filter: { state: 'VA' }, as_of: '2026-08-31',
  taste: { headline: { name: 'retail_rate_cents_kwh', value: 10.63, unit: 'cents/kWh', sector: 'all-sector average', window: '2026', as_of: '2026-08-31' } } };
const QUEUE_ERCOT = { ok: true, tool: 'get_interconnection_queue', iso: 'ERCOT', as_of: '2026-11-19',
  taste: { headline: { name: 'queued_generation_gw', value: 461.4, unit: 'GW', as_of: '2026-10-31' }, project_count: { value: 1766 } } };
const TL_TX_ECHO = { state: 'TX', queue_context: { iso_reported: [{ iso: 'ERCOT', gw: 461.4, requests: 1847, as_of: '2026-10-31', primary: true }] },
  timeline: [{ year: 2026, cumulative_firm_signal_mw: null, under_construction_mw: null, units: 89 }] };
const row = (county, st = 'TX') => ({ county, state: st, iso: 'ERCOT' });
const RQ_TX = { count_total_matching: 1761, filters_applied: { state: 'TX', status: 'active' },
  freshness_by_iso: { ERCOT: { source_as_of: '2026-10-31' }, MISO: { source_as_of: '2026-11-19' } },
  summary: { by_fuel_class: { 'firm/baseload-capable': 175, intermittent: 25 } },
  results: [row('Fisher'), row('Leon'), row('Franklin'), row('Leon')] };

describe('6 xd-b: each asked power side gets a headline slot', () => {
  const QB = 'How do wholesale power prices, grid headroom and the PJM queue affect new data center capacity in Northern Virginia?';
  const executed = [
    ex(1, 'get_market_intel', { market: 'northern-virginia' }, INTEL_NOVA),
    ex(2, 'get_grid_intelligence', { iso: 'PJM' }, GRID_PJM),
    ex(3, 'get_refined_queue', { iso: 'PJM', state: 'VA' }, RQ_VA),
    ex(4, 'get_power_availability_timeline', { state: 'VA' }, TL_HELD('VA')),
    ex(5, 'get_energy_prices', { state: 'VA' }, ENERGY_VA),
  ];
  const ia = buildCrossDomainAnswer({ intent: QB, intent_class: 'dc_power_place', place: { label: 'Northern Virginia', state: 'VA', iso: 'PJM' } }, executed, asMap(executed));
  it('the queue slice, headroom and the retail price (labelled not wholesale) all reach the headline', () => {
    expect(ia.headline).toMatch(/PJM queue \(VA\): 312 active requests \(as of 2026-11-17\)/);
    expect(ia.headline).toMatch(/PJM headroom withheld/);
    expect(ia.headline).toMatch(/VA retail rate 10\.63 cents\/kWh \(EIA 2026 average, as of 2026-08-31; not wholesale\/LMP\)/);
    expect(ia.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });
  it('with less room the price keeps its slot in its short form, basis words kept', () => {
    const long = buildCrossDomainAnswer({ intent: QB, intent_class: 'dc_power_place',
      place: { label: 'Northern Virginia, Loudoun', state: 'VA', iso: 'PJM' } }, executed, asMap(executed));
    expect(long.headline).toMatch(/VA retail 10\.63 cents\/kWh \(EIA, as of 2026-08-31; not wholesale\)/);
    expect(long.headline).toMatch(/PJM headroom withheld/);
    expect(long.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });
  it('the timing line nobody asked for gives way and stays in evidence', () => {
    expect(ia.headline).not.toMatch(/firm-supply/);
    expect(ia.evidence.join(' ')).toMatch(/VA's EIA-860M firm-supply MW by year is withheld/);
  });
  it('askedDims reads the sides the question named', () => {
    expect([...askedDims(QB, true)].sort()).toEqual(['headroom', 'price', 'queue']);
    expect([...askedDims('Where in Texas can I get grid power the fastest for a data center?', false)]).toEqual(['timing']);
  });
});

describe('7 one count per GW figure', () => {
  it('the operator echo folds into the queue fact: one GW, the operator count, never the row count', () => {
    const QA = 'Where can I get 50 MW of colocation or powered capacity with power in under 24 months in Texas, and what do grid headroom and the interconnection queue look like there?';
    const executed = [
      ex(1, 'get_market_intel', { market: 'dallas' }, { ...INTEL_NOVA, market: { name: 'Dallas' } }),
      ex(2, 'get_interconnection_queue', { iso: 'ERCOT' }, QUEUE_ERCOT),
      ex(3, 'get_power_availability_timeline', { state: 'TX' }, TL_TX_ECHO),
    ];
    const ia = buildCrossDomainAnswer({ intent: QA, intent_class: 'dc_power_place', place: { label: 'Dallas', state: 'TX', iso: 'ERCOT' } }, executed, asMap(executed));
    const all = [ia.headline, ...ia.evidence, ...ia.facts.map((f) => f.text)].join(' ');
    const ev = ia.evidence.join(' ');
    expect(ev).toContain('ERCOT interconnection queue: 461.4 GW of requested generation across 1,847 requests (ERCOT report, as of 2026-10-31; generation, not load or headroom).');
    expect(all).not.toContain('1,766');   // DC Hub's row count is not ERCOT's GW basis
    expect(all).not.toMatch(/own reported generation queue/);
    expect(ia.facts.filter((f) => /461\.4 GW/.test(f.text))).toHaveLength(1);
    for (const f of ia.facts) expect(Object.keys(f).filter((k) => k.startsWith('_'))).toEqual([]);
  });
  it('a different GW is not folded', () => {
    const queues = new Map([['ERCOT', { _gw: 300, text: 'x' }]]);
    expect(mergeQueueEcho({ _echo: true, _iso: 'ERCOT', _gw: 461.4 }, queues)).toBe(false);
    expect(queues.get('ERCOT').text).toBe('x');
  });
  it('a fuel split over the reduced rows is not printed against the full total', () => {
    expect(refinedQueueFacts(RQ_TX)[0].text).toBe('US interconnection queue, TX slice: 1,761 active generation requests (ISO queue file, as of 2026-10-31; a request count, not MW or headroom).');
    expect(refinedQueueFacts({ ...RQ_TX, count_total_matching: 200 })[0].text).toMatch(/\(175 firm or baseload-capable\)/);
  });
});

describe('12 Q-d: where in Texas, fastest grid power', () => {
  const Q = 'Where in Texas can I get grid power the fastest for a data center?';
  it('whereGridPowerAsk: a where-in-state ask about getting power, not about the data centers already there', () => {
    expect(whereGridPowerAsk(Q)).toBe(true);
    expect(whereGridPowerAsk('Which parts of Ohio can get power soonest for a 100 MW campus?')).toBe(true);
    expect(whereGridPowerAsk('Where in Texas are the existing data center operators and how is the grid?')).toBe(false);
    expect(whereGridPowerAsk('How fast can a data center in Texas get grid power?')).toBe(false);
  });
  it('the plan reads the power side only', () => {
    const p = _planQuery(Q, {});
    expect(p.intent_class).toBe('dc_power_place');
    const tools = p.recommended_sequence.map((s) => s.tool);
    expect(tools).not.toContain('search_facilities');
    expect(tools).toEqual(expect.arrayContaining(['get_refined_queue', 'get_power_availability_timeline']));
    expect(dcPowerPlaceSequence({}, { state: 'TX' }, null, 'Texas data center grid queue').map((s) => s.tool)).toContain('search_facilities');
  });
  it('the lead says where the returned requests sit, the slice and the ERCOT-wide queue each once with their basis', () => {
    const executed = [
      ex(1, 'get_refined_queue', { state: 'TX' }, RQ_TX),
      ex(2, 'get_power_availability_timeline', { state: 'TX' }, TL_TX_ECHO),
    ];
    const ia = buildCrossDomainAnswer({ intent: Q, intent_class: 'dc_power_place', place: { label: 'TX', state: 'TX', iso: 'ERCOT' } }, executed, asMap(executed));
    expect(ia).toBeTruthy();
    expect(ia.headline).toMatch(/^TX \(ERCOT\)\. Power: TX queue requests returned sit in Leon County \(2\), Fisher County \(1\), Franklin County \(1\) \(4 rows shown of 1,761, not a TX county ranking\)/);
    expect(ia.headline).toMatch(/ERCOT queue \(TX\): 1,761 active requests \(as of 2026-10-31\)/);
    // Timing was asked (fastest): the withheld firm-supply line takes the slot; the ERCOT-wide GW stays in evidence once.
    expect(ia.headline).toMatch(/TX firm-supply MW \(EIA-860M\) withheld/);
    expect(ia.evidence.filter((x) => /461\.4 GW/.test(x))).toHaveLength(1);
    // Asked about the queue as well, the ERCOT-wide total is said once, ISO-wide, with its own report date.
    const iq = buildCrossDomainAnswer({ intent: `${Q} What does the queue look like?`, intent_class: 'dc_power_place', place: { label: 'TX', state: 'TX', iso: 'ERCOT' } }, executed, asMap(executed));
    expect(`${iq.headline} ${iq.evidence.join(' ')}`).not.toMatch(/\(as of 2026-10-31\) \(as of 2026-10-31\)/);
    expect(ia.headline).not.toMatch(/Data centers:/);
    expect(ia.not_established.join(' ')).not.toMatch(/facility search/);
    expect(ia.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });
});

describe('ERCOT queue: one GW, ERCOT\'s own count (2026-11-27)', () => {
  const FULL = { iso: 'ERCOT', queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-10-31', project_count: 1766,
    queued_generation_gw_not_comparable_to: 'DC Hub per-project interconnection-queue rows',
    queued_generation_gw_source: 'cited: ERCOT GIS Report, October 2026 (posted 2026-11-02), Summary sheet: 1,847 generation interconnection or change requests, 461,414 MW (~461.4 GW) under study as of Oct 31 2026' };
  const MISO = { iso: 'MISO', queued_generation_gw: 250.6, project_count: 1136, last_refreshed: '2026-11-27T06:05:09Z', source_as_of_basis: 'live_feed_fetch_date' };
  const fact = (p) => queueFact({ step: 2, tool: 'get_interconnection_queue', args: { iso: p.iso }, p });

  it('a full ERCOT read pairs its GW with ERCOT\'s 1,847 requests, never DC Hub\'s 1,766 rows', () => {
    const f = fact(FULL);
    expect(f.text).toBe('ERCOT interconnection queue: 461.4 GW of requested generation across 1,847 requests (ISO report, as of 2026-10-31; generation, not load or headroom).');
  });
  it('no request count in the cited line: no count at all', () => {
    expect(fact({ ...FULL, queued_generation_gw_source: null }).text).not.toMatch(/across/);
  });
  it('a preview ERCOT read (taste headline, no marker) never pairs the row count', () => {
    const f = fact({ iso: 'ERCOT', taste: { headline: { name: 'queued_generation_gw', value: 461.4, as_of: '2026-10-31' }, project_count: { value: 1766 } } });
    expect(f.text).not.toContain('1,766');
  });
  it('the served queued_generation_requests field wins over the cited line', () => {
    expect(fact({ ...FULL, queued_generation_requests: 1850 }).text).toContain('across 1,850 requests');
    expect(fact({ ...FULL, queued_generation_requests: 1850, queued_generation_gw_source: null }).text).toContain('across 1,850 requests');
  });
  it('a null field falls back to the cited line', () => {
    expect(fact({ ...FULL, queued_generation_requests: null }).text).toContain('across 1,847 requests');
  });
  it('MISO\'s live-feed GW keeps its own row count', () => {
    expect(fact(MISO).text).toContain('250.6 GW of requested generation across 1,136 projects');
  });
});
