// ttp-block-anon-trim.test.mjs — Grok QA 2026-10-23 follow-up, measured live 2026-10-24 after mcp#1128 +
// be#7664: keyless find_sites returned "time_to_power": null on every candidate. The anonymous trim's headroom
// gate matches the KEY "time_to_power" and nulled the whole block, the free band with it. The block is now
// trimmed inside: months withheld (with the _in_pro marker), band kept. Pure functions, no network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ENV = ['DCHUB_DEPTH_GATE', 'DCHUB_GRID_HEADROOM_TIER'];
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
async function load(headroom) {
  delete process.env.DCHUB_DEPTH_GATE;
  if (headroom === undefined) delete process.env.DCHUB_GRID_HEADROOM_TIER; else process.env.DCHUB_GRID_HEADROOM_TIER = headroom;
  return import('../server.mjs?ttpblock=' + String(headroom) + '-' + Math.random());
}
const block = (months = 60.4, band = 'over_48_months') => ({ time_to_power_months: months, time_to_power_band: band,
  market_slug: 'columbus', as_of: '2026-10-24', basis: 'DCPI time-to-power estimate', not_a_date: 'A modeled market estimate.' });
const payload = () => ({ success: true, candidates: [
  { verdict: 'AVOID', market: { verdict: 'AVOID', slug: 'columbus', distance_km: null }, time_to_power: block() },
  { verdict: 'BUILD', market: { verdict: 'BUILD', slug: 'dallas', distance_km: null }, time_to_power: block(18.0, 'under_24_months') },
] });

describe('trimForTrial: the siting time_to_power block', () => {
  for (const headroom of ['1', undefined]) {
    it(`keeps the band and withholds the months (headroom tier ${headroom ? 'on, as in prod' : 'off'})`, async () => {
      const { trimForTrial } = await load(headroom);
      const out = trimForTrial(payload(), 'find_sites');
      for (const c of out.candidates) {
        expect(c.time_to_power).not.toBeNull();
        expect(c.time_to_power.time_to_power_band).toMatch(/_months$/);
        expect(c.time_to_power.market_slug).toBeTruthy();
        expect(c.verdict).toMatch(/^(BUILD|CAUTION|AVOID)$/);
      }
      if (headroom) {
        expect(out.candidates.map((c) => c.time_to_power.time_to_power_months)).toEqual([null, null]);
        expect(out.candidates[0].time_to_power._time_to_power_months_in_pro).toBe(true);
        expect(JSON.stringify(out)).not.toMatch(/60\.4|"time_to_power_months":18/);
      }
    });
  }
  it('another tool\'s bare time_to_power figure is still withheld whole', async () => {
    const { trimForTrial } = await load('1');
    const out = trimForTrial({ time_to_power: 14, time_to_power_months: 14 }, 'get_grid_intelligence');
    expect(out.time_to_power).toBeNull();
    expect(out.time_to_power_months).toBeNull();
  });
  it('an object under the key without the band shape is not let through', async () => {
    const { trimForTrial } = await load('1');
    const out = trimForTrial({ time_to_power: { months: 14, p50: 12 } }, 'get_grid_intelligence');
    expect(out.time_to_power).toBeNull();
  });
});
