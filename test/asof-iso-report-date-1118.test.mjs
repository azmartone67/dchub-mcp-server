// asof-iso-report-date-1118.test.mjs — owner 2026-11-18 ("Yes, fix it here"), after mcp#1554 went live.
//
// Live keyless 22:19Z: the capacity_grid plan quoted ERCOT's queue (ERCOT GIS report, as of 2026-10-31:
// source_as_of_basis published_report, queued_generation_gw_as_of 2026-10-31) yet its header read
// "AS_OF: 2026-11-18 | OLDEST_INPUT: ERCOT interconnection queue" (the step's as_of is DC Hub's ingest date) and the
// queue fact said "collected 2026-11-18". A source date the backend marks as a data date now counts toward as_of; a
// live feed's fetch date (live_feed_fetch_date) still does not. Pure, no network. Shapes are the live figures.
import { describe, it, expect } from 'vitest';
import { buildProvenance } from '../lib/attribution.mjs';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';
import { queueFact } from '../lib/cross-domain-answer.mjs';
import { _planQuery } from '../server.mjs';

const ERCOT = { iso: 'ERCOT', as_of: '2026-11-18', last_refreshed: '2026-11-18T06:02:36Z', source_as_of: '2026-10-31',
  source_as_of_basis: 'published_report', queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-10-31', project_count: 1766 };
const MISO = { iso: 'MISO', as_of: null, last_refreshed: '2026-11-18T06:02:48Z', source_as_of: '2026-11-18',
  source_as_of_basis: 'live_feed_fetch_date', queued_generation_gw: 259.9, project_count: 1126 };
const qstep = (iso, p) => ({ step: 2, tool: 'get_interconnection_queue', args: { iso }, status: 'executed', result: p });

describe('an ISO report date counts toward as_of', () => {
  it('the plan is dated by ERCOT\'s report, and the header names it', () => {
    const plan = { _entity: 'plan_execution', executed: [qstep('ERCOT', ERCOT), qstep('MISO', MISO)] };
    plan.provenance = buildProvenance(plan, { toolName: 'execute_plan' });
    expect(plan.provenance.as_of).toBe('2026-10-31');
    expect(buildPlanFactHeader(plan).split('\n')[0]).toBe('SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-10-31 | OLDEST_INPUT: ERCOT interconnection queue');
  });

  it('a source file date counts too; a live feed\'s fetch date does not', () => {
    const file = { ...MISO, source_as_of: '2026-11-02', source_as_of_basis: 'source_file_date', as_of: '2026-11-18' };
    expect(buildProvenance(file, {}).as_of).toBe('2026-11-02');
    const live = { ...MISO, source_as_of: '2026-11-02', as_of: '2026-11-18' };   // live_feed_fetch_date
    expect(buildProvenance(live, {}).as_of).toBe('2026-11-18');
    const none = { ...MISO, source_as_of: '2026-11-02', source_as_of_basis: undefined, as_of: '2026-11-18' };
    expect(buildProvenance(none, {}).as_of).toBe('2026-11-18');
  });

  it('a source date on a data row stays that row\'s', () => {
    const p = { as_of: '2026-11-18', projects: [{ name: 'x', source_as_of: '2026-01-01', source_as_of_basis: 'published_report' }] };
    expect(buildProvenance(p, {}).as_of).toBe('2026-11-18');
  });

  it('the queue fact says the ISO report date, and a live feed stays "collected"', () => {
    expect(queueFact({ tool: 'get_interconnection_queue', step: 2, args: { iso: 'ERCOT' }, p: ERCOT }).text)
      .toContain('(ISO report, as of 2026-10-31;');
    const { queued_generation_gw_as_of: _drop, ...viaSource } = ERCOT;
    expect(queueFact({ tool: 'get_interconnection_queue', step: 2, args: { iso: 'ERCOT' }, p: viaSource }).as_of).toBe('2026-10-31');
    const viaFigure = { ...ERCOT, source_as_of: '2026-11-18', source_as_of_basis: 'live_feed_fetch_date' };
    expect(queueFact({ tool: 'get_interconnection_queue', step: 2, args: { iso: 'ERCOT' }, p: viaFigure }).as_of).toBe('2026-10-31');
    expect(queueFact({ tool: 'get_interconnection_queue', step: 2, args: { iso: 'MISO' }, p: MISO }).text)
      .toContain('(collected 2026-11-18;');
  });

  it('a power-availability plan\'s rationale names no listings step; a capacity plan\'s still does', () => {
    const pow = _planQuery('Which US markets have the most available grid power for a 100 MW data center campus running Llama inference, and what does the interconnection queue look like?', {});
    expect(pow.planner_rationale).not.toMatch(/Capacity Source/);
    const cap = _planQuery('Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do grid headroom and the interconnection queue look like there?', {});
    expect(cap.planner_rationale).toMatch(/Capacity Source listings/);
  });
});
