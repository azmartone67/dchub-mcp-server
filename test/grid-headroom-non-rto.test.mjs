import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';

const LIVE_PHOENIX = 'What is grid headroom and time to power for a 100 MW campus in Phoenix?';

function seq(intent, ctx) {
  const p = _planQuery(intent, ctx || {});
  return { plan: p, steps: p.recommended_sequence || [] };
}

describe('grid_headroom does not pass a non-RTO iso (live 2026-11-12 Phoenix)', () => {
  // Planner 5.40: a campus (a data-center noun) + headroom/time to power + one place is dc_power_place (Grok
  // cross-domain round 2). The guard this file exists for still holds there: no iso=WECC reaches any tool.
  const argsOf = (steps) => JSON.stringify(steps.map((s) => s.args_hint));
  it('the live Phoenix time-to-power question routes to dc_power_place', () => {
    expect(_planQuery(LIVE_PHOENIX).intent_class).toBe('dc_power_place');
  });

  it('Phoenix does not pass iso=WECC; it reads AZ retirements, the AZ queue slice and the AZ timeline', () => {
    const { steps, plan } = seq(LIVE_PHOENIX);
    expect(argsOf(steps)).not.toContain('WECC');
    expect(argsOf(steps)).not.toContain('"iso"');
    const byTool = Object.fromEntries(steps.map((s) => [s.tool, s]));
    expect(byTool.get_market_intel.args_hint).toEqual({ market: 'phoenix' });
    expect(byTool.get_retirement_headroom.args_hint).toMatchObject({ region_iso: 'AZPS,SRP,TEPC', target_mw: 100 });
    // The state slice is a request count: never sized to the buyer's MW.
    expect(byTool.get_refined_queue.args_hint).toEqual({ state: 'AZ' });
    expect(byTool.get_power_availability_timeline.args_hint).toEqual({ state: 'AZ', mw: 100 });
    expect(byTool.get_interconnection_queue).toBeUndefined();
    expect(byTool.get_grid_intelligence).toBeUndefined();
    expect(plan.execution_waves).toEqual([[1, 2, 3, 4]]);
  });

  it('without a data-center noun, Phoenix headroom stays on grid_headroom and still passes no WECC', () => {
    const { steps, plan } = seq('What is grid headroom and time to power in Phoenix?');
    expect(plan.intent_class).toBe('grid_headroom');
    expect(argsOf(steps)).not.toContain('WECC');
    expect(argsOf(steps)).not.toContain('"iso"');
  });

  it('Las Vegas is the same non-RTO path with state NV', () => {
    const { steps } = seq('What is grid headroom and time to power for a 100 MW campus in Las Vegas?');
    expect(argsOf(steps)).not.toContain('WECC');
    const q = steps.find((s) => s.tool === 'get_refined_queue');
    expect(q.args_hint.state).toBe('NV');
    expect(q.args_hint.iso).toBeUndefined();
  });

  it('Dallas still uses ERCOT for the ISO tools', () => {
    const { steps, plan } = seq('What is grid headroom and time to power for a 100 MW campus in Dallas?');
    expect(plan.intent_class).toBe('dc_power_place');
    expect(argsOf(steps)).toContain('ERCOT');
    expect(argsOf(steps)).not.toContain('WECC');
    expect(steps.map((s) => s.tool)).toEqual([
      'get_market_intel', 'get_grid_intelligence', 'get_refined_queue', 'get_power_availability_timeline',
    ]);
    expect(steps[1].args_hint).toEqual({ iso: 'ERCOT' });
    expect(steps[2].args_hint).toEqual({ iso: 'ERCOT', state: 'TX' });
    expect(plan.execution_waves).toEqual([[1, 2, 3, 4]]);
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
    expect(PLANNER_VERSION).toBe('5.63');
  });
});
