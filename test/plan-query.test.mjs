// plan-query.test.mjs — unit tests for the deterministic plan_query router
// (r-plan-query v1 + r-planner-v2 + r-planner-v3). Pure functions, no network:
// these tests exercise the exported _planQuery/_planSignals/_planWaves helpers directly.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _planWaves, _planWorkflowConfidence,
         _planExecutionEstimate, _planParallelGroups, _planReplay, _planHostingCoverage,
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
    // The whole point of the split: the planner's behavior rev has moved
    // 5.2 → 5.6 (fiber_power_pairing, hosting_capacity, then incentives_tax)
    // while the replay SHAPE never changed. A consumer pinning schema_version is
    // still safe; one pinning planner_version would have broken — by design.
    // (This literal is a deliberate speed bump: every routing rev must touch it.)
    expect(r.planner_version).toBe('5.7');       // planner behavior rev...
    expect(r.schema_version).toBe(1);            // ...leaves the shape version at 1
    expect(r.intent).toBe(p.intent);             // self-contained: intent duplicated
    expect(r.intent_class).toBe(p.intent_class); // self-contained: intent_class duplicated
    expect(REPLAY_DECISION_STATUSES).toEqual(     // full lifecycle published
      ['planned', 'running', 'completed', 'failed', 'skipped', 'cancelled']);
    // compatibility contract published in-object (ChatGPT: publish the policy)
    expect(r.compatibility.schema_version).toBe(1);
    expect(r.compatibility.schema_v1).toMatch(/additive-only/i);
    expect(r.compatibility.breaking_changes).toMatch(/schema_version/i);
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

  // ── r-planner-v5.5 (2026-07-28): the DISTRIBUTION layer ───────────────────
  // get_hosting_capacity (tool #81) was registered and live but appeared in NO
  // plan class, so execute_plan — advertised as the front door for multi-
  // capability questions — could never route to it. Every other grid class in
  // this router answers at TRANSMISSION level; none of them can say what the
  // distribution system will actually serve.
  //
  // The whole risk of this wiring is score theft: keyword weights are one
  // shared pool, and a pattern containing "capacity" would bleed score off
  // capacity_search and grid_headroom. So the routing assertions below are
  // paired with the no-theft sweep at the bottom, which is the real contract.
  describe('v5.5 hosting_capacity (get_hosting_capacity was unroutable)', () => {
    const seq = (q, ctx = {}) => (_planQuery(q, ctx).recommended_sequence || []).map((s) => s.tool);
    const hcStep = (q, ctx = {}) => (_planQuery(q, ctx).recommended_sequence || [])
      .find((s) => s.tool === 'get_hosting_capacity');

    it('routes an explicit feeder / hosting-capacity intent to its own class', () => {
      const p = _planQuery('what is the hosting capacity on the feeders near Poughkeepsie', {});
      expect(p.intent_class).toBe('hosting_capacity');
      expect(p.best_tool).toBe('get_hosting_capacity');
      // the covered utility is resolved into a CONCRETE arg, not a placeholder
      expect(p.recommended_sequence[0].args_hint).toMatchObject({
        utility: 'Central Hudson (load headroom)', capacity_type: 'load' });
      // the feeder number is never quoted alone: published feeders top out
      // around 5-27 MW, so the transmission read rides in the same wave.
      expect(seq('what is the hosting capacity on the feeders near Poughkeepsie'))
        .toContain('get_grid_intelligence');
      expect(p.execution_waves).toEqual([[1, 2, 3]]);
    });

    it('with no covered geography, plans the COVERAGE listing (no invented args)', () => {
      // "is this published anywhere" is a real answer — the no-arg mode returns
      // the 18 covered utilities rather than a placeholder the agent must fill.
      const p = _planQuery('how much load can this feeder take', {});
      expect(p.intent_class).toBe('hosting_capacity');
      expect(p.recommended_sequence[0].args_hint).toEqual({});
    });

    it('capacity_search adds the feeder read ONLY inside a load-publishing utility', () => {
      // Ameren Illinois FILES load-serving headroom — the number that actually
      // answers "site 50 MW here" — so the step is worth a call.
      const il = _planQuery('site a 50 MW data center in central Illinois', {});
      expect(il.intent_class).toBe('capacity_search');
      expect(seq('site a 50 MW data center in central Illinois')).toEqual([
        'get_retirement_headroom', 'get_refined_queue', 'get_market_dcpi_rank', 'get_hosting_capacity']);
      expect(il.execution_waves).toEqual([[1, 2, 3, 4]]);   // still one parallel wave
      expect(hcStep('site a 50 MW data center in central Illinois').args_hint)
        .toMatchObject({ utility: 'Ameren Illinois (load)', capacity_type: 'load' });
      // ...and the intent's MW figure is deliberately NOT pushed into min_mw:
      // filtering a 50 MW floor against a table whose ceiling is 9.9 MW returns
      // empty, and empty reads as "no capacity" — the exact confidently-wrong
      // answer this tool exists to prevent.
      expect(hcStep('site a 50 MW data center in central Illinois').args_hint.min_mw).toBeUndefined();

      // Texas: no utility publishes. The step is omitted rather than spent on a
      // call whose whole content would be "not published" — but it stays a
      // declared alternative so the route is still discoverable.
      expect(seq('find 50 MW in Dallas')).toEqual([
        'get_retirement_headroom', 'get_refined_queue', 'get_market_dcpi_rank']);
      expect(_planQuery('find 50 MW in Dallas', {}).alternatives.map((a) => a.tool))
        .toContain('get_hosting_capacity');
    });

    it('gen-only territory gets NO step — an export number cannot answer siting', () => {
      // Dominion VA publishes "gen": DER EXPORT headroom, what the feeder can
      // ACCEPT from solar/storage. Planning a step that returns it invites
      // exactly the gen-quoted-as-load error the tool is built to prevent.
      expect(seq('find 100 MW in Northern Virginia')).not.toContain('get_hosting_capacity');
      expect(seq('find 100 MW near Providence Rhode Island')).not.toContain('get_hosting_capacity');
    });

    it('site_analysis adds the parcel-level feeder read inside covered territory', () => {
      // A Central Hudson parcel: coordinates alone are enough — no utility name
      // in the text — and they resolve to a point read, not a territory read.
      const ctx = { lat: 41.86, lon: -74.02 };
      const p = _planQuery('what power can I actually get at this parcel', ctx);
      expect(p.intent_class).toBe('site_analysis');
      expect(seq('what power can I actually get at this parcel', ctx)).toEqual([
        'analyze_site', 'get_composite_site_score', 'get_disaster_risk', 'get_water_risk',
        'get_hosting_capacity']);
      expect(hcStep('what power can I actually get at this parcel', ctx).args_hint)
        .toMatchObject({ lat: 41.86, lon: -74.02, capacity_type: 'load' });
      // Phoenix — nobody publishes there, so the plan is byte-for-byte the old one
      expect(seq('analyze the site at 33.45,-112.07')).toEqual([
        'analyze_site', 'get_composite_site_score', 'get_disaster_risk', 'get_water_risk']);
    });

    it('a scheduled tool is never ALSO listed as a rejected alternative', () => {
      for (const q of ['site a 50 MW data center in central Illinois',
                       'what is the hosting capacity on the feeders near Poughkeepsie']) {
        const p = _planQuery(q, {});
        const planned = new Set(p.recommended_sequence.map((s) => s.tool));
        for (const a of p.alternatives) expect(planned.has(a.tool)).toBe(false);
        // and no tool is offered twice (runner-up colliding with a declaration)
        const tools = p.alternatives.map((a) => a.tool);
        expect(tools.length).toBe(new Set(tools).size);
      }
    });

    it('_planHostingCoverage prefers the DRAW-side utility over the export-side one', () => {
      // Published extents overlap: this Hudson Valley point sits inside Central
      // Hudson's LOAD-headroom filing AND inside several export-side maps
      // (Central Hudson's own DER map, NYSEG, Con Edison). Only the load number
      // answers "how much can I take here", so it must win the tie — declaration
      // order alone would hand back whichever box was listed first.
      const both = _planHostingCoverage('this parcel', { lat: 41.86, lon: -74.02 });
      expect(both.covered_hits).toBeGreaterThan(1);
      expect(both.capacity_type).toBe('load');
      expect(both.answers_load).toBe(true);
      // coordinates work with no place name in the text at all
      expect(both.matched_on).toBe('coordinates');
      // a named territory resolves without coordinates
      expect(_planHostingCoverage('a parcel in the Hudson Valley', null))
        .toMatchObject({ utility: 'Central Hudson (load headroom)', matched_on: 'name' });
      // export-side is still DETECTED — it just never earns a step
      expect(_planHostingCoverage('near Providence', null).answers_load).toBe(false);
      // and uncovered is honestly null, never a guess
      expect(_planHostingCoverage('find 50 MW in Dallas', { lat: 32.78, lon: -96.8 })).toBeNull();
    });

    it('steals NOTHING — every intent the two planner suites pin keeps its class', () => {
      // The stated risk of this change: "capacity" is a shared scoring pool.
      // Every pattern added for hosting_capacity is feeder-shaped for exactly
      // this reason; this is the assertion that holds them to it.
      const PINNED = [
        ['rank the best data-center markets in the US', 'market_ranking'],
        ['rank markets for a 200 MW AI campus', 'market_ranking'],
        ['best markets for a GPU training buildout', 'market_ranking'],
        ['rank the best markets by grid power availability', 'market_ranking'],
        ['find 50 MW in Dallas', 'capacity_search'],
        ['where can I get 100 MW near a substation', 'capacity_search'],
        ['where can I find 100 MW near a substation in ERCOT', 'capacity_search'],
        ['compare Phoenix vs Columbus for hyperscale', 'market_comparison'],
        ['compare Northern Virginia and Atlanta', 'market_comparison'],
        ['how much power is available in ERCOT', 'grid_headroom'],
        ['how much power is available on the grid', 'grid_headroom'],
        ['how much power is available in ERCOT for a 200 MW site', 'grid_headroom'],
        ['interconnection queue depth in PJM', 'interconnection_queue'],
        ['what is queued for interconnection in ERCOT', 'interconnection_queue'],
        ['what changed in the last week', 'changes_delta'],
        ['water and drought risk for Phoenix', 'water_climate'],
        ['recent hyperscaler data center deals', 'deals_ma'],
        ['dark fiber routes near Ashburn', 'fiber'],
        ['plan diverse fiber routes to a carrier hotel in Dallas', 'fiber'],
        ['electricity prices in Texas', 'price'],
        ['search for data centers in Virginia', 'facility_search'],
        ['analyze the site at 33.45,-112.07', 'site_analysis'],
        ['where do fiber density and grid headroom overlap in Atlanta', 'fiber_power_pairing'],
      ];
      const rerouted = PINNED
        .map(([intent, want]) => ({ intent, want, got: _planQuery(intent, {}).intent_class }))
        .filter((r) => r.got !== r.want);
      expect(rerouted).toEqual([]);
    });
  });
});
