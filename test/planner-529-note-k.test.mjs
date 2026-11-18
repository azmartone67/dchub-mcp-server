// planner-529-note-k.test.mjs — planner 5.29 (Grok note K, 2026-11-15), pure functions, no network.
//
// Grok asked for the three re-check prompts on every planner PR:
//   "Texas or Arizona, 100 MW by 2028"   both states covered, at least one step, never an empty plan
//   "ERCOT vs PJM vs MISO"               iso_comparison over all three grids
//   "Northern Virginia, next 18 months"  the data-center capacity plan the full sentence already gets
// Item 1: several named US states split into one set of steps per state (siting_search); a state's grid
//   step reads that state's own grid; market steps with no market named read find_sites per state; a plan
//   that reaches no tool runs _execGuaranteedSteps. Items 2 and 3 are in test/keyless-first-full.test.mjs
//   (section K) and the execute_plan runs in test/planner-529-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planPipelinePlace, _execWidenedLine, _planSignals, _planNamedStates, _planStateGridArg, _planSitingEligible,
  _planMultiStateFallback, _execGuaranteedSteps, _resolutionGap, PLANNER_VERSION } from '../server.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';

const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint]));
const statesOf = (p) => new Set(p.recommended_sequence.map((s) => s.state_fanout
  || (s.args_hint && (s.args_hint.state || s.args_hint.region))).filter(Boolean));
const PLACEHOLDER = /^<.*>$/;

describe('planner 5.29: the three re-check prompts', () => {
  it('PLANNER_VERSION is 5.30', () => { expect(PLANNER_VERSION).toBe('5.40'); });

  it('"Texas or Arizona, 100 MW by 2028": both states covered, every step runnable, size and deadline carried', () => {
    const p = _planQuery('Texas or Arizona, 100 MW by 2028', {});
    expect(p.intent_class, show(p)).toBe('siting_search');
    expect(p.recommended_sequence.length).toBeGreaterThan(0);
    const st = statesOf(p);
    expect(st.has('TX') && st.has('AZ'), show(p)).toBe(true);
    for (const code of ['TX', 'AZ']) {
      expect(p.recommended_sequence.filter((s) => s.state_fanout === code).length, code + ' ' + show(p)).toBeGreaterThanOrEqual(2);
    }
    // No step waits on a value nothing produces: every argument is concrete.
    const waiting = p.recommended_sequence.filter((s) => Object.values(s.args_hint || {}).some((v) => typeof v === 'string' && PLACEHOLDER.test(v)));
    expect(waiting, show(p)).toEqual([]);
    const canvas = p.recommended_sequence.filter((s) => s.tool === 'site_selection_canvas');
    expect(canvas.map((s) => s.args_hint.region)).toEqual(['TX', 'AZ']);
    for (const s of canvas) expect(s.args_hint).toMatchObject({ capacity_mw: 100, max_months: expect.any(Number) });
    expect(p.recommended_sequence.filter((s) => s.tool === 'find_sites').map((s) => s.args_hint.state)).toEqual(['TX', 'AZ']);
    expect(p.recommended_sequence.length, 'two states fit the default six steps').toBeLessThanOrEqual(6);
    expect(p.replay.resolution_gap ?? null, 'two named states are a bound geography, not H3b').toBe(null);
    expect(p.state_fanout.states).toEqual(['TX', 'AZ']);
  });

  it('the other two live phrasings route the same way (were capacity_search with the DCPI step skipped)', () => {
    for (const t of ['Where can I get 100 MW of power for a data center in Texas or Arizona by 2028?',
      'Find sites for a 100 MW data center in Texas or Arizona, energized by 2028']) {
      const p = _planQuery(t, {});
      expect(p.intent_class, t + ' ' + show(p)).toBe('siting_search');
      expect([...statesOf(p)].sort(), t).toEqual(['AZ', 'TX']);
      expect(p.recommended_sequence.some((s) => s.tool === 'get_market_dcpi_rank' && PLACEHOLDER.test(String(s.args_hint.market_slug))), t).toBe(false);
    }
  });

  it('"ERCOT vs PJM vs MISO": iso_comparison over all three grids', () => {
    const p = _planQuery('ERCOT vs PJM vs MISO', {});
    expect(p.intent_class).toBe('iso_comparison');
    expect(p.recommended_sequence.find((s) => s.tool === 'compare_isos').args_hint.isos).toBe('ERCOT,PJM,MISO');
    expect(p.recommended_sequence.filter((s) => s.tool === 'get_grid_intelligence').map((s) => s.args_hint.iso)).toEqual(['ERCOT', 'PJM', 'MISO']);
  });

  it('"Northern Virginia, next 18 months": the dc_capacity plan of the full sentence, not discover_tools alone', () => {
    const bare = _planQuery('Northern Virginia, next 18 months', {});
    const full = _planQuery('What data center capacity is coming online in Northern Virginia in the next 18 months?', {});
    expect(bare.intent_class, show(bare)).toBe('dc_capacity');
    const tools = (p) => p.recommended_sequence.map((s) => s.tool);
    expect(tools(bare)).toEqual(['get_pipeline', 'search_facilities', 'get_power_availability_timeline', 'source_capacity']);
    expect(tools(bare)).toEqual(tools(full));
    expect(bare.recommended_sequence.map((s) => s.args_hint)).toEqual(full.recommended_sequence.map((s) => s.args_hint));
    expect(bare.unresolved ?? null).toBe(null);
    // get_pipeline is held to the resolved market, with the completion cutoff "next 18 months" gives
    // (the first day of the month after the deadline month).
    const pipe = bare.recommended_sequence.find((s) => s.tool === 'get_pipeline').args_hint;
    const now = new Date();
    const after = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 19, 1));
    expect(pipe).toEqual({ country: 'US', market: 'northern-virginia',
      expected_completion_before: `${after.getUTCFullYear()}-${String(after.getUTCMonth() + 1).padStart(2, '0')}-01` });
  });

  it('get_pipeline place: the market slug, else the state; a town reads its state (cut after the call)', () => {
    const pipe = (t) => _planQuery(t, {}).recommended_sequence.find((s) => s.tool === 'get_pipeline').args_hint;
    expect(pipe('What data center capacity is under construction in Dallas?')).toMatchObject({ market: 'dallas', status: 'construction' });
    expect(pipe('data center pipeline in Texas by 2028')).toEqual({ country: 'US', state: 'TX', expected_completion_before: '2029-01-01' });
    const ash = pipe('How much data center capacity is coming online in Ashburn?');
    expect(ash).toEqual({ country: 'US', state: 'VA', limit: 100 });
    expect(pipe('data center pipeline')).toEqual({});
    expect(_planPipelinePlace({ __outlook: { unresolved: { kind: 'market_ambiguous' } } }, null, null)).toEqual({});
  });

  it('_execWidenedLine: names the state-wide steps, relays the server note, and is silent when nothing widened', () => {
    const vaSteps = [
      { step: 2, tool: 'search_facilities', status: 'executed', args: { state: 'VA' }, result: {} },
      { step: 3, tool: 'source_capacity', status: 'executed', args: { state: 'VA' }, result: {} },
      { step: 4, tool: 'find_sites', status: 'failed', args: { state: 'VA' }, result: null },
    ];
    expect(_execWidenedLine({ widened_from: 'Northern Virginia', to: 'PJM' }, vaSteps))
      .toBe('Widened Northern Virginia to Virginia: search_facilities, source_capacity read all of Virginia, not Northern Virginia alone; say so when quoting them.');
    const note = 'Widened Northern Virginia to Virginia: 3 more projects are labelled only with the state.';
    const withPipe = [{ step: 1, tool: 'get_pipeline', status: 'executed', args: { market: 'northern-virginia' }, result: { scope: { note } } }, ...vaSteps];
    const line = _execWidenedLine({ widened_from: 'Northern Virginia', to: 'PJM' }, withPipe);
    expect(line.startsWith(note + ' Also: search_facilities, source_capacity read all of Virginia')).toBe(true);
    // A server note alone is relayed even without a plan-level widening.
    expect(_execWidenedLine(null, withPipe.slice(0, 1))).toBe(note);
    // A step held to a market, city or point is not widened; no scope_widened and no note: ''.
    expect(_execWidenedLine({ widened_from: 'Dallas', to: 'ERCOT' }, [{ step: 1, tool: 'search_facilities', status: 'executed', args: { state: 'TX', city: 'Dallas' } }])).toBe('');
    expect(_execWidenedLine(null, vaSteps)).toBe('');
    expect(_execWidenedLine({ widened_from: 'Dallas', to: 'ERCOT' }, 'junk')).toBe('');
  });

  it('the forward-window rescue needs a place and never outvotes a class that matched', () => {
    expect(_planQuery('next 18 months', {}).intent_class).toBe('unknown');
    const p = _planQuery('power timeline for Ohio over the next 18 months', {});
    expect(p.intent_class).toBe('power_timeline');
  });
});

describe('planner 5.29 item 1: several named states', () => {
  it('ambiguous two-letter codes count only as places (IN, OR, ME after "in"/"for", never in prose)', () => {
    expect(_planNamedStates('Find sites in IN or OH for 100 MW by 2028')).toEqual(['IN', 'OH']);
    expect(_planNamedStates('fiber OR power for 100 MW in Texas or Arizona')).toEqual(['TX', 'AZ']);
    expect(_planNamedStates('ME and my team want 100 MW in TX or AZ')).toEqual(['TX', 'AZ']);
    expect(_planNamedStates('TX or AZ, 100 MW by 2028')).toEqual(['TX', 'AZ']);
    const p = _planQuery('TX or AZ, 100 MW by 2028', {});
    expect(p.intent_class).toBe('siting_search');
  });

  it('a one-state question keeps its class (siting_search needs two states, a size and a siting or deadline word)', () => {
    expect(_planQuery('Find sites for 100 MW in Ohio by 2028', {}).intent_class).not.toBe('siting_search');
    expect(_planQuery('where can I get 50 MW in Texas by Q2 2027', {}).intent_class).not.toBe('siting_search');
    expect(_planSitingEligible('Texas or Arizona', _planSignals('Texas or Arizona'))).toBe(false);   // no size
    expect(_planSitingEligible('Texas or Arizona, 100 MW by 2028', _planSignals('Texas or Arizona, 100 MW by 2028'))).toBe(true);
  });

  it('a ranking over named states stays market_ranking (its canvas already runs per state)', () => {
    const p = _planQuery('Where should I build a 100 MW data center: Texas, Ohio or Georgia?', {});
    expect(p.intent_class).toBe('market_ranking');
    expect(p.recommended_sequence.find((s) => s.tool === 'get_grid_intelligence').args_hint.iso).toBe('<ISO serving the finalist market>');
  });

  it('three states split the default six steps: each state gets its market and land reads', () => {
    const p = _planQuery('Find sites for 100 MW in Texas, Ohio or Arizona by 2028', {});
    expect(p.intent_class).toBe('siting_search');
    expect(p.recommended_sequence.length).toBeLessThanOrEqual(6);
    for (const st of ['TX', 'OH', 'AZ']) {
      const tools = p.recommended_sequence.filter((s) => s.state_fanout === st).map((s) => s.tool).sort();
      expect(tools, st + ' ' + show(p)).toEqual(['find_sites', 'site_selection_canvas']);
    }
  });

  it('fiber + power over two states (ran 0 of 4 steps): find_sites per state, the market steps read its candidates', () => {
    const p = _planQuery('fiber and power overlap in Texas or Arizona', {});
    expect(p.recommended_sequence.filter((s) => s.tool === 'find_sites').map((s) => s.args_hint.state)).toEqual(['TX', 'AZ']);
    const named = p.recommended_sequence.filter((s) => Object.values(s.args_hint || {}).some((v) => /named in the intent/.test(String(v))));
    expect(named, show(p)).toEqual([]);
    const fs = p.recommended_sequence.filter((s) => s.tool === 'find_sites').map((s) => s.step);
    for (const t of ['get_metro_fiber', 'get_market_dcpi_rank']) {
      expect(p.recommended_sequence.find((s) => s.tool === t).depends_on, t).toEqual(expect.arrayContaining(fs));
    }
    expect(p.state_fallback.states).toEqual(['TX', 'AZ']);
    expect(_planMultiStateFallback([], { states: ['TX'] })).toBe(null);
  });

  it('a multi-state siting phrasing with fiber in it goes to siting_search, not fiber_power_pairing', () => {
    const p = _planQuery('Texas or Arizona: 100 MW data center with fiber and power by 2028', {});
    expect(p.intent_class, JSON.stringify(p.matched_classes)).toBe('siting_search');
  });

  it('power_timeline over two states: each state\'s grid read takes its own grid (Arizona was lost to Texas\'s mints)', () => {
    const p = _planQuery('timeline for power in Texas or Arizona', {});
    expect(p.intent_class).toBe('power_timeline');
    expect(p.recommended_sequence.filter((s) => s.tool === 'get_grid_intelligence').map((s) => s.args_hint.iso)).toEqual(['ERCOT', 'AZPS']);
  });

  it('_planStateGridArg: the first RTO; a balancing authority only where the tool takes one; else nothing', () => {
    expect(_planStateGridArg('get_grid_intelligence', 'TX')).toBe('ERCOT');
    expect(_planStateGridArg('get_grid_intelligence', 'AZ')).toBe('AZPS');
    expect(_planStateGridArg('get_interconnection_queue', 'AZ')).toBe(null);
    expect(_planStateGridArg('get_grid_intelligence', 'WA')).toBe(null);
    expect(_planStateGridArg('get_refined_queue', 'OH')).toBe('PJM');
  });

  it('_resolutionGap: two named states are a bound geography (was H3b "texas or arizona by")', () => {
    const t = 'Where can I get 100 MW of power for a data center in Texas or Arizona by 2028?';
    expect(_resolutionGap(t, _planSignals(t), 'capacity_search')).toBe(null);
  });

  it('a question naming two states that matches no class still reads both states', () => {
    const p = _planQuery('is Texas or Arizona better for a data center', {});
    expect(p.recommended_sequence.filter((s) => s.tool === 'find_sites').map((s) => s.args_hint.state)).toEqual(['TX', 'AZ']);
    expect(p.unresolved.note).not.toMatch(/no data tool was run/);
  });
});

describe('planner 5.29 item 1: never an empty plan (_execGuaranteedSteps)', () => {
  it('per named state: find_sites; capped by the step budget left', () => {
    const d = _planSignals('Texas or Arizona, 100 MW by 2028');
    expect(_execGuaranteedSteps(d, null, 6).map((g) => [g.tool, g.args])).toEqual([['find_sites', { state: 'TX' }], ['find_sites', { state: 'AZ' }]]);
    expect(_execGuaranteedSteps(d, null, 1)).toHaveLength(1);
  });
  it('no state named: the navigator for the question, never a ranking that would answer for other markets', () => {
    expect(_execGuaranteedSteps(_planSignals('fiber and power overlap'), null, 6, 'fiber and power overlap'))
      .toMatchObject([{ tool: 'discover_tools', args: { query: 'fiber and power overlap' } }]);
    expect(_execGuaranteedSteps(_planSignals('power outlook for Timbuktu'), null, 6, 'power outlook for Timbuktu').map((g) => g.tool)).toEqual(['discover_tools']);
    expect(_execGuaranteedSteps(null, null, 0).length).toBeGreaterThan(0);
  });
});

describe('planner 5.29: the intent answer names the states, not the union of their grids', () => {
  it('scope reads "TX and AZ (states)"', () => {
    const executed = [{ step: 1, tool: 'get_refined_queue', status: 'executed', args: { state: 'TX' },
      result: { count_total_matching: 4, source_as_of: '2026-11-10' } }];
    const ia = buildIntentAnswer({ intent: 'Texas or Arizona, 100 MW by 2028', intent_class: 'siting_search',
      constraint_iso: ['ERCOT', 'SPP', 'MISO', 'WECC'], states: ['TX', 'AZ'], requested_mw: 100 }, executed, new Map());
    expect(ia && ia.geography).toBe('TX and AZ (states)');
  });
});
