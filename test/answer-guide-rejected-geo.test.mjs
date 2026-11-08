/**
 * execute_plan answer_guide must not lead with a verdict from outside the
 * requested geography (Grok finding #117661).
 *
 * Live 2026-11-04 18:07Z, anonymous, intent "What is the data center power
 * outlook for Las Vegas?": constraint_iso ["WECC"], C1 FAIL rejected the ERCOT
 * mint from get_dchub_recommendation, and answer_guide still read
 * "LEAD WITH THE VERDICT — this run returned: Midland–Odessa: BUILD".
 *
 * Pure function. No network, no DB, no server boot.
 */
import { describe, it, expect } from 'vitest';
import { _execAnswerGuide } from '../server.mjs';

const ercotPocket = [{ step: 2, tool: 'get_dchub_recommendation', status: 'executed',
  result: { top_pocket: { market: 'Midland–Odessa', iso: 'ERCOT', state: 'TX', verdict: 'BUILD' } } }];

describe('answer_guide geography (#117661)', () => {
  it('drops a verdict whose iso is outside constraint_iso', () => {
    const g = _execAnswerGuide(ercotPocket, ['WECC']);
    expect(g).not.toMatch(/LEAD WITH THE VERDICT/);
    expect(g).not.toMatch(/Midland/);
    expect(g).toMatch(/^Compose the answer/);
  });

  it('keeps a verdict whose iso is inside constraint_iso (case-insensitive)', () => {
    const run = [{ result: { market: 'Las Vegas', iso: 'wecc', verdict: 'CAUTION', composite_score: 48.1 } }];
    expect(_execAnswerGuide(run, ['WECC'])).toMatch(/LEAD WITH THE VERDICT — this run returned: Las Vegas: CAUTION \(48\.1\)/);
  });

  it('keeps an in-geography verdict and drops the outside one in the same run', () => {
    const run = [...ercotPocket, { result: { market: 'Las Vegas', iso: 'WECC', verdict: 'CAUTION' } }];
    const g = _execAnswerGuide(run, ['WECC']);
    expect(g).toMatch(/this run returned: Las Vegas: CAUTION\./);
    expect(g).not.toMatch(/Midland/);
  });

  it('keeps a verdict with no iso, and everything when no constraint was set', () => {
    const noIso = [{ result: { market: 'Ashburn', verdict: 'AVOID' } }];
    expect(_execAnswerGuide(noIso, ['WECC'])).toMatch(/Ashburn: AVOID/);
    expect(_execAnswerGuide(ercotPocket, [])).toMatch(/Midland–Odessa: BUILD/);
    expect(_execAnswerGuide(ercotPocket)).toMatch(/Midland–Odessa: BUILD/);
  });

  it('the call site passes the run constraint set', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    // #118011: a third arg (the one named market, market_outlook runs only) follows the set.
    expect(src).toMatch(/answer_guide:[\s\S]{0,160}_execAnswerGuide\(executed, constraintIsoSet[,)]/);
  });
});
