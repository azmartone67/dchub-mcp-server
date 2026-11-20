// grok-daily-1119b.test.mjs -- Grok's daily MCP leadership note (2026-11-19), planner 5.48.
//   P1  a site screen at a street address reads the geocoded ADDRESS, never the market's default point; an address
//       the geocoder cannot place runs no point read and says "The address could not be located; give lat/lon"
//   2   permitting "most recent" ranks by the record's own as_of (never the bulk-load updated_at)
//   5   an LMP-led energy-price answer is dated by its interval; the retail month is context
//   6   a Henry Hub ask leads with the Henry Hub figure; the gas-economics market label is title-cased
//   7   power timing with no time-to-power figure says so in not_established
//   10  asked power sides keep their slot: the queue GW beside the state count, firm supply when asked
//   14  get_facility evidence names say provider + name
import { describe, it, expect } from 'vitest';
import { _planQuery, _execGeocodePlan, _execAddressGeo, _execInjectGeo, _execResolveArgs } from '../server.mjs';
import { streetAddressOf, addressPointOk, addressMissAnswer } from '../lib/street-address.mjs';
import { buildPermittingAnswer } from '../lib/permitting-answer.mjs';
import { buildGasPriceAnswer, buildPriceNowAnswer } from '../lib/energy-answers.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';
import { buildPlanFactHeader, priceNowDates } from '../lib/plan-fact-header.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';
import { buildCrossDomainAnswer, HEADLINE_MAX } from '../lib/cross-domain-answer.mjs';
import { buildColocationAnswer } from '../lib/colocation-answer.mjs';

const ex = (step, tool, args, result, extra = {}) => ({ step, tool, args, status: 'executed', result, ...extra });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));

const POINT_TOOLS = new Set(['analyze_site', 'analyze_parcel', 'get_disaster_risk', 'get_water_risk', 'get_composite_site_score',
  'get_infrastructure', 'get_climate_intel', 'get_fiber_readiness']);
const BEAUMEADE = 'Screen the site at 21571 Beaumeade Circle, Ashburn VA for a 60 MW data center: power, parcel, flood';
// What GET /api/v1/geocode answered for this address on 2026-11-19 (ArcGIS World Geocoder).
const GEO_HIT = { lat: 39.022189829975, lng: -77.453582639552, label: '21571 Beaumeade Cir, Ashburn, Virginia, 20147', source: 'ArcGIS World Geocoder' };
// ...and for an address that does not exist in Ashburn: the TOWN's point, labelled with the town alone.
const GEO_TOWN = { lat: 39.0427652, lng: -77.4858142, label: 'Ashburn, Virginia', source: 'ArcGIS World Geocoder' };
const ASHBURN_DEFAULT = { lat: 39.0438, lon: -77.4874 };

describe('P1: a street address is the site', () => {
  it('reads the address from the question, with its town and state', () => {
    expect(streetAddressOf(BEAUMEADE)).toMatchObject({ query: '21571 Beaumeade Circle, Ashburn, VA', number: '21571', state: 'VA' });
    expect(streetAddressOf('Screen 1 Main St, Washington DC')).toMatchObject({ query: '1 Main St, Washington, DC', state: 'DC' });
    expect(streetAddressOf('flood risk at 44 Elm Road, Columbus, Ohio')).toMatchObject({ query: '44 Elm Road, Columbus, OH' });
    // sizes and plain numbers are not addresses
    expect(streetAddressOf('100 MW at Main Street in Ashburn')).toBeNull();
    expect(streetAddressOf('Screen the site at 39.02, -77.45 for a 60 MW data center')).toBeNull();
    expect(streetAddressOf('how soon can a 100 MW load get power in ERCOT')).toBeNull();
  });

  it('plans every point read on the geocoded address, not the Ashburn default point', async () => {
    const p = _planQuery(BEAUMEADE);
    expect(p.intent_class).toBe('site_analysis');
    const seq = structuredClone(p.recommended_sequence);
    const pts = seq.filter((s) => POINT_TOOLS.has(s.tool));
    expect(pts.map((s) => s.tool)).toEqual(expect.arrayContaining(['analyze_site', 'analyze_parcel', 'get_disaster_risk', 'get_water_risk']));
    for (const s of pts) expect(s).toMatchObject({ geocode: '21571 Beaumeade Circle, Ashburn, VA', geocode_basis: 'address' });
    const asked = [];
    const geo = await _execGeocodePlan(seq, async (q) => { asked.push(q); return GEO_HIT; });
    expect(asked).toEqual(['21571 Beaumeade Circle, Ashburn, VA']);
    expect(geo[0]).toMatchObject({ basis: 'address', steps: pts.length });
    for (const s of seq.filter((x) => POINT_TOOLS.has(x.tool))) {
      expect(Math.abs(s.args_hint.lat - GEO_HIT.lat)).toBeLessThan(0.005);
      expect(Math.abs(s.args_hint.lon - GEO_HIT.lng)).toBeLessThan(0.005);
    }
    // The run's point becomes the address, so a point tool the plan left without a point reads it too.
    const sig = { coords: null, state: 'VA' };
    expect(_execAddressGeo(geo, sig)).toMatchObject({ miss: false });
    const args = {};
    _execInjectGeo('get_disaster_risk', args, sig);
    expect(Math.abs(args.lat - GEO_HIT.lat)).toBeLessThan(0.005);
    expect(Math.abs(args.lon - GEO_HIT.lng)).toBeLessThan(0.005);
    expect(args.lat).not.toBe(ASHBURN_DEFAULT.lat);
  });

  it('an address the geocoder cannot place runs no point read and leads "could not be located"', async () => {
    const seq = structuredClone(_planQuery(BEAUMEADE).recommended_sequence);
    for (const miss of [async () => GEO_TOWN, async () => null]) {
      const s2 = structuredClone(seq);
      const geo = await _execGeocodePlan(s2, miss);
      expect(geo[0]).toMatchObject({ resolved: false, basis: 'address' });
      // every point step still waits on its point: it cannot resolve, so it does not run
      for (const s of s2.filter((x) => POINT_TOOLS.has(x.tool))) {
        expect(_execResolveArgs(s.args_hint, {}, {}, false).unresolved).toBeTruthy();
        expect(s.args_hint.lat).not.toBe(ASHBURN_DEFAULT.lat);
      }
      const sig = { coords: null };
      const g = _execAddressGeo(geo, sig);
      expect(g).toMatchObject({ miss: true, query: '21571 Beaumeade Circle, Ashburn, VA' });
      expect(sig.coords).toBeNull();
      const a = addressMissAnswer(g.query, { kind: 'siting', requested_mw: 60 });
      expect(a.headline).toMatch(/^The address could not be located; give lat\/lon\./);
      expect(JSON.stringify(a)).not.toMatch(/Parcel:|acres|parcel \d/);
      expect(a.evidence).toEqual([]);
    }
  });

  it('a town-level geocoder label is not the address', () => {
    expect(addressPointOk(GEO_HIT.label, '21571 Beaumeade Circle, Ashburn, VA')).toBe(true);
    expect(addressPointOk(GEO_TOWN.label, '21571 Beaumeade Circle, Ashburn, VA')).toBe(false);
    expect(addressPointOk('Beaumeade Circle, Ashburn, Virginia', '21571 Beaumeade Circle, Ashburn, VA')).toBe(false);
  });

  it('a question with coordinates keeps them (no geocode)', () => {
    const p = _planQuery('Screen the site at 39.0186, -77.458 (21571 Beaumeade Circle, Ashburn VA) for 60 MW: parcel, flood');
    for (const s of p.recommended_sequence.filter((x) => POINT_TOOLS.has(x.tool))) {
      expect(s.args_hint).toMatchObject({ lat: 39.0186, lon: -77.458 });
      expect(s.geocode).toBeUndefined();
    }
  });
});

describe('item 2: permitting "most recent" ranks by the record\'s own as_of', () => {
  // Live shape 2026-11-19: a bulk load stamped updated_at 2026-10-24 on every row.
  const R = (jurisdiction, state, as_of, extra = {}) => ({ class: 'moratorium', jurisdiction, state, stage: 'enacted',
    effective_date: null, as_of, updated_at: '2026-10-24 17:08:26+00', ...extra });
  const MOR = { ok: true, class: 'moratorium', count: 54, records: [
    R('Howell Township', 'MI', null),
    R('Colfax County', 'NM', '2026-03-02'),
    R('Town of Beloit', 'WI', '2026-09-15'),
    R('Undated County', 'GA', '2026-10-24', { as_of_basis: 'unknown' }),
    R('Milwaukee', 'WI', '2025-12-01'),
    R('Prince George\'s County', 'MD', '2026-10-25'),
  ] };
  const a = buildPermittingAnswer({ intent: 'Which places have data center moratoriums?', intent_class: 'permitting' },
    [ex(1, 'get_permitting_intel', { class: 'moratorium' }, MOR)]);
  it('sorts by as_of, newest first, each row "(as of <as_of>)", undated rows left out', () => {
    const most = a.headline.split('Most recent by source date: ')[1];
    expect(most).toMatch(/^Prince George's County, MD \(enacted, as of 2026-10-25\); Town of Beloit, WI \(enacted, as of 2026-09-15\); Colfax County, NM \(enacted, as of 2026-03-02\); Milwaukee, WI \(enacted, as of 2025-12-01\) \(2 undated records not ranked\)\./);
    expect(a.headline).not.toMatch(/Howell|Undated County|record updated/);
    expect(a.as_of).toBe('2026-10-25');
    expect(a.not_established.join(' ')).toMatch(/2 of the 6 moratorium records shown carry no source date/);
  });
});

describe('item 6: a Henry Hub ask leads with Henry Hub', () => {
  const GI = { ok: true, score: { state: 'TX', gas_price: 2.803, gas_price_sector: 'electric power', data_as_of: '2026-08-01', verdict: 'BUILD' } };
  const GE = { ok: true, market: 'dallas', as_of: '2026-11-19', henry_hub_spot_usd_mmbtu: 3.1, delivered_electric_usd_mmbtu: 3.4 };
  const run = (intent) => {
    const executed = [ex(1, 'get_gas_index', { state: 'TX' }, GI), ex(2, 'get_gas_economics', { market: 'dallas' }, GE)];
    return buildGasPriceAnswer({ intent, intent_class: 'gas_price' }, executed, asMap(executed));
  };
  it('names the Henry Hub figure and its date first; the state EIA price follows as context', () => {
    const a = run('What is the Henry Hub natural gas price today vs Texas?');
    expect(a.headline).toMatch(/^Henry Hub spot: \$3\.1\/MMBtu \(DC Hub gas economics, as of 2026-11-19\)\. For context: TX natural-gas price: \$2\.803\/MMBtu/);
    expect(a.evidence[0]).toMatch(/^Henry Hub spot: \$3\.1/);
  });
  it('the market label is title-cased; an ask without Henry Hub keeps its lead', () => {
    const a = run('natural gas price for a data center in Texas');
    expect(a.headline).toMatch(/^TX natural-gas price: \$2\.803/);
    expect(a.evidence.join(' ')).toMatch(/Dallas gas economics:/);
    expect(a.evidence.join(' ')).not.toMatch(/dallas gas economics/);
  });
});

describe('item 7: power timing with no time-to-power figure says so', () => {
  const TL = { state: 'AZ', timeline: [{ year: 2026, cumulative_firm_signal_mw: null }], as_of: '2026-11-19' };
  const RQ = { count_total_matching: 24, scope: { state: 'AZ', filtered_server_side: true }, freshness_by_iso: { CAISO: { source_as_of: '2026-07-16' } }, results: [] };
  const ctx = { intent: 'time to power for 100 MW in Phoenix', intent_class: 'grid_headroom', constraint_iso: ['WECC'], requested_mw: 100, state: 'AZ' };
  it('a preview run: the figure is withheld at this access level', () => {
    const executed = [ex(1, 'get_power_availability_timeline', { state: 'AZ', mw: 100 }, TL, { depth: 'preview' }),
      ex(2, 'get_refined_queue', { state: 'AZ', min_mw: 100 }, RQ, { depth: 'preview' })];
    const a = buildIntentAnswer(ctx, executed, asMap(executed));
    expect(a.kind).toBe('power_timing');
    expect(a.time_to_power_basis).toBeUndefined();
    expect(a.not_established[0]).toMatch(/^No time-to-power figure for .*: time-to-power and queue wait are withheld at this access level/);
  });
  it('a full run with none: says none came back', () => {
    const executed = [ex(1, 'get_power_availability_timeline', { state: 'AZ', mw: 100 }, TL), ex(2, 'get_refined_queue', { state: 'AZ' }, RQ)];
    const a = buildIntentAnswer(ctx, executed, asMap(executed));
    expect(a.not_established[0]).toMatch(/^No time-to-power figure for .*: the timing steps that ran returned none/);
  });
  it('a run with a figure carries no such line', () => {
    const executed = [ex(1, 'get_grid_intelligence', { iso: 'PJM' }, { iso: 'PJM', avg_time_to_power_months: 44.9 })];
    const a = buildIntentAnswer({ ...ctx, intent: 'time to power for 100 MW in PJM', constraint_iso: ['PJM'] }, executed, asMap(executed));
    expect(a.time_to_power_basis).toBeTruthy();
    expect(a.not_established.join(' ')).not.toMatch(/No time-to-power figure/);
  });
});

describe('item 5: an LMP-led price answer is dated by its interval', () => {
  const EP = { ok: true, filter: { iso: 'ERCOT' },
    wholesale_lmp: { iso: 'ERCOT', hub: 'HB_NORTH', source: 'ERCOT', real_time: { lmp_usd_mwh: 31.2, interval_ending: '2026-11-19T21:15:00Z', as_of: '2026-11-19T21:15:00Z' } },
    taste: { headline: { name: 'retail_rate', value: 8.9, unit: 'cents/kWh', sector: 'industrial', window: '2026', as_of: '2026-08-31' } } };
  const executed = [ex(1, 'get_energy_prices', { iso: 'ERCOT' }, EP)];
  const ia = buildPriceNowAnswer({ intent: 'What is the energy price in ERCOT right now?', intent_class: 'price_now', iso: 'ERCOT' }, executed, asMap(executed));
  const plan = { _entity: 'plan_execution', intent_class: 'price_now', intent_answer: ia, executed,
    provenance: { as_of: '2026-08-31', as_of_kind: 'source' } };
  it('the fact header and the lead Source line use the LMP date, retail said as context', () => {
    expect(ia.headline).toMatch(/^ERCOT HB_NORTH real-time LMP/);
    expect(priceNowDates(plan)).toEqual({ asOf: '2026-11-19', retail: '2026-08-31' });
    const fh = buildPlanFactHeader(plan);
    expect(fh.split('\n')[0]).toBe('SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-11-19 | RETAIL_CONTEXT_AS_OF: 2026-08-31');
    const lead = planLeadText({ ...plan, fact_header: fh });
    expect(lead).toMatch(/Source: DC Hub \(dchub\.cloud\), as of 2026-11-19 \(retail context as of 2026-08-31\)\./);
    expect(lead).not.toMatch(/oldest input/);
  });
  it('no retail figure: no retail context; no LMP: the oldest-input rule stands', () => {
    const e2 = [ex(1, 'get_energy_prices', { iso: 'ERCOT' }, { ...EP, taste: null })];
    const ia2 = buildPriceNowAnswer({ intent: 'ERCOT price now', intent_class: 'price_now', iso: 'ERCOT' }, e2, asMap(e2));
    expect(priceNowDates({ intent_answer: ia2 })).toEqual({ asOf: '2026-11-19', retail: null });
    const e3 = [ex(1, 'get_energy_prices', { iso: 'ERCOT' }, { ...EP, wholesale_lmp: null })];
    const ia3 = buildPriceNowAnswer({ intent: 'ERCOT price now', intent_class: 'price_now', iso: 'ERCOT' }, e3, asMap(e3));
    expect(priceNowDates({ intent_answer: ia3 })).toBeNull();
  });
});

describe('item 10: every asked power side keeps its headline slot', () => {
  const INTEL = { success: true, market: { id: 'dallas', name: 'Dallas' }, as_of: '2026-11-03', stats: { facility_count: 300, total_power_mw: 4000, mw_reporting_count: 100 } };
  const GRID = { ok: true, iso: 'ERCOT', as_of: '2026-11-19', avg_time_to_power_months: 30 };
  const RQ_TX = { count_total_matching: 1761, filters_applied: { state: 'TX', status: 'active' },
    freshness_by_iso: { ERCOT: { source_as_of: '2026-10-31' } }, results: [{ county: 'Leon', state: 'TX', iso: 'ERCOT' }] };
  const TL = { state: 'TX', queue_context: { iso_reported: [{ iso: 'ERCOT', gw: 461.4, requests: 1847, as_of: '2026-10-31', primary: true }] },
    sources: { planned_generators: { vintage: '2026-09-30' } }, timeline: [{ year: 2026, cumulative_firm_signal_mw: 16796, units: 89 }] };
  const steps = [ex(1, 'get_market_intel', { market: 'dallas' }, INTEL), ex(2, 'get_grid_intelligence', { iso: 'ERCOT' }, GRID),
    ex(3, 'get_refined_queue', { state: 'TX' }, RQ_TX), ex(4, 'get_power_availability_timeline', { state: 'TX' }, TL)];
  const run = (intent, executed = steps, place = { label: 'Dallas', state: 'TX', iso: 'ERCOT' }) =>
    buildCrossDomainAnswer({ intent, intent_class: 'dc_power_place', place }, executed, asMap(executed));
  it('power + queue: the state request count AND the operator queue GW', () => {
    const a = run('How do grid power and the interconnection queue look for data centers in Dallas?');
    expect(a.headline).toMatch(/ERCOT queue \(TX\): 1,761 active requests/);
    expect(a.headline).toMatch(/461\.4 GW/);
    expect(a.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });
  it('four asked sides in a nearly full headline: each takes its short form, none is cut', () => {
    const a = run('What do grid headroom, time to power and the interconnection queue look like for data centers in Dallas?',
      steps.map((e) => (e.tool === 'get_grid_intelligence' ? { ...e, result: { ...GRID, build_rate_pct: 40 } } : e)),
      { label: 'Dallas-Fort Worth', state: 'TX', iso: 'ERCOT' });
    expect(a.headline).toMatch(/TX queue 1,761 requests \(as of 2026-10-31\)/);
    expect(a.headline).toMatch(/ERCOT queue 461\.4 GW \(as of 2026-10-31\)/);
    expect(a.headline).toMatch(/ERCOT headroom: average time to power 30 months/);
    expect(a.headline).toMatch(/TX firm supply 16,796 MW \(as of 2026-09-30\)/);
    expect(a.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });
  it('VA firm supply asked: the firm-supply line keeps its slot', () => {
    const NOVA = { success: true, market: { id: 'northern-virginia', name: 'Ashburn' }, as_of: '2026-11-03T21:06:18',
      stats: { facility_count: 587, total_power_mw: 11313, mw_reporting_count: 200 } };
    const GRID_PJM = { ok: true, iso: 'PJM', as_of: '2026-11-19T07:00:00Z', taste: { headline: { name: 'demand_mw', value: 98081, unit: 'MW', as_of: '2026-11-19T07:00:00Z' } },
      _build_rate_pct_withheld: true, _operating_reserve_mw_withheld: true };
    const RQ_VA = { count_total_matching: 312, filters_applied: { state: 'VA', iso: 'PJM', status: 'active' }, freshness_by_iso: { PJM: { source_as_of: '2026-11-17' } } };
    const EN = { ok: true, filter: { state: 'VA' }, as_of: '2026-08-31',
      taste: { headline: { name: 'retail_rate_cents_kwh', value: 10.63, unit: 'cents/kWh', sector: 'all-sector average', window: '2026', as_of: '2026-08-31' } } };
    const TLVA = { state: 'VA', timeline: [{ year: 2026, cumulative_firm_signal_mw: null, under_construction_mw: null, units: 41 }] };
    const ex5 = [ex(1, 'get_market_intel', { market: 'northern-virginia' }, NOVA), ex(2, 'get_grid_intelligence', { iso: 'PJM' }, GRID_PJM),
      ex(3, 'get_refined_queue', { iso: 'PJM', state: 'VA' }, RQ_VA), ex(4, 'get_power_availability_timeline', { state: 'VA' }, TLVA),
      ex(5, 'get_energy_prices', { state: 'VA' }, EN)];
    const a = run('How do power prices, grid headroom, the PJM queue and firm supply look for new data center capacity in Northern Virginia?', ex5,
      { label: 'Northern Virginia', state: 'VA', iso: 'PJM' });
    // Five asked sides (price, headroom, queue, firm supply): the asked ones take their short forms to fit.
    expect(a.headline).toMatch(/VA firm-supply MW withheld/);
    expect(a.headline).toMatch(/VA queue 312 requests \(as of 2026-11-17\)/);
    expect(a.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });
});

describe('item 14: get_facility evidence says provider + name', () => {
  it('"Vantage Ashburn II", not "Ashburn II, VA, United States (Vantage Data Centers)"', () => {
    const executed = [ex(2, 'get_market_dcpi_rank', { market_slug: 'northern-virginia' }, { verdict: 'AVOID', composite_score: 21.9 }),
      ex(1, 'get_facility', { slug: 'vantage-ashburn-ii' }, { data: { name: 'Ashburn II, VA, United States', operator: 'Vantage Data Centers', fiber_carrier_count: 12 } })];
    const a = buildColocationAnswer({ intent: 'colocation in Ashburn', intent_class: 'colocation', metro: { label: 'Northern Virginia', dcpi_slug: 'northern-virginia' }, metros: [] }, executed, asMap(executed));
    expect(a).toBeTruthy();
    const ev = a.evidence.join(' ');
    expect(ev).toMatch(/Vantage Ashburn II: 12 fiber carriers on record\./);
    expect(ev).not.toMatch(/United States|, VA \(Vantage/);
  });
});
