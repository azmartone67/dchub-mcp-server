// plan-query.test.mjs — unit tests for the deterministic plan_query router
// (r-plan-query v1 + r-planner-v2 + r-planner-v3). Pure functions, no network:
// these tests exercise the exported _planQuery/_planSignals/_planWaves helpers directly.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _planWaves, _planWorkflowConfidence,
         _planExecutionEstimate, _planParallelGroups, _planReplay,
         PLANNER_VERSION, REPLAY_SCHEMA_VERSION, REPLAY_DECISION_STATUSES } from '../server.mjs';

describe('plan_query router (pure)', () => {
  it('is deterministic: same intent + context → identical plan', () => {
    const a = _planQuery('rank markets for a 200MW AI campus', {});
    const b = _planQuery('rank markets for a 200MW AI campus', {});
    expect(a).toEqual(b);
  });

  it('r-planner-v4: AI-campus intent leads with ai_capacity_index, demotes rank_markets', () => {
    // The partner grading panel (Grok/Sonar/Mistral) flagged that an AI-campus
    // intent was ranked by installed build-out (rank_markets) — which surfaces
    // saturated AVOID markets. AI campuses are deployability-bound, so lead with
    // ai_capacity_index and keep rank_markets as the explained alternative.
    const p = _planQuery('rank markets for a 200 MW AI campus', {});
    expect(p.intent_class).toBe('market_ranking');
    expect(p.best_tool).toBe('ai_capacity_index');
    expect(p.recommended_sequence[0].tool).toBe('ai_capacity_index');
    const altTools = p.alternatives.map((a) => a.tool);
    expect(altTools).toContain('rank_markets');        // demoted, not dropped
    expect(altTools).not.toContain('ai_capacity_index'); // never its own alternative
    expect(p.reason).toMatch(/AI-workload signal/i);
    // GPU / hyperscale market phrasings hit the same branch (the AI branch is
    // scoped to market_ranking — a specific-SITE GPU intent still routes to
    // site_analysis, which is correct).
    expect(_planQuery('best markets for a GPU training buildout').best_tool).toBe('ai_capacity_index');
    // explicit context.workload_type also triggers it
    expect(_planQuery('rank the best markets', { workload_type: 'ai' }).best_tool).toBe('ai_capacity_index');
    // a PLAIN market ranking is unaffected
    expect(_planQuery('rank the best data-center markets in the US').best_tool).toBe('rank_markets');
  });

  it('routes a market-ranking intent and carries every v2 field', () => {
    // r-planner-v4: use a PLAIN (non-AI) market intent so this covers the
    // rank_markets lead; the AI-campus route is asserted separately above.
    const p = _planQuery('rank the best data-center markets in the US', {});
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

  it('r-planner-v5: emits a versioned replay decision-trail composed from existing fields', () => {
    const p = _planQuery('rank the best data-center markets in the US', {});
    const r = p.replay;
    expect(r).toBeTruthy();
    // versioned so downstream tooling can pin a shape
    expect(typeof r.planner_version).toBe('string');
    expect(r.planner_version).toBe(PLANNER_VERSION);
    // r-planner-v5.2 (ChatGPT SDK review): schema_version is independent of
    // planner_version; replay is self-contained; status publishes the full enum.
    expect(r.schema_version).toBe(REPLAY_SCHEMA_VERSION);
    expect(r.schema_version).toBe(1);
    expect(r.planner_version).toBe('5.2');       // planner behavior rev...
    expect(r.schema_version).toBe(1);            // ...leaves the shape version at 1
    expect(r.intent).toBe(p.intent);             // self-contained: intent duplicated
    expect(r.intent_class).toBe(p.intent_class); // self-contained: intent_class duplicated
    expect(REPLAY_DECISION_STATUSES).toEqual(     // full lifecycle published
      ['planned', 'running', 'completed', 'failed', 'skipped', 'cancelled']);
    // r-planner-v5.1 field names: decisions / rationale / decision_confidence / status
    // D0 is the routing decision, carrying intent_confidence; D1..Dn mirror steps
    expect(r.decision_log).toBeUndefined();      // renamed → decisions
    expect(r.decisions[0]).toMatchObject({ id: 'D0', step: 0, kind: 'route', status: 'planned' });
    expect(r.decisions[0].decision_confidence).toBe(p.intent_confidence);
    expect(r.decisions[0].rationale).toBe(p.reason);
    expect(r.decisions.length).toBe(1 + p.recommended_sequence.length);
    for (let i = 0; i < p.recommended_sequence.length; i++) {
      const step = p.recommended_sequence[i];
      const entry = r.decisions[i + 1];
      expect(entry).toMatchObject({ id: `D${step.step}`, step: step.step, kind: 'step', status: 'planned' });
      expect(entry.decision).toContain(step.tool);
      expect(entry.rationale).toBe(step.why);
      expect(entry.decision_confidence).toBe(p.workflow_confidence);
    }
    // rejected mirrors alternatives, with stable ids + the rejection reason
    expect(r.rejected.length).toBe(p.alternatives.length);
    r.rejected.forEach((rej, i) => {
      expect(rej.id).toBe(`R${i + 1}`);
      expect(rej.tool).toBe(p.alternatives[i].tool);
      expect(rej.reason).toBeTruthy();
    });
    // execution graph carries the concurrency structure
    expect(r.execution_graph.waves).toEqual(p.execution_waves);
    expect(r.execution_graph.parallel_groups).toEqual(p.execution_strategy.parallel_groups);
    // additive: the replay does NOT mutate any pre-existing field
    expect(p.intent_class).toBe('market_ranking');
    expect(p.best_tool).toBe('rank_markets');
  });

  it('r-planner-v5: replay is deterministic and present on the unknown-intent fallback', () => {
    const a = _planQuery('rank markets for a 200MW AI campus', {});
    const b = _planQuery('rank markets for a 200MW AI campus', {});
    expect(a.replay).toEqual(b.replay); // determinism preserved end-to-end
    const fb = _planQuery('zxcv qwerty asdf nonsense', {});
    expect(fb.intent_class).toBe('unknown');
    expect(fb.replay.decisions[0].id).toBe('D0');
    expect(fb.replay.decisions[0].status).toBe('planned');
    expect(fb.replay.planner_version).toBe(PLANNER_VERSION);
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

  // ── r-planner-v3: parallel_groups + execution_estimate + plan-only note ────
  describe('r-planner-v3 execution strategy & estimate', () => {
    it('market_ranking: pins parallel_groups + estimate (standard-tier waves)', () => {
      const p = _planQuery('rank the best data-center markets in the US', {});
      expect(p.intent_class).toBe('market_ranking');
      expect(p.execution_strategy.parallel_groups).toEqual([
        ['rank_markets'],
        ['get_market_dcpi_rank', 'get_grid_intelligence'],
      ]);
      // node count (3 steps), NOT the fan-out sum (which stays in estimated_calls)
      expect(p.execution_estimate).toEqual({
        estimated_calls: 3,
        estimated_latency_ms: 2400, // 1200 (rank_markets) + 1200 (parallel standard wave)
        parallelizable: true,
      });
      expect(p.estimated_calls).toBeGreaterThan(p.execution_estimate.estimated_calls); // fan-out ≠ node count
    });

    it('grid_headroom with ISO: one fully-parallel wave, single-wave latency', () => {
      const p = _planQuery('how much power is available', { iso: 'ERCOT' });
      expect(p.intent_class).toBe('grid_headroom');
      expect(p.execution_strategy.parallel_groups).toEqual([
        ['get_grid_intelligence', 'get_interconnection_queue', 'get_refined_queue'],
      ]);
      expect(p.execution_estimate).toEqual({
        estimated_calls: 3,
        estimated_latency_ms: 1200, // one wave, all standard tier, runs concurrently
        parallelizable: true,
      });
    });

    it('grid_headroom without ISO: light scoreboard wave then standard wave', () => {
      const p = _planQuery('how much power is available on the grid', {});
      expect(p.execution_strategy.parallel_groups).toEqual([
        ['get_grid_scoreboard'],
        ['get_grid_intelligence', 'get_interconnection_queue'],
      ]);
      expect(p.execution_estimate.estimated_latency_ms).toBe(1700); // 500 light + 1200 standard
    });

    it('interconnection_queue: heavy analyze_site wave dominates the estimate', () => {
      const p = _planQuery('what is queued for interconnection in ERCOT', {});
      expect(p.intent_class).toBe('interconnection_queue');
      expect(p.execution_strategy.parallel_groups).toEqual([
        ['get_interconnection_queue', 'get_refined_queue'],
        ['analyze_site'],
      ]);
      expect(p.execution_estimate).toEqual({
        estimated_calls: 3,
        estimated_latency_ms: 4200, // 1200 (parallel standard wave) + 3000 (heavy analyze_site)
        parallelizable: true,
      });
    });

    it('carries the plan-only note so agents do not wait for an execute_plan', () => {
      for (const p of [
        _planQuery('rank the best markets', {}),
        _planQuery('zzz completely unrelated gibberish qqq', {}), // fallback branch too
      ]) {
        expect(p.execution_strategy.note).toMatch(/only plans; execute the sequence yourself/);
        expect(p.note).toMatch(/only plans; execute the sequence yourself/);
      }
    });

    it('fallback branch: parallel_groups + estimate present and deterministic', () => {
      const p = _planQuery('zzz completely unrelated gibberish qqq', {});
      expect(p.execution_strategy.parallel_groups).toEqual([
        ['discover_tools', 'get_dchub_recommendation'],
      ]);
      expect(p.execution_estimate).toEqual({
        estimated_calls: 2,
        estimated_latency_ms: 3000, // max(light discover_tools 500, heavy recommendation 3000)
        parallelizable: true,
      });
    });

    it('_planExecutionEstimate / _planParallelGroups: pure helpers agree with waves', () => {
      const seq = [
        { step: 1, tool: 'get_grid_scoreboard', depends_on: [] },
        { step: 2, tool: 'analyze_site', depends_on: [1] },
        { step: 3, tool: 'get_water_risk', depends_on: [1] },
      ];
      const waves = _planWaves(seq);
      expect(waves).toEqual([[1], [2, 3]]);
      expect(_planParallelGroups(seq, waves)).toEqual([
        ['get_grid_scoreboard'], ['analyze_site', 'get_water_risk'],
      ]);
      expect(_planExecutionEstimate(seq, waves)).toEqual({
        estimated_calls: 3,
        estimated_latency_ms: 3500, // 500 light + max(3000 heavy, 1200 standard)
        parallelizable: true,
      });
    });
  });

  // r-planner-v5.2: the two intents ChatGPT's schema review surfaced as routing
  // to 'unknown' — capacity-in-a-market and market head-to-head.
  describe('v5.2 capacity_search + market_comparison (were unknown)', () => {
    it('routes "find 50 MW in Dallas" to capacity_search, carrying target_mw', () => {
      const p = _planQuery('find 50 MW in Dallas', {});
      expect(p.intent_class).toBe('capacity_search');
      expect(p.best_tool).toBe('get_retirement_headroom');
      const s1 = p.recommended_sequence.find((s) => s.tool === 'get_retirement_headroom');
      expect(s1.args_hint.target_mw).toBe(50);      // MW parsed from the intent
      // three independent reads → one parallel wave
      expect(p.recommended_sequence.map((s) => s.tool)).toEqual([
        'get_retirement_headroom', 'get_refined_queue', 'get_market_dcpi_rank']);
      expect(p.execution_waves).toEqual([[1, 2, 3]]);
      expect(p.parallelizable).toBe(true);
      // an ISO in the intent scopes the retirement/queue reads
      const q = _planQuery('where can I find 100 MW near a substation in ERCOT', {});
      expect(q.intent_class).toBe('capacity_search');
      expect(q.recommended_sequence.find((s) => s.tool === 'get_retirement_headroom').args_hint.region_iso).toBe('ERCOT');
    });

    it('routes "compare Phoenix vs Columbus" to market_comparison, extracting both slugs', () => {
      const p = _planQuery('compare Phoenix vs Columbus for hyperscale', {});
      expect(p.intent_class).toBe('market_comparison');
      expect(p.best_tool).toBe('get_market_dcpi_rank');
      const [a, b] = p.recommended_sequence.filter((s) => s.tool === 'get_market_dcpi_rank');
      expect(a.args_hint.market_slug).toBe('phoenix');   // pulled from the intent, not a placeholder
      expect(b.args_hint.market_slug).toBe('columbus');
      // symmetric reads run in parallel
      expect(p.execution_waves[0]).toEqual(expect.arrayContaining([1, 2]));
      // two-word market names survive extraction
      const nv = _planQuery('compare Northern Virginia and Atlanta', {});
      expect(nv.intent_class).toBe('market_comparison');
      const slugs = nv.recommended_sequence.filter((s) => s.tool === 'get_market_dcpi_rank').map((s) => s.args_hint.market_slug);
      expect(slugs).toEqual(['northern-virginia', 'atlanta']);
    });

    it('does NOT steal the existing AI-campus / ranking / grid routes (regression)', () => {
      expect(_planQuery('rank markets for a 200 MW AI campus').intent_class).toBe('market_ranking');
      expect(_planQuery('rank the best data-center markets in the US').intent_class).toBe('market_ranking');
      expect(_planQuery('how much power is available', { iso: 'ERCOT' }).intent_class).toBe('grid_headroom');
    });
  });
});
