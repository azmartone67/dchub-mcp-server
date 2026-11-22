// ttp-band-marker-consistent-1122.test.mjs — measured live 2026-11-22, keyless find_sites
// {lat:31.99, lon:-102.07, radius_km:120, ...}: each candidate's time_to_power block carried
// "time_to_power_band":"under_24_months" AND "_time_to_power_band_withheld":true at once, plus
// "_time_to_power_months_withheld":null and "__time_to_power_months_withheld_withheld":true.
// Cause: the headroom gate (_gatesHeadroom) matched `time_to_power` inside the band's key and inside
// the `_<k>_in_pro` marker's own key; the depth gate has a keep-list for both (_DEPTH_KEEP_RE), the
// headroom gate had none. The band is free by design (mcp#1129, lib/iso-bands.mjs), so the fix keeps
// it and drops the false marker; a marker is never itself gated (re-trim stays idempotent).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ENV = ['DCHUB_DEPTH_GATE', 'DCHUB_GRID_HEADROOM_TIER'];
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
async function load() {
  delete process.env.DCHUB_DEPTH_GATE;
  process.env.DCHUB_GRID_HEADROOM_TIER = '1';   // as in prod
  return import('../server.mjs?ttpmarker=' + Math.random());
}
const payload = () => ({ success: true, candidates: [
  { verdict: 'BUILD', market: { verdict: 'BUILD', slug: 'midland-tx' },
    time_to_power: { time_to_power_months: 9.6, time_to_power_band: 'under_24_months', market_slug: 'midland-tx',
      grid: 'ERCOT', as_of: '2026-11-22', basis: 'DCPI time-to-power estimate' } },
] });

// Every `_<k>_in_pro` / `_<k>_withheld` marker set true must sit beside a withheld (null) `<k>`.
function contradictions(node, path = '') {
  const bad = [];
  if (!node || typeof node !== 'object') return bad;
  for (const [k, v] of Object.entries(node)) {
    const m = /^_(.+)_(?:in_pro|withheld)$/.exec(k);
    if (m && v === true && Object.prototype.hasOwnProperty.call(node, m[1]) && node[m[1]] != null) bad.push(`${path}${k}`);
    if (/^__/.test(k)) bad.push(`${path}${k} (marker of a marker)`);
    if (v && typeof v === 'object') bad.push(...contradictions(v, `${path}${k}.`));
  }
  return bad;
}

describe('trimForTrial: a withheld marker never sits beside a value it claims withheld', () => {
  it('find_sites time_to_power block: band kept with no withheld marker, months nulled with one', async () => {
    const { trimForTrial } = await load();
    const ttp = trimForTrial(payload(), 'find_sites').candidates[0].time_to_power;
    expect(ttp.time_to_power_band).toBe('under_24_months');
    expect(ttp).not.toHaveProperty('_time_to_power_band_in_pro');
    expect(ttp.time_to_power_months).toBeNull();
    expect(ttp._time_to_power_months_in_pro).toBe(true);
  });
  it('trimming twice is idempotent: the marker is not itself gated (no __..._in_pro_in_pro)', async () => {
    const { trimForTrial } = await load();
    const once = trimForTrial(payload(), 'find_sites');
    const twice = trimForTrial(once, 'find_sites');
    expect(twice).toEqual(once);
    expect(contradictions(twice)).toEqual([]);
  });
  it('a bare headroom-gated figure elsewhere is still withheld', async () => {
    const { trimForTrial } = await load();
    const out = trimForTrial({ headroom_mw: 500, time_to_power_months: 14, headroom_band: '<1 GW' }, 'get_grid_intelligence');
    expect(out.headroom_mw).toBeNull();
    expect(out.time_to_power_months).toBeNull();
    expect(out.headroom_band).toBe('<1 GW');
    expect(contradictions(out)).toEqual([]);
  });
});
