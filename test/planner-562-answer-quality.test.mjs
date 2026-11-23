// planner-562-answer-quality.test.mjs -- planner 5.62 (Grok answer-quality note 2026-11-23), pure functions, no network.
// P5: a corridor-table centroid ("Loudoun County") is not a user site; permitting asks there route to permitting.
// P7: a question that asks for facilities reads search_facilities, held to the named place, same wave.
// P4: a facility search is held to the named town and its answer leads with the facilities, dated by row as_of.
// Every fixture is PJM (Ashburn, Loudoun, Northern Virginia, Columbus OH).
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { buildPermittingAnswer, permittingAsk, namedJurisdictions } from '../lib/permitting-answer.mjs';
import { facilitiesAsk } from '../lib/facility-join.mjs';
import { searchFacilitiesFacts, factsFromStep } from '../lib/plan-step-facts.mjs';
import { buildFacilitySearchAnswer } from '../lib/facility-search-answer.mjs';

const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.tool, s.args_hint, s.depends_on]));
const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const LOUDOUN = [
  'Are there any data center moratoriums or permitting constraints in Loudoun County or Northern Virginia?',
  'Are there data center permitting constraints in Loudoun County?',
  'Is there a moratorium on data centers in Loudoun County, Virginia?',
];

describe('planner 5.62', () => {
  it('PLANNER_VERSION is 5.62', () => { expect(PLANNER_VERSION).toBe('5.62'); });
});

describe('item 1: permitting survives a corridor centroid', () => {
  for (const q of LOUDOUN) {
    it(`routes to permitting at state VA: ${q}`, () => {
      const p = _planQuery(q, {});
      expect(p.intent_class, show(p)).toBe('permitting');
      const m = p.recommended_sequence.find((s) => s.tool === 'get_permitting_intel' && s.args_hint.class === 'moratorium');
      expect(m && m.args_hint, show(p)).toEqual({ class: 'moratorium', state: 'VA' });
    });
  }
  it('"permitting constraints" on data centers is a permitting ask', () => {
    expect(permittingAsk('Are there data center permitting constraints in Virginia?')).toBe('weak');
    expect(permittingAsk('permitting constraints for a gas turbine air permit')).toBe(null);
  });
  it('a real point keeps its site screen; an address screen and an air-permit ask keep their class', () => {
    expect(_planQuery('Evaluate the site at 39.0,-77.5 for moratorium risk', {}).intent_class).toBe('site_analysis');
    expect(_planQuery('Screen 21571 Beaumeade Circle, Ashburn VA: flood zone, zoning and parcel', {}).intent_class).toBe('site_analysis');
    expect(_planQuery('air permits for gas turbines near Ashburn', {}).intent_class).toBe('air_permits');
  });
  it('a site hunt in a corridor county runs the land flow, with the moratorium read beside it', () => {
    const p = _planQuery('find a site for a 50 MW data center in Loudoun County, check moratorium', {});
    expect(p.intent_class, show(p)).not.toBe('permitting');
    expect(p.recommended_sequence[0].tool, show(p)).toBe('find_sites');
    expect(p.recommended_sequence[0].args_hint, show(p)).toMatchObject({ lat: 39.09, lon: -77.64 });
    expect(p.recommended_sequence.some((s) => s.tool === 'get_permitting_intel' && s.args_hint.class === 'moratorium'), show(p)).toBe(true);
  });
});

const VA_MOR = { ok: true, class: 'moratorium', count: 2, records: [
  { jurisdiction: 'Loudoun County', state: 'VA', stage: 'enacted', effective_date: null, as_of: '2026-09-18', source_url: 'https://example.gov/loudoun' },
  { jurisdiction: 'Suffolk', state: 'VA', stage: 'enacted', effective_date: null, as_of: '2026-10-23', source_url: 'https://example.gov/suffolk' },
] };
const ex = (step, tool, args, result) => ({ step, tool, status: 'executed', args, result });

describe('item 1: the permitting answer leads with the named jurisdiction', () => {
  it('Loudoun leads with its stage, source date and source link; Suffolk follows as another VA jurisdiction', () => {
    const a = buildPermittingAnswer({ intent: LOUDOUN[0], intent_class: 'permitting' },
      [ex(1, 'get_permitting_intel', { class: 'moratorium', state: 'VA' }, VA_MOR)]);
    expect(a.headline).toMatch(/^Named in the question: Loudoun County, VA: enacted, source date 2026-09-18, source https:\/\/example\.gov\/loudoun/);
    expect(a.headline).toMatch(/Other VA jurisdictions: Suffolk, VA \(enacted, as of 2026-10-23\)\./);
    expect(a.headline.match(/Loudoun/g).length).toBe(1);
    expect(a.headline).not.toMatch(/effective/);   // effective_date is null: never invented
  });
  it('a named county with no record says so, dated, and invents nothing', () => {
    const a = buildPermittingAnswer({ intent: 'Is there a moratorium in Fairfax County, Virginia?', intent_class: 'permitting' },
      [ex(1, 'get_permitting_intel', { class: 'moratorium', state: 'VA' }, VA_MOR)]);
    expect(a.headline).toMatch(/^No published moratorium record for Fairfax County on file as of 2026-10-23/);
    expect(a.headline).not.toMatch(/Fairfax County, VA:/);
  });
  it('a state-only ask keeps the 5.42 headline', () => {
    const a = buildPermittingAnswer({ intent: 'data center moratoriums in Virginia?', intent_class: 'permitting' },
      [ex(1, 'get_permitting_intel', { class: 'moratorium', state: 'VA' }, VA_MOR)]);
    expect(a.headline).toMatch(/^2 data-center moratorium records on record in VA/);
  });
  it('a question word before the county is not part of its name', () => {
    expect(namedJurisdictions('Does Fairfax County have a data center moratorium?', VA_MOR.records).asked).toEqual(['Fairfax County']);
    expect(namedJurisdictions('Is there a moratorium in Prince William County?', VA_MOR.records).asked).toEqual(['Prince William County']);
    expect(namedJurisdictions('Is Loudoun County under a moratorium?', VA_MOR.records).asked).toEqual(['Loudoun County']);
  });
  it('namedJurisdictions matches a whole name, not a fragment', () => {
    expect(namedJurisdictions('moratorium in Suffolk County, NY', VA_MOR.records).hit.map((r) => r.jurisdiction)).toEqual(['Suffolk']);
    expect(namedJurisdictions('moratorium in Loudounville', VA_MOR.records).hit).toEqual([]);
  });
});

describe('item 2: a facilities ask joins search_facilities', () => {
  it('P7 Columbus: fiber, DCPI, grid and search_facilities {query:Columbus, state:OH}, same wave', () => {
    const p = _planQuery('Help me think about a data center site in Columbus, Ohio: power, fiber, and nearby facilities.', {});
    const t = tools(p);
    expect(t, show(p)).toContain('get_market_dcpi_rank');
    expect(t, show(p)).toContain('get_grid_intelligence');
    expect(t.some((x) => /fiber/.test(x)), show(p)).toBe(true);
    const f = p.recommended_sequence.find((s) => s.tool === 'search_facilities');
    expect(f && f.args_hint, show(p)).toEqual({ query: 'Columbus', state: 'OH' });
    expect(f.depends_on).toEqual([]);
  });
  it('Ashburn power + fiber + which data centers: search_facilities held to Ashburn', () => {
    const p = _planQuery('What power and fiber is near Ashburn, and which data centers are there?', {});
    const f = p.recommended_sequence.find((s) => s.tool === 'search_facilities');
    expect(f && f.args_hint, show(p)).toEqual({ city: 'Ashburn', state: 'VA' });
  });
  it('a queue ask gets no facility step', () => {
    expect(tools(_planQuery('PJM queue depth for Ashburn', {}))).not.toContain('search_facilities');
  });
  it('facilitiesAsk', () => {
    expect(facilitiesAsk('nearby facilities')).toBe(true);
    expect(facilitiesAsk('which data centers are in Columbus')).toBe(true);
    expect(facilitiesAsk('who operates in Ashburn')).toBe(true);
    expect(facilitiesAsk('operators in Ashburn')).toBe(true);
    expect(facilitiesAsk('PJM queue depth for Ashburn')).toBe(false);
  });
});

const ASH_ROWS = { total_matching: 605, as_of: null, facilities: [
  { name: 'Ashburn I', provider: 'Vantage Data Centers', city: 'Ashburn', state: 'VA', as_of: '2026-03-30', submarket_match: 'in' },
  { name: 'Ashburn II', provider: 'Vantage Data Centers', city: 'Ashburn', state: 'VA', as_of: '2026-03-30', submarket_match: 'in' },
], submarket_scope: { submarket: 'Ashburn', kept: 2, dropped_outside_submarket: 3, unverified: 0,
  outside_places: [{ place: 'Sterling', rows: 3 }] } };

describe('item 3: facility answers lead with facilities, scoped and dated', () => {
  it('P4 Ashburn is searched as the town, widening to the metro query only on no row', () => {
    const p = _planQuery('Which data center facilities are in the Ashburn market?', {});
    expect(p.intent_class).toBe('facility_search');
    const s = p.recommended_sequence[0];
    expect(s.tool).toBe('search_facilities');
    expect(s.args_hint).toEqual({ city: 'Ashburn', state: 'VA' });
    expect(s.widen_to).toEqual({ query: 'Northern Virginia', state: 'VA' });
  });
  it('the fact counts the rows kept in Ashburn, names them, and is dated by row as_of', () => {
    const [f] = searchFacilitiesFacts(ASH_ROWS, { query: 'Northern Virginia', state: 'VA' });
    expect(f.text).toBe('2 facilities in Ashburn on record, e.g. Vantage Ashburn I, Vantage Ashburn II (DC Hub, row as_of 2026-03-30).');
    expect(f.as_of).toBe('2026-03-30');
    expect(f.text).not.toMatch(/605|Northern Virginia|Sterling|undated/);
    expect(factsFromStep('search_facilities', ASH_ROWS, {})[0].text).toBe(f.text);
  });
  it('the facility answer leads with the facilities; the PJM line follows as context', () => {
    const grid = { iso: 'PJM', as_of: '2026-11-23', queue: { total_gw: 373.2 } };
    const a = buildFacilitySearchAnswer({ intent_class: 'facility_search' }, [
      ex(1, 'search_facilities', { city: 'Ashburn', state: 'VA' }, ASH_ROWS),
      ex(3, 'get_grid_intelligence', { iso: 'PJM' }, grid),
    ]);
    expect(a.headline).toMatch(/^2 facilities in Ashburn on record/);
    expect(a.facts[0].tool).toBe('search_facilities');
  });
  it('another class is not answered here', () => {
    expect(buildFacilitySearchAnswer({ intent_class: 'colocation' }, [ex(1, 'search_facilities', {}, ASH_ROWS)])).toBe(null);
  });
});
