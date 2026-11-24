// power-rotation-1123.test.mjs — planner 5.63, the daily MCP head-to-head POWER rotation (2026-11-23, planner 5.62,
// keyless): four of five power asks misrouted. Pure: the planner and the answer builders in-process, no network.
//   p2  a large-load status ask reads get_interconnection_queue for the ISO and leads with the large-load figures
//   p3  a generation-supply ask for one state reads EIA-860M planned generators (power_supply), never get_pipeline
//   p4  a wholesale / hub price ask is price_now beside a data-center noun, passes HB_NORTH, and gets no state
//   p5  a transmission constraint ask about one place reads the lines there (grid_constraints) with an intent_answer
// The real-server run of the same questions: test/power-rotation-1123-e2e.test.mjs.
import { describe, it, expect, afterEach } from 'vitest';
import { _planQuery, _execInjectGeo, PLANNER_VERSION } from '../server.mjs';
import { powerRotationRoute, namedHub, buildLargeLoadAnswer, buildPowerSupplyAnswer, buildGridConstraintsAnswer,
  transmissionAsk, generationSupplyAsk, largeLoadAsk, dayOf, LARGE_LOAD_PAGE } from '../lib/power-rotation-1123.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });

const P2 = 'What is the status of large-load interconnection in ERCOT: how many GW of large loads, mostly data centers in Texas, have requested interconnection, and how many are approved or energized?';
const P3 = 'How much firm generating capacity does Georgia have in MW, and how much new generation is planned or under construction?';
const P3_DC = 'How much firm generating capacity does Georgia have for data centers, and how much new generation is under construction?';
const P4 = 'What is the wholesale power price right now at the ERCOT North hub for a data center in Texas?';
const P5 = 'What transmission constraints limit new large loads in Northern Virginia (Loudoun County), and what transmission upgrades are planned?';

afterEach(() => { delete process.env.DCHUB_POWER_ROTATION_1123; });

it('is planner 5.63', () => { expect(PLANNER_VERSION).toBe('5.63'); });

describe('p2: a large-load ask reads the large-load queue', () => {
  it('routes to interconnection_queue for ERCOT, not dc_power_place, and runs no facility search', () => {
    const p = _planQuery(P2);
    expect(p.intent_class).toBe('interconnection_queue');
    expect(tools(p)[0]).toBe('get_interconnection_queue');
    expect(p.recommended_sequence[0].args_hint).toMatchObject({ iso: 'ERCOT' });
    expect(tools(p)).not.toContain('search_facilities');
  });
  it('a Texas large-load ask with no ISO named still reads ERCOT', () => {
    const p = _planQuery('How many GW of large loads are seeking interconnection in Texas, and how many are energized?');
    expect(p.intent_class).toBe('interconnection_queue');
    expect(p.recommended_sequence[0].args_hint).toMatchObject({ iso: 'ERCOT' });
  });
  const BLOCK = { iso: 'ERCOT', source: LARGE_LOAD_PAGE, rows: [
    { metric: 'large_load_queue_total', value_mw: 466497, as_of_date: '2026-06-18', source_title: 'ERCOT Large Load Working Group report, June 19 2026' },
    { metric: 'approved_to_energize', value_mw: 8927, as_of_date: '2026-06-18', source_title: 'ERCOT Large Load Working Group report, June 19 2026' },
    { metric: 'data_center_load_in_queue', value_mw: 420812, as_of_date: '2026-06-18', source_title: 'ERCOT Large Load Working Group report, June 19 2026' },
    { metric: 'observed_energized', value_mw: 3900, as_of_date: '2026-06-18', source_title: 'ERCOT Large Load Working Group report, June 19 2026' },
    { metric: 'large_load_queue_total', value_mw: 474000, as_of_date: '2026-06-30', source_title: 'older duplicate row, never read' },
  ] };
  const Q = { iso: 'ERCOT', as_of: '2026-11-23', taste: { headline: { name: 'queued_generation_gw', value: 461.4, unit: 'GW', as_of: '2026-10-31' } } };
  it('leads with the large-load GW, the data-center share and the approved / energized split, each dated', () => {
    const a = buildLargeLoadAnswer({ intent_class: 'interconnection_queue', large_load: true },
      [ex(1, 'get_interconnection_queue', { iso: 'ERCOT' }, { ...Q, large_load: BLOCK })]);
    expect(a.headline).toMatch(/^ERCOT large-load interconnection: 466\.5 GW of large loads seeking interconnection \(420\.8 GW of it data centers\); 8\.9 GW approved to energize; 3\.9 GW observed energized\./);
    expect(a.headline).not.toMatch(/facilit/i);
    expect(a.facts.every((f) => f.as_of === '2026-06-18')).toBe(true);
    expect(a.evidence.join(' ')).toMatch(/Large Load Working Group/);
    // the generation queue is context, said as a separate queue, never the lead
    expect(a.headline.indexOf('461.4')).toBeGreaterThan(a.headline.indexOf('466.5'));
    expect(a.headline).toMatch(/separate queue/);
  });
  it('a served queued_large_load_gw leads when no tracker block came back', () => {
    const a = buildLargeLoadAnswer({ intent_class: 'interconnection_queue', large_load: true },
      [ex(1, 'get_interconnection_queue', { iso: 'ERCOT' }, { ...Q, queued_large_load_gw: 474, queued_load_dc_share_pct: 90.2 })]);
    expect(a.headline).toMatch(/^ERCOT large-load interconnection: 474 GW of large loads seeking interconnection/);
    expect(a.not_established.join(' ')).toMatch(/approved \/ energized split is not in this answer/);
  });
  it('withheld (the keyless preview): says so with the sourced page, and the generation queue is labelled as not load', () => {
    const a = buildLargeLoadAnswer({ intent_class: 'interconnection_queue', large_load: true },
      [ex(1, 'get_interconnection_queue', { iso: 'ERCOT' }, { ...Q, _queued_large_load_gw_withheld: true })]);
    expect(a.headline).toMatch(/large-load queue figures are withheld at this access level/);
    expect(a.headline).toContain(LARGE_LOAD_PAGE);
    expect(a.facts[0].text).toMatch(/461\.4 GW requested generation, not load/);
  });
  it('a PJM large-load ask is not told PJM figures are withheld: DC Hub holds only ERCOT\'s large-load queue', () => {
    const a = buildLargeLoadAnswer({ intent_class: 'interconnection_queue', large_load: true },
      [ex(1, 'get_interconnection_queue', { iso: 'PJM' }, { iso: 'PJM', taste: { headline: { name: 'queued_generation_gw', value: 373.5, as_of: '2026-11-01' } } })]);
    expect(a.headline).toMatch(/^PJM large-load interconnection: DC Hub holds no PJM large-load queue figure/);
    expect(a.headline).not.toMatch(/withheld/);
    expect(a.headline).not.toContain(LARGE_LOAD_PAGE);
  });
  it('only an asked large-load plan gets this answer', () => {
    expect(buildLargeLoadAnswer({ intent_class: 'interconnection_queue', large_load: false },
      [ex(1, 'get_interconnection_queue', { iso: 'ERCOT' }, { ...Q, large_load: BLOCK })])).toBeNull();
  });
});

describe('p3: a generation-supply ask reads generators, not data centers', () => {
  for (const q of [P3, P3_DC]) {
    it(`routes to power_supply: ${q.slice(0, 60)}`, () => {
      const p = _planQuery(q);
      expect(p.intent_class).toBe('power_supply');
      expect(tools(p)).toContain('get_power_pipeline');
      expect(tools(p)).not.toContain('get_pipeline');
      expect(p.recommended_sequence.find((s) => s.tool === 'get_power_pipeline').args_hint).toMatchObject({ state: 'GA' });
      // Georgia is on no US RTO queue: no queue step runs with a SERC "iso"
      expect(p.recommended_sequence.some((s) => s.tool === 'get_refined_queue' && s.args_hint.iso === 'SERC')).toBe(false);
    });
  }
  const PP = { count: 28, total_planned_mw: 6872, as_of: '2026-11-23 08:33:16.204394+00:00',
    by_technology_mw: { 'Solar Photovoltaic': 3818, 'Natural Gas Fired Combustion Turbine': 1716 },
    by_status: { 'Regulatory approvals pending. Not under construction': 7, 'Planned for installation': 9, 'Under construction': 8 },
    largest_projects: [{ plant_name: 'Pepper Hammock Solar and Storage', entity_name: 'BrightNight Power', capacity_mw: 1200, technology: 'Solar Photovoltaic', status: '(L) Regulatory approvals pending. Not under construction', planned_month: 9, planned_year: 2029 },
      { plant_name: 'Yates', entity_name: 'Georgia Power Co', capacity_mw: 482.8, technology: 'Natural Gas Fired Combustion Turbine', status: '(V) Under construction, more than 50 percent complete', planned_month: 2, planned_year: 2027 }] };
  it('leads with GA new generation (MW, count, under construction, EIA-860M, dated) and says firm supply is withheld', () => {
    const a = buildPowerSupplyAnswer({ intent_class: 'power_supply', state: 'GA' },
      [ex(1, 'get_power_pipeline', { state: 'GA', limit: 500 }, PP), ex(2, 'get_power_availability_timeline', { state: 'GA' }, { state: 'GA', timeline: [] })]);
    expect(a.headline).toMatch(/^GA new generation: 28 planned or under-construction generators, 6,872 MW nameplate \(EIA-860M, as of 2026-11-23\); 8 under construction\./);
    expect(a.headline).toMatch(/firm generating capacity in MW is withheld at this access level/);
    expect(a.headline).not.toMatch(/no project on record/);
    expect(a.evidence.join(' ')).toMatch(/Pepper Hammock/);
  });
  it('the planner keeps a mix ask, a retirement ask and a data-center construction ask', () => {
    expect(_planQuery('What is the generating capacity mix in Virginia?').intent_class).toBe('generation_mix');
    expect(_planQuery('Which data centers are under construction in Virginia?').intent_class).not.toBe('power_supply');
    expect(generationSupplyAsk('Which planned generator retirements in PJM could free up 100 MW?')).toBe(false);
  });
});

describe('p4: a wholesale hub ask is price_now', () => {
  it('beside a data-center noun, reads get_energy_prices iso=ERCOT hub=HB_NORTH', () => {
    const p = _planQuery(P4);
    expect(p.intent_class).toBe('price_now');
    expect(p.recommended_sequence[0]).toMatchObject({ tool: 'get_energy_prices', args_hint: { iso: 'ERCOT', hub: 'HB_NORTH' } });
  });
  it('the ISO price read never gets the state injected (the state turned it into the retail rate)', () => {
    const args = { iso: 'ERCOT', hub: 'HB_NORTH' };
    expect(_execInjectGeo('get_energy_prices', args, { state: 'TX' })).toEqual([]);
    expect(args.state).toBeUndefined();
    // a state price read still gets its state
    const a2 = {};
    expect(_execInjectGeo('get_energy_prices', a2, { state: 'TX' })).toEqual(['state']);
  });
  it('hub names: only next to "hub", only on ERCOT', () => {
    expect(namedHub('ERCOT North hub price', 'ERCOT')).toBe('HB_NORTH');
    expect(namedHub('price at HB_HOUSTON', 'ERCOT')).toBe('HB_HOUSTON');
    expect(namedHub('wholesale price in North Texas', 'ERCOT')).toBeNull();
    expect(namedHub('PJM West hub', 'PJM')).toBeNull();
  });
  it('a two-sided ask (wholesale plus headroom and queue) keeps dc_power_place', () => {
    expect(_planQuery('How do wholesale power prices, grid headroom and the PJM queue affect new data center capacity in Northern Virginia?').intent_class).toBe('dc_power_place');
  });
});

describe('p5: a transmission constraint ask reads the lines at the place', () => {
  it('routes to grid_constraints at the Loudoun centroid, with the PJM grid and VA permitting', () => {
    const p = _planQuery(P5);
    expect(p.intent_class).toBe('grid_constraints');
    expect(p.recommended_sequence[0]).toMatchObject({ tool: 'get_infrastructure', args_hint: { lat: 39.09, lon: -77.64 } });
    expect(tools(p)).toEqual(expect.arrayContaining(['get_grid_intelligence', 'get_permitting_intel']));
    expect(tools(p)).not.toContain('get_market_dcpi_rank');
  });
  it('the same with a market arg (the live run bound northern-virginia)', () => {
    expect(_planQuery(P5, { market: 'northern-virginia' }).intent_class).toBe('grid_constraints');
  });
  it('"transmission lines near <point>" stays a point read', () => {
    expect(transmissionAsk('What transmission lines, power plants and gas pipelines are near 33.45, -112.07?')).toBe(false);
    expect(_planQuery('What transmission lines, power plants and gas pipelines are near 33.45, -112.07?').intent_class).toBe('point_infrastructure');
  });
  const INF = { counts: { substations: 225, transmission_lines_eia: 91 }, filter: { lat: 39.09, lon: -77.64, radius_km: 30 },
    nearest_transmission: { status: 'measured', distance_km: 1.8, voltage_kv: 230, operator: 'VIRGINIA ELECTRIC & POWER CO', substation: 'GREENWAY',
      lines_in_radius: 230, ehv_230kv_plus: 103, source: 'EIA transmission lines located at their HIFLD substation (DC Hub /api/v1/grid/transmission-proximity)' } };
  it('the answer leads with line counts by kV and the nearest line, and says upgrades are not held', () => {
    const a = buildGridConstraintsAnswer({ intent_class: 'grid_constraints', state: 'VA', place_label: 'Loudoun County, VA' },
      [ex(1, 'get_infrastructure', { lat: 39.09, lon: -77.64, radius_km: 30 }, INF)]);
    expect(a.headline).toMatch(/^Transmission at Loudoun County, VA: 230 transmission lines \(103 at 230 kV\+\) and 225 substations within 30 km; nearest line 230 kV 1\.8 km away/);
    expect(a.headline).not.toMatch(/DCPI 20\/100/);
    expect(a.not_established.join(' ')).toMatch(/Planned transmission upgrades .* are not in this answer/);
  });
  it('the upgrade side: VA reads the PJM project list and leads with its dated status counts', () => {
    const p = _planQuery(P5);
    expect(p.recommended_sequence.find((s) => s.tool === 'get_infra_projects').args_hint).toMatchObject({ type: 'transmission', state: 'VA' });
    const IP = { summary: { as_of: { transmission: '2026-05-15' }, by_type: { transmission: { matching: 690, by_status: { Planned: 591, 'Under Construction': 86, 'On Hold': 13 } } } },
      transmission_projects: [{ iso: 'PJM', kv: 765, description: 'Build a new 115 mile 765kV line from Joshua Falls - Yeat.', owner: 'AEP', status: 'Planned', projected_isd: '2029-06-01' },
        { iso: 'PJM', kv: 230, description: 'Rebuild 230 kV line', owner: 'Dominion', status: 'Under Construction' }],
      sources: { transmission: { as_of: '2026-05-15', per_iso: [{ iso: 'SPP', as_of: '2026-05-15' }, { iso: 'PJM', as_of: '2026-11-19' }] } } };
    const a = buildGridConstraintsAnswer({ intent_class: 'grid_constraints', state: 'VA', place_label: 'Loudoun County, VA' },
      [ex(1, 'get_infrastructure', { lat: 39.09, lon: -77.64, radius_km: 30 }, INF), ex(4, 'get_infra_projects', { type: 'transmission', state: 'VA' }, IP)]);
    expect(a.headline).toMatch(/VA planned transmission upgrades: 690 on file \(591 planned, 86 under construction, 13 on hold; PJM project list, as of 2026-11-19\)/);
    expect(a.headline).not.toMatch(/planned upgrades are not in this answer/);
    expect(a.evidence.join(' ')).toMatch(/765 kV Build a new 115 mile/);
    expect(a.not_established.join(' ')).not.toMatch(/Planned transmission upgrades/);
  });
  it('Georgia (no ISO project list) runs no upgrade step and says so', () => {
    const p = _planQuery('What transmission constraints limit new data center loads near Atlanta, Georgia, and what upgrades are planned?');
    if (p.intent_class === 'grid_constraints') expect(tools(p)).not.toContain('get_infra_projects');
  });
});

describe('guards', () => {
  it('detectors', () => {
    expect(largeLoadAsk(P2)).toBe(true);
    expect(largeLoadAsk('large loads')).toBe(false);
    expect(transmissionAsk(P5)).toBe(true);
    expect(dayOf('2026-11-24T02:00:00.000Z')).toBe('2026-11-23');   // a UTC evening is the Phoenix day before
    expect(dayOf('2026-11-23 08:33:16.204394+00:00')).toBe('2026-11-23');
  });
  it('the kill switch returns every ask to its 5.62 class', () => {
    process.env.DCHUB_POWER_ROTATION_1123 = '0';
    expect(powerRotationRoute(P5, { state: 'VA', coords: { lat: 39, lon: -77 } }, 'unknown')).toBeNull();
    expect(_planQuery(P3).intent_class).not.toBe('power_supply');
    expect(_planQuery(P5).intent_class).not.toBe('grid_constraints');
  });
});
