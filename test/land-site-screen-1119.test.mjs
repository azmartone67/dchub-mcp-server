// land-site-screen-1119.test.mjs — Grok's daily MCP leadership note (2026-11-18 evening), items 3 and 4. Planner 5.42.
//   item 3 (LAND L1)  a site screen at a point that names the parcel and transmission reads them, and the lead carries
//                     the flood and transmission lines; evidence[] holds one line per read (flood, water, permitting,
//                     transmission, parcel)
//   item 4 (LAND L2)  "find land for N MW near <place>" runs find_sites first, around the place's point (or a geocoded
//                     one, falling back to the state), and the lead names the top three search areas or says none matched
import { describe, it, expect } from 'vitest';
import { _planQuery, _execGeocodePlan } from '../server.mjs';
import { landSearchAsk, landSearchFirst, landSearchLead, withLandLead } from '../lib/land-search.mjs';
import { siteScreenSteps, siteScreenFacts } from '../lib/site-screen-facts.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const steps = (p) => p.recommended_sequence;
// Every step numbered 1..n in order, and every depends_on names an earlier step.
const wellFormed = (seq) => seq.every((s, i) => s.step === i + 1 && (s.depends_on || []).every((n) => n >= 1 && n < s.step));

describe('item 4: a land question leads with find_sites', () => {
  it('Columbus (capacity_search wording): find_sites is step 1, at the city point, 60 km', () => {
    const p = _planQuery('Find land for a 100 MW data center near Columbus, Ohio');
    const s = steps(p);
    expect(s[0]).toMatchObject({ step: 1, tool: 'find_sites', land_search: true, args_hint: { lat: 39.9612, lon: -82.9988, radius_km: 60 } });
    expect(s.filter((x) => x.tool === 'find_sites')).toHaveLength(1);
    expect(wellFormed(s)).toBe(true);
  });
  it('Columbus (dc_power_place wording): the power reads stay and find_sites leads them', () => {
    const p = _planQuery('Find powered land for a 100 MW data center near Columbus, Ohio: grid headroom and the queue');
    expect(p.intent_class).toBe('dc_power_place');
    const s = steps(p);
    expect(s[0].tool).toBe('find_sites');
    expect(s.map((x) => x.tool)).toEqual(expect.arrayContaining(['get_refined_queue', 'get_hosting_capacity', 'get_market_intel']));
    expect(wellFormed(s)).toBe(true);
  });
  it('a place the planner holds no point for is geocoded at execution, and a miss falls back to the state', async () => {
    const p = _planQuery('Find sites for a 200 MW data center near Dallas');
    const fs = steps(p)[0];
    expect(fs).toMatchObject({ tool: 'find_sites', geocode: 'Dallas, TX', geocode_fallback: { state: 'TX' } });
    const miss = structuredClone(steps(p));
    const r = await _execGeocodePlan(miss, async () => null);
    expect(miss[0].args_hint).toEqual({ state: 'TX' });
    expect(r[0]).toMatchObject({ resolved: false, fell_back_steps: 1 });
    const hit = structuredClone(steps(p));
    await _execGeocodePlan(hit, async () => ({ lat: 32.7767, lng: -96.797, label: 'Dallas, Texas' }));
    expect(hit[0].args_hint).toEqual({ lat: 32.7767, lon: -96.797, radius_km: 60 });
  });
  it('questions that are not a land search keep their plan', () => {
    expect(steps(_planQuery('how soon can a 100 MW load get power in ERCOT')).some((x) => x.land_search)).toBe(false);
    const ash = steps(_planQuery('Find 100 MW of buildable capacity near Ashburn'));
    expect(ash.some((x) => x.land_search)).toBe(false);
    expect(steps(_planQuery('where should I look for 200 MW in Ohio'))[0].tool).toBe('site_selection_canvas');
    // a point given is a site screen, not a search; no size is not a land search
    expect(landSearchAsk('find land for 100 MW here', { mw: 100, coords: { lat: 39, lon: -77 } })).toBe(false);
    expect(landSearchAsk('find land for a data center in Ohio', {})).toBe(false);
    expect(landSearchAsk('Find land for a 100 MW data center near Columbus, Ohio', { mw: 100 })).toBe(true);
  });
  it('moving find_sites first remaps every depends_on', () => {
    const seq = [{ step: 1, tool: 'a', depends_on: [] }, { step: 2, tool: 'find_sites', depends_on: [], args_hint: { state: 'OH' } },
      { step: 3, tool: 'b', depends_on: [1, 2] }];
    landSearchFirst(seq, { lat: 1, lon: 2, radius_km: 60 }, 'why');
    expect(seq.map((s) => [s.step, s.tool, s.depends_on])).toEqual([[1, 'find_sites', []], [2, 'a', []], [3, 'b', [2, 1]]]);
    expect(seq[0].args_hint).toEqual({ lat: 1, lon: 2, radius_km: 60 });
  });
});

const CAND = (lat, lon, fib, gas, mkt, verdict) => ({ anchor: { type: 'substation', kv_band: '500 kV+' }, coordinate_precision_km: 11,
  fiber_distance_km: fib, gas_distance_km: gas, lat, lon, grid_operator: { resolved: true, iso: 'PJM' },
  market: { market: mkt, verdict, as_of: '2026-11-19' }, verdict });
const FS = { success: true, _candidates_total_available: 10, candidates: [
  CAND(40.2, -83, 0.26, 18.06, 'Worthington', 'AVOID'), CAND(40.3, -83.4, 0.17, 18.07, 'Worthington', 'AVOID'),
  CAND(40.2, -82.8, 0.76, 13.75, 'Worthington', 'AVOID')] };

describe('item 4: the land-search lead', () => {
  const fsArgs = { lat: 39.9612, lon: -82.9988, radius_km: 60 };
  it('names the top three search areas with their substation, fiber, gas and market verdict', () => {
    const l = landSearchLead([ex(1, 'find_sites', fsArgs, FS)], null, 'Columbus, OH');
    expect(l.headline).toMatch(/^find_sites: 10 search areas within 60 km of Columbus, OH \(3 shown\), top 3: 1\) near 40\.2, -83 \(500 kV\+ substation; fiber route 0\.26 km; gas pipeline 18\.1 km; Worthington DCPI AVOID\); 2\) /);
    expect(l.headline).toMatch(/3\) near 40\.2, -82\.8 /);
    expect(l.headline).toMatch(/coarsened to about 11 km/);
    expect(l.fact).toMatchObject({ tool: 'find_sites', as_of: '2026-11-19' });
    expect(l.not_established.join(' ')).toMatch(/not a parcel, not a listing and not land known to be for sale/);
  });
  it('says plainly when no area matched', () => {
    const l = landSearchLead([ex(1, 'find_sites', fsArgs, { success: true, count: 0, candidates: [] })], null, 'Columbus, OH');
    expect(l.headline).toBe('No substation-anchored search area matched within 60 km of Columbus, OH (find_sites).');
  });
  it('goes in front of the plan answer and keeps its queue and hosting lines', () => {
    const l = landSearchLead([ex(1, 'find_sites', fsArgs, FS)], null, 'Columbus, OH');
    const a = withLandLead({ kind: 'siting', headline: 'Siting read for 100 MW, PJM (ISO): DCPI AVOID (columbus-oh).',
      evidence: ['174 active interconnection-queue projects (queue data as of 2026-11-19).', 'Largest utility-published load feeder headroom: 18 MW.'],
      not_established: [], source: 'Source: DC Hub' }, l);
    expect(a.headline.indexOf('find_sites:')).toBe(0);
    expect(a.headline).toMatch(/Siting read for 100 MW/);
    expect(a.evidence).toHaveLength(3);
    expect(Object.keys(a).pop()).toBe('source');
    expect(withLandLead(null, l).kind).toBe('land_search');
  });
  it('a plan with no find_sites step gets no lead', () => {
    expect(landSearchLead([ex(1, 'get_refined_queue', {}, {})], null, 'x')).toBe(null);
  });
});

const L1 = 'Screen 21571 Beaumeade Circle, Ashburn, VA for flood zone, zoning and parcel, nearby transmission and the grid context';
const PT = { lat: 39.0186, lon: -77.458 };

describe('item 3: the site screen reads what it names', () => {
  it('the L1 screen adds analyze_parcel and get_infrastructure at the point, and keeps permitting', () => {
    const s = steps(_planQuery(L1, PT));
    expect(s.map((x) => x.tool)).toEqual(expect.arrayContaining(['analyze_site', 'get_disaster_risk', 'get_water_risk',
      'analyze_parcel', 'get_infrastructure', 'get_permitting_intel']));
    expect(s.find((x) => x.tool === 'get_infrastructure').args_hint).toEqual({ ...PT, radius_km: 10 });
    expect(s.length).toBeLessThanOrEqual(8);
    expect(wellFormed(s)).toBe(true);
  });
  it('the parcel only when named; get_infrastructure at every point (5.50: the nearest line in km); nothing without a point', () => {
    expect(siteScreenSteps('score this site for flood risk', PT, []).map((x) => x.tool)).toEqual(['get_infrastructure']);
    // "at this parcel" names the place of a power question; it does not ask for the parcel's boundary
    expect(siteScreenSteps('what power can I actually get at this parcel', PT, []).map((x) => x.tool)).toEqual(['get_infrastructure']);
    expect(siteScreenSteps('parcel boundary and acreage', PT, []).map((x) => x.tool)).toEqual(['analyze_parcel', 'get_infrastructure']);
    expect(siteScreenSteps('nearest substations to this site', PT, []).map((x) => x.tool)).toEqual(['get_infrastructure']);
    expect(siteScreenSteps('parcel acreage', PT, ['analyze_parcel', 'get_infrastructure'])).toEqual([]);
    expect(siteScreenSteps('parcel and transmission', null, [])).toEqual([]);
  });
});

const ANALYZE = { _gated: true, status: 'gated_preview', site_teaser: { verdict: 'BUILD', power_infrastructure: 'BUILD' },
  preview_bands: { verdict: 'BUILD', power_infrastructure: 'BUILD' },
  site_context: { blocks: [{ key: 'flood', status: 'answered', title: 'Flood zone' }] } };
const DISASTER = { coverage: 'validated', disaster_risk: { rating: 'Relatively Low' }, location: { county: 'Loudoun', state: 'Virginia' },
  hazards: { 'Riverine Flooding': 'Relatively Moderate', Lightning: 'Relatively High' }, source: 'FEMA National Risk Index (NRI), county-level' };
const WATER = { dominant_severity: 'Moderate (D1)', latest_week: { date: '2026-11-10T00:00:00' }, source: 'US Drought Monitor (NDMC/USDA/NOAA/NASA)', state: 'VA' };
const PERMIT = { count: null, _records_total_available: 24, records: [
  { class: 'local_sentiment', jurisdiction: 'Washington County', state: 'VA', stance: 'mixed', title: 'Washington Co., Va. approves data center ordinance', updated_at: '2026-11-12 19:35:31+00' },
  { class: 'local_sentiment', jurisdiction: 'Loudoun County', state: 'VA', stance: 'opposed', title: 'Loudoun Supervisors Approve 12-Month Data Center Pause', updated_at: '2026-11-18 15:09:21+00' }] };
const INFRA = { counts: { substations: 79, transmission_lines_eia: 14, gas_pipelines: 7, discovered_power_plants: 21 }, filter: { ...PT, radius_km: 10 } };
const PARCEL = { _entity: 'parcel_analysis', total_acres: 41.237, hosted_parcel: { parcel_id: '0412-34-5678', county: 'Loudoun', state: 'VA' } };
const L1_RUN = [
  ex(1, 'analyze_site', PT, ANALYZE), ex(3, 'get_disaster_risk', PT, DISASTER), ex(4, 'get_water_risk', { ...PT, state: 'VA' }, WATER),
  ex(5, 'analyze_parcel', PT, PARCEL), ex(6, 'get_infrastructure', { ...PT, radius_km: 10 }, INFRA), ex(7, 'get_permitting_intel', { state: 'VA' }, PERMIT)];

describe('item 3: the site-screen answer', () => {
  const a = buildIntentAnswer({ intent: L1, intent_class: 'site_analysis', constraint_iso: ['PJM'] }, L1_RUN);
  it('the lead keeps the site verdict and adds the flood and transmission lines', () => {
    expect(a.headline).toMatch(/^Siting read for PJM \(ISO\): site verdict BUILD at 39\.0186, -77\.458/);
    expect(a.headline).toMatch(/Flood: Loudoun County, Virginia rates riverine flooding Relatively Moderate in the FEMA National Risk Index \(all hazards: Relatively Low\); a county rating, not the parcel's FEMA flood zone\./);
    expect(a.headline).toMatch(/Transmission: 79 substations, 14 transmission-line records \(EIA snapshot\), 7 gas-pipeline records within 10 km of the point/);
  });
  it('evidence carries one line per read: flood, water (dated by its week), permitting (this county first), transmission, parcel', () => {
    const ev = a.evidence.join('\n');
    expect(a.evidence.length).toBeGreaterThanOrEqual(5);
    expect(ev).toMatch(/Water: drought Moderate \(D1\) in VA \(US Drought Monitor \(NDMC\/USDA\/NOAA\/NASA\), week of 2026-11-10\)\./);
    expect(ev).toMatch(/Permitting: 24 data-center permitting records on file for VA \(DC Hub permitting intel\)\. In this county: "Loudoun Supervisors Approve 12-Month Data Center Pause" \(Loudoun County, local_sentiment, opposed, record updated 2026-11-18\)\./);
    expect(ev).toMatch(/Parcel: 41\.2 acres, parcel 0412-34-5678 \(Loudoun County, VA GIS layer hosted by DC Hub\)\./);
  });
  it('says what the question asked that no read answers', () => {
    const ne = a.not_established.join(' ');
    expect(ne).toMatch(/zoning designation is not held by DC Hub/);
    expect(ne).toMatch(/FEMA flood zone at the point \(National Flood Hazard Layer\) is answered in analyze_site's full site report/);
  });
  it('a parcel outside the hosted counties says so', () => {
    const f = siteScreenFacts([ex(5, 'analyze_parcel', PT, { error: 'parcel_not_covered' })], null, 'parcel');
    expect(f.lines[0].text).toBe('Parcel: no hosted parcel boundary covers this point (analyze_parcel: parcel_not_covered).');
  });
  it('another class keeps its answer as it was', () => {
    const b = buildIntentAnswer({ intent: 'Find 100 MW near Ashburn', intent_class: 'capacity_search', constraint_iso: ['PJM'] }, L1_RUN);
    expect(b.headline).not.toMatch(/Flood:|Transmission:/);
    expect(b.evidence.join(' ')).not.toMatch(/^Water:/m);
  });
});
