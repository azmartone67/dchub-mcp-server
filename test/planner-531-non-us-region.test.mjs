// planner-531-non-us-region.test.mjs — planner 5.31 (Grok Note V item 3, 2026-11-16).
//
// Live 18:45Z, keyless, planner 5.29: execute_plan "Which European markets have grid capacity for a 40 MW
// data center by 2028?" ran get_grid_intelligence x4 + get_refined_queue x4 + get_power_pipeline and
// answered with the CAISO queue (164.8 GW). It named a REGION, not a country, so lib/country-scope.mjs did
// not match. A non-US region, or a tracked non-US market named alone (Frankfurt), now runs no US-only step
// and mints no US ISO. Pure planner cases; the execute_plan run is test/planner-531-e2e.test.mjs.
import { describe, it, expect, beforeAll } from 'vitest';
import { US_ONLY_TOOLS, namedNonUsRegions, isNonUsMarket } from '../lib/country-scope.mjs';

const EU_ASK = 'Which European markets have grid capacity for a 40 MW data center by 2028?';
const US_ISO = /\b(CAISO|PJM|ERCOT|MISO|SPP|NYISO|ISO-?NE)\b/;
let planQuery;
const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.tool, s.args_hint]));
// A US-only tool is allowed only as rank_markets over a region that excludes the US.
const usSteps = (seq) => seq.filter((s) => US_ONLY_TOOLS.has(s.tool)
  && !(s.tool === 'rank_markets' && s.args_hint && ['eu', 'apac', 'canada'].includes(s.args_hint.region)));

describe('planner 5.31: a non-US region or market is never answered with US grid data', () => {
  beforeAll(async () => { ({ _planQuery: planQuery } = await import('../server.mjs')); }, 120_000);

  it('the Note V intent: no US-only step, no US ISO anywhere in the plan, Europe read as Europe', () => {
    const p = planQuery(EU_ASK, {});
    expect(usSteps(p.recommended_sequence), show(p)).toEqual([]);
    expect(JSON.stringify(p.recommended_sequence)).not.toMatch(US_ISO);
    expect(p.recommended_sequence).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'rank_markets', args_hint: expect.objectContaining({ region: 'eu' }) }),
      expect.objectContaining({ tool: 'source_capacity', args_hint: expect.objectContaining({ region: 'europe', min_mw: 40 }) }),
    ]));
  });

  it.each([
    ['Frankfurt alone reads Germany', 'data center power availability in Frankfurt by 2027', 'EU_DE_LU'],
    ['APAC', 'best APAC markets for a 100 MW AI campus', null],
    ['Latin America', 'grid capacity in Latin America for 30 MW', null],
  ])('%s', (_l, q, grid) => {
    const p = planQuery(q, {});
    expect(usSteps(p.recommended_sequence), show(p)).toEqual([]);
    expect(JSON.stringify(p.recommended_sequence)).not.toMatch(US_ISO);
    if (grid) expect(p.recommended_sequence.find((s) => s.tool === 'get_grid_data').args_hint.iso).toBe(grid);
  });

  it('"Texas vs Europe" keeps Texas and reads no "europe" market slug', () => {
    const p = planQuery('Texas vs Europe for 100 MW', {});
    expect(p.recommended_sequence.some((s) => s.args_hint && s.args_hint.market_slug === 'europe'), show(p)).toBe(false);
    expect(p.recommended_sequence.some((s) => s.args_hint && s.args_hint.market_slug === 'texas')).toBe(true);
    expect(p.recommended_sequence.some((s) => s.tool === 'rank_markets' && s.args_hint.region === 'eu')).toBe(true);
  });

  it.each([
    ['Delaware is a US state (DE is not Germany)', 'power availability in Delaware for 50 MW'],
    ['an EU customer is not a place', 'grid headroom in Virginia for an EU customer'],
  ])('CONTROL: %s', (_l, q) => {
    const p = planQuery(q, {});
    expect(p.recommended_sequence.some((s) => s.tool === 'get_refined_queue'), show(p)).toBe(true);
    expect(p.recommended_sequence.some((s) => s.tool === 'source_capacity' && s.args_hint.region)).toBe(false);
  });

  it('helpers: regions and non-US markets', () => {
    expect(namedNonUsRegions(EU_ASK).map((r) => r.key)).toEqual(['europe']);
    expect(namedNonUsRegions('Which EU markets')).toHaveLength(1);
    expect(namedNonUsRegions('neutral sites in houston')).toEqual([]);   // "eu" inside a word
    expect(isNonUsMarket({ slug: 'frankfurt', iso: 'ENTSOE-DE', state: 'DE' })).toBe(true);
    expect(isNonUsMarket({ slug: 'wilmington-de', iso: 'PJM', state: 'DE' })).toBe(false);
    expect(isNonUsMarket(null)).toBe(false);
  });
});
