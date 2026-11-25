// answer-composition-1124.test.mjs — Grok Brain note 2026-11-24, items 3, 4 and 5.
//   3  Beaumeade site screen: the headline said the parcel point's FEMA NFHL zone X (panel, date) while an evidence
//      line said "FEMA flood zone at the point: not available (the NFHL query failed)". One flood line per answer.
//   4  xd-b (PJM / Virginia power + price): the market-monitor LMP and auction prices sat in evidence with no headline
//      clause, and as_of read 2024-07-30 (a superseded 2025/26 auction). Superseded figures are dropped and the lead
//      carries one wholesale clause built from the served figures.
//   5  p4 ERCOT North: "$60.69/MWh (...; stale)" on a 32-minute-old interval, and no recent average. The age is said in
//      minutes, "stale" only at an hour or more, and a served recent average / next-day range is said with its window.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteScreenFacts } from '../lib/site-screen-facts.mjs';
import { buildCrossDomainAnswer, HEADLINE_MAX } from '../lib/cross-domain-answer.mjs';
import { lmpFact, currentWholesaleFigures, trimWholesaleContext, wholesaleContextLead, buildPriceNowAnswer } from '../lib/energy-answers.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));

// ---- item 3 ----
const PT = { lat: 39.0438, lon: -77.4874 };
const COUNTY = { coverage: 'validated', hazards: { 'Riverine Flooding': 'Relatively Moderate' },
  location: { county: 'Loudoun', state: 'Virginia' }, disaster_risk: { rating: 'Relatively Low' } };
const DR_FAILED = { ...COUNTY, flood_zone_at_point: { status: 'unavailable' } };
const DR_ZONE = { ...COUNTY, flood_zone_at_point: { status: 'measured', zone: 'X', zone_subtype: 'AREA OF MINIMAL FLOOD HAZARD',
  special_flood_hazard_area: false, firm_panel: '51107C0265E', panel_effective_date: '2017-02-17' } };
const PARCEL_FLOOD = { status: 'measured', zone: 'X', zone_subtype: 'AREA OF MINIMAL FLOOD HAZARD', sfha: false,
  firm_panel: '51107C0265E', panel_effective_date: '2017-02-17', static_bfe_ft: null, as_of: '2017-02-17',
  confirm: 'Confirm any flood determination on the official FEMA map.' };
const PARCEL = (flood) => ({ _entity: 'parcel_analysis', ok: true, total_acres: 12.3,
  hosted_parcel: { parcel_id: 'LOUD-9', county: 'Loudoun', state: 'VA' }, flood });
const ASK3 = 'Screen 21571 Beaumeade Circle, Ashburn VA for flood zone, zoning and parcel';
const floodLines = (r) => r.lines.filter((l) => /^Flood\b/.test(l.text));

describe('item 3: one flood line per answer', () => {
  it('parcel served zone X, disaster-risk NFHL failed: exactly one flood line, no "query failed"', () => {
    const r = siteScreenFacts([ex(1, 'get_disaster_risk', PT, DR_FAILED), ex(2, 'analyze_parcel', PT, PARCEL(PARCEL_FLOOD))], null, ASK3);
    const fl = floodLines(r);
    expect(fl).toHaveLength(1);
    expect(fl[0].text).toMatch(/Zone X/);
    expect(fl[0].text).toMatch(/FIRM panel 51107C0265E effective 2017-02-17/);
    expect(fl[0].text).toMatch(/County context: Loudoun County, Virginia rates riverine flooding Relatively Moderate/);
    const all = [r.flood, ...r.lines.map((l) => l.text), ...r.not_established].join(' ');
    expect(all).not.toMatch(/NFHL query failed|not available/);
    expect(r.flood).toBe(fl[0].text);
  });
  it('both reads served a zone: one line (the parcel one, it carries the BFE)', () => {
    const r = siteScreenFacts([ex(1, 'get_disaster_risk', PT, DR_ZONE), ex(2, 'analyze_parcel', PT, PARCEL(PARCEL_FLOOD))], null, ASK3);
    expect(floodLines(r)).toHaveLength(1);
    expect(floodLines(r)[0].tool).toBe('analyze_parcel');
  });
  it('disaster-risk served the zone, the parcel flood read timed out: one line, the zone, no "no answer"', () => {
    const r = siteScreenFacts([ex(1, 'get_disaster_risk', PT, DR_ZONE), ex(2, 'analyze_parcel', PT, PARCEL({ status: 'timed_out' }))], null, ASK3);
    const fl = floodLines(r);
    expect(fl).toHaveLength(1);
    expect(fl[0].text).toMatch(/FEMA flood zone X/);
    expect(fl[0].text).not.toMatch(/no answer|did not answer/);
  });
  it('the parcel read says no flood map covers the point, the disaster-risk read failed: the map answer is the one line', () => {
    const r = siteScreenFacts([ex(1, 'get_disaster_risk', PT, DR_FAILED), ex(2, 'analyze_parcel', PT, PARCEL({ status: 'not_mapped' }))], null, ASK3);
    const fl = floodLines(r);
    expect(fl).toHaveLength(1);
    expect(fl[0].text).toMatch(/FEMA maps no flood zone here/);
    expect(fl[0].text).not.toMatch(/query failed/);
  });
  it('neither served a zone: the one disaster-risk line says so (never invents a zone)', () => {
    const r = siteScreenFacts([ex(1, 'get_disaster_risk', PT, DR_FAILED), ex(2, 'analyze_parcel', PT, PARCEL({ status: 'unavailable' }))], null, ASK3);
    const fl = floodLines(r);
    expect(fl).toHaveLength(1);
    expect(fl[0].text).toMatch(/not available/);
    expect(fl[0].text).not.toMatch(/Zone X|zone X/);
  });
});

// ---- item 4 ----
const PJM_CTX = JSON.parse(readFileSync(new URL('./fixtures/pjm-wholesale-context-1124.json', import.meta.url), 'utf8'));
const INTEL_NOVA = { success: true, market: { id: 'northern-virginia', name: 'Ashburn' }, as_of: '2026-11-03T21:06:18',
  stats: { facility_count: 587, total_power_mw: 11313, mw_reporting_count: 200 }, siting: { dcpi: { verdict: 'AVOID', as_of: '2026-11-24T00:34:29Z' } } };
const GRID_PJM = { ok: true, tool: 'get_grid_intelligence', iso: 'PJM', as_of: '2026-11-25T00:00:00Z',
  taste: { headline: { name: 'demand_mw', value: 105545, unit: 'MW', as_of: '2026-11-25T00:00:00Z' } },
  _build_rate_pct_withheld: true, _operating_reserve_mw_withheld: true };
const RQ_VA = { count_total_matching: 312, filters_applied: { state: 'VA', iso: 'PJM', status: 'active' },
  freshness_by_iso: { PJM: { source_as_of: '2026-11-24' } } };
const TL_VA = { state: 'VA', timeline: [{ year: 2026, cumulative_firm_signal_mw: null, under_construction_mw: null, units: 16 }] };
const ENERGY_VA = { ok: true, tool: 'get_energy_prices', filter: { state: 'VA' }, as_of: '2026-08-31',
  taste: { headline: { name: 'retail_rate_cents_kwh', value: 10.63, unit: 'cents/kWh', sector: 'all-sector average', window: '2026', as_of: '2026-08-31' } } };
const EP_PJM = (ctx) => ({ ok: true, tool: 'get_energy_prices', filter: { iso: 'PJM' }, as_of: '2026-08-31', wholesale_lmp: null,
  wholesale_lmp_withheld: { iso: 'PJM', reason: "PJM's Data Miner 2 terms forbid publishing its data without PJM membership" },
  wholesale_context: ctx, taste: ENERGY_VA.taste });
const QB = 'How do wholesale power prices, grid headroom and the PJM queue affect new data center capacity in Northern Virginia?';
const xdb = (ep) => {
  const executed = [
    ex(1, 'get_market_intel', { market: 'northern-virginia' }, INTEL_NOVA),
    ex(2, 'get_grid_intelligence', { iso: 'PJM' }, GRID_PJM),
    ex(3, 'get_refined_queue', { iso: 'PJM', state: 'VA' }, RQ_VA),
    ex(4, 'get_power_availability_timeline', { state: 'VA' }, TL_VA),
    ex(5, 'get_energy_prices', { state: 'VA' }, ENERGY_VA),
    ex(6, 'get_energy_prices', { iso: 'PJM' }, ep),
  ];
  return buildCrossDomainAnswer({ intent: QB, intent_class: 'dc_power_place', place: { label: 'Northern Virginia', state: 'VA', iso: 'PJM' } }, executed, asMap(executed));
};

describe('item 4: PJM wholesale clause and a current as_of', () => {
  it('superseded figures are dropped: the latest two auction years, the latest monitor report', () => {
    const { kept, omitted } = currentWholesaleFigures(PJM_CTX.figures);
    expect(omitted).toBe(6);
    expect(kept.map((g) => g.published).sort()[0]).toBe('2025-12-17');
    expect(kept.filter((g) => /Base Residual/.test(g.name)).map((g) => g.period)).toEqual(['2028/2029 delivery year', '2027/2028 delivery year']);
    expect(kept.filter((g) => /LMP/.test(g.name)).every((g) => g.published === '2026-11-12')).toBe(true);
    const t = trimWholesaleContext({ wholesale_context: PJM_CTX });
    expect(t.wholesale_context.figures).toHaveLength(4);
    expect(t.wholesale_context.superseded_figures_omitted).toBe(6);
    expect(trimWholesaleContext(null)).toBe(null);
  });
  it('the headline carries a $/MWh figure with its period and source, built from the served values', () => {
    const a = xdb(EP_PJM(PJM_CTX));
    expect(a.headline).toMatch(/real-time (?:load-weighted )?LMP \$74\.98\/MWh \(Jan-Sep 2026, IMM\)/);
    expect(a.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
    // the clause follows the data, not a literal
    const moved = { ...PJM_CTX, figures: PJM_CTX.figures.map((g) => (g.value === 74.98 ? { ...g, value: 81.5 } : g)) };
    expect(xdb(EP_PJM(moved)).headline).toMatch(/\$81\.5\/MWh/);
  });
  it('as_of is the oldest input and is no older than the 2027/28 auction report', () => {
    const a = xdb(EP_PJM(trimWholesaleContext({ wholesale_context: PJM_CTX }).wholesale_context));
    expect(a.as_of >= '2025-12-17').toBe(true);
    const untrimmed = xdb(EP_PJM(PJM_CTX));
    expect(untrimmed.as_of >= '2025-12-17').toBe(true);
    expect(untrimmed.evidence.join(' ')).not.toMatch(/2025\/2026 delivery year|2026\/2027 delivery year/);
  });
  it('the capacity range spans the current delivery years', () => {
    const l = wholesaleContextLead({ args: { iso: 'PJM' }, p: { wholesale_context: PJM_CTX } });
    expect(l.short).toBe('PJM wholesale: real-time load-weighted LMP $74.98/MWh (Jan-Sep 2026, IMM); capacity $325-333.44/MW-day (2027/28 to 2028/29)');
  });
  it('the withheld note says the live LMP is what is not served', () => {
    const a = xdb(EP_PJM(PJM_CTX));
    expect(a.not_established.join(' ')).toMatch(/PJM live wholesale LMP is not served \(the LMP figures quoted are published report averages\)/);
    // capacity figures only: no LMP average is quoted, so the note keeps its plain form
    const capOnly = { ...PJM_CTX, figures: PJM_CTX.figures.filter((g) => /MW-day/.test(g.unit)) };
    expect(xdb(EP_PJM(capOnly)).not_established.join(' ')).toMatch(/PJM wholesale LMP is not served: /);
  });
});

// ---- item 5 ----
const NOW = Date.parse('2026-11-25T00:42:00Z');   // 17:42 MST
const RT = (ending, stale, extra = {}) => ({ wholesale_lmp: { iso: 'ERCOT', hub: 'HB_NORTH', source: 'ERCOT',
  real_time: { lmp_usd_mwh: 60.69, interval_ending: ending, as_of: ending, market: 'RTM', stale, stale_after_minutes: 30 },
  day_ahead: null, ...extra } });
const s5 = (p) => ({ tool: 'get_energy_prices', step: 1, args: { iso: 'ERCOT', hub: 'HB_NORTH' }, p });

describe('item 5: ERCOT hub price, its age and the recent average', () => {
  it('a 32-minute-old interval flagged by the backend says its age, never "stale"', () => {
    const f = lmpFact(s5(RT('2026-11-25T00:10:00Z', true)), NOW);
    expect(f.text).toMatch(/real-time LMP: \$60\.69\/MWh/);
    expect(f.text).toMatch(/32 min old/);
    expect(f.text).not.toMatch(/stale/);
  });
  it('an interval an hour or more old is stale', () => {
    expect(lmpFact(s5(RT('2026-11-24T23:30:00Z', true)), NOW).text).toMatch(/stale, 72 min old/);
  });
  it('a served recent average and next-day range are said with their windows', () => {
    const p = RT('2026-11-25T00:35:00Z', false, {
      recent_average: { lmp_usd_mwh: 41.27, intervals: 24, window_start: '2026-11-24T22:40:00Z', window_end: '2026-11-25T00:35:00Z' },
      day_ahead_range: { min_usd_mwh: 22.1, max_usd_mwh: 88.4, delivery_date: '2026-11-25' } });
    const f = lmpFact(s5(p), NOW);
    expect(f.text).toMatch(/recent average \$41\.27\/MWh over 24 intervals \(.+ to .+\)/);
    expect(f.text).toMatch(/day-ahead \$22\.1-\$88\.4\/MWh for 2026-11-25/);
    expect(f.text).not.toMatch(/stale|min old/);
    const a = buildPriceNowAnswer({ intent: 'what is the ERCOT North hub price and what has it averaged recently', intent_class: 'price_now' },
      [ex(1, 'get_energy_prices', { iso: 'ERCOT', hub: 'HB_NORTH' }, p)], null);
    expect(a.headline).toMatch(/recent average \$41\.27\/MWh/);
  });
});
