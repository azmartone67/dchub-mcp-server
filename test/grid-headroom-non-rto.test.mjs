import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';

const LIVE_PHOENIX = 'What is grid headroom and time to power for a 100 MW campus in Phoenix?';

function seq(intent, ctx) {
  const p = _planQuery(intent, ctx || {});
  return { plan: p, steps: p.recommended_sequence || [] };
}

describe('grid_headroom does not pass a non-RTO iso (live 2026-11-12 Phoenix)', () => {
  it('the live Phoenix time-to-power question still routes to grid_headroom', () => {
    expect(_planQuery(LIVE_PHOENIX).intent_class).toBe('grid_headroom');
  });

  it('Phoenix does not pass iso=WECC; it uses the AZ timeline and a state-filtered queue', () => {
    const { steps, plan } = seq(LIVE_PHOENIX);
    const blob = JSON.stringify(steps);
    expect(blob).not.toContain('WECC');
    expect(blob).not.toContain('"iso"');
    const byTool = Object.fromEntries(steps.map((s) => [s.tool, s]));
    expect(byTool.get_power_availability_timeline.args_hint).toEqual({ state: 'AZ' });
    expect(byTool.get_refined_queue.args_hint).toEqual({
      state: 'AZ', min_mw: 100, geocoded_only: true,
    });
    expect(byTool.get_interconnection_queue).toBeUndefined();
    expect(byTool.get_grid_intelligence).toBeUndefined();
    expect(plan.execution_waves).toEqual([[1, 2]]);
  });

  it('Las Vegas is the same non-RTO path with state NV', () => {
    const { steps } = seq('What is grid headroom and time to power for a 100 MW campus in Las Vegas?');
    expect(JSON.stringify(steps)).not.toContain('WECC');
    const q = steps.find((s) => s.tool === 'get_refined_queue');
    expect(q.args_hint.state).toBe('NV');
    expect(q.args_hint.iso).toBeUndefined();
  });

  it('Dallas still uses ERCOT for the three ISO tools', () => {
    const { steps, plan } = seq('What is grid headroom and time to power for a 100 MW campus in Dallas?');
    expect(plan.intent_class).toBe('grid_headroom');
    expect(JSON.stringify(steps)).toContain('ERCOT');
    expect(JSON.stringify(steps)).not.toContain('WECC');
    expect(steps.map((s) => s.tool)).toEqual([
      'get_grid_intelligence', 'get_interconnection_queue', 'get_refined_queue',
    ]);
    expect(steps[0].args_hint).toEqual({ iso: 'ERCOT' });
    expect(plan.execution_waves).toEqual([[1, 2, 3]]);
  });

  it('an explicit ERCOT context is unchanged (fully parallel wave)', () => {
    const { steps, plan } = seq('how much power is available', { iso: 'ERCOT' });
    expect(plan.intent_class).toBe('grid_headroom');
    expect(plan.execution_waves).toEqual([[1, 2, 3]]);
    expect(steps[0].args_hint).toEqual({ iso: 'ERCOT' });
  });

  it('a geography-free grid question still starts at the scoreboard', () => {
    const { plan } = seq('how much power is available on the grid', {});
    expect(plan.best_tool).toBe('get_grid_scoreboard');
    expect(plan.execution_waves).toEqual([[1], [2, 3]]);
  });

  it('planner_version moved with the routing change', () => {
    expect(PLANNER_VERSION).toBe('5.22');
  });
});
