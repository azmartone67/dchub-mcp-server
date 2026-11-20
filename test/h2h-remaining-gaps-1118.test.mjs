// h2h-remaining-gaps-1118.test.mjs — Grok's MCP head-to-head re-run (2026-11-18 10:37 MST, server 2.12.59, planner
// 5.40): the eight gaps that are planner or answer code. Planner 5.41.
//   1 Q-f   an address-shaped search hands get_facility the row that names the street, not a generic operator row
//   2 Q-d   a one-place power answer leads with the dated firm-supply figure (or says it is withheld), and never says
//           "no figure this caller can read" beside power data
//   3 xd-a  capacity_grid with a deadline reads each finalist's state timeline and names its dated firm supply
//   4 xd-b  a colocation-price wholesale ask leads with the ISO wholesale figure or says the LMP is not served
//     e1    price_now says live load or that it is withheld, and is dated by the LMP interval
//   5 e2    a state queue asked with a size floor leads with the state count and says whether the floor applied
//   6 e7    a withdrawn count of 0 is not a fact beside "not served"
//   7 e8    a price ask about Germany vs France reads no facility step and leads with one coverage sentence
//   8       the Dallas fiber ranking is dated by its live PeeringDB read, not the March curated baseline
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { facilitySlugsFromSearch } from '../lib/colocation-plan.mjs';
import { buildCrossDomainAnswer, capacityGridSequence, timelineMwWithheld } from '../lib/cross-domain-answer.mjs';
import { buildPriceNowAnswer, buildQueueWithdrawalsAnswer, buildQueueSliceAnswer } from '../lib/energy-answers.mjs';
import { buildColocationAnswer } from '../lib/colocation-answer.mjs';
import { refinedQueueFacts } from '../lib/plan-step-facts.mjs';
import { geographyScopeLine } from '../lib/plan-lead-text.mjs';
import { buildFiberAnswer } from '../lib/fiber-answer.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const tools = (p) => p.recommended_sequence.map((s) => s.tool);

it('is planner 5.41', () => { expect(PLANNER_VERSION).toBe('5.47'); });

describe('1 Q-f: the Cermak building, not the operator row the search ranked first', () => {
  const SEARCH = { data: [
    { slug: 'equinix-llc-chicago-b613a074', name: 'EQUINIX LLC', city: 'CHICAGO' },
    { slug: 'digital-realty-digital-realty-chi-350-e-cermak-8b961839', name: 'Digital Realty CHI (350 E Cermak)', city: 'Chicago' },
    { slug: 'colocation-america-corporation-cdc1-350-e-cermak-rd-933daaf8', name: 'CDC1 - 350 E Cermak Rd', city: 'Chicago' },
  ] };
  it('an address query puts the rows naming the street first, keeping all three', () => {
    const s = facilitySlugsFromSearch(SEARCH, 3, '350 E Cermak');
    expect(s[0]).toMatch(/350-e-cermak/);
    expect(s[1]).toMatch(/350-e-cermak/);
    expect(s).toContain('equinix-llc-chicago-b613a074');
  });
  it('a name query keeps the search order', () => {
    expect(facilitySlugsFromSearch(SEARCH, 3, 'Equinix Chicago')[0]).toBe('equinix-llc-chicago-b613a074');
    expect(facilitySlugsFromSearch(SEARCH, 3)[0]).toBe('equinix-llc-chicago-b613a074');
  });
  it('the profile read at the street clears "No facility profile ... was read"', () => {
    const rows = [
      ex(1, 'get_market_dcpi_rank', { market_slug: 'chicago' }, { verdict: 'AVOID', composite_score: 21.9 }),
      ex(4, 'search_facilities', { query: '350 E Cermak', state: 'IL', limit: 3 }, SEARCH),
      ex(5, 'get_facility', { slug: facilitySlugsFromSearch(SEARCH, 3, '350 E Cermak')[0] }, { data: { name: 'Digital Realty CHI (350 E Cermak)' } }),
    ];
    const a = buildColocationAnswer({ intent_class: 'colocation', intent: 'Colocation at 350 E Cermak, Chicago',
      metro: { id: 'chicago', label: 'Chicago', dcpi_slug: 'chicago' }, address: '350 E Cermak' }, rows, null);
    expect(a.not_established.join(' ')).not.toMatch(/No facility profile at 350 E Cermak was read/);
  });
});

const TL_TX = { state: 'TX', sources: { planned_generators: { vintage: '2026-09-30' } },
  queue_context: { iso_reported: [{ iso: 'ERCOT', gw: 461.4, requests: 1847, as_of: '2026-10-31' }] },
  timeline: [{ year: 2026, cumulative_firm_signal_mw: 16796, under_construction_mw: 9000, units: 89 }, { year: 2027, cumulative_firm_signal_mw: 21000, units: 40 }] };
const TL_HELD = { state: 'TX', queue_context: TL_TX.queue_context,
  timeline: [{ year: 2026, cumulative_firm_signal_mw: null, under_construction_mw: null, units: 89 }] };
const RQ_TX = { count_total_matching: 1761, filters_applied: { state: 'TX', status: 'active' },
  freshness_by_iso: { ERCOT: { source_as_of: '2026-10-31' } } };

describe('2 Q-d: Texas fastest grid power', () => {
  const Q = 'Where in Texas can I get grid power the fastest for a data center?';
  const run = (tl) => buildCrossDomainAnswer({ intent: Q, intent_class: 'dc_power_place', place: { label: 'TX', state: 'TX', iso: 'ERCOT' } }, [
    ex(1, 'search_facilities', { state: 'TX', limit: 10 }, { data: [] }),
    ex(2, 'get_refined_queue', { state: 'TX' }, RQ_TX),
    ex(3, 'get_power_availability_timeline', { state: 'TX' }, tl),
  ], null);
  it('the lead carries the dated 2026 firm-supply figure', () => {
    const a = run(TL_TX);
    expect(a.headline).toMatch(/TX 2026 firm-supply signal: 16,796 MW \(as of 2026-09-30\)/);
    expect(a.headline).not.toMatch(/no figure this caller can read/);
    expect(a.not_established.join(' ')).toMatch(/facility search returned no data-center figure/);
  });
  it('a withheld timeline is said as withheld in the lead', () => {
    const a = run(TL_HELD);
    expect(a.headline).toMatch(/TX firm-supply MW \(EIA-860M\) withheld at this access level/);
    expect(a.headline).not.toMatch(/no figure this caller can read/);
  });
  it('timelineMwWithheld reads units with no MW as withheld', () => {
    expect(timelineMwWithheld(TL_HELD)).toBe(true);
    expect(timelineMwWithheld(TL_TX)).toBe(false);
    expect(timelineMwWithheld({ timeline: [{ year: 2026, units: 0 }] })).toBe(false);
  });
});

describe('3 xd-a: 50 MW with power in 24 months', () => {
  const Q = 'Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do grid headroom and the interconnection queue look like there?';
  it('the plan reads each finalist state timeline before Capacity Source', () => {
    const p = _planQuery(Q, {});
    expect(p.intent_class).toBe('capacity_grid');
    const t = p.recommended_sequence.find((s) => s.tool === 'get_power_availability_timeline');
    expect(t.args_hint.state).toMatch(/^<finalist_state/);
    expect(t.estimated_calls).toBe(3);
    expect(tools(p).at(-1)).toBe('source_capacity');
  });
  it('no deadline, no timeline step', () => {
    expect(capacityGridSequence({ mw: 50 }).map((s) => s.tool)).not.toContain('get_power_availability_timeline');
  });
  it('the lead names three markets, each with a dated state firm-supply figure', () => {
    const CANVAS = { shortlist: [
      { market: 'Midland–Odessa', state: 'TX', iso: 'ERCOT', verdict: 'BUILD', _time_to_power_months_withheld: true },
      { market: 'Upper Peninsula', state: 'MI', iso: 'MISO', verdict: 'BUILD', _time_to_power_months_withheld: true },
      { market: 'Williston', state: 'ND', iso: 'MISO', verdict: 'BUILD', _time_to_power_months_withheld: true },
    ], citation: { retrieved_at: '2026-11-18T17:00:00Z' } };
    const tl = (st, mw) => ({ state: st, sources: { planned_generators: { vintage: '2026-09-30' } }, timeline: [{ year: 2026, cumulative_firm_signal_mw: mw, units: 5 }] });
    const a = buildCrossDomainAnswer({ intent: Q, intent_class: 'capacity_grid', requested_mw: 50, deadline_months: 24 }, [
      ex(1, 'site_selection_canvas', { capacity_mw: 50, max_months: 24 }, CANVAS),
      ex(2, 'get_interconnection_queue', { iso: 'ERCOT' }, { iso: 'ERCOT', queued_generation_gw: 461.4 }),
      ex(4, 'get_power_availability_timeline', { state: 'TX' }, tl('TX', 16796)),
      ex(4, 'get_power_availability_timeline', { state: 'MI' }, tl('MI', 2100)),
      ex(4, 'get_power_availability_timeline', { state: 'ND' }, tl('ND', 640)),
      ex(5, 'source_capacity', { min_mw: 50 }, { items: [] }),
    ], null);
    expect(a.headline).toMatch(/Midland–Odessa TX \(ERCOT; TX-wide 2026 firm supply 16,796 MW\)/);
    expect(a.headline).toMatch(/MI-wide 2026 firm supply 2,100 MW/);
    expect(a.headline).toMatch(/ND-wide 2026 firm supply 640 MW/);
    expect(a.headline).toMatch(/EIA-860M state totals, as of 2026-09-30/);
    expect(a.headline).toMatch(/24-month cut not applied/);
    expect(a.facts.filter((f) => f.tool === 'get_power_availability_timeline')).toHaveLength(3);
  });
});

describe('4 xd-b and e1: wholesale prices and load', () => {
  it('e1: the LMP leads, load is said withheld with its hour, and the answer is dated by the interval', () => {
    const EP = { wholesale_lmp: { iso: 'ERCOT', hub: 'HB_HUBAVG', source: 'ERCOT', real_time: { lmp_usd_mwh: 7.37, interval_ending: '2026-11-18T17:40:17Z', as_of: '2026-11-18T17:40:17Z' } },
      taste: { headline: { value: 7.68, unit: 'cents/kWh', sector: 'all-sector average', window: '2026', as_of: '2026-08-31' } } };
    const GD = { iso: 'ERCOT', demand_mw: null, demand_period: '2026-11-18T16' };
    const rows = [ex(1, 'get_energy_prices', { iso: 'ERCOT' }, EP), ex(2, 'get_grid_data', { iso: 'ERCOT', metric: 'demand' }, GD)];
    const a = buildPriceNowAnswer({ intent: 'What is the ERCOT power price and system load right now?', intent_class: 'price_now' }, rows, null);
    expect(a.headline).toMatch(/real-time LMP: \$7\.37\/MWh/);
    expect(a.headline).toMatch(/ERCOT system load \(EIA-930 hourly demand, hour 2026-11-18T16 UTC\) is withheld at this access level/);
    expect(a.as_of).toBe('2026-11-18');
    const read = buildPriceNowAnswer({ intent: 'ERCOT price and load now', intent_class: 'price_now' },
      [rows[0], ex(2, 'get_grid_data', { iso: 'ERCOT' }, { iso: 'ERCOT', demand_mw: 51615, newest_at: '2026-11-18T16:00:00Z' })], null);
    expect(read.headline).toMatch(/demand 51,615 MW/);
  });
  it('xd-b: a wholesale ask leads with the PJM published figure and says the LMP is not served', () => {
    const EP = { wholesale_lmp: null, wholesale_lmp_withheld: { iso: 'PJM', reason: "PJM's Data Miner 2 terms forbid publishing its data without PJM membership" },
      wholesale_context: { iso: 'PJM', figures: [{ name: 'Base Residual Auction (capacity) clearing price', value: 325, unit: '$/MW-day (UCAP)', period: '2028/2029 delivery year', published: '2026-07-14', source: 'PJM Interconnection' }] },
      taste: { headline: { value: 10.63, unit: 'cents/kWh', sector: 'all-sector average', window: '2026', as_of: '2026-08-31' } } };
    const rows = [ex(1, 'get_market_dcpi_rank', { market_slug: 'northern-virginia' }, { verdict: 'AVOID', composite_score: 20 }),
      ex(2, 'get_energy_prices', { iso: 'PJM', state: 'VA' }, EP)];
    const a = buildColocationAnswer({ intent: 'What are wholesale power prices in Northern Virginia and how much colocation capacity is there?', intent_class: 'pricing_out_of_scope',
      metro: { id: 'nova', label: 'Northern Virginia', dcpi_slug: 'northern-virginia' } }, rows, null);
    const i = a.headline.indexOf('PJM wholesale LMP is not served');
    expect(i).toBeGreaterThan(0);
    expect(a.headline).toMatch(/Base Residual Auction \(capacity\) clearing price: \$325/);
    expect(i).toBeLessThan(a.headline.indexOf('retail electricity rate'));
  });
});

describe('5 e2: VA projects of 100 MW or more', () => {
  const Q = 'How many projects of 100 MW or more are in the interconnection queue in Virginia?';
  const RQ = (min) => ({ count_total_matching: min ? 50 : 310, total_queued_mw: min ? 21400 : null,
    filters_applied: { state: 'VA', status: 'active', min_mw: min, ...(min ? {} : { _min_mw_not_applied: 'not applied' }) },
    freshness_by_iso: { PJM: { source_as_of: '2026-11-18' } } });
  const IQ = { iso: 'PJM', queued_generation_gw: 373.5 };
  const run = (min) => buildQueueSliceAnswer({ intent: Q, intent_class: 'interconnection_queue' }, [
    ex(1, 'get_interconnection_queue', {}, IQ), ex(2, 'get_refined_queue', { state: 'VA', min_mw: 100 }, RQ(min))], null);
  it('the floor applied: the lead starts with the VA count of 100 MW or more', () => {
    const a = run(100);
    expect(a.headline.startsWith('VA interconnection queue: 50 active requests of 100 MW or more, 21,400 MW in all (ISO queue files, as of 2026-11-18)')).toBe(true);
    expect(a.headline.indexOf('VA')).toBeLessThan(a.headline.search(/373\.5/) === -1 ? Infinity : a.headline.search(/373\.5/));
  });
  it('the floor not applied: says so, never calls 310 the >=100 MW count', () => {
    const a = run(null);
    expect(a.headline.startsWith('VA interconnection queue: 310 active requests of all sizes')).toBe(true);
    expect(a.headline).toMatch(/100 MW floor was not applied at this access level/);
    expect(a.not_established.join(' ')).toMatch(/100 MW or more/);
  });
  it('no size floor asked: this answer stays out', () => {
    expect(buildQueueSliceAnswer({ intent_class: 'interconnection_queue' }, [ex(2, 'get_refined_queue', { state: 'VA' }, RQ(null))], null)).toBe(null);
  });
});

describe('6 e7: withdrawals not served', () => {
  const RQ0 = { count_total_matching: 0, filters_applied: { iso: 'PJM', status: 'withdrawn' } };
  it('a zero withdrawn count is not a fact', () => {
    expect(refinedQueueFacts(RQ0)).toEqual([]);
    expect(refinedQueueFacts({ ...RQ0, count_total_matching: 12 })[0].text).toMatch(/12 withdrawn/);
  });
  it('the answer says not served with no "0 withdrawn" anywhere', () => {
    const a = buildQueueWithdrawalsAnswer({ intent_class: 'queue_withdrawals' }, [
      ex(1, 'get_refined_queue', { iso: 'PJM', status: 'withdrawn' }, RQ0), ex(2, 'get_interconnection_queue', { iso: 'PJM' }, { iso: 'PJM', queued_generation_gw: 373.5 })], null);
    expect(a.headline).toMatch(/not served yet/);
    expect(JSON.stringify(a)).not.toMatch(/\b0 withdrawn/);
  });
});

describe('7 e8: Germany vs France day-ahead prices', () => {
  const Q = 'Compare day-ahead electricity prices in Germany vs France';
  it('reads only the two grids: no facility search, no capacity listing', () => {
    const p = _planQuery(Q, {});
    expect(tools(p)).not.toContain('search_facilities');
    expect(tools(p)).not.toContain('source_capacity');
    expect(p.geography_scope.price_not_covered).toBe(true);
  });
  it('the lead is one outside-coverage sentence for the prices', () => {
    const line = geographyScopeLine({ geography_scope: { name: 'Germany and France', price_not_covered: true } });
    expect(line).toMatch(/^Day-ahead and wholesale power prices for Germany and France are outside DC Hub's coverage/);
  });
  it('a non-price question about the two countries keeps its facility steps, and the plural reads "are"', () => {
    expect(tools(_planQuery('compare Germany vs France for a 100 MW campus', {}))).toContain('search_facilities');
    expect(geographyScopeLine({ geography_scope: { name: 'Germany and France' } })).toMatch(/^Germany and France are outside/);
  });
});

describe('8 Dallas fiber: the ranking is dated by the live PeeringDB read', () => {
  const Q = 'Which Dallas carrier hotels have the most networks?';
  const METRO = { market: 'Dallas-Fort Worth', baseline: { as_of: '2026-03-17' }, summary: { key_carrier_hotels: ['Hotel Alpha'] } };
  const peer = (n) => ({ source: 'PeeringDB', location: { radius_deg: 0.5 }, provenance: { retrieved_at: '2026-11-18T17:59:26.042Z' },
    connectivity: { facilities_nearby: 50, top_facilities: [
      { name: 'Equinix DA1 - Dallas', net_count: n ? 300 : null }, { name: 'Equinix DA3 - Dallas', net_count: n ? 200 : null }, { name: 'Equinix DA6 - Dallas', net_count: n ? 150 : null }] } });
  const run = (n) => buildFiberAnswer({ intent: Q, intent_class: 'fiber' }, [
    ex(1, 'get_metro_fiber', { market: 'Dallas-Fort Worth' }, METRO), ex(2, 'get_peering_intel', { lat: 32.7767, lon: -96.797 }, peer(n))], null);
  it('counts read: each hotel has its count, dated by the live read', () => {
    const a = run(true);
    expect(a.headline).toMatch(/Equinix DA1 - Dallas \(300 networks\); Equinix DA3 - Dallas \(200 networks\); Equinix DA6 - Dallas \(150 networks\) \(PeeringDB, read live on 2026-11-18\)/);
    expect(a.as_of).toBe('2026-11-18');
  });
  it('counts withheld: said as withheld, still dated by the live read', () => {
    const a = run(false);
    expect(a.headline).toMatch(/PeeringDB, read live on 2026-11-18; the per-facility network counts are withheld at this access level/);
    expect(a.as_of).toBe('2026-11-18');
  });
});
