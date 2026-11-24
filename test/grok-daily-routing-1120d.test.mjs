// grok-daily-routing-1120d.test.mjs — planner 5.56, Grok's daily MCP note (2026-11-20), four routing gaps confirmed live
// on 5.55 through plan_query (03:01Z 11-21). Pure: the planner and the answer builders in-process, no network.
//   item 1  a street address + a screen verb is a site screen (site_analysis), not permitting ("zoning" in the sentence)
//   item 2  one named facility is searched by its name, get_facility reads the best name match, the record leads
//   item 3  a status ask (under construction ...) reads get_pipeline with the status and leads with the projects
//   item 4  a data-center capacity ask reads get_market_intel (operational count + MW floor) beside the construction
//           pipeline, and facts[] and paired_sides count the same projects
// The real-server run of the same questions: test/grok-daily-routing-1120d-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _execGeocodePlan, PLANNER_VERSION } from '../server.mjs';
import { namedFacility, rankByFacilityName, buildNamedFacilityAnswer } from '../lib/named-facility.mjs';
import { facilitySlugsFromSearch } from '../lib/colocation-plan.mjs';
import { pipelineStatusOf, buildPipelineStatusAnswer, buildCapacitySidesAnswer } from '../lib/pipeline-status.mjs';
import { pairLines } from '../lib/plan-pairs.mjs';
import { factsFromExecuted } from '../lib/plan-step-facts.mjs';
import { siteScreenVerb } from '../lib/street-address.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const ex = (step, tool, args, result, extra = {}) => ({ step, tool, args, status: 'executed', result, ...extra });

it('is planner 5.56 or later (5.58; 5.56 routing + 5.57 answers)', () => { expect(PLANNER_VERSION).toBe('5.63'); });

const BEAUMEADE = 'Screen 21571 Beaumeade Circle, Ashburn, VA 20147 as a data center site: flood zone, zoning and parcel, nearby transmission and the grid context.';
const GEO = { lat: 39.02219, lng: -77.45358, label: '21571 Beaumeade Cir, Ashburn, Virginia, 20147', source: 'ArcGIS World Geocoder' };

describe('item 1: a street address with a screen verb is a site screen', () => {
  it('the Beaumeade screen classes as site_analysis, not permitting', () => {
    const p = _planQuery(BEAUMEADE);
    expect(p.intent_class).toBe('site_analysis');
    expect(p.matched_classes.find((c) => c.class === 'permitting')).toBeUndefined();
  });
  it('its point reads run at the geocoded address (39.02219, -77.45358)', async () => {
    const seq = structuredClone(_planQuery(BEAUMEADE).recommended_sequence);
    expect(seq.map((s) => s.tool)).toEqual(expect.arrayContaining(['get_composite_site_score', 'get_infrastructure', 'get_disaster_risk']));
    const asked = [];
    await _execGeocodePlan(seq, async (q) => { asked.push(q); return GEO; });
    expect(asked).toEqual(['21571 Beaumeade Circle, Ashburn, VA']);
    for (const t of ['get_composite_site_score', 'get_infrastructure', 'get_disaster_risk']) {
      expect(seq.find((s) => s.tool === t).args_hint).toMatchObject({ lat: 39.02219, lon: -77.45358 });
    }
  });
  it('a Virginia (Loudoun) permitting read stays inside the screen', () => {
    const pi = _planQuery(BEAUMEADE).recommended_sequence.find((s) => s.tool === 'get_permitting_intel');
    expect(pi).toBeTruthy();
    expect(pi.args_hint).toMatchObject({ state: 'VA' });
  });
  it('a moratorium question with no site still classes as permitting', () => {
    expect(_planQuery('Which counties have data center moratoriums?').intent_class).toBe('permitting');
    // an address with no screen verb and a moratorium ask keeps permitting
    expect(siteScreenVerb('Is there a data center moratorium at 21571 Beaumeade Circle, Ashburn, VA?')).toBe(false);
    expect(_planQuery('Is there a data center moratorium at 21571 Beaumeade Circle, Ashburn, VA?').intent_class).toBe('permitting');
  });
});

const QTS_Q = 'Give me the details for QTS Atlanta Metro data center: address, operator, power capacity and status.';
const SUWANEE = { name: 'QTS Suwanee', provider: 'QTS Data Centers', city: 'Suwanee', state: 'GA', status: 'operational', slug: 'qts-qts-suwanee-1a2b3c4d' };
const ATL1 = { name: 'QTS Atlanta-Metro (ATL1)', provider: 'QTS Data Centers', city: 'Atlanta', state: 'GA', status: 'operational', slug: 'qts-qts-atlanta-metro-atl1-5e6f7a8b' };

describe('item 2: a named facility keeps its name', () => {
  it('the search carries "QTS Atlanta Metro", with the market as a filter', () => {
    const p = _planQuery(QTS_Q);
    expect(p.intent_class).toBe('facility_search');
    const s = p.recommended_sequence.find((x) => x.tool === 'search_facilities');
    expect(s.args_hint.query).toBe('QTS Atlanta Metro');
    expect(s.args_hint.state).toBe('GA');
    expect(s.named_facility).toBe('QTS Atlanta Metro');
    expect(tools(p)).toContain('get_facility');
  });
  it('an operator-wide ask is not one named facility', () => {
    expect(namedFacility('Equinix sites in Virginia over 10 MW')).toBeNull();
    expect(namedFacility('QTS data centers in Atlanta')).toBeNull();
    expect(namedFacility('Tell me about Digital Realty IAD38')).toMatchObject({ name: 'Digital Realty IAD38', code: 'IAD38' });
  });
  it('get_facility takes the best name match, not the first row', () => {
    const r = { success: true, data: [SUWANEE, ATL1] };
    expect(facilitySlugsFromSearch(r, 3, 'QTS Atlanta Metro', 'QTS Atlanta Metro')[0]).toMatch(/^qts-qts-atlanta-metro-atl1/);
    // no name: the first row as before
    expect(facilitySlugsFromSearch(r, 3, 'Atlanta')[0]).toBe(SUWANEE.slug);
    // a code matches whole: DA1 never matches DA11
    expect(rankByFacilityName([{ name: 'Equinix DA11', slug: 'a' }, { name: 'Equinix DA1', slug: 'b' }], 'Equinix DA1')[0].slug).toBe('b');
  });
  it('the lead is the facility record, and the power context comes after it', () => {
    const full = { ...ATL1, address: '1033 Jefferson St NW, Atlanta, GA 30318', updated_at: '2026-11-02T00:00:00Z' };
    const timeline = { state: 'GA', timeline: [{ year: 2026, cumulative_firm_signal_mw: 4210 }], sources: { planned_generators: { vintage: '2026-09-30' } } };
    const a = buildNamedFacilityAnswer({ intent: QTS_Q, intent_class: 'facility_search', facility: { name: 'QTS Atlanta Metro' } }, [
      ex(1, 'search_facilities', { query: 'QTS Atlanta Metro', state: 'GA' }, { success: true, data: [SUWANEE, ATL1] }),
      ex(3, 'get_power_availability_timeline', { state: 'GA' }, timeline),
      ex(2, 'get_facility', { slug: ATL1.slug }, { success: true, data: full }),
    ]);
    expect(a.headline.startsWith('QTS Atlanta-Metro')).toBe(true);
    const first = a.headline.split(/(?<=\.)\s/)[0];
    expect(first).not.toMatch(/firm-supply/i);
    expect(first).toMatch(/operator QTS; Atlanta, GA; status operational; address 1033 Jefferson St NW/);
    expect(a.headline).toMatch(/record as of 2026-11-02/);
    expect(a.headline).toMatch(/Not on record: power capacity \(MW\)/);
    expect(a.headline).toMatch(/Power context for GA \(not this facility's own supply\): GA 2026 firm-supply signal: 4,210 MW/);
  });
});

const NOVA_Q = 'Which data center campuses are under construction in Northern Virginia, with operator and MW?';
const PIPE = { success: true, as_of: '2026-11-20', total: 2, projects: [
  { company: 'Amazon Web Services', project: 'AWS Devlin Tech Park', capacity: 300, status: 'construction', market: 'Northern Virginia' },
  { company: 'CyrusOne', project: 'CyrusOne Sterling VI', capacity: null, status: 'construction', market: 'Northern Virginia' }] };

describe('item 3: a status ask reaches the pipeline', () => {
  it('status words map to the pipeline status', () => {
    expect(pipelineStatusOf(NOVA_Q)).toBe('construction');
    expect(pipelineStatusOf('which campuses are being built in Ohio')).toBe('construction');
    expect(pipelineStatusOf('planned data centers in Georgia')).toBe('announced');
    expect(pipelineStatusOf('the gas pipeline near Austin')).toBeNull();
  });
  it('the plan reads get_pipeline {status: construction, state: VA}', () => {
    const p = _planQuery(NOVA_Q);
    const gp = p.recommended_sequence.find((s) => s.tool === 'get_pipeline');
    expect(gp).toBeTruthy();
    expect(gp.args_hint).toMatchObject({ status: 'construction', state: 'VA' });
    expect(p.recommended_sequence[0].tool).toBe('get_pipeline');
    expect(tools(p)).not.toContain('get_facility');
  });
  it('the lead names the projects with their company; grid demand never heads it', () => {
    const a = buildPipelineStatusAnswer({ intent_class: 'facility_search', status: 'construction' }, [
      ex(1, 'get_pipeline', { status: 'construction', state: 'VA', market: 'northern-virginia' }, PIPE),
      ex(2, 'get_grid_intelligence', { iso: 'PJM' }, { iso: 'PJM', demand_mw: 95340 }),
    ]);
    expect(a.headline).toMatch(/^Under construction in Northern Virginia \(DC Hub pipeline, as of 2026-11-20\): AWS Devlin Tech Park \(Amazon Web Services, 300 MW\); CyrusOne Sterling VI \(CyrusOne, MW not held\)\./);
    expect(a.headline).not.toMatch(/PJM demand/);
  });
  it('a preview with capacity locked says MW is withheld', () => {
    const prev = { ...PIPE, total: undefined, _locked_fields: ['capacity'], projects: PIPE.projects.map((r) => ({ ...r, capacity: null })) };
    const a = buildPipelineStatusAnswer({ intent_class: 'facility_search', status: 'construction' }, [ex(1, 'get_pipeline', { status: 'construction', state: 'VA' }, prev)]);
    expect(a.headline).toMatch(/AWS Devlin Tech Park \(Amazon Web Services, MW withheld at this access level\)/);
  });
});

const TX_Q = 'How much data center capacity in Texas is operational versus under construction (MW)?';
const INTEL = (name, n, mw, rep) => ({ success: true, as_of: '2026-11-20', market: { name }, stats: { facility_count: n, total_power_mw: mw, mw_reporting_count: rep } });

describe('item 4: dc_capacity reads the operational side', () => {
  it('the plan runs get_market_intel for the operational count and get_pipeline status=construction for the build side', () => {
    const p = _planQuery(TX_Q);
    expect(p.intent_class).toBe('dc_capacity');
    const intel = p.recommended_sequence.filter((s) => s.tool === 'get_market_intel');
    expect(intel.map((s) => s.args_hint.market)).toEqual(['dallas', 'houston']);
    expect(p.recommended_sequence.find((s) => s.tool === 'get_pipeline').args_hint).toMatchObject({ state: 'TX', status: 'construction' });
    // the alternatives no longer reject the market brief
    expect(JSON.stringify(p.alternatives || [])).not.toMatch(/"tool":"get_market_intel"/);
    expect(p.recommended_sequence.length).toBeLessThanOrEqual(6);
  });
  it('a pipeline-only capacity ask keeps its 5.29 plan (no market brief, the facility search stays)', () => {
    const t = tools(_planQuery('What data center capacity is under construction in Dallas?'));
    expect(t).toContain('search_facilities');
    expect(t).not.toContain('get_market_intel');
  });
  it('the lead holds the operational count + MW floor with its date, and the construction count', () => {
    const a = buildCapacitySidesAnswer({ intent_class: 'dc_capacity', state: 'TX' }, [
      ex(1, 'get_pipeline', { country: 'US', state: 'TX', status: 'construction' }, { ...PIPE, projects: PIPE.projects.map((r) => ({ ...r, market: 'Dallas' })) }),
      ex(2, 'get_market_intel', { market: 'dallas' }, INTEL('Dallas', 246, 4323, 45)),
      ex(3, 'get_market_intel', { market: 'houston' }, INTEL('Houston', 120, 900, 20)),
    ]);
    expect(a.headline).toMatch(/^Operational, in TX's tracked markets \(named one by one, not a state total\): Dallas: 246 facilities tracked, 4,323 MW across the 45 that report capacity \(a floor\) \(DC Hub market brief, as of 2026-11-20\); Houston: 120 facilities tracked/);
    expect(a.headline).toMatch(/Under construction: TX data-center pipeline: 2 projects on record/);
  });
  it('a withheld construction count is said as withheld', () => {
    const prev = { success: true, as_of: '2026-11-20', preview_is_partial: true, projects: [{ project: 'X', company: 'Y', capacity: null }] };
    const a = buildCapacitySidesAnswer({ intent_class: 'dc_capacity', state: 'TX' }, [ex(1, 'get_pipeline', { state: 'TX', status: 'construction' }, prev)]);
    expect(a.headline).toMatch(/Under construction: TX data-center pipeline: 1 project shown in this preview \(the full count is withheld\); MW withheld at this access level/);
  });
  it('facts[] (the slimmed step) and paired_sides (the full step) count the same projects', () => {
    const fullP = { success: true, as_of: '2026-11-20', preview_is_partial: true, projects: [
      { project: 'A', company: 'C1', capacity: null }, { project: 'B', company: 'C2', capacity: null }] };
    // what execute_plan's step slimmer keeps: the first row, and the full count in truncation.rows_total
    const slim = { ...fullP, projects: [fullP.projects[0]], truncated: true, truncation: { basis: 'structured', rows_kept_per_array: 1, rows_total: { projects: 2 } } };
    const e = ex(1, 'get_pipeline', { state: 'TX', status: 'construction' }, slim);
    const full = new Map([[e, fullP]]);
    const count = (s) => Number((/(\d+) projects? (?:on record|shown)/.exec(s) || [])[1]);
    const fromFacts = factsFromExecuted([e]).find((f) => f.tool === 'get_pipeline').text;
    const fromPairs = pairLines([e], (x) => full.get(x)).data_center.line;
    expect(count(fromFacts)).toBe(2);
    expect(count(fromPairs)).toBe(2);
  });
});
