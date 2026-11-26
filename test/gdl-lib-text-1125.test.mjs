// gdl-lib-text-1125.test.mjs -- answer-text defects from the daily head-to-head of 2026-11-25 (lib/ half).
//
//   1. "VA: 312 active generation requests located in the state (0 MW) (PJM queue rows)": a null-capacity sum said as
//      0 MW. MW is said only when rows carrying a figure cover >= 80% of the requests ("X MW across N of M requests").
//   2. "the rows sit in Richardson, Digital Realty DFW (Richardson) metro" / "... CHICAGO, 350 E Cermak metro": a
//      facility name or address said as a metro, and a capitals city kept in capitals.
//   3. "AS_OF: 2017-02-17 | OLDEST_INPUT: analyze parcel" (a FEMA FIRM panel effective date) and
//      "OLDEST_INPUT_AS_OF 2026-05-15 (VA infra projects)" beside evidence "PJM project list, as of 2026-11-19".
//   4. "nearest line of any voltage voltage not held 7.5 km away".
//   5. "live demand was 105,764 MW (EIA-930 hourly, as of 2026-11-26)" said in the Phoenix evening of 2026-11-25.
// Pure, no network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { factsFromStep, searchFacilitiesFacts } from '../lib/plan-step-facts.mjs';
import { queueMwClause, servingGridQueue } from '../lib/state-queue-coverage.mjs';
import { honestCountText, rowsMetro, cityCase } from '../lib/plan-facility-lead.mjs';
import { buildProvenance } from '../lib/attribution.mjs';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';
import { buildGridConstraintsAnswer } from '../lib/power-rotation-1123.mjs';
import { nearestTransmission } from '../lib/site-point-depth.mjs';
import { headroomFact } from '../lib/cross-domain-answer.mjs';

// ── 1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tl = (qc) => ({ state: 'VA', queue_context: { as_of: '2026-11-20', ...qc } });
const tlText = (qc, args = { state: 'VA' }) => factsFromStep('get_power_availability_timeline', tl(qc), args)[0].text;

describe('1: the MW beside a state queue count', () => {
  it('a null-capacity sum (active_mw 0) never prints "0 MW"', () => {
    const t = tlText({ active_projects: 312, active_mw: 0, by_iso: [{ iso: 'PJM', active_projects: 312, active_mw: 0 }] });
    expect(t).toMatch(/^VA: 312 active generation requests located in the state \(PJM queue rows\)/);
    expect(t).not.toMatch(/\bMW\)/);
  });
  it('a MW sum with no stated coverage is left out (today\'s backend)', () => {
    const t = tlText({ active_projects: 175, active_mw: 5321.4, by_iso: [{ iso: 'PJM', active_projects: 175, active_mw: 5321.4 }] });
    expect(t).not.toMatch(/5,?321/);
  });
  it('coverage >= 80%: "X MW across N of M requests"', () => {
    const t = tlText({ active_projects: 100, active_mw: 5000, active_mw_projects: 85 });
    expect(t).toContain('VA: 100 active generation requests located in the state (5,000 MW across 85 of 100 requests)');
  });
  it('coverage under 80%: no MW', () => {
    expect(tlText({ active_projects: 100, active_mw: 5000, active_mw_projects: 79 })).not.toMatch(/5,?000/);
  });
  it('the serving-grid branch follows the same rule', () => {
    const qc = { active_projects: 30, active_mw: 0, serving_grid: 'PJM', by_iso: [{ iso: 'PJM', active_projects: 30, active_mw: 0 }] };
    expect(tlText(qc)).not.toMatch(/0 MW/);
    const qc2 = { active_projects: 30, active_mw: 900, serving_grid: 'PJM', by_iso: [{ iso: 'PJM', active_projects: 30, active_mw: 900, active_mw_projects: 30 }] };
    expect(tlText(qc2)).toContain('(900 MW across 30 of 30 requests)');
    expect(servingGridQueue('VA', [{ iso: 'PJM', active_projects: 3, active_mw: 9 }], 'PJM').mwRows).toBe(null);
  });
  it('queueMwClause: never a 0 or null sum', () => {
    expect(queueMwClause(0, 10, 10)).toBe('');
    expect(queueMwClause(null, 10, 10)).toBe('');
    expect(queueMwClause(50, 10, null)).toBe('');
    expect(queueMwClause(50, 10, 8)).toBe(' (50 MW across 8 of 10 requests)');
  });
});

// ── 2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('2: the facility header names a metro only when one resolves', () => {
  let prev;
  beforeEach(() => { prev = process.env.DCHUB_PLAN_FACILITY_LEAD_V1; process.env.DCHUB_PLAN_FACILITY_LEAD_V1 = '1'; });
  afterEach(() => { if (prev === undefined) delete process.env.DCHUB_PLAN_FACILITY_LEAD_V1; else process.env.DCHUB_PLAN_FACILITY_LEAD_V1 = prev; });

  it('a facility name: the rows\' cities and state, no "metro"', () => {
    const rows = [{ name: 'DFW10', provider: 'Digital Realty', city: 'Dallas', state: 'TX' },
      { name: 'DFW29', provider: 'Digital Realty', city: 'Richardson', state: 'TX' }];
    const t = searchFacilitiesFacts({ _data_total_available: 4, facilities: rows }, { query: 'Digital Realty DFW (Richardson)' })[0].text;
    expect(t).toContain('the rows sit in Dallas and Richardson, TX');
    expect(t).not.toMatch(/metro/);
  });
  it('an address: the city in title case, no "metro"', () => {
    const rows = [{ name: 'CH1', provider: 'Equinix', city: 'CHICAGO', state: 'IL' }];
    const t = searchFacilitiesFacts({ _data_total_available: 2, facilities: rows }, { query: '350 E Cermak' })[0].text;
    expect(t).toContain('the rows sit in Chicago, IL');
    expect(t).not.toMatch(/CHICAGO|Cermak metro/);
  });
  it('a metro asked by name keeps "<place> metro"', () => {
    const rows = [{ name: 'ATL1', provider: 'QTS', city: 'Atlanta' }, { name: 'ALP1', provider: 'X', city: 'Alpharetta' }];
    const t = searchFacilitiesFacts({ total_matching: 2, facilities: rows }, { query: 'Atlanta', state: 'GA' })[0].text;
    expect(t).toContain('the rows sit in Atlanta and Alpharetta, Atlanta metro');
  });
  it('the rows\' market field names the metro for a facility query', () => {
    const rows = [{ name: 'A', city: 'Richardson', market: 'Dallas' }, { name: 'B', city: 'Plano', market: 'Dallas' }];
    expect(honestCountText({ n: 2, returned: 2, total: 2, scopeTxt: ' matching "x"', rows, place: 'Digital Realty DFW (Richardson)', scoped: false }))
      .toContain('the rows sit in Richardson and Plano, Dallas metro');
  });
  it('helpers', () => {
    expect(cityCase('CHICAGO')).toBe('Chicago');
    expect(cityCase('WINSTON-SALEM')).toBe('Winston-Salem');
    expect(cityCase('McLean')).toBe('McLean');
    expect(rowsMetro({ rows: [], place: 'Digital Realty DFW (Richardson)' })).toBe(null);
    expect(rowsMetro({ rows: [], place: 'Columbus' })).toBe('Columbus');
  });
});

// ── 3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('3: fact_header dates are data dates', () => {
  it('a FIRM panel effective date does not date the plan', () => {
    const parcel = { as_of: '2026-11-24', parcel: { acres: 4.2 },
      flood: { zone: 'X', firm_panel: '51107C0261E', panel_effective_date: '2017-02-17', as_of: '2017-02-17' } };
    const plan = { _entity: 'plan_execution', executed: [{ step: 1, tool: 'analyze_parcel', args: {}, status: 'executed', result: parcel }] };
    plan.provenance = buildProvenance(plan, { toolName: 'execute_plan' });
    expect(plan.provenance.as_of).toBe('2026-11-24');
    expect(buildPlanFactHeader(plan)).not.toMatch(/2017-02-17/);
  });
  it('an effective_date outside a row is not a data date', () => {
    expect(buildProvenance({ as_of: '2026-11-20', ordinance: { effective_date: '2019-01-01' } }, {}).as_of).toBe('2026-11-20');
  });
  it('per_iso releases of ISOs outside as_of_isos do not date the plan', () => {
    const infra = { summary: { as_of: { gas_pipeline: null, transmission: '2026-11-19' } },
      sources: { transmission: { as_of: '2026-11-19', as_of_all_isos: '2026-05-15', as_of_isos: ['PJM'],
        per_iso: [{ iso: 'ISO-NE', as_of: '2026-05-15' }, { iso: 'CAISO', as_of: '2026-08-03' }, { iso: 'PJM', as_of: '2026-11-19' }] } },
      transmission_projects: [{ iso: 'PJM', source_release: '2026-11-19', kv: 500 }] };
    const plan = { _entity: 'plan_execution', executed: [{ step: 1, tool: 'get_infra_projects', args: { state: 'VA', type: 'transmission' }, status: 'executed', result: infra }] };
    expect(buildProvenance(plan, { toolName: 'execute_plan' }).as_of).toBe('2026-11-19');
    // No as_of_isos: every ISO's release still counts (unchanged).
    const all = JSON.parse(JSON.stringify(infra)); delete all.sources.transmission.as_of_isos;
    expect(buildProvenance(all, {}).as_of).toBe('2026-05-15');
  });
});

// ── 4 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('4: a line with no voltage on record', () => {
  const ctx = { intent_class: 'grid_constraints', state: 'VA', place_label: 'Loudoun County, VA' };
  const EHV = { distance_km: 3.4, voltage_kv: 500, operator: 'DOM', from_sub: 'BEAUMEADE', to_sub: 'Y' };
  const infra = (prox) => ({ step: 1, tool: 'get_infrastructure', args: { lat: 39, lon: -77.4, radius_km: 30 }, status: 'executed',
    result: { counts: { substations: 9 }, filter: { radius_km: 30 }, nearest_transmission: nearestTransmission(prox) } });
  const PROX = { available: true, line_count: 4, ehv_230kv_plus: 2, max_voltage_kv: 500, nearest: { distance_km: 7.5, voltage_kv: null, operator: 'DOM' } };
  it('the any-voltage clause names the distance, then the gap', () => {
    const a = buildGridConstraintsAnswer(ctx, [infra({ ...PROX, nearest_ehv: EHV })]);
    const all = `${a.headline} ${a.evidence.join(' ')}`;
    expect(all).not.toMatch(/voltage not held|voltage voltage/);
    expect(a.headline).toContain('nearest line of any voltage: 7.5 km away (voltage not on record)');
    expect(a.evidence.join(' ')).toContain('the nearest line of any voltage is 7.5 km away (voltage not on record)');
  });
  it('no 230 kV+ line: the nearest line says the gap after its distance', () => {
    const a = buildGridConstraintsAnswer(ctx, [infra(PROX)]);
    expect(a.evidence.join(' ')).toContain('Nearest transmission line: 7.5 km away (voltage not on record)');
  });
});

// ── 5 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('5: the EIA-930 demand hour is said as its America/Phoenix day', () => {
  it('02:00 UTC on 11-26 is 2026-11-25 in Phoenix; as_of keeps the machine day', () => {
    const s = { tool: 'get_grid_intelligence', step: 1, args: { iso: 'PJM' },
      p: { iso: 'PJM', as_of: '2026-11-26T02:00:00Z', taste: { headline: { name: 'demand_mw', value: 105764, as_of: '2026-11-26T02' } } } };
    const f = headroomFact(s);
    expect(f.text).toContain('live demand was 105,764 MW (EIA-930 hourly, as of 2026-11-25)');
    expect(f.as_of).toBe('2026-11-26');
  });
});
