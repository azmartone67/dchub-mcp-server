// planner-558-named-markets-on-grid-plans.test.mjs — agent-incentive round (2026-11-21).
//
// Live, keyless and connected: "Is central Ohio (Columbus, PJM) or the Dallas-Fort Worth area (ERCOT) the better bet"
// routed to iso_comparison (two grids named), ran compare_isos and two queue reads, and never read either named
// market's Data Center Power Index (DCPI) card. The lead said "no figure in them could be summarised here".
//
//   * a grid plan whose question names two or more tracked markets also reads each market's DCPI card;
//   * a grid-only question ("Compare PJM and ERCOT interconnection queues") is unchanged;
//   * the fact header of such a plan leads with the named markets' verdicts and carries ONE AS_OF.
// Examples with figures use PJM / SERC markets only (DCPI hold #117162: no ERCOT, AZ or MISO scores).
import { describe, it, expect } from 'vitest';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';

process.env.DCHUB_API_BASE = process.env.DCHUB_API_BASE || 'http://127.0.0.1:9';
const S = await import('../server.mjs');
const dcpiSteps = (p) => (p.recommended_sequence || []).filter((s) => s.tool === 'get_market_dcpi_rank')
  .map((s) => s.args_hint && s.args_hint.market_slug);

describe('5.59: named markets on a grid plan', () => {
  it('two grids and two named markets: both DCPI cards are read', () => {
    const p = S._planQuery('We need about 150 MW for an AI training campus by 2028. Is central Ohio (Columbus, PJM) or the '
      + 'Dallas-Fort Worth area (ERCOT) the better bet on power availability and interconnection risk?', {});
    expect(p.intent_class).toBe('iso_comparison');
    expect(dcpiSteps(p)).toEqual(['columbus', 'dallas']);
    // the class's own steps still run first
    expect(p.recommended_sequence[0].tool).toBe('compare_isos');
    p.recommended_sequence.forEach((s, i) => expect(s.step).toBe(i + 1));
  });

  it('one grid, two named markets ("Columbus vs Atlanta"): both cards, not only the first', () => {
    const p = S._planQuery('Columbus (PJM) vs Atlanta for a 100 MW campus: power and interconnection risk?', {});
    expect(dcpiSteps(p)).toEqual(expect.arrayContaining(['columbus', 'atlanta']));
  });

  it('grids only: no market card is invented', () => {
    const p = S._planQuery('Compare PJM and ERCOT interconnection queues', {});
    expect(p.intent_class).toBe('iso_comparison');
    expect(dcpiSteps(p)).toEqual([]);
  });

  it('_planTrackedMarketsInOrder needs no comparison word; Dallas-Fort Worth is one place', () => {
    expect(S._planTrackedMarketsInOrder('Columbus or Dallas-Fort Worth, which grid?')).toEqual(['columbus', 'dallas']);
    expect(S._planComparedMarkets('Columbus or Dallas')).toBe(null);   // the gated form is unchanged
  });

  it('PLANNER_VERSION is 5.59', () => { expect(S.PLANNER_VERSION).toBe('5.63'); });
});

describe('5.59: the header of a grid plan with named markets leads with their verdicts', () => {
  const plan = {
    _entity: 'plan_execution', intent_class: 'grid_headroom', constraint_iso: ['PJM'],
    executed: [
      { step: 1, tool: 'get_grid_intelligence', args: { iso: 'PJM' }, status: 'executed', result: { iso: 'PJM', as_of: '2026-06-30' } },
      { step: 2, tool: 'get_market_dcpi_rank', args: { market_slug: 'columbus' }, status: 'executed',
        result: { market_name: 'Columbus', verdict: 'AVOID', composite_score: 17.2, computed_at: '2026-11-21T17:13:01.784583+00:00' } },
      { step: 3, tool: 'get_market_dcpi_rank', args: { market_slug: 'atlanta' }, status: 'executed',
        result: { market_name: 'Atlanta', verdict: 'CAUTION', composite_score: 52.1, computed_at: '2026-11-21T17:10:00+00:00' } },
    ],
  };
  it('SUMMARY names each market and verdict; AS_OF is one date, the oldest DCPI read', () => {
    const h = buildPlanFactHeader(plan);
    expect(h).toMatch(/SUMMARY: Columbus DCPI AVOID[^|]*\| Atlanta DCPI CAUTION/);
    expect(h).toMatch(/ENTITY: Columbus \(market\) \| Atlanta \(market\)/);
    expect((h.match(/AS_OF:/g) || []).length).toBe(1);
    expect(h).toMatch(/AS_OF: 2026-11-21T17:10Z/);
    expect(h).not.toMatch(/2026-06-30/);
  });
  it('one named market only: the existing header is kept', () => {
    const one = { ...plan, executed: plan.executed.slice(0, 2) };
    expect(buildPlanFactHeader(one) || '').not.toMatch(/Atlanta/);
  });
});

