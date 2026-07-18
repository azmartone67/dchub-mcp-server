// plan-query.test.mjs — unit tests for the deterministic plan_query router
// (r-plan-query v1 + r-planner-v2). Pure functions, no network: these tests
// exercise the exported _planQuery/_planSignals/_planWaves helpers directly.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _planWaves, _planWorkflowConfidence } from '../server.mjs';

describe('plan_query router (pure)', () => {
  it('is deterministic: same intent + context → identical plan', () => {
    const a = _planQuery('rank markets for a 200MW AI campus', {});
    const b = _planQuery('rank markets for a 200MW AI campus', {});
    expect(a).toEqual(b);
  });

  it('routes a market-ranking intent and carries every v2 field', () => {
    const p = _planQuery('rank the best markets for a 200MW AI campus', {});
    expect(p.intent_class).toBe('market_ranking');
    expect(p.best_tool).toBe('rank_markets');
    // dual confidences
    expect(p.intent_confidence).toBeGreaterThan(0);
    expect(p.intent_confidence).toBe(p.confidence); // v1 alias preserved
    expect(p.workflow_confidence).toBeGreaterThanOrEqual(0.2);
    expect(p.workflow_confidence).toBeLessThanOrEqual(0.95);
    expect(p.workflow_confidence_basis).toMatchObject({
      resolved_signals: expect.any(Number),
      minted_placeholders: expect.any(Number),
      user_supplied_placeholders: expect.any(Number),
    });
    // planner rationale is one sentence of prose
    expect(typeof p.planner_rationale).toBe('string');
    expect(p.planner_rationale.length).toBeGreaterThan(20);
    // per-step graph fields
    for (const s of p.recommended_sequence) {
      expect(Array.isArray(s.depends_on)).toBe(true);
      expect(s.estimated_calls).toBeGreaterThanOrEqual(1);
    }
    // plan-level estimates
    const sum = p.recommended_sequence.reduce((n, s) => n + s.estimated_calls, 0);
    expect(p.estimated_calls).toBe(sum);
    expect(typeof p.parallelizable).toBe('boolean');
    // every alternative carries a rejection reason
    for (const alt of p.alternatives) {
      expect(alt.rejected_because).toBeTruthy();
      expect(alt.when).toBeTruthy();
    }
  });

  it('market_ranking: step 2 depends on step 1 (slug mint) and fans out', () => {
    const p = _planQuery('rank the best markets', {});
    const s2 = p.recommended_sequence.find((s) => s.step === 2);
    expect(s2.tool).toBe('get_market_dcpi_rank');
    expect(s2.depends_on).toEqual([1]);
    expect(s2.estimated_calls).toBe(5); // one per step-1 finalist
    expect(p.execution_waves[0]).toEqual([1]);
  });

  it('grid_headroom with ISO in context: fully parallel single wave', () => {
    const p = _planQuery('how much power is available', { iso: 'ERCOT' });
    expect(p.intent_class).toBe('grid_headroom');
    expect(p.execution_waves).toEqual([[1, 2, 3]]);
    expect(p.parallelizable).toBe(true);
    expect(p.estimated_calls).toBe(3);
    // ISO resolved → no user-supplied placeholders anywhere
    expect(p.workflow_confidence_basis.user_supplied_placeholders).toBe(0);
  });

  it('grid_headroom without ISO: scoreboard first, deep reads wait on it', () => {
    const p = _planQuery('how much power is available on the grid', {});
    expect(p.best_tool).toBe('get_grid_scoreboard');
    expect(p.execution_waves).toEqual([[1], [2, 3]]);
    expect(p.parallelizable).toBe(true);
  });

  it('workflow_confidence rises when context resolves placeholders', () => {
    const vague = _planQuery('water and disaster risk for a site', {});
    const precise = _planQuery('water and disaster risk for a site',
      { lat: 33.4, lon: -112.0 });
    expect(precise.intent_class).toBe(vague.intent_class);
    expect(precise.workflow_confidence).toBeGreaterThan(vague.workflow_confidence);
    expect(precise.workflow_confidence_basis.user_supplied_placeholders).toBe(0);
    expect(vague.workflow_confidence_basis.user_supplied_placeholders).toBeGreaterThan(0);
  });

  it('interconnection_queue: snapshot ∥ refined, then candidate chaining', () => {
    const p = _planQuery('what is queued for interconnection in ERCOT', {});
    expect(p.intent_class).toBe('interconnection_queue');
    expect(p.execution_waves).toEqual([[1, 2], [3]]);
    const s3 = p.recommended_sequence.find((s) => s.step === 3);
    expect(s3.depends_on).toEqual([2]);
    // step-3 candidate_id is MINTED by step 2, so it must not dock workflow confidence
    expect(p.workflow_confidence_basis.minted_placeholders).toBeGreaterThan(0);
    expect(p.chaining).toBeTruthy();
  });

  it('runner-up alternative carries the score-margin rejection reason', () => {
    const p = _planQuery('rank the best markets by grid power availability', {});
    const ru = p.alternatives.find((a) => a.rejected_because && /Scored .* vs /.test(a.rejected_because));
    expect(ru).toBeTruthy();
  });

  it('unknown intent falls back with v2 fields intact', () => {
    const p = _planQuery('zzz completely unrelated gibberish qqq', {});
    expect(p.intent_class).toBe('unknown');
    expect(p.intent_confidence).toBe(0.2);
    expect(p.workflow_confidence).toBeGreaterThanOrEqual(0.2);
    expect(p.execution_waves).toEqual([[1, 2]]);
    expect(p.parallelizable).toBe(true);
    expect(p.alternatives[0].rejected_because).toBeTruthy();
  });

  it('_planWaves degrades cycles to sequential instead of hanging', () => {
    const waves = _planWaves([
      { step: 1, depends_on: [2] },
      { step: 2, depends_on: [1] },
    ]);
    expect(waves.flat().sort()).toEqual([1, 2]);
  });

  it('_planWorkflowConfidence stays within [0.2, 0.95]', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      step: i + 1, depends_on: [], args_hint: { a: '<user must supply>' },
    }));
    const low = _planWorkflowConfidence(many, {});
    expect(low.workflow_confidence).toBe(0.2);
    const high = _planWorkflowConfidence([{ step: 1, depends_on: [], args_hint: {} }],
      { iso: 'ERCOT', mw: 200, coords: { lat: 1, lon: 2 }, state: 'TX', candidateId: 'cand_x', market: 'dallas', since: '24h' });
    expect(high.workflow_confidence).toBe(0.95);
  });

  it('signals: parses ISO / MW / coords out of free text', () => {
    const d = _planSignals('need 1.5 GW near 33.44, -112.07 in ERCOT', {});
    expect(d.iso).toBe('ERCOT');
    expect(d.mw).toBe(1500);
    expect(d.coords).toEqual({ lat: 33.44, lon: -112.07 });
  });
});
