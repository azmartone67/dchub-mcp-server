// planner-547-siting-oldest-input.test.mjs — planner 5.47 (conductor live check 2026-11-20), pure functions, no network.
//
// Live keyless on 5.46, "fastest place to get 300 MW within 18 months near Dallas" (siting_search): the evidence quoted
// "ERCOT's own reported generation queue … (ERCOT report, as of 2026-10-31)", yet intent_answer.source read only
// "as of 2026-11-20" (the DCPI date) and the fact header's AS_OF was DC Hub's load time of the timeline rows. The
// operator report date sits in the timeline's queue_context.iso_reported rows, which the as_of walk suppressed as rows
// and the intent answer never read. A published one now counts, so both dates are labelled as on the other runs (#1575).
import { describe, it, expect } from 'vitest';
import { buildProvenance } from '../lib/attribution.mjs';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';
import { buildIntentAnswer, datedSource } from '../lib/intent-answers.mjs';
import { PLANNER_VERSION } from '../server.mjs';

const NOW = Date.parse('2026-11-20T07:00:00Z');
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
// The live shapes (2026-11-20 06:42Z), trimmed.
const timeline = (basisClass = 'published') => ({
  state: 'TX', as_of: '2026-11-20T06:41:45Z',
  queue_context: {
    as_of: '2026-11-20T05:52:59.346126+00:00', basis_class: 'derived',
    by_iso: [{ iso: 'ERCOT', as_of: '2026-11-20T05:52:59.346126+00:00', as_of_kind: 'when DC Hub loaded the rows' }],
    iso_reported: [{ iso: 'ERCOT', primary: true, gw: 461.4, requests: 1847, as_of: '2026-10-31', basis_class: basisClass,
      basis: 'cited: ERCOT GIS Report, October 2026 (posted 2026-11-02), Summary sheet' }],
  },
  citation: { as_of: '2026-11-20T06:42:05.000Z', cite_as: 'DC Hub, dchub.cloud — PARTIAL preview, 3 of 6 shown (as of 2026-11-20)' },
  provenance: { as_of: '2026-11-20T05:52:59.346Z' },
});
const dcpi = ex(1, 'get_market_dcpi_rank', { market_slug: 'dallas' }, {
  market_slug: 'dallas', verdict: 'CAUTION', composite_score: 42, time_to_power_months: null, computed_at: '2026-11-20T06:21:59Z',
  citation: { as_of: '2026-11-20T06:21:59.591Z', cite_as: 'DC Hub, dchub.cloud — PARTIAL: every row shown; the decision layer is not in this preview (as of 2026-11-20)' },
  provenance: { as_of: '2026-11-20T06:21:59.591Z' } });
const canvas = ex(2, 'site_selection_canvas', { region: 'TX', capacity_mw: 300, max_months: 18 }, {
  applied_filters: { region: 'TX', max_months: null }, max_months_applied: false,
  shortlist: [{ market: 'Midland–Odessa', slug: 'midland-tx', verdict: 'BUILD' }] });
const ctx = { intent: 'fastest place to get 300 MW within 18 months near Dallas', intent_class: 'siting_search',
  constraint_iso: ['ERCOT'], requested_mw: 300, deadline_months: 18, named_markets: ['dallas'], state: 'TX', states: ['TX'] };
const plan = (tl) => {
  const p = { _entity: 'plan_execution', intent: ctx.intent, intent_class: 'siting_search', constraint_iso: ['ERCOT'],
    executed: [dcpi, canvas, ex(4, 'get_power_availability_timeline', { state: 'TX', mw: 300 }, tl)] };
  p.provenance = buildProvenance(p, { toolName: 'execute_plan', now: NOW });
  p.fact_header = buildPlanFactHeader(p);
  return p;
};

describe('planner 5.47: the siting answer is dated by the operator report it quotes', () => {
  it('PLANNER_VERSION is 5.51', () => { expect(PLANNER_VERSION).toBe('5.57'); });

  it('a published iso_reported date is the plan as_of, and the header names the TX timeline as that input', () => {
    const p = plan(timeline());
    expect(String(p.provenance.as_of).slice(0, 10)).toBe('2026-10-31');
    expect(p.fact_header.split('\n')[0]).toBe('SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-10-31 | OLDEST_INPUT: TX power availability timeline');
  });

  it('a derived (not published) iso_reported row stays a row date', () => {
    const p = plan(timeline('derived'));
    expect(String(p.provenance.as_of).slice(0, 10)).toBe('2026-11-20');
  });

  it('intent_answer.source labels both dates: the oldest input and the DCPI verdict', () => {
    const steps = [dcpi, canvas, ex(4, 'get_power_availability_timeline', { state: 'TX', mw: 300 }, timeline())];
    const a = buildIntentAnswer(ctx, steps, null, NOW);
    expect(a.as_of).toBe('2026-10-31');
    expect(a.source).toMatch(/, as of 2026-10-31 \(oldest input\); DCPI verdict as of 2026-11-20$/);
    expect(a.evidence.join(' ')).toContain('(ERCOT report, as of 2026-10-31)');
    const derived = buildIntentAnswer(ctx, [dcpi, canvas, ex(4, 'get_power_availability_timeline', { state: 'TX' }, timeline('derived'))], null, NOW);
    expect(derived.source).not.toContain('oldest input');
  });

  it('datedSource never lets the cited line read fresher than as_of', () => {
    expect(datedSource('Source: DC Hub (dchub.cloud/grid/ercot), as of 2026-11-20', '2026-10-31', null))
      .toBe('Source: DC Hub (dchub.cloud/grid/ercot), as of 2026-10-31');
    expect(datedSource('Source: DC Hub (dchub.cloud/grid/miso), as of 2026-10-17T03:00Z', '2026-10-17T01:00:00Z', null))
      .toBe('Source: DC Hub (dchub.cloud/grid/miso), as of 2026-10-17T03:00Z');   // same day: the hour stays
  });
});
