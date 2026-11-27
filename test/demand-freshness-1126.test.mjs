// GDL 2026-11-26 item 1: a stale EIA-930 demand hour is never said as "live" or "Right now".
// Live 2026-11-26 evening: ERCOT demand_period 2026-11-10T21 (EIA's API timing out) was printed as
// "Right now: ERCOT demand: 54,223 MW (2026-11-10 17:00 MST ...)" and "live demand was 54,223 MW".
import { describe, it, expect, afterEach, vi } from 'vitest';
import { demandFreshness, demandHourEndMs, DEMAND_FRESH_HOURS } from '../lib/demand-freshness.mjs';
import { factsFromStep } from '../lib/plan-step-facts.mjs';
import { headroomFact } from '../lib/cross-domain-answer.mjs';
import { buildPriceNowAnswer } from '../lib/energy-answers.mjs';

const NOW = new Date('2026-11-27T00:45:00Z');   // 17:45 Phoenix on 2026-11-26, the run Grok scored
afterEach(() => vi.useRealTimers());
const at = (d) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(d); };

const tasteStep = (hour) => ({ iso: 'ERCOT', taste: { headline: { name: 'demand_mw', value: 54223, unit: 'MW', window: hour, as_of: `${hour}:00:00Z` } } });
const fullStep = (hour) => ({ iso: 'ERCOT', demand_mw: 53439, demand_period: hour,
  freshness_sla: { layers: { demand: { as_of: hour, sla_hours: 4 } } } });

describe('demandFreshness', () => {
  it('measures from the END of the EIA hour', () => {
    expect(demandHourEndMs('2026-11-26T21')).toBe(Date.parse('2026-11-26T22:00:00Z'));
    expect(DEMAND_FRESH_HOURS).toBe(3);
  });
  it('a 16-day-old hour is stale; an hour that ended 1 h ago is not', () => {
    expect(demandFreshness(fullStep('2026-11-10T21'), NOW.getTime()).stale).toBe(true);
    expect(demandFreshness(fullStep('2026-11-26T22'), NOW.getTime()).stale).toBe(false);
    expect(demandFreshness(tasteStep('2026-11-10T17'), NOW.getTime()).day).toBe('2026-11-10');
  });
  it('no demand hour stated: null (no gate)', () => {
    expect(demandFreshness({ iso: 'ERCOT' }, NOW.getTime())).toBeNull();
  });
});

describe('factsFromStep get_grid_data', () => {
  it('forced stale row: the demand line is replaced by the not_established sentence', () => {
    at(NOW);
    for (const p of [tasteStep('2026-11-10T21'), fullStep('2026-11-10T21')]) {
      const fs = factsFromStep('get_grid_data', p, { iso: 'ERCOT' });
      expect(fs[0].text).toBe('The latest EIA-930 demand reading for ERCOT is 2026-11-10; it is not shown as a current load.');
      expect(fs[0]._stale_demand).toBe(true);
      for (const f of fs) expect(f.text).not.toMatch(/\blive\b|right now|54,223|53,439/i);
    }
  });
  it('a fresh hour keeps its demand line', () => {
    at(NOW);
    const fs = factsFromStep('get_grid_data', fullStep('2026-11-26T22'), { iso: 'ERCOT' });
    expect(fs[0].text).toMatch(/demand 53,439 MW/);
    expect(fs[0]._stale_demand).toBeUndefined();
  });
});

describe('answers', () => {
  it('xd headroom line: no "live demand" on a stale hour', () => {
    at(NOW);
    const f = headroomFact({ tool: 'get_grid_intelligence', step: 1, args: { iso: 'ERCOT' },
      p: { iso: 'ERCOT', taste: { headline: { name: 'demand_mw', value: 54223, as_of: '2026-11-10T21' } } } });
    expect(f.text).not.toMatch(/live demand/);
    expect(f.text).toContain('the latest EIA-930 demand reading for ERCOT is 2026-11-10, not shown as a current load');
  });
  it('e1 price_now: the LMP leads, no "Right now" on a stale hour, and the sentence is not_established', () => {
    at(NOW);
    const EP = { wholesale_lmp: { iso: 'ERCOT', hub: 'HB_HUBAVG', source: 'ERCOT', real_time: { lmp_usd_mwh: 42.71, interval_ending: '2026-11-27T00:15:00Z', as_of: '2026-11-27T00:15:00Z' } } };
    const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
    const run = (gd) => buildPriceNowAnswer({ intent: 'What is ERCOT power price and demand right now?', intent_class: 'price_now' },
      [ex(1, 'get_energy_prices', { iso: 'ERCOT' }, EP), ex(2, 'get_grid_data', { iso: 'ERCOT' }, gd)], null);
    const stale = run(tasteStep('2026-11-10T17'));
    expect(stale.headline).toMatch(/real-time LMP: \$42\.71\/MWh/);
    expect(stale.headline).not.toMatch(/Right now/);
    expect(JSON.stringify(stale)).not.toMatch(/54,223/);
    expect(JSON.stringify(stale)).toContain('The latest EIA-930 demand reading for ERCOT is 2026-11-10; it is not shown as a current load.');
    const fresh = run(tasteStep('2026-11-26T22'));
    expect(fresh.headline).toMatch(/Right now: .*54,223 MW/);
  });
});

// 2026-11-27 live: with be's ISO-load fallback the demand figure is minutes old, but the step's provenance as_of is
// still the EIA series' oldest hour, so the line read "demand 52,281 MW (grid operator feed, as of 2026-11-11)".
describe('a fresh fallback demand is dated by its own hour', () => {
  const fallback = () => ({ iso: 'ERCOT', region: 'ERCOT', demand_mw: 52281, demand_period: '2026-11-27T04:25:15Z',
    demand_source: 'ercot:np6-625-cd(seMW)+np6-235-cd(demand)',
    demand_eia930: { demand_mw: 54223, demand_period: '2026-11-11T00', age_hours: 387.7 },
    freshness_sla: { layers: { demand: { as_of: '2026-11-27T04:25:15Z', sla_hours: 4 } } },
    provenance: { as_of: '2026-11-11T00:00:00Z' }, citation: { as_of: '2026-11-11T00:00:00Z' } });
  it('the fact names the reading day, not the EIA day', () => {
    at(new Date('2026-11-27T04:44:00Z'));   // 21:44 Phoenix on 2026-11-26
    const fs = factsFromStep('get_grid_data', fallback(), { iso: 'ERCOT' });
    expect(fs[0].text).toContain('demand 52,281 MW');
    expect(fs[0].text).toContain('as of 2026-11-26');
    expect(fs[0].as_of).toBe('2026-11-27');
    for (const f of fs) expect(f.text).not.toContain('2026-11-11');
  });
  it('the xd headroom clause names the ISO feed and the reading day', () => {
    at(new Date('2026-11-27T04:44:00Z'));
    const p = { ...fallback(), as_of: '2026-11-11T00:00:00Z' };
    const f = headroomFact({ tool: 'get_grid_intelligence', step: 1, args: { iso: 'ERCOT' }, p });
    expect(f.text).toContain("live demand was 52,281 MW (the ISO's own real-time load, as of 2026-11-26)");
    expect(f.text).not.toMatch(/EIA-930|2026-11-1[01]/);
  });
});
