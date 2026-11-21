// plan-proof-1116.test.mjs — Grok's live execute_plan proof run (2026-11-16 ~22:30Z, planner 5.31),
// items 1, 2, 3 and 8 at the pure-function level. The end-to-end half is plan-proof-1116-e2e.test.mjs.
// Fixtures are the fields the live envelopes carried on 2026-11-16 22:51Z, cut to what each rule reads.
import { describe, it, expect } from 'vitest';
import { buildIntentAnswer, TTP_GRID_FIELD, TTP_QUEUE_FIELD } from '../lib/intent-answers.mjs';
import { compactFirstPlan } from '../lib/keyless-first-full.mjs';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';
import { planId, compactReplay } from '../lib/plan-replay-id.mjs';

const ttpRows = (n, v) => Array.from({ length: n }, (_, i) => ({ candidate_id: 'c' + i, estimated_ttp_months: v }));

// ---- item 1: PJM 100 MW time to power ----
const PJM_EXECUTED = [
  { step: 1, tool: 'get_grid_intelligence', args: { iso: 'PJM' }, status: 'executed',
    result: { iso: 'PJM', avg_time_to_power_months: 44.9, avg_queue_wait_months: 56.1, demand_mw: 96179 } },
  { step: 2, tool: 'get_interconnection_queue', args: { iso: 'PJM' }, status: 'executed',
    result: { iso: 'PJM', queued_generation_gw: 373.6, source_as_of: '2026-11-16', source_as_of_basis: 'live_feed_fetch_date',
      last_refreshed: '2026-11-16T06:03:48.045786+00:00' } },
  { step: 3, tool: 'get_refined_queue', args: { iso: 'PJM', min_mw: 100 }, status: 'executed',
    result: { count_total_matching: 827, filters_applied: { min_mw: 100 }, results: ttpRows(200, 50.5),
      freshness_by_iso: { PJM: { source_as_of: '2026-11-16' } }, total_queued_mw: 348737 } },
];
const PJM_CTX = { intent: 'how soon can a 100 MW load get power in PJM', intent_class: 'grid_headroom',
  constraint_iso: ['PJM'], requested_mw: 100 };

describe('item 1: the power-timing headline states ONE time-to-power figure and names its field', () => {
  const ia = buildIntentAnswer(PJM_CTX, PJM_EXECUTED, null, Date.parse('2026-11-16T23:00:00Z'));

  it('leads with the grid DCPI average (44.9), not the queue rows (50.5)', () => {
    expect(ia.headline).toBe(`Time to 100 MW of power for PJM (ISO): PJM average time-to-power 44.9 months (${TTP_GRID_FIELD}).`);
    expect(ia.headline).not.toMatch(/50\.5|see the time-to-power figures below/);
    expect(ia.time_to_power_basis).toEqual({ field: TTP_GRID_FIELD, scope: 'iso_average', iso: 'PJM' });
  });

  it('the queue rows\' figure stays in evidence, labelled as a different series not used for the headline', () => {
    const q = ia.evidence.find((e) => /50\.5/.test(e));
    expect(q).toMatch(new RegExp(`${TTP_QUEUE_FIELD.replace(/\./g, '\\.')}: 50\\.5 months on every queue row shown \\(200 rows\\)`));
    expect(q).toMatch(/different series from the headline figure and is not used for it/);
  });

  it('the compact first answer leads with that headline and drops the "not part of this answer" line', () => {
    const out = { _entity: 'plan_execution', ok: true, intent: PJM_CTX.intent, intent_class: 'grid_headroom', planner_version: '5.31',
      executed: PJM_EXECUTED, constraint_iso: ['PJM'], totals: { steps_run: 3 }, answer_guide: 'Compose the answer from executed[].result.',
      intent_answer: ia, _source: 'DC Hub — dchub.cloud' };
    const c = compactFirstPlan(out, null);
    expect(c.answer).toBe(ia.headline);
    expect(JSON.stringify(c)).not.toMatch(/not part of this answer/);
    expect(c.intent_answer.not_established.join(' ')).not.toMatch(/month estimate/);
  });

  it('with no grid figure, the queue rows\' estimate leads and names its own field', () => {
    const ex = [PJM_EXECUTED[0], PJM_EXECUTED[2]].map((e) => (e.tool === 'get_grid_intelligence'
      ? { ...e, result: { ...e.result, avg_time_to_power_months: null } } : e));
    const r = buildIntentAnswer(PJM_CTX, ex, null);
    // 5.57 (Grok daily 2026-11-20 item 6): the figure carries the date of the queue data it came from.
    expect(r.headline).toBe(`Time to 100 MW of power for PJM (ISO): estimated time-to-power 50.5 months (${TTP_QUEUE_FIELD}, queue data as of 2026-11-16).`);
    expect(r.time_to_power_basis.field).toBe(TTP_QUEUE_FIELD);
    expect(r.evidence.join(' ')).not.toMatch(/different series/);
  });

  it('with neither, it is still "not measurable" (and so the compact answer\'s gap line is honest)', () => {
    const ex = [{ ...PJM_EXECUTED[0], result: { iso: 'PJM', avg_time_to_power_months: null } },
      { ...PJM_EXECUTED[2], result: { ...PJM_EXECUTED[2].result, results: ttpRows(3, null) } }];
    const r = buildIntentAnswer(PJM_CTX, ex, null);
    expect(r.headline).toMatch(/is not measurable from this run/);
    expect(r.time_to_power_basis).toBeUndefined();
  });
});

// ---- item 2: Phoenix vs Columbus ----
const dcpiStep = (step, slug, name, iso, verdict, score, ttp, computed) => ({
  step, tool: 'get_market_dcpi_rank', args: { market_slug: slug }, status: 'executed',
  result: { market_slug: slug, market_name: name, iso, verdict, composite_score: score, time_to_power_months: ttp,
    computed_at: computed, citation: { as_of: computed }, provenance: { as_of: computed } } });
const COMPARE = {
  _entity: 'plan_execution', ok: true, intent: 'compare Phoenix vs Columbus for a 100 MW data center', intent_class: 'market_comparison',
  constraint_iso: ['PJM', 'WECC'],
  executed: [
    dcpiStep(1, 'phoenix', 'Phoenix', 'WECC', 'CAUTION', 43.5, 42, '2026-11-16T18:29:35.298825+00:00'),
    dcpiStep(2, 'columbus', 'Columbus', 'PJM', 'AVOID', 17.2, 60.3, '2026-11-16T18:29:39.972751+00:00'),
    { step: 3, tool: 'get_market_intel', args: { market: 'phoenix' }, status: 'executed',
      result: { market: { id: 'phoenix', name: 'Phoenix' }, siting: { mw: { total_mw: 4323 } }, provenance: { as_of: '2026-09-30' } } },
    { step: 4, tool: 'get_market_intel', args: { market: 'columbus' }, status: 'executed',
      result: { market: { id: 'columbus', name: 'Columbus' }, siting: { mw: { total_mw: 2111 } }, provenance: { as_of: '2026-09-30' } } },
  ],
  provenance: { as_of: '2026-09-30', as_of_basis: 'OLDEST of 24 source timestamps in this response' },
};

describe('item 2: a comparison header names every compared market and is dated by the DCPI reads', () => {
  const h = buildPlanFactHeader(COMPARE);
  it('names both markets, each with its own DCPI verdict and figures', () => {
    expect(h).toBe([
      'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-11-16T18:29Z',
      'ENTITY: Phoenix (market) | Columbus (market) | PJM (ISO) | WECC (ISO)',
      'SUMMARY: Phoenix DCPI CAUTION 43.5/100, time to power 42 months | Columbus DCPI AVOID 17.2/100, time to power 60.3 months',
    ].join('\n'));
  });
  it('is not dated by the market-intel input (2026-09-30) and carries no figure from it', () => {
    expect(h).not.toMatch(/2026-09-30|4,323|Tracked/);
  });
  it('the oldest read dates it; an undated read means no AS_OF rather than a guessed one', () => {
    const p = JSON.parse(JSON.stringify(COMPARE));
    p.executed[1].result.computed_at = '2026-11-15T07:00:00Z';
    p.executed[1].result.citation.as_of = '2026-11-15T07:00:00Z';
    expect(buildPlanFactHeader(p).split('\n')[0]).toBe('SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-11-15T07:00Z');
    for (const k of ['computed_at', 'citation', 'provenance']) delete p.executed[1].result[k];
    expect(buildPlanFactHeader(p).split('\n')[0]).toBe('SOURCE: DC Hub (dchub.cloud)');
  });
  it('a long ENTITY line drops ISOs before it drops a compared market', () => {
    const p = JSON.parse(JSON.stringify(COMPARE));
    p.constraint_iso = ['PJM', 'WECC', 'ERCOT', 'MISO'];
    p.executed[0].result.market_name = 'Phoenix ' + 'x'.repeat(60);
    const h2 = buildPlanFactHeader(p);
    expect(h2.length).toBeLessThanOrEqual(320);
    expect(h2).toMatch(/Columbus \(market\)/);
  });
  it('not a comparison (one market, or another intent class): the header is unchanged', () => {
    const one = { ...COMPARE, executed: [COMPARE.executed[0], COMPARE.executed[2]] };
    // Owner 2026-11-18: the oldest input's date names that input (OLDEST_INPUT), the date itself unchanged.
    expect(buildPlanFactHeader(one).split('\n')[0]).toBe('SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-09-30 | OLDEST_INPUT: Phoenix market intel');
    const ranking = { ...COMPARE, intent_class: 'market_ranking' };
    expect(buildPlanFactHeader(ranking)).toMatch(/^SOURCE: DC Hub \(dchub\.cloud\) \| AS_OF: 2026-09-30 \| OLDEST_INPUT: Phoenix market intel and Columbus market intel\nENTITY: Phoenix \(market\) \| PJM/);
  });
});

// ---- item 3: ERCOT queue ----
const ERCOT = {
  _entity: 'plan_execution', ok: true, intent_class: 'grid_headroom', constraint_iso: ['ERCOT'],
  provenance: { as_of: '2026-10-31' },
  executed: [
    { step: 2, tool: 'get_interconnection_queue', args: { iso: 'ERCOT' }, status: 'executed',
      result: { iso: 'ERCOT', queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-10-31', source_as_of: '2026-10-31',
        source_as_of_basis: 'published_report', large_load: { generation_queue: { mw: 461414, requests: 1847, as_of: '2026-10-31' } } } },
    { step: 3, tool: 'get_refined_queue', args: { iso: 'ERCOT', min_mw: 100 }, status: 'executed',
      result: { total_queued_mw: 446266, filters_applied: { min_mw: 100 }, count_total_matching: 1478 } },
  ],
};

describe('item 3: the header\'s queue figure is the one the answer cites, from the same read and date', () => {
  it('ERCOT: the GIS generation queue from get_interconnection_queue, with its report date', () => {
    const h = buildPlanFactHeader(ERCOT);
    expect(h.split('\n')[2]).toBe('SUMMARY: Generation queue 461.4 GW (get_interconnection_queue, as of 2026-10-31)');
    expect(h).not.toMatch(/446,266/);
  });
  it('a live feed with no report date says "collected", as the answer_guide does', () => {
    const p = { ...ERCOT, executed: [{ ...ERCOT.executed[0], result: { iso: 'PJM', queued_generation_gw: 373.6, source_as_of: '2026-11-16',
      source_as_of_basis: 'live_feed_fetch_date', last_refreshed: '2026-11-16T06:03:48Z' } }] };
    expect(buildPlanFactHeader(p)).toMatch(/SUMMARY: Generation queue 373\.6 GW \(get_interconnection_queue, collected 2026-11-16\)$/);
  });
  it('the preview shape (taste.headline) is read the same way', () => {
    const p = { ...ERCOT, executed: [{ ...ERCOT.executed[0], result: { iso: 'ERCOT',
      taste: { headline: { name: 'queued_generation_gw', value: 461.4, unit: 'GW', as_of: '2026-10-31' } } } }] };
    expect(buildPlanFactHeader(p)).toMatch(/Generation queue 461\.4 GW \(get_interconnection_queue, as of 2026-10-31\)/);
  });
  it('only the row sum: it is printed as a row sum with its floor, never as "Queue N MW"', () => {
    const p = { ...ERCOT, executed: [ERCOT.executed[1]] };
    const h = buildPlanFactHeader(p);
    expect(h).toMatch(/SUMMARY: Queue rows sum 446,266 MW \(get_refined_queue, rows of 100 MW or more\)$/);
    expect(h).not.toMatch(/SUMMARY: Queue \d/);
  });
});

// ---- item 8 (pure half) ----
describe('item 8: planId is stable for the same question; compactReplay keeps decisions and status', () => {
  const base = { intent: 'How soon can a 100 MW load get power in PJM', context: { iso: 'PJM', capacity_mw: 100 },
    intentClass: 'grid_headroom', plannerVersion: '5.31' };
  it('same question (case, spacing, rerun token, cohort aside) gives the same id', () => {
    const a = planId(base);
    expect(a).toMatch(/^plan_[0-9a-f]{16}$/);
    expect(planId({ ...base, intent: '  how soon can a 100 MW   load get power in pjm ',
      context: { capacity_mw: 100, iso: 'PJM', rerun_token: 'pr1.x', cohort: 'cohort.front_door' } })).toBe(a);
  });
  it('another question, context, class or planner version gives another id', () => {
    const a = planId(base);
    expect(planId({ ...base, intent: 'how soon can a 200 MW load get power in PJM' })).not.toBe(a);
    expect(planId({ ...base, context: { iso: 'ERCOT', capacity_mw: 100 } })).not.toBe(a);
    expect(planId({ ...base, intentClass: 'interconnection_queue' })).not.toBe(a);
    expect(planId({ ...base, plannerVersion: '5.33' })).not.toBe(a);
  });
  it('compactReplay keeps id, step, kind, status and decision for every decision, and the plan id', () => {
    const replay = { schema_version: 1, planner_version: '5.31', intent_class: 'grid_headroom', plan_id: 'plan_0123456789abcdef',
      compatibility: { big: 'x'.repeat(500) }, note: 'n',
      decisions: [{ id: 'D0', step: 0, kind: 'route', status: 'planned', decision: 'Route', rationale: 'r'.repeat(300) },
        { id: 'D1', step: 1, kind: 'step', status: 'executed', decision: 'Call get_grid_intelligence', rationale: 'r', depends_on: [] },
        { id: 'D2', step: 2, kind: 'step', status: 'failed', decision: 'Call get_refined_queue' },
        { id: 'C1', kind: 'constraint_check', status: 'PASS', decision: 'every minted iso' }],
      rejected: [{ id: 'R1', tool: 'compare_isos', reason: 'one ISO' }] };
    const c = compactReplay(replay);
    expect(c.plan_id).toBe('plan_0123456789abcdef');
    expect(c.decisions).toEqual([{ id: 'D0', step: 0, kind: 'route', status: 'planned', decision: 'Route' },
      { id: 'D1', step: 1, kind: 'step', status: 'executed', decision: 'Call get_grid_intelligence' },
      { id: 'D2', step: 2, kind: 'step', status: 'failed', decision: 'Call get_refined_queue' },
      { id: 'C1', kind: 'constraint_check', status: 'PASS', decision: 'every minted iso' }]);
    expect(c.rejected_tools).toEqual(['compare_isos']);
    expect(JSON.stringify(c).length).toBeLessThan(1200);
    expect(compactReplay(null)).toBeNull();
  });
});
