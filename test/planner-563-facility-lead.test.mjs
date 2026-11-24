// planner-563-facility-lead.test.mjs -- DCHUB_PLAN_FACILITY_LEAD_V1 (Grok spec 3, 2026-11-23), pure functions, no
// network. Fixtures are Ashburn / Loudoun / Columbus OH only. Off, every function here behaves as planner 5.62.
import { describe, it, expect, afterEach } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { placeRow, cutRowsToSubmarket } from '../lib/submarket-scope.mjs';
import { searchFacilitiesFacts } from '../lib/plan-step-facts.mjs';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';
import { facilityLeadRoutingAdjust, submarketNumeralIn, honestCountText, facilityLeadSummary, FACILITY_LEAD_PLANNER_VERSION }
  from '../lib/plan-facility-lead.mjs';

const FLAG = 'DCHUB_PLAN_FACILITY_LEAD_V1';
const DCPI_FIX = 'DCHUB_PLANNER_DCPI_CLASSIFY_FIX';
const prev = { f: process.env[FLAG], d: process.env[DCPI_FIX] };
const on = () => { process.env[FLAG] = '1'; };
const off = () => { delete process.env[FLAG]; };
afterEach(() => {
  if (prev.f === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev.f;
  if (prev.d === undefined) delete process.env[DCPI_FIX]; else process.env[DCPI_FIX] = prev.d;
});
const P4 = 'Which data center facilities are in the Ashburn market?';
const strip = (p) => JSON.stringify(p).replace(/"planner_version":"5\.6[34]"/g, '').replace(/"plan_id":"[^"]*"/g, '');
const ASHBURN = { city: 'Ashburn', lat: 39.0438, lon: -77.4874, radius_km: 10 };

describe('version', () => {
  it('PLANNER_VERSION stays 5.63 (flag-off plans byte-identical); 5.64 is the flag-on report', () => {
    expect(PLANNER_VERSION).toBe('5.63');
    expect(FACILITY_LEAD_PLANNER_VERSION).toBe('5.64');
  });
});

describe('item 1: routing', () => {
  for (const ctx of [{ market: 'Ashburn' }, { market: 'northern-virginia' }, {}]) {
    it(`P4 ${JSON.stringify(ctx)} routes to facility_search with search_facilities first (flag on)`, () => {
      on();
      const p = _planQuery(P4, ctx);
      expect(p.intent_class, p.reason).toBe('facility_search');
      expect(p.recommended_sequence[0].tool).toBe('search_facilities');
      expect(p.recommended_sequence.map((s) => s.tool)).not.toContain('site_selection_canvas');
    });
  }
  it('flag off: P4 with market:"Ashburn" keeps 5.62 routing (market_ranking)', () => {
    off();
    expect(_planQuery(P4, { market: 'Ashburn' }).intent_class).toBe('market_ranking');
  });
  // Over-correction guards (spec test 2): ranking and DCPI asks keep their class, with and without the DCPI fix flag.
  for (const dcpiFix of ['', '1']) {
    for (const [q, ctx] of [
      ['Rank the best data center markets in Virginia', {}],
      ['Rank the best data center markets in Virginia', { state: 'VA' }],
      ["What's the Data Center Power Index (DCPI) for Ashburn?", {}],
      ["What's the Data Center Power Index (DCPI) for Ashburn?", { market: 'Ashburn' }],
      ['What is the best data center market in Virginia?', {}],
      ['Which market should I build in for 100 MW in Ohio?', {}],
    ]) {
      it(`unchanged class (DCPI fix ${dcpiFix || 'off'}) ${JSON.stringify(ctx)}: ${q}`, () => {
        if (dcpiFix) process.env[DCPI_FIX] = dcpiFix; else delete process.env[DCPI_FIX];
        off(); const a = _planQuery(q, ctx);
        on(); const b = _planQuery(q, ctx);
        expect(b.intent_class).toBe(a.intent_class);
        expect(b.recommended_sequence.map((s) => s.tool)).toEqual(a.recommended_sequence.map((s) => s.tool));
      });
    }
  }
  it('the ranking ask stays market_ranking', () => {
    on();
    expect(_planQuery('Rank the best data center markets in Virginia', {}).intent_class).toBe('market_ranking');
  });
  // The singular rule on its own (no market arg): a 1.5 facilities match ties the bare 1.5 market credit, and the tie
  // went to market_ranking on declaration order.
  for (const q of ['Who operates in the Ashburn market?', 'Which operators are in the Columbus market?']) {
    it(`singular "<place> market" beside a facilities word is facility_search (flag on), market_ranking off: ${q}`, () => {
      on(); expect(_planQuery(q, {}).intent_class).toBe('facility_search');
      off(); expect(_planQuery(q, {}).intent_class).toBe('market_ranking');
    });
  }
  it('a bound market arg adds no ranking score once the text matched a class (who operates in Dallas)', () => {
    on(); expect(_planQuery('who operates in Dallas', { market: 'dallas' }).intent_class).toBe('facility_search');
    off(); expect(_planQuery('who operates in Dallas', { market: 'dallas' }).intent_class).toBe('market_ranking');
  });
  it('a bound market still rescues text that matched no class', () => {
    on(); const b = _planQuery('hello there', { market: 'northern-virginia' });
    off(); const a = _planQuery('hello there', { market: 'northern-virginia' });
    expect(strip(b)).toBe(strip(a));
  });
  it('the adjust drops only the singular bare credit, and only beside a facilities match', () => {
    const mk = () => [
      { cls: { id: 'market_ranking' }, score: 1.5, hits: ['markets?'] },
      { cls: { id: 'facility_search' }, score: 3, hits: ['facilit(?:y|ies)'] }];
    let s = mk(); expect(facilityLeadRoutingAdjust(P4, s)).toBe(true); expect(s[0].score).toBe(0);
    s = mk(); expect(facilityLeadRoutingAdjust('Which data center facilities are in the best markets?', s)).toBe(false); expect(s[0].score).toBe(1.5);
    s = mk(); expect(facilityLeadRoutingAdjust('Top data center facilities in the Ashburn market', s)).toBe(false);
    s = mk(); s[1].score = 0; expect(facilityLeadRoutingAdjust(P4, s)).toBe(false); expect(s[0].score).toBe(1.5);
  });
});

describe('item 4: submarket numeral tolerance', () => {
  it('flag on: "Ashburn I" / "Ashburn III" / "Ashburn 2" are inside Ashburn; Sterling and Ashburnham are not', () => {
    on();
    for (const c of ['Ashburn I', 'Ashburn III', 'ashburn 2']) expect(placeRow({ city: c }, ASHBURN).match, c).toBe('in');
    for (const c of ['Sterling', 'Ashburnham', 'Ashburn Farm', 'Ashburn Village I']) expect(placeRow({ city: c }, ASHBURN).match, c).toBe('out');
    expect(submarketNumeralIn('Ashburn IX', 'Ashburn')).toBe(true);
    expect(submarketNumeralIn('Ashburn', 'Ashburn')).toBe(false);
  });
  it('flag off: "Ashburn I" is cut as 5.62 cut it', () => {
    off();
    expect(placeRow({ city: 'Ashburn I' }, ASHBURN)).toEqual({ match: 'out', place: 'Ashburn I' });
  });
  it('the cut keeps Ashburn I and still cuts the Sterling row (flag on)', () => {
    on();
    const rows = [{ name: 'Ashburn I', provider: 'Vantage Data Centers', city: 'Ashburn I' },
      { name: 'DC1', provider: 'Equinix', city: 'Ashburn' }, { name: 'Sterling One', city: 'Sterling' }];
    const { scope } = cutRowsToSubmarket('search_facilities', { _data_total_available: 5, facilities: rows }, ASHBURN);
    expect(scope.kept).toBe(2);
    expect(scope.outside_places).toEqual([{ place: 'Sterling', rows: 1 }]);
  });
});

describe('item 3: honest counts', () => {
  const ashburnResult = () => cutRowsToSubmarket('search_facilities', { _data_total_available: 5, facilities: [
    { name: 'DC1', provider: 'Equinix', city: 'Ashburn', as_of: '2026-04-02' },
    { name: 'QTS Ashburn 1', provider: 'QTS', city: 'Ashburn', as_of: '2026-02-11' },
    { name: 'Ashburn I', provider: 'Vantage Data Centers', city: 'Ashburn I', as_of: '2026-03-30' },
  ] }, ASHBURN).result;
  it('flag on: a preview slice says N of M, never "on record"', () => {
    on();
    const f = searchFacilitiesFacts(ashburnResult(), { city: 'Ashburn', state: 'VA' })[0];
    expect(f.text).toMatch(/^3 of 5 matching rows shown \(preview\), in Ashburn, e\.g\. /);
    expect(f.text).not.toMatch(/on record/);
  });
  it('flag off: the 5.62 wording', () => {
    off();
    const f = searchFacilitiesFacts(ashburnResult(), { city: 'Ashburn', state: 'VA' })[0];
    expect(f.text).toMatch(/^2 facilities in Ashburn on record/);
  });
  it('flag on: the whole set is "on record"; an unserved total says so', () => {
    on();
    const rows = [{ name: 'DC1', provider: 'Equinix', city: 'Columbus' }, { name: 'NAL1', provider: 'QTS', city: 'Columbus' }];
    expect(searchFacilitiesFacts({ total_matching: 2, facilities: rows }, { query: 'Columbus', state: 'OH' })[0].text)
      .toMatch(/^2 facilities matching "Columbus" on record/);
    expect(searchFacilitiesFacts({ facilities: rows }, { query: 'Columbus', state: 'OH' })[0].text)
      .toMatch(/^2 facilities matching "Columbus" in this read \(the total matching was not served\)/);
  });
  it('flag on: P7 rows outside Columbus proper name their towns', () => {
    on();
    const rows = [{ name: 'Hilliard Data Center', provider: 'Amazon AWS', city: 'Dublin' }, { name: 'NAL1 DC2', provider: 'QTS', city: 'New Albany' }];
    const t = searchFacilitiesFacts({ _data_total_available: 5, facilities: rows }, { query: 'Columbus', state: 'OH' })[0].text;
    expect(t).toMatch(/^2 of 5 matching rows shown \(preview\), matching "Columbus"; the rows sit in Dublin and New Albany, Columbus metro, e\.g\. /);
  });
  it('flag on: a widened read never says the metro total is the town\'s', () => {
    on();
    const r = cutRowsToSubmarket('search_facilities', { total_matching: 605, facilities: [
      { name: 'DC1', provider: 'Equinix', city: 'Ashburn' }, { name: 'DC2', provider: 'Equinix', city: 'Ashburn' },
      { name: 'Sterling One', city: 'Sterling' }] }, ASHBURN).result;
    const t = searchFacilitiesFacts(r, { query: 'Northern Virginia', state: 'VA' })[0].text;
    expect(t).toMatch(/^2 of the 3 rows shown sit in Ashburn \(preview of 605 matching rows "Northern Virginia"\)/);
    expect(t).not.toMatch(/2 of 605/);
  });
  it('flag on: rows partly in the asked place list it too', () => {
    on();
    const rows = [{ name: 'A', provider: 'X', city: 'Columbus' }, { name: 'B', provider: 'Y', city: 'Dublin' }];
    expect(searchFacilitiesFacts({ total_matching: 2, facilities: rows }, { query: 'Columbus', state: 'OH' })[0].text)
      .toMatch(/the rows sit in Columbus and Dublin, Columbus metro/);
  });
  it('honestCountText: a scoped whole set says how many of the matched rows sit in the place', () => {
    expect(honestCountText({ n: 2, returned: 3, total: 3, scopeTxt: ' in Ashburn', rows: [], place: 'Ashburn', scoped: true }))
      .toBe('2 of 3 matching rows sit in Ashburn');
  });
});

describe('item 2: the fact header SUMMARY leads with the facilities', () => {
  const plan = () => ({ _entity: 'plan_execution', intent_class: 'facility_search', as_of: '2026-04-02',
    intent_answer: { kind: 'facility_search', facts: [{ tool: 'search_facilities', as_of: '2026-04-02',
      text: '3 of 5 matching rows shown (preview), in Ashburn, e.g. Equinix DC1, QTS Ashburn 1 (DC Hub, row as_of 2026-04-02).' }] },
    executed: [{ tool: 'get_market_dcpi_rank', status: 'executed', result: { composite_score: 20, verdict: 'AVOID' } }] });
  it('flag on: SUMMARY begins with the facilities fact; DCPI follows', () => {
    on();
    const h = buildPlanFactHeader(plan());
    const sum = h.split('\n').find((l) => l.startsWith('SUMMARY: '));
    expect(sum, h).toMatch(/^SUMMARY: 3 of 5 matching rows shown \(preview\), in Ashburn/);
  });
  it('flag off: SUMMARY is the 5.62 header', () => {
    off();
    const h = buildPlanFactHeader(plan()) || '';
    expect(h).not.toMatch(/matching rows shown/);
  });
  it('another class is never led by a facilities line', () => {
    on();
    expect(facilityLeadSummary({ ...plan(), intent_class: 'market_ranking' })).toBe(null);
  });
});
