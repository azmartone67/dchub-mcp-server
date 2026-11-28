// gdl-colo-depth-1127.test.mjs: Grok daily MCP leadership iteration 2026-11-27 (COLO_DEPTH rotation + L2).
//   cd5: a tracked non-US market reads its city, the Capacity Source line names the place asked, and the power side
//        says what DC Hub does not cover outside the US.
//   cd1: no plan date later than the America/Phoenix day.
//   cd2: MW of 1,000 or more is comma-grouped and whole.
//   cd4: a colocation supply ask reads the market brief and the construction pipeline, and leads with them.
//   L2:  an AVOID caveat about the named metro follows the search areas; only a distance warning leads.
import { describe, it, expect } from 'vitest';
import { countryScopedPlan, marketCity, unscopedFacilitySearch } from '../lib/country-scope.mjs';
import { capacityFact } from '../lib/cross-domain-answer.mjs';
import { noFutureDayDeep, noFutureDayText } from '../lib/no-future-day.mjs';
import { coloSupplyLine } from '../lib/pipeline-status.mjs';
import { coloSupplyAsk } from '../lib/colocation-plan.mjs';
import { withSitingCaveat } from '../lib/siting-caveat.mjs';
import { FACILITY_LEAD_PLANNER_VERSION } from '../lib/plan-facility-lead.mjs';
import { _planQuery } from '../server.mjs';

const FRANKFURT = { slug: 'frankfurt', intel: 'frankfurt', name: 'Frankfurt', state: 'DE', iso: 'ENTSOE-DE' };

describe('cd5 Frankfurt', () => {
  it('a tracked market in the country reads its city, not the whole country', () => {
    const seq = [{ step: 1, tool: 'get_market_dcpi_rank', args_hint: { market_slug: 'frankfurt' } },
      { step: 2, tool: 'get_grid_intelligence', args_hint: { iso: 'PJM' } }];
    const r = countryScopedPlan('Frankfurt data center market: how many projects, how many MW, and are grid connections constrained?',
      { __outlook: FRANKFURT }, seq, 'market_ranking');
    const sf = r.seq.find((s) => s.tool === 'search_facilities');
    expect(sf.args_hint).toMatchObject({ country: 'DE', city: 'Frankfurt' });
    expect(r.scope.bound_market).toBe('frankfurt');
  });
  it('a country with no bound market keeps the country-wide search', () => {
    const r = countryScopedPlan('data centers in Germany', {}, [{ step: 1, tool: 'get_grid_intelligence', args_hint: {} }], 'facility_search');
    const sf = r.seq.find((s) => s.tool === 'search_facilities');
    expect(sf.args_hint.city).toBeUndefined();
  });
  it('marketCity drops the state tail', () => {
    expect(marketCity({ name: 'Frankfurt' })).toBe('Frankfurt');
    expect(marketCity({ slug: 'new-york' })).toBe('New York');
    expect(marketCity({ name: 'Phoenix, AZ' })).toBe('Phoenix');
  });
  it('the Capacity Source line names the place the step asked about', () => {
    const f = capacityFact({ tool: 'source_capacity', step: 5, args: { location: 'Germany' }, p: { count: 0, items: [] } }, null);
    expect(f.text).toContain('in Germany');
    expect(f.text).not.toContain('North America');
    const r = capacityFact({ tool: 'source_capacity', step: 5, args: { region: 'europe' }, p: { count: 0, items: [] } }, null);
    expect(r.text).toContain('in Europe');
    const mk = capacityFact({ tool: 'source_capacity', step: 5, args: { market: 'columbus-oh' }, p: { count: 0, items: [] } }, null);
    expect(mk.text).toContain('of the size asked in Columbus:');
    const none = capacityFact({ tool: 'source_capacity', step: 5, args: {}, p: { count: 0, items: [] } }, null);
    expect(none.text).toContain('in North America');
  });
});

describe('cd1 no date later than the Phoenix day', () => {
  it('clamps date-only as_of / collected_at and "as of" text later than today; leaves earlier dates and timestamps', () => {
    const sc = {
      intent_answer: { headline: 'Under construction in Northern Virginia (DC Hub pipeline, as of 2026-11-28): x. Older (as of 2026-11-20).' },
      facts: [{ as_of: '2026-11-28', collected_at: '2026-11-28', text: 'DCPI (as of 2026-11-28).' }, { as_of: '2026-03-30' }],
      citation: { as_of: '2026-11-28T00:37:24.452Z' },
      licences: [{ license: 'CC-BY-4.0 after 30 days (days from 2026-12-01)' }],
    };
    const out = noFutureDayDeep(sc, '2026-11-27');
    expect(out.intent_answer.headline).toContain('as of 2026-11-27): x');
    expect(out.intent_answer.headline).toContain('as of 2026-11-20');
    expect(out.facts[0]).toMatchObject({ as_of: '2026-11-27', collected_at: '2026-11-27', text: 'DCPI (as of 2026-11-27).' });
    expect(out.facts[1].as_of).toBe('2026-03-30');
    expect(out.citation.as_of).toBe('2026-11-28T00:37:24.452Z');
    expect(out.licences).toBe(sc.licences);
  });
  it('keeps identity when nothing changes', () => {
    const sc = { facts: [{ as_of: '2026-11-27' }] };
    expect(noFutureDayDeep(sc, '2026-11-27')).toBe(sc);
    expect(noFutureDayText('as of 2026-11-28T01:00Z', '2026-11-27')).toBe('as of 2026-11-28T01:00Z');
  });
});

describe('cd4 colocation supply ask', () => {
  const Q = 'Who are the main colocation providers in Phoenix, how much capacity do they have, and how much is being added?';
  it('is a supply ask; a plain provider ask is not', () => {
    expect(coloSupplyAsk(Q)).toBe(true);
    expect(coloSupplyAsk('Colocation providers in Dallas')).toBe(false);
  });
  it('plans the market brief and the construction pipeline, and get_facility still reads the metro search', () => {
    const p = _planQuery(Q, {});
    expect(p.intent_class).toBe('colocation');
    const tools = p.recommended_sequence.map((s) => s.tool);
    expect(tools).toContain('get_market_intel');
    expect(tools).toContain('get_pipeline');
    const pl = p.recommended_sequence.find((s) => s.tool === 'get_pipeline');
    expect(pl.args_hint).toMatchObject({ market: 'phoenix', status: 'construction', state: 'AZ' });
    const search = p.recommended_sequence.find((s) => s.tool === 'search_facilities');
    expect(search.step).toBe(2);
    const fac = p.recommended_sequence.find((s) => s.tool === 'get_facility');
    expect(fac.depends_on).toEqual([2]);
    const steps = p.recommended_sequence.map((s) => s.step);
    expect(new Set(steps).size).toBe(steps.length);
  });
  it('a plain provider ask keeps its plan', () => {
    const tools = _planQuery('Colocation providers in Dallas', {}).recommended_sequence.map((s) => s.tool);
    expect(tools).not.toContain('get_market_intel');
  });
  it('the supply line leads with the brief (comma-grouped MW) and names the projects', () => {
    const ex = [
      { tool: 'get_market_intel', status: 'executed', args: { market: 'phoenix' },
        result: { market: { name: 'Phoenix' }, stats: { facility_count: 246, total_power_mw: 4323.4, mw_reporting_count: 45 }, as_of: '2026-11-12' } },
      { tool: 'get_pipeline', status: 'executed', args: { market: 'phoenix', status: 'construction' },
        result: { as_of: '2026-11-28T02:01:44.993059', data: [{ project: 'Phoenix Campus Expansion', company: 'Aligned', capacity: 300 }] } },
    ];
    const s = coloSupplyLine(ex, new Map());
    expect(s.text).toMatch(/^Phoenix: 246 facilities tracked, 4,323 MW across the 45 that report capacity/);
    expect(s.text).toContain('Under construction: Phoenix Campus Expansion (Aligned) (DC Hub pipeline, as of 2026-11-27).');
  });
});

describe('cd2 MW format', () => {
  it('a figure of 1,000 or more is whole with a comma', () => {
    const ex = [{ tool: 'get_market_intel', status: 'executed', args: { market: 'dallas' },
      result: { market: { name: 'Dallas' }, stats: { facility_count: 367, total_power_mw: 7302.1, mw_reporting_count: 67 }, as_of: '2026-09-26' } }];
    expect(coloSupplyLine(ex, new Map()).text).toContain('7,302 MW');
  });
});

describe('L2 areas first', () => {
  const LEAD = 'find_sites: 10 search areas within 60 km of Columbus, OH, top 3: 1) near 40.18, -83.01.';
  const answer = { headline: `${LEAD} Siting read for 100 MW.` };
  it('an AVOID caveat about the named metro follows the areas', () => {
    const cav = { line: 'Every area listed reads AVOID on the Data Center Power Index (Columbus; PJM).', named: true, far: false,
      metro: { name: 'Columbus', slug: 'columbus-oh', verdict: 'AVOID' } };
    const out = withSitingCaveat(answer, cav, { after: LEAD });
    expect(out.headline.startsWith('find_sites: 10 search areas')).toBe(true);
    expect(out.headline.indexOf('Every area listed')).toBeGreaterThan(LEAD.length - 1);
  });
  it('a distance warning still leads', () => {
    const cav = { line: 'One of the 3 areas shown sits 100 km or more from Columbus.', named: true, far: true,
      metro: { name: 'Columbus', slug: 'columbus-oh', verdict: 'AVOID' } };
    expect(withSitingCaveat(answer, cav, { after: LEAD }).headline.startsWith('One of the 3 areas')).toBe(true);
  });
});

it('the live planner label moves past 5.64', () => { expect(FACILITY_LEAD_PLANNER_VERSION).toBe('5.65'); });

describe('cd3 specs_not_on_record names address and power (backend 2026-11-27)', () => {
  it('the colocation answer labels them', async () => {
    const { buildColocationAnswer } = await import('../lib/colocation-answer.mjs');
    const metro = { id: 'atlanta', label: 'Atlanta', dcpi_slug: 'atlanta', query: 'Atlanta', state: 'GA' };
    const fac = { tool: 'get_facility', status: 'executed', args: { slug: 'qts-atl1' },
      result: { data: { name: 'QTS Atlanta-Metro (ATL1)', provider: 'QTS', city: 'Atlanta', state: 'GA', specs_not_on_record: ['tier_level', 'address', 'power_mw'] } } };
    const dcpi = { tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'atlanta' }, result: { verdict: 'CAUTION', composite_score: 50, as_of: '2026-11-27' } };
    const a = buildColocationAnswer({ intent: 'QTS Atlanta-Metro colocation', intent_class: 'colocation', metro, metros: [] }, [dcpi, fac], new Map());
    expect((a.not_established || []).join(' ')).toContain('tier level, address, power capacity (MW) not on record');
  });
});

describe('cd2 largest campuses + status pair', () => {
  const Q = 'Texas data center market: which are the largest campuses, and how much is operational versus under construction?';
  it('routes to dc_capacity with a 100 MW facility read, never market slugs "operational" / "under-construction"', () => {
    const p = _planQuery(Q, {});
    expect(p.intent_class).toBe('dc_capacity');
    const slugs = p.recommended_sequence.map((s) => s.args_hint && (s.args_hint.market_slug || s.args_hint.market)).filter(Boolean);
    expect(slugs).not.toContain('operational');
    expect(p.recommended_sequence.find((s) => s.tool === 'search_facilities').args_hint).toMatchObject({ state: 'TX', min_capacity_mw: 100 });
  });
  it('a real comparison still compares', () => {
    expect(_planQuery('Compare Dallas vs Phoenix', {}).intent_class).toBe('market_comparison');
  });
  it('the answer names at least 3 campuses with operators, MW comma-grouped, and says when size was not ranked', async () => {
    const { buildCapacitySidesAnswer } = await import('../lib/pipeline-status.mjs');
    const ex = [
      { tool: 'get_market_intel', status: 'executed', args: { market: 'dallas' }, result: { market: { name: 'Dallas' }, stats: { facility_count: 367, total_power_mw: 7302.1, mw_reporting_count: 67 }, as_of: '2026-09-26' } },
      { tool: 'get_pipeline', status: 'executed', args: { state: 'TX', status: 'construction' }, result: { count: 2, data: [
        { project: 'Abilene Campus', company: 'Crusoe', capacity: 1200 }, { project: 'Small Build', company: 'X', capacity: 40 }] } },
      { tool: 'search_facilities', status: 'executed', args: { state: 'TX', min_capacity_mw: 100 }, result: { data: [
        { name: 'Campus A', provider: 'Op A', power_mw: 150 }, { name: 'Campus B', provider: 'Op B', power_mw: 400 }, { name: 'Campus C', provider: 'Op C' }] } },
    ];
    const a = buildCapacitySidesAnswer({ intent_class: 'dc_capacity', state: 'TX' }, ex, new Map());
    expect(a.headline).toContain('Largest campuses on record in TX (100 MW or more): Campus B (Op B, 400 MW); Campus A (Op A, 150 MW); Campus C (Op C).');
    expect(a.headline).toContain('Largest under construction: Abilene Campus (Crusoe, 1,200 MW)');
    expect(a.headline).toContain('7,302 MW');
    ex[2].result._params_not_applied = ['min_capacity_mw'];
    expect(buildCapacitySidesAnswer({ intent_class: 'dc_capacity', state: 'TX' }, ex, new Map()).headline).toContain('not ranked by size');
  });
});

describe('cd1 read-time dates say "read on"', () => {
  it('a pipeline read whose only date is the request time', async () => {
    const { asOfIsReadTime } = await import('../lib/no-future-day.mjs');
    const { factsFromStep } = await import('../lib/plan-step-facts.mjs');
    const p = { as_of: '2026-11-28T01:56:50.867669', last_updated: '2026-11-28T01:56:50.867669', count: 1,
      data: [{ project: 'Phoenix Campus Expansion', company: 'Aligned', capacity: 300 }],
      citation: { retrieved_at: '2026-11-28T01:56:50.875Z' } };
    expect(asOfIsReadTime(p)).toBe(true);
    const f = factsFromStep('get_pipeline', p, { market: 'phoenix' })[0];
    expect(f.text).toContain('(DC Hub pipeline, read on 2026-11-27)');
    expect(f.as_of_basis).toMatch(/^read_time/);
    expect(asOfIsReadTime({ ...p, as_of: '2026-11-20T00:00:00', last_updated: null })).toBe(false);
  });
});

describe('cd5 live check 11-28: a colocation ask about a tracked non-US market', () => {
  const steps = async (q, ctx = {}) => (await _planQuery(q, ctx)).recommended_sequence.map((s) => [s.tool, s.args_hint || {}]);
  it('searches the market city in its country, never the whole database', async () => {
    for (const ctx of [{}, { market: 'frankfurt' }]) {
      const seq = await steps('Which colocation providers operate in Frankfurt and how much capacity do they have?', ctx);
      const sf = seq.filter(([t]) => t === 'search_facilities');
      expect(sf.length).toBe(1);
      expect(sf[0][1]).toMatchObject({ country: 'DE', city: 'Frankfurt' });
      expect(seq.map(([t]) => t)).toContain('get_market_dcpi_rank');
    }
  });
  it('keeps the kW size on the scoped search', async () => {
    const sf = (await steps('colocation in Frankfurt for 500 kW')).find(([t]) => t === 'search_facilities');
    expect(sf[1]).toMatchObject({ country: 'DE', city: 'Frankfurt', min_capacity_mw: 0.5 });
  });
  it('a US colocation metro is unchanged', async () => {
    const sf = (await steps('Which colocation providers operate in Dallas?')).find(([t]) => t === 'search_facilities');
    expect(sf[1]).toMatchObject({ query: 'Dallas', state: 'TX' });
    expect(sf[1].country).toBeUndefined();
  });
  it('unscopedFacilitySearch names only a search with no place', () => {
    expect(unscopedFacilitySearch({ tool: 'search_facilities', args_hint: { limit: 10, min_capacity_mw: 0.5 } })).toBe(true);
    expect(unscopedFacilitySearch({ tool: 'search_facilities', args_hint: { state: 'TX', limit: 10 } })).toBe(false);
    expect(unscopedFacilitySearch({ tool: 'get_facility', args_hint: {} })).toBe(false);
  });
});

describe('cd5 live check 11-28: caller-typed markets', () => {
  it('a caller-typed US market is not filled in or rescoped', async () => {
    const p = await _planQuery('Which colocation providers operate in Dallas?', { market: 'dallas' });
    expect(p.recommended_sequence.some((s) => s.args_hint && s.args_hint.country === 'DE')).toBe(false);
    expect(p.recommended_sequence.find((s) => s.tool === 'search_facilities').args_hint).toMatchObject({ state: 'TX' });
  });
});
