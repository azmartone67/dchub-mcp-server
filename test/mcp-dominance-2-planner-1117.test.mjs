// mcp-dominance-2-planner-1117.test.mjs — Grok MCP-dominance evals (2026-11-17), planner 5.35: gaps 1, 3, 5 and 7.
//
//   gap 1  "generating capacity mix in Virginia" -> class unknown, discover_tools only.
//   gap 3  "PJM, MISO and SPP" read PJM only; "Northern Virginia vs ERCOT" read ERCOT with state=VA (0 rows);
//          "Dallas, Atlanta and Columbus" read two; "How is the Columbus market?" read Canton; state comparisons
//          minted "texas" / "ohio-power"; a harvested "ercot-supply" reached get_market_dcpi_rank (404).
//   gap 5  "Stargate Abilene" -> deals_ma.
//   gap 7  "Henry Hub" -> get_energy_prices (electricity); get_gas_index never ran.
//
// Routing is pure (_planQuery). The end-to-end generation-mix answer is test/mcp-dominance-2-planner-e2e-1117.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _execInjectGeo, PLANNER_VERSION } from '../server.mjs';
import { buildGenerationMixAnswer, marketSlugGuard, marketSlugProblem, namedCampus, mixGrids, generationMixAsk, gasPriceAsk } from '../lib/plan-entities.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const args = (p, tool) => p.recommended_sequence.filter((s) => s.tool === tool).map((s) => s.args_hint);
const ex = (step, tool, a, result) => ({ step, tool, args: a, status: 'executed', result });

describe('5.35', () => {
  it('the planner version is the current one (5.35 introduced these routes)', () => { expect(PLANNER_VERSION).toBe('5.61'); });
});

describe('gap 1: generation mix', () => {
  it('Virginia: generation_mix, reads PJM (compare_isos needs two grids, so a neighbour rides as context)', () => {
    const p = _planQuery('What is the generating capacity mix in Virginia for data center power planning?', { state: 'VA' });
    expect(p.intent_class).toBe('generation_mix');
    expect(tools(p)).toEqual(['compare_isos', 'get_grid_data']);
    expect(args(p, 'compare_isos')[0].isos).toBe('PJM,MISO');
    expect(args(p, 'get_grid_data')[0]).toEqual({ iso: 'PJM', metric: 'fuel_mix' });
  });
  it('a non-RTO state reads its balancing authority; two grids are compared as asked', () => {
    expect(args(_planQuery('What is the fuel mix in Georgia?', {}), 'get_grid_data')[0].iso).toBe('SOCO');
    const p = _planQuery('Compare the generation mix of ERCOT and PJM', {});
    expect(p.intent_class).toBe('generation_mix');
    expect(args(p, 'compare_isos')[0].isos).toBe('ERCOT,PJM');
  });
  it('the answer leads with the asked grid\'s percentages, dated, and says it is generation, not installed capacity', () => {
    const cmp = { comparison: {
      PJM: { iso: 'PJM', generation_mix_period: '2026-11-17T06', generation_mix_pct: { NG: 41.2, NUC: 33.1, COL: 15.0, WND: 4.1, SUN: 2.9, WAT: 1.7, BAT: -0.2 } },
      MISO: { iso: 'MISO', generation_mix_period: '2026-11-17T06', generation_mix_pct: { COL: 40.1, NG: 30.0 } } } };
    const ia = buildGenerationMixAnswer({ intent: 'What is the generating capacity mix in Virginia?', intent_class: 'generation_mix', grids: [{ grid: 'PJM', state: 'VA' }] },
      [ex(1, 'compare_isos', { isos: 'PJM,MISO' }, cmp)], null);
    expect(ia.kind).toBe('generation_mix');
    expect(ia.headline).toBe('PJM generation mix: gas 41.2%, nuclear 33.1%, coal 15%, wind 4.1%, solar 2.9%, hydro 1.7% (the grid serving VA) (EIA-930 hour 2026-11-17T06).');
    expect(ia.headline).not.toMatch(/MISO/);
    expect(ia.evidence.join(' ')).toMatch(/Virginia is mostly PJM/);
    expect(ia.evidence.join(' ')).toMatch(/not installed capacity; installed capacity by fuel is not in this read/);
    expect(ia.as_of).toBe('2026-11-17T06');
  });
  it('no mix in the run is no answer block (the lead falls back to the step facts)', () => {
    expect(buildGenerationMixAnswer({ intent: 'x', intent_class: 'generation_mix', grids: [{ grid: 'PJM' }] }, [ex(1, 'compare_isos', {}, { comparison: { PJM: {} } })], null)).toBeNull();
  });
  it('mix wording only: a grid headroom ask is not a mix ask', () => {
    expect(generationMixAsk('How much grid headroom does PJM have?')).toBe(false);
    expect(mixGrids({ states: ['TX'] }, { TX: ['ERCOT', 'SPP'] })).toEqual([{ grid: 'ERCOT', state: 'TX' }]);
  });
});

describe('gap 7: gas price reads the gas index', () => {
  it('Henry Hub in Texas: get_gas_index state=TX first, no electricity rate', () => {
    const p = _planQuery('What is the Henry Hub natural gas price for on-site generation in Texas?', {});
    expect(p.intent_class).toBe('gas_price');
    expect(tools(p)[0]).toBe('get_gas_index');
    expect(args(p, 'get_gas_index')[0]).toEqual({ state: 'TX' });
    expect(tools(p)).not.toContain('get_energy_prices');
  });
  it('a gas AND electricity price ask keeps the electricity read; an electricity-only ask is unchanged', () => {
    expect(tools(_planQuery('Natural gas prices and electricity rates in Ohio', {}))).toContain('get_energy_prices');
    expect(_planQuery('What are electricity prices in Ohio?', {}).intent_class).toBe('price');
    expect(gasPriceAsk('gas economics for on-site generation in Texas')).toBe(false);
  });
});

describe('gap 3: every entity is read, and no slug that is not a market reaches a market tool', () => {
  it('PJM, MISO and SPP: a queue read for each grid', () => {
    const p = _planQuery('Compare interconnection queue depth in PJM, MISO and SPP', {});
    expect(p.intent_class).toBe('iso_comparison');
    expect(args(p, 'get_interconnection_queue').map((a) => a.iso)).toEqual(['PJM', 'MISO', 'SPP']);
  });
  it('Northern Virginia vs ERCOT: PJM and ERCOT, each read on its own', () => {
    const p = _planQuery('Northern Virginia vs ERCOT: which has faster time to power for 200 MW?', {});
    expect(p.intent_class).toBe('iso_comparison');
    expect(args(p, 'compare_isos')[0].isos).toBe('PJM,ERCOT');
    expect(args(p, 'get_grid_intelligence').map((a) => a.iso)).toEqual(['PJM', 'ERCOT']);
  });
  it('a state is never injected onto a step whose grid does not serve it (ERCOT + VA read 0 rows)', () => {
    const sig = { stateFromPlace: 'VA' };
    const a1 = { iso: 'ERCOT' };
    expect(_execInjectGeo('get_refined_queue', a1, sig)).toEqual([]);
    expect(a1.state).toBeUndefined();
    const a2 = { iso: 'PJM' };
    expect(_execInjectGeo('get_refined_queue', a2, sig)).toEqual(['state']);
    expect(a2.state).toBe('VA');
  });
  it('Dallas, Atlanta and Columbus: three DCPI cards', () => {
    const p = _planQuery('Compare data center markets Dallas, Atlanta and Columbus', {});
    expect(args(p, 'get_market_dcpi_rank').map((a) => a.market_slug)).toEqual(['dallas', 'atlanta', 'columbus']);
  });
  it('"How is the Columbus data center market?" reads Columbus, not a ranked Ohio finalist', () => {
    const p = _planQuery('How is the Columbus data center market?', {});
    expect(p.intent_class).toBe('market_outlook');
    expect(args(p, 'get_market_dcpi_rank')[0].market_slug).toBe('columbus');
    expect(tools(p)).not.toContain('site_selection_canvas');
  });
  it('Texas vs Ohio / prices Texas vs Virginia: per-state reads, no state-name market slugs', () => {
    const a = _planQuery('Texas vs Ohio power availability for data centers', {});
    expect(JSON.stringify(a.recommended_sequence)).not.toMatch(/"(?:texas|ohio-power)"/);
    expect(args(a, 'get_power_availability_timeline').map((x) => x.state)).toEqual(['TX', 'OH']);
    expect(args(a, 'get_grid_intelligence').map((x) => x.iso)).toEqual(['ERCOT', 'PJM']);
    const b = _planQuery('Compare power prices Texas vs Virginia', {});
    expect(tools(b).slice(0, 2)).toEqual(['get_energy_prices', 'get_energy_prices']);
    expect(args(b, 'get_energy_prices').map((x) => x.state)).toEqual(['TX', 'VA']);
    expect(JSON.stringify(b.recommended_sequence)).not.toMatch(/prices-texas/);
  });
  it('two tracked markets still compare as markets', () => {
    const p = _planQuery('Compare Phoenix vs Columbus for a 100 MW data center', {});
    expect(args(p, 'get_market_dcpi_rank').map((a) => a.market_slug)).toEqual(['phoenix', 'columbus']);
  });
  it('the market-slug guard: ercot-supply, texas, ohio-power are skipped with a reason; real markets pass', () => {
    expect(marketSlugGuard('get_market_dcpi_rank', { market_slug: 'ercot-supply' })).toMatchObject({ missing: 'market_slug' });
    expect(marketSlugGuard('get_market_dcpi_rank', { market_slug: 'ercot-supply' }).note).toMatch(/names a grid operator/);
    expect(marketSlugGuard('get_market_intel', { market: 'texas' }).note).toMatch(/is a US state/);
    expect(marketSlugProblem('ohio-power')).toMatch(/not a DCPI market slug/);
    for (const ok of ['dallas', 'columbus', 'phoenix', 'abilene']) expect(marketSlugGuard('get_market_dcpi_rank', { market_slug: ok })).toBeNull();
    expect(marketSlugGuard('get_market_intel', { market: 'northern-virginia' }, new Set(['northern-virginia']))).toBeNull();
    expect(marketSlugGuard('get_energy_prices', { state: 'texas' })).toBeNull();
  });
});

describe('gap 5: a named campus is read by name', () => {
  it('Stargate Abilene: the name lookup first (pipeline + facility registry), the corpus, the Abilene DCPI card', () => {
    // Owner note 2026-11-18 (feature 4): the lookup by name= replaced the free-text search and the market-wide pipeline.
    const p = _planQuery('Stargate Abilene campus status and capacity', {});
    expect(p.intent_class).toBe('named_campus');
    expect(tools(p)).toEqual(['get_pipeline', 'search_facilities', 'semantic_search', 'get_market_dcpi_rank']);
    expect(args(p, 'search_facilities')[0]).toEqual({ name: 'Stargate Abilene' });
    expect(args(p, 'get_pipeline')[0]).toEqual({ name: 'Stargate Abilene' });
    expect(tools(p)).not.toContain('hyperscaler_deals');
  });
  it('a size and a generic word are not a campus name', () => {
    expect(namedCampus('rank markets for a 200 MW AI campus')).toBeNull();
    expect(namedCampus('Find a site for a 1 GW AI campus in Texas')).toBeNull();
    expect(namedCampus('status of the New Albany campus in Ohio')).toMatchObject({ name: 'New Albany', market: { slug: 'new-albany' } });
  });
});
