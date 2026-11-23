// grok-daily-answers-1120d.test.mjs — planner 5.57, Grok's daily MCP note (2026-11-20): answer composition, pure
// functions with mocked step results (live keyless shapes of 2026-11-20 where noted). The real server.mjs path is in
// test/grok-daily-answers-e2e-1120d.test.mjs.
//   6   "how soon can a 100 MW load get power in Phoenix": the lead names market, grid and verdict and now says the time
//       to power is withheld (or gives the figure with its field and date), and not_established says no figure came back.
//   7   MISO withdrawals: the by-iso queue_withdrawals block leads; "not served yet" only when it is absent.
//   8   headline slots: xd-a carries the queue GW beside the firm supply; xd-b the retail cents/kWh, the PJM VA queue and
//       the firm supply.
//   10  "where in Texas": ERCOT's summary.by_county top three by queued MW, dated, no "rows shown".
import { describe, it, expect } from 'vitest';
import { PLANNER_VERSION, _planQuery } from '../server.mjs';
import { buildIntentAnswer, TTP_WITHHELD, TTP_MARKET_FIELD } from '../lib/intent-answers.mjs';
import { buildQueueWithdrawalsAnswer, withdrawalsFact, WITHDRAWALS_NOT_HELD } from '../lib/energy-answers.mjs';
import { buildCrossDomainAnswer, countyQueueFact, askedDims, HEADLINE_MAX } from '../lib/cross-domain-answer.mjs';
import { dcPowerPlaceSequence, COUNTY_QUEUE_ISO } from '../lib/dc-power-place.mjs';
import { buildFreeDecisionTaste } from '../lib/free-decision-taste.mjs';

const ex = (step, tool, args, result, extra = {}) => ({ step, tool, args, status: 'executed', result, ...extra });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));
const NOW = Date.parse('2026-11-20T20:00:00Z');

it('is planner 5.57 or later (5.58)', () => { expect(PLANNER_VERSION).toBe('5.62'); });

describe('6 Phoenix time to power', () => {
  const Q = 'how soon can a 100 MW load get power in Phoenix';
  // GET /api/v1/dcpi/scores/phoenix, keyless (2026-11-21 00:35Z): verdict served, the time to power locked.
  const card = (ttp) => ({ market_slug: 'phoenix', market_name: 'Phoenix', verdict: 'CAUTION', composite_score: 43.5, time_to_power_months: ttp,
    computed_at: '2026-11-21T00:35:23.291805+00:00', ...(ttp == null ? { _gated: true, locked: true, _locked_fields: ['time_to_power_months', 'queue_wait_months'] } : {}) });
  // GET /api/v1/interconnection-queue/refined?state=AZ keyless: CAISO rows, estimated_ttp_months locked.
  const RQ_AZ = { count_total_matching: 24, filters_applied: { state: 'AZ', min_mw: 0 }, _locked_fields: ['estimated_ttp_months'],
    freshness_by_iso: { CAISO: { source_as_of: '2026-07-16T21:57:50+00:00', source_as_of_basis: 'source_file_date' } },
    results: [{ county: 'LA PAZ', state: 'AZ', iso: 'CAISO', estimated_ttp_months: null }] };
  const TL_AZ = { state: 'AZ', iso_context: ['WECC'], timeline: [{ year: 2026, cumulative_firm_signal_mw: null, under_construction_mw: null, units: 11 }] };
  const ctx = { intent: Q, intent_class: 'capacity_search', constraint_iso: ['WECC'], requested_mw: 100, named_markets: ['phoenix'], state: 'AZ' };
  const preview = { depth: 'preview' };
  const keyless = () => [ex(1, 'get_retirement_headroom', { target_mw: 100 }, { count_returned: 0, generators: [] }),
    ex(2, 'get_refined_queue', { state: 'AZ', min_mw: 100 }, RQ_AZ, preview),
    ex(3, 'get_market_dcpi_rank', { market_slug: 'phoenix' }, card(null), preview),
    ex(4, 'get_power_availability_timeline', { state: 'AZ', mw: 100 }, TL_AZ, preview)];

  it('keyless: the lead names Phoenix, its grid and verdict, then says the time to power is withheld', () => {
    const a = buildIntentAnswer(ctx, keyless(), null, NOW);
    expect(a.headline.startsWith(`Time to 100 MW of power near Phoenix (WECC), DCPI verdict CAUTION: ${TTP_WITHHELD}`)).toBe(true);
  });
  it('keyless: not_established says no time-to-power figure came back and why', () => {
    const a = buildIntentAnswer(ctx, keyless(), null, NOW);
    expect(a.not_established[0]).toBe('No time-to-power figure for Phoenix: time-to-power and queue wait are withheld at this access level (the timing steps ran as previews).');
  });
  it('a served figure gives its months, its field and its date', () => {
    const rows = [ex(3, 'get_market_dcpi_rank', { market_slug: 'phoenix' }, card(28.4)), ex(2, 'get_refined_queue', { state: 'AZ' }, { ...RQ_AZ, _locked_fields: [] })];
    const a = buildIntentAnswer(ctx, rows, null, NOW);
    expect(a.headline).toContain(`Phoenix DCPI time-to-power 28.4 months (${TTP_MARKET_FIELD}, as of 2026-11-21).`);
    expect(a.not_established.join(' ')).not.toMatch(/No time-to-power figure/);
  });
  it('no market read, no preview and no figure: no "withheld" claim; not_established says none came back', () => {
    const a = buildIntentAnswer({ ...ctx, named_markets: [] }, [ex(1, 'get_retirement_headroom', { target_mw: 100 }, { count_returned: 0, generators: [] })], null, NOW);
    expect(a.headline).toMatch(/ is not measurable from this run: the timing steps that ran returned no time-to-power figure\.$/);
    expect(a.headline).not.toMatch(/withheld/);
    expect(a.not_established[0]).toMatch(/^No time-to-power figure for .*: the timing steps that ran returned none for this geography\.$/);
  });
  it('the AZ queue date in the answer is the CAISO file date the refined queue reports (freshness_by_iso.CAISO.source_as_of)', () => {
    const a = buildIntentAnswer(ctx, keyless(), null, NOW);
    expect(a.not_established.join(' ')).toMatch(/as of 2026-07-16/);
  });
});

describe('7 MISO withdrawals', () => {
  // GET /api/v1/interconnection-queue/by-iso?iso=MISO, keyless (2026-11-20).
  const W = { basis: 'Requests the ISO\'s own queue file marks withdrawn.',
    by_iso: { MISO: { basis: 'MISO GI queue API: applicationStatus \'Withdrawn\', dated by withdrawnDate', count: 2327, gw: 395.038, status: 'captured' } },
    by_year: [{ count: 947, gw: 165.855, year: 2025 }, { count: 339, gw: 74.081, year: 2026 }], count: 2327, gw: 395.038,
    isos_captured: ['MISO'], loaded_at: '2026-11-20T09:31:37.913466+00:00' };
  const RQ0 = { count_total_matching: 0, filters_applied: { iso: 'MISO', status: 'withdrawn' } };
  const IQ = (extra) => ({ iso: 'MISO', queued_generation_gw: 256.9, queued_generation_gw_as_of: '2026-11-20', project_count: 1136, ...extra });
  const run = (iq, iso = 'MISO') => {
    const rows = [ex(1, 'get_refined_queue', { iso, status: 'withdrawn' }, { ...RQ0, filters_applied: { iso, status: 'withdrawn' } }), ex(2, 'get_interconnection_queue', { iso }, iq)];
    return buildQueueWithdrawalsAnswer({ intent_class: 'queue_withdrawals' }, rows, asMap(rows));
  };
  it('the block leads: count, GW, the latest year and its date; no "not served"', () => {
    const a = run(IQ({ queue_withdrawals: W }));
    expect(a.headline.startsWith('MISO withdrawn interconnection requests: 2,327 (395 GW requested), 339 of them withdrawn in 2026 (MISO GI queue API, as of 2026-11-20; withdrawn requests, not part of the active queue).')).toBe(true);
    expect(a.headline).toContain('MISO active interconnection queue: 256.9 GW');
    expect(JSON.stringify(a)).not.toContain(WITHDRAWALS_NOT_HELD);
    expect(a.facts[0]).toMatchObject({ tool: 'get_interconnection_queue', entity: 'MISO', as_of: '2026-11-20' });
  });
  it('the old sentence stays when the block is absent, or lists the ISO as not captured', () => {
    expect(run(IQ({})).headline.startsWith(`MISO withdrawals: ${WITHDRAWALS_NOT_HELD}`)).toBe(true);
    const pjm = { ...W, by_iso: { PJM: { count: null, gw: null, status: 'not_captured', reason: 'x' } }, isos_captured: ['MISO'] };
    expect(run({ iso: 'PJM', queued_generation_gw: 373.5, queue_withdrawals: pjm }, 'PJM').headline.startsWith(`PJM withdrawals: ${WITHDRAWALS_NOT_HELD}`)).toBe(true);
    expect(withdrawalsFact({ tool: 'get_interconnection_queue', p: { iso: 'PJM', queue_withdrawals: pjm }, args: { iso: 'PJM' } }, 'PJM')).toBeNull();
  });
  it('the keyless queue preview keeps the block, so a keyless plan can lead with it', () => {
    const env = buildFreeDecisionTaste('get_interconnection_queue', IQ({ queue_withdrawals: W, projects: [{ id: 1 }] })).envelope;
    expect(env.queue_withdrawals.by_iso.MISO.count).toBe(2327);
    expect(env.projects).toBeUndefined();
    const rows = [ex(1, 'get_refined_queue', { iso: 'MISO', status: 'withdrawn' }, RQ0), ex(2, 'get_interconnection_queue', { iso: 'MISO' }, env)];
    expect(buildQueueWithdrawalsAnswer({ intent_class: 'queue_withdrawals' }, rows, asMap(rows)).headline).toMatch(/^MISO withdrawn interconnection requests: 2,327/);
  });
});

describe('8 headline slots keep every asked side', () => {
  it('xd-a: the headline holds a queue GW figure and the firm supply', () => {
    const Q = 'Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do grid headroom and the interconnection queue look like there?';
    const CANVAS = { shortlist: [
      { market: 'Midland–Odessa', state: 'TX', iso: 'ERCOT', verdict: 'BUILD', _time_to_power_months_withheld: true },
      { market: 'Upper Peninsula', state: 'MI', iso: 'MISO', verdict: 'BUILD', _time_to_power_months_withheld: true },
      { market: 'Williston', state: 'ND', iso: 'MISO', verdict: 'BUILD', _time_to_power_months_withheld: true }], citation: { retrieved_at: '2026-11-18T17:00:00Z' } };
    const q = (iso, gw, d) => ({ ok: true, tool: 'get_interconnection_queue', iso, taste: { headline: { name: 'queued_generation_gw', value: gw, unit: 'GW', as_of: d } } });
    const tl = (st, mw) => ({ state: st, sources: { planned_generators: { vintage: '2026-09-30' } }, timeline: [{ year: 2026, cumulative_firm_signal_mw: mw, units: 5 }] });
    const a = buildCrossDomainAnswer({ intent: Q, intent_class: 'capacity_grid', requested_mw: 50, deadline_months: 24 }, [
      ex(1, 'site_selection_canvas', { capacity_mw: 50, max_months: 24 }, CANVAS),
      ex(2, 'get_interconnection_queue', { iso: 'ERCOT' }, q('ERCOT', 461.4, '2026-10-31')), ex(2, 'get_interconnection_queue', { iso: 'MISO' }, q('MISO', 256.9, '2026-11-20')),
      ex(4, 'get_power_availability_timeline', { state: 'TX' }, tl('TX', 16796)), ex(4, 'get_power_availability_timeline', { state: 'MI' }, tl('MI', 2100)),
      ex(4, 'get_power_availability_timeline', { state: 'ND' }, tl('ND', 640)), ex(5, 'source_capacity', { min_mw: 50 }, { items: [] })], null);
    expect(a.headline).toMatch(/ERCOT 461\.4 GW/);
    expect(a.headline).toMatch(/MISO 256\.9 GW/);
    expect(a.headline).toMatch(/firm 16,796 MW/);
    expect(a.headline).toMatch(/Firm: EIA-860M state supply, as of 2026-09-30/);
    expect(a.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });

  const INTEL = { success: true, market: { id: 'northern-virginia', name: 'Ashburn' }, as_of: '2026-11-03T21:06:18',
    stats: { facility_count: 587, total_power_mw: 11313, mw_reporting_count: 200 }, siting: { dcpi: { verdict: 'AVOID', as_of: '2026-11-18T00:34:29Z' } } };
  const GRID = { ok: true, tool: 'get_grid_intelligence', iso: 'PJM', as_of: '2026-11-19T07:00:00Z', taste: { headline: { name: 'demand_mw', value: 98081, unit: 'MW', as_of: '2026-11-19T07:00:00Z' } } };
  const RQ_VA = { count_total_matching: 312, filters_applied: { state: 'VA', iso: 'PJM', status: 'active' }, freshness_by_iso: { PJM: { source_as_of: '2026-11-17' } } };
  const TL = (mw) => ({ state: 'VA', sources: { planned_generators: { vintage: '2026-11-01' } }, timeline: [{ year: 2026, cumulative_firm_signal_mw: mw, under_construction_mw: mw == null ? null : 300, units: 41 }] });
  const ENERGY = { ok: true, tool: 'get_energy_prices', filter: { state: 'VA' }, as_of: '2026-08-31',
    taste: { headline: { name: 'retail_rate_cents_kwh', value: 10.63, unit: 'cents/kWh', window: '2026', as_of: '2026-08-31' } } };
  const QPJM = { iso: 'PJM', queued_generation_gw: 373.5, queued_generation_gw_as_of: '2026-11-17', project_count: 972 };
  const xdb = (q, tl) => {
    const rows = [ex(1, 'get_market_intel', { market: 'northern-virginia' }, INTEL), ex(2, 'get_grid_intelligence', { iso: 'PJM' }, GRID),
      ex(3, 'get_refined_queue', { iso: 'PJM', state: 'VA' }, RQ_VA), ex(4, 'get_power_availability_timeline', { state: 'VA' }, tl),
      ex(5, 'get_energy_prices', { state: 'VA' }, ENERGY), ex(6, 'get_interconnection_queue', { iso: 'PJM' }, QPJM)];
    return buildCrossDomainAnswer({ intent: q, intent_class: 'dc_power_place', place: { label: 'Northern Virginia', state: 'VA', iso: 'PJM' } }, rows, asMap(rows));
  };
  it('xd-b: the retail cents/kWh with its label, the PJM VA queue and the firm supply all reach the headline', () => {
    const a = xdb('How do retail power prices, firm supply and the PJM queue affect new data center capacity in Northern Virginia?', TL(412));
    expect(a.headline).toMatch(/VA retail (rate )?10\.63 cents\/kWh/);
    expect(a.headline).toMatch(/VA queue 312 requests|PJM queue \(VA\): 312/);
    expect(a.headline).toMatch(/VA firm supply 412 MW|firm-supply signal: 412 MW/);
    expect(a.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
    // the market's facility line stays; its DCPI verdict moves to evidence to make room
    expect(a.headline).toMatch(/Data centers: 587 facilities/);
    expect(a.evidence.join(' ')).toMatch(/verdict: AVOID/);
  });
  it('"firm power" names the firm-supply side too, and its withheld line keeps the slot keyless', () => {
    expect(askedDims('retail power price, PJM queue and firm power for a data center in Virginia', true).has('timing')).toBe(true);
    const a = xdb('How do retail power prices, firm power and the PJM queue affect new data center capacity in Northern Virginia?', TL(null));
    expect(a.headline).toMatch(/VA firm-supply MW withheld/);
    expect(a.headline).toMatch(/VA retail 10\.63 cents\/kWh/);
  });
});

describe('10 where in Texas', () => {
  const Q = 'Where in Texas can I get grid power the fastest for a data center?';
  // GET /api/v1/interconnection-queue/by-iso?iso=ERCOT, keyless (2026-11-20), summary trimmed to its top rows.
  const BY_COUNTY = { as_of: '2026-11-20', iso: 'ERCOT', counties: 193, projects: 1766,
    top: [{ county: 'Brazoria', projects: 48, queued_mw: 10834.1 }, { county: 'Pecos', projects: 53, queued_mw: 21389.2 }, { county: 'Wharton', projects: 41, queued_mw: 8625.1 },
      { county: 'Ward', projects: 30, queued_mw: 7000 }] };
  const ERCOT = { iso: 'ERCOT', queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-10-31', project_count: 1766,
    summary: { by_county: BY_COUNTY, by_zone: { as_of: '2026-11-20', iso: 'ERCOT', top: [{ zone: 'WEST', queued_mw: 150969.5 }, { zone: 'NORTH', queued_mw: 113059.1 }, { zone: 'SOUTH', queued_mw: 101335.9 }, { zone: 'HOUSTON', queued_mw: 1 }] } } };
  const RQ_TX = { count_total_matching: 1761, filters_applied: { state: 'TX', status: 'active' }, freshness_by_iso: { ERCOT: { source_as_of: '2026-10-31' } },
    results: [{ county: 'Fisher', state: 'TX' }, { county: 'Franklin', state: 'TX' }, { county: 'Leon', state: 'TX' }] };
  const TL_TX = { state: 'TX', timeline: [{ year: 2026, cumulative_firm_signal_mw: null, under_construction_mw: null, units: 89 }] };
  const run = (iq) => {
    const rows = [ex(1, 'get_refined_queue', { state: 'TX' }, RQ_TX), ex(2, 'get_interconnection_queue', { iso: 'ERCOT' }, iq), ex(3, 'get_power_availability_timeline', { state: 'TX' }, TL_TX)];
    return buildCrossDomainAnswer({ intent: Q, intent_class: 'dc_power_place', place: { label: 'TX', state: 'TX', iso: 'ERCOT' } }, rows, asMap(rows));
  };
  it('the plan reads ERCOT by-iso beside the TX slice and the timeline', () => {
    const p = _planQuery(Q, {});
    expect(p.intent_class).toBe('dc_power_place');
    const s = p.recommended_sequence.find((x) => x.tool === 'get_interconnection_queue');
    expect(s && s.args_hint).toEqual({ iso: 'ERCOT' });
    expect(dcPowerPlaceSequence({}, { state: 'OH' }, null, 'Where in Ohio can I get grid power the fastest?').map((x) => x.tool)).not.toContain('get_interconnection_queue');
    expect(dcPowerPlaceSequence({}, { state: 'TX' }, null, 'Texas data center grid queue').map((x) => x.tool)).not.toContain('get_interconnection_queue');
    expect(COUNTY_QUEUE_ISO.TX).toBe('ERCOT');
  });
  it('the lead is the top three counties by queued MW, with MW, projects and the date; no rows-shown line; no DCPI', () => {
    const a = run(ERCOT);
    expect(a.headline).toMatch(/^TX \(ERCOT\)\. Power: Where in TX: the ERCOT queue's requested generation is largest in Pecos County \(21,389 MW, 53 projects\), Brazoria County \(10,834 MW, 48 projects\), Wharton County \(8,625 MW, 41 projects\) \(ERCOT queue, as of 2026-11-20; queued generation MW\)/);
    expect(a.headline).not.toMatch(/rows shown|Fisher County|Ward/);
    expect(a.headline).not.toMatch(/DCPI/);
    expect(a.facts.find((f) => /queue by county across 193 counties, as of 2026-11-20/.test(f.text))).toBeTruthy();
    expect(a.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  });
  it('the keyless queue preview keeps summary.by_county and by_zone top three, and the lead still follows', () => {
    const env = buildFreeDecisionTaste('get_interconnection_queue', { ...ERCOT, projects: [{ id: 1 }], top_subregions: [{ x: 1 }] }).envelope;
    expect(env.summary.by_county.top.map((r) => r.county)).toEqual(['Brazoria', 'Pecos', 'Wharton']);
    expect(env.summary.by_zone.top).toHaveLength(3);
    expect(env.top_subregions).toBeUndefined();
    expect(run(env).headline).toMatch(/Where in TX: the ERCOT queue's requested generation is largest in Pecos County/);
  });
  it('no by_county block (or a by_county for an ISO beyond the state): the 5.43 rows-shown line stays', () => {
    const { summary, ...bare } = ERCOT;
    expect(run(bare).headline).toMatch(/TX queue requests returned sit in .* \(3 rows shown of 1,761, not a TX county ranking\)/);
    expect(countyQueueFact({ tool: 'get_interconnection_queue', p: { iso: 'PJM', summary: { by_county: { ...BY_COUNTY, iso: 'PJM' } } } }, 'OH')).toBeNull();
  });
});
