// live-reading-phoenix-time-1123.test.mjs: live readings say the America/Phoenix clock, never a raw UTC stamp.
// Grok head-to-head 2026-11-23 17:40 Phoenix (00:40Z on 11-24), on planner 5.63:
//   * p4 "ERCOT HB_NORTH real-time LMP: $26.65/MWh (interval ending 2026-11-24T03:50:17Z; ...)"
//   * p5 "PJM demand: 97,545 MW (2026-11-24T02, DC Hub, as of 2026-11-24)"
// under headlines dated 2026-11-23. And a date serialized as midnight UTC ("2026-10-31T00:00:00Z", a queue report date)
// keeps its own date. Machine as_of fields are unchanged. Pure; no network.
import { describe, it, expect } from 'vitest';
import { spokenTime, spokenDay } from '../lib/cite-day.mjs';
import { lmpFact } from '../lib/energy-answers.mjs';
import { factsFromStep } from '../lib/plan-step-facts.mjs';

describe('spokenTime / spokenDay', () => {
  it('a UTC stamp is its Phoenix clock, labelled MST', () => {
    expect(spokenTime('2026-11-24T03:50:17Z')).toBe('2026-11-23 20:50 MST');
    expect(spokenTime('2026-11-23T17:30:00-06:00')).toBe('2026-11-23 16:30 MST');
    expect(spokenTime('2026-11-24T02')).toBe('2026-11-23 19:00 MST');   // an EIA-930 UTC hour
    expect(spokenTime('2026-11-23')).toBeNull();
    expect(spokenTime('soon')).toBeNull();
    expect(spokenTime(null)).toBeNull();
  });
  it('exactly midnight UTC is a date and keeps it; a real reading shifts', () => {
    for (const v of ['2026-10-31T00:00:00Z', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00+00:00', '2026-10-31 00:00:00', '2026-10-31T00:00'])
      expect(spokenDay(v), v).toBe('2026-10-31');
    expect(spokenDay('2026-10-31T00:39:23Z')).toBe('2026-10-30');
    expect(spokenDay('2026-11-24T00:40:00Z')).toBe('2026-11-23');
  });
});

describe('the real-time LMP line', () => {
  const s = { tool: 'get_energy_prices', step: 1, args: { iso: 'ERCOT', hub: 'HB_NORTH' }, p: { wholesale_lmp: { iso: 'ERCOT', hub: 'HB_NORTH',
    real_time: { lmp_usd_mwh: 26.65, interval_ending: '2026-11-24T03:50:17Z', as_of: '2026-11-24T03:50:17Z', stale: false }, source: 'ERCOT' } } };
  it('says the interval on the Phoenix clock, never the UTC stamp', () => {
    const f = lmpFact(s);
    expect(f.text).toBe('ERCOT HB_NORTH real-time LMP: $26.65/MWh (interval ending 2026-11-23 20:50 MST; ERCOT).');
    expect(f.text).not.toMatch(/T\d\d:|\dZ\b|2026-11-24/);
    expect(f.as_of).toBe('2026-11-23');   // the reading's America/Phoenix day (Grok Brain 2026-11-24 item 5), as the line says it
  });
});

describe('the hourly demand line (taste headline)', () => {
  const p = { iso: 'PJM', as_of: '2026-11-24T02:00:00Z',
    taste: { headline: { name: 'demand_mw', label: 'PJM demand', value: 97545, unit: 'MW', window: '2026-11-24T02', as_of: '2026-11-24T02:00:00Z' } } };
  it('says the hour and its day on one Phoenix clock', () => {
    const [f] = factsFromStep('get_grid_intelligence', p, { iso: 'PJM' });
    expect(f.text).toContain('(2026-11-23 19:00 MST, DC Hub, as of 2026-11-23)');
    expect(f.text).not.toMatch(/T\d\d\b|2026-11-24/);
    expect(f.as_of).toBe('2026-11-24');   // the machine field is unchanged
  });
  it('a window that is a date at midnight UTC is said as that date', () => {
    const q = { iso: 'PJM', taste: { headline: { name: 'demand_mw', value: 90000, unit: 'MW', window: '2026-11-23T00:00:00Z', as_of: '2026-11-23T00:00:00Z' } } };
    const [f] = factsFromStep('get_grid_intelligence', q, { iso: 'PJM' });
    expect(f.text).toContain('(2026-11-23, DC Hub, as of 2026-11-23)');
  });
  it('a report date at midnight UTC keeps its date', () => {
    const q = { iso: 'ERCOT', taste: { headline: { name: 'queued_generation_gw', value: 461.4, unit: 'GW', as_of: '2026-10-31T00:00:00Z' } } };
    const [f] = factsFromStep('get_interconnection_queue', q, { iso: 'ERCOT' });
    expect(f.text).toContain('as of 2026-10-31');
  });
});
