// verdict-reasons-trim.test.mjs — r-reasons-strip (2026-09-22).
//
// MEASURED, live, keyless, on https://dchub.cloud/mcp the day this shipped:
// site_selection_canvas region=TX returned the free preview (3 rows, the score
// fields null with `_…_in_pro` markers and their bands) and, on every row,
// verdict_reasons carrying the same scores in full:
//
//   {"code":"EXCESS_POWER_MEETS_BUILD_FLOOR","value":85.7,
//    "message":"Excess-power score 85.7 meets the 65.0 floor the BUILD band requires."}
//   {"code":"CONSTRAINT_WITHIN_BUILD_CEILING","value":20.1, …"Constraint score 20.1 …"}
//   {"code":"TIME_TO_POWER","value":9.6, …"Time-to-power 9.6 months weights …"}
//
// The REST twin (/api/v1/site-selection/canvas) withholds the same figures from
// the same callers (dchub-backend util/plan_tease.py).
//
// WHAT THIS PINS
//   * a reason's figure is withheld wherever the field it explains is withheld:
//     `value` null + `_value_in_pro`, and the figure gone from `message`;
//   * the verdict, the reason code, the component, the published band threshold
//     and the band wording stay, because they are the free explanation;
//   * a reason with no figure passes through untouched;
//   * a message that still shows the figure in some other format is dropped,
//     not shipped (fail closed);
//   * DCHUB_DEPTH_GATE=0 restores the figures together with the fields.
//
// Pure functions, no network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ENV = ['DCHUB_DEPTH_GATE', 'DCHUB_GRID_HEADROOM_TIER'];
let saved;
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// Both flags are read at module scope, so each state gets its own import.
async function load({ depth, headroom }) {
  if (depth === undefined) delete process.env.DCHUB_DEPTH_GATE; else process.env.DCHUB_DEPTH_GATE = depth;
  if (headroom === undefined) delete process.env.DCHUB_GRID_HEADROOM_TIER;
  else process.env.DCHUB_GRID_HEADROOM_TIER = headroom;
  return import('../server.mjs?reasons=' + String(depth) + '-' + String(headroom) + '-' + Math.random());
}
// Production runs with the depth gate on (the default) and the headroom tier on.
const PROD = { depth: undefined, headroom: '1' };

const row = () => ({
  market: 'Midland–Odessa', slug: 'midland-tx', state: 'TX', iso: 'ERCOT', verdict: 'BUILD',
  excess_power_score: 85.7, constraint_score: 20.1, time_to_power_months: 9.6,
  composite_score: 83.8, dcpi_url: 'https://dchub.cloud/dcpi/midland-tx',
  verdict_reasons: [
    { code: 'EXCESS_POWER_MEETS_BUILD_FLOOR', component: 'excess_power_score', value: 85.7,
      threshold: 65.0, unit: 'index_0_100', affects: 'verdict',
      message: 'Excess-power score 85.7 meets the 65.0 floor the BUILD band requires.' },
    { code: 'CONSTRAINT_WITHIN_BUILD_CEILING', component: 'constraint_score', value: 20.1,
      threshold: 50.0, unit: 'index_0_100', affects: 'verdict',
      message: 'Constraint score 20.1 is within the 50.0 ceiling the BUILD band allows.' },
    { code: 'TIME_TO_POWER', component: 'time_to_power_months', value: 9.6, threshold: 60.0,
      unit: 'months', affects: 'composite_rank',
      message: 'Time-to-power 9.6 months weights the composite rank (capped at 60.0). It is NOT '
        + 'a verdict input: the verdict is decided by excess-power and constraint alone.' },
    { code: 'VERDICT_ADJUSTED_BEYOND_BASE_BANDS', component: null, value: null, threshold: null,
      unit: null, affects: 'verdict',
      message: 'The published verdict is BUILD, which the two base components alone would not produce (CAUTION).' },
  ],
});
const canvas = () => ({ ok: true, product: 'Site Selection Canvas', matched: 20, universe: 333,
  shortlist: [row(), row(), row(), row()] });

const FIGURES = ['85.7', '20.1', '9.6', '83.8'];

describe('trimForTrial — verdict_reasons in the free preview', () => {
  it('★ no preview row carries a score in its reasons, value or message', async () => {
    const { trimForTrial } = await load(PROD);
    const out = trimForTrial(canvas(), 'site_selection_canvas');
    expect(out.shortlist.length).toBe(3);
    for (const r of out.shortlist) {
      const text = JSON.stringify(r.verdict_reasons);
      for (const f of FIGURES) expect(text, `reasons still carry ${f}`).not.toContain(f);
      for (const reason of r.verdict_reasons.slice(0, 3)) {
        expect(reason.value).toBeNull();
        expect(reason._value_in_pro).toBe(true);
      }
    }
  });

  it('keeps the verdict, the reason code, the band threshold and the band wording', async () => {
    const { trimForTrial } = await load(PROD);
    const [r] = trimForTrial(canvas(), 'site_selection_canvas').shortlist;
    expect(r.verdict).toBe('BUILD');
    expect(r.excess_power_score_band).toBe('BUILD');
    const [ex, con, ttp] = r.verdict_reasons;
    expect([ex.code, con.code, ttp.code]).toEqual(
      ['EXCESS_POWER_MEETS_BUILD_FLOOR', 'CONSTRAINT_WITHIN_BUILD_CEILING', 'TIME_TO_POWER']);
    expect([ex.threshold, con.threshold, ttp.threshold]).toEqual([65.0, 50.0, 60.0]);
    expect(ex.message).toBe('Excess-power score meets the 65.0 floor the BUILD band requires.');
    expect(con.message).toBe('Constraint score is within the 50.0 ceiling the BUILD band allows.');
    expect(ttp.message.startsWith('Time-to-power weights the composite rank (capped at 60.0).')).toBe(true);
  });

  it('a reason with no figure passes through untouched', async () => {
    const { trimForTrial } = await load(PROD);
    const [r] = trimForTrial(canvas(), 'site_selection_canvas').shortlist;
    expect(r.verdict_reasons[3]).toEqual(row().verdict_reasons[3]);
  });

  it('an integer score written as "40.0" in the message goes too', async () => {
    const { _stripReasonNumerics } = await load(PROD);
    const out = _stripReasonNumerics({ code: 'CONSTRAINT_ABOVE_BUILD_CEILING', component: 'constraint_score',
      value: 40, threshold: 30.0, message: 'Constraint score 40.0 exceeds the 30.0 ceiling the BUILD band allows.' });
    expect(out.value).toBeNull();
    expect(out.message).toBe('Constraint score exceeds the 30.0 ceiling the BUILD band allows.');
  });

  it('fails closed: a message that still shows the figure is dropped', async () => {
    const { _stripReasonNumerics } = await load(PROD);
    const out = _stripReasonNumerics({ code: 'X', component: 'excess_power_score', value: 85.7,
      threshold: 65.0, message: 'Excess-power score of 85.70 (rounded 85.7) meets the floor.' });
    expect(out.value).toBeNull();
    expect(out.message).toBeNull();
  });

  it('DCHUB_DEPTH_GATE=0 restores the figures together with the fields', async () => {
    const { trimForTrial } = await load({ depth: '0', headroom: undefined });
    const [r] = trimForTrial(canvas(), 'site_selection_canvas').shortlist;
    expect(r.excess_power_score).toBe(85.7);
    expect(r.verdict_reasons[0].value).toBe(85.7);
    expect(r.verdict_reasons[0].message).toContain('85.7');
  });
});
