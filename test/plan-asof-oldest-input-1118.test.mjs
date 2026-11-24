// plan-asof-oldest-input-1118.test.mjs — owner 2026-11-18 ("Yes, name the source"), Grok 1118 item 3.
//
// Grok's keyless queue answer read "as of 2026-11-05T09:37" while the plan ran on 11-18, with nothing saying whose date
// that was. AS_OF stays the plan's OLDEST input (an answer is no fresher than its stalest input); the fact header now
// names that input (OLDEST_INPUT) and the lead's Source line says "(oldest input: …)". Pure, no network.
import { describe, it, expect } from 'vitest';
import { buildPlanFactHeader, oldestInputOf } from '../lib/plan-fact-header.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';
import { buildProvenance, planAsOfSteps } from '../lib/attribution.mjs';

const step = (n, tool, args, asOf) => ({ step: n, tool, args, status: 'executed', result: { provenance: { as_of: asOf } } });
const plan = (executed) => {
  const p = { _entity: 'plan_execution', intent: 'Which markets have power, and what does the queue look like?', executed };
  p.provenance = buildProvenance(p, { toolName: 'execute_plan' });
  p.fact_header = buildPlanFactHeader(p);
  return p;
};

describe('the plan as_of names its oldest input', () => {
  it('Grok 1118: the queue report date is named as the PJM queue\'s, and stays the AS_OF', () => {
    const p = plan([
      step(1, 'get_interconnection_queue', { iso: 'PJM' }, '2026-11-05T09:37:00Z'),
      step(2, 'get_market_dcpi_rank', { market_slug: 'columbus' }, '2026-11-18T10:00:00Z'),
    ]);
    expect(p.provenance.as_of).toBe('2026-11-05T09:37:00.000Z');
    expect(p.fact_header.split('\n')[0]).toBe('SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-11-05T02:37-07:00 | OLDEST_INPUT: PJM interconnection queue');
    // The lead is a sentence: the stamp prints as its America/Phoenix day (lib/cite-day.mjs); the header keeps the hour.
    expect(planLeadText(p)).toContain('Source: DC Hub (dchub.cloud), as of 2026-11-05 (oldest input: PJM interconnection queue).');
  });

  it('two steps on the same oldest date are both named; a third is counted', () => {
    const d = '2026-11-01T00:00:00Z';
    const p = plan([
      step(1, 'get_interconnection_queue', { iso: 'PJM' }, d),
      step(2, 'get_interconnection_queue', { iso: 'MISO' }, d),
      step(3, 'get_power_availability_timeline', { state: 'tx' }, d),
      step(4, 'get_grid_intelligence', { iso: 'PJM' }, '2026-11-18T00:00:00Z'),
    ]);
    expect(oldestInputOf(p, p.provenance.as_of)).toBe('PJM interconnection queue and MISO interconnection queue (+1 more)');
  });

  it('a run-time as_of (no step dated) prints no AS_OF and no OLDEST_INPUT', () => {
    const p = plan([{ step: 1, tool: 'discover_tools', args: {}, status: 'executed', result: { tools: [] } }]);
    expect(p.provenance.as_of_kind).toBe('generated_at');
    expect(p.fact_header.split('\n')[0]).toBe('SOURCE: DC Hub (dchub.cloud)');
    expect(planLeadText(p)).not.toContain('oldest input');
  });

  it('a row date the plan provenance ignores does not pick the step', () => {
    const p = { _entity: 'plan_execution', executed: [
      { step: 1, tool: 'search_facilities', args: {}, status: 'executed', result: { rows: [{ updated_at: '2026-11-05T09:37:00Z' }] } },
      // A record-scoped key at a step's top level sits inside executed[] in the plan, so the plan's as_of never counts it.
      { step: 2, tool: 'get_facility', args: {}, status: 'executed', result: { updated_at: '2026-11-05T09:37:00Z' } },
      step(3, 'get_interconnection_queue', { iso: 'PJM' }, '2026-11-05T09:37:00Z'),
    ] };
    p.provenance = buildProvenance(p, { toolName: 'execute_plan' });
    expect(p.provenance.as_of).toBe('2026-11-05T09:37:00.000Z');
    expect(planAsOfSteps(p, p.provenance.as_of).map((e) => e.tool)).toEqual(['get_interconnection_queue']);
  });

  it('never throws and names nothing on junk', () => {
    expect(planAsOfSteps(null, '2026-11-05')).toEqual([]);
    expect(planAsOfSteps({ executed: [null, 3, 'x'] }, '2026-11-05')).toEqual([]);
    expect(planAsOfSteps({ executed: [] }, 'not a date')).toEqual([]);
    expect(oldestInputOf({ executed: [] }, '2026-11-05')).toBeNull();
  });
});
