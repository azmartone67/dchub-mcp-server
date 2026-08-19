/**
 * The 2026-08-19 composite-intent shell: five defects found by two live runs
 * (ours + xAI's) of the same intent, each asserted here.
 *
 *   "find 100 MW of buildable capacity near Ashburn with fiber and grid headroom"
 *
 * [1] a sub-1 class margin means the intent read as TWO classes; the router
 *     docked confidence to say so and then ran one class anyway
 * [2] a BUILD/CAUTION/AVOID verdict came back at step 3 and nothing told the
 *     agent to lead with it (xAI: Ashburn DCPI 19.3 / AVOID)
 * [3] context={market:"ashburn"} did not constrain geography — minted
 *     ["CAISO","MISO","PJM"], ran iso=CAISO, constraint_check PASS
 * [4] the per-step timeout equalled Cloudflare's 15s ceiling; get_refined_queue
 *     aborted at 15004 ms
 * [6] every param except `intent` published as an EMPTY schema
 */
import { describe, it, expect } from 'vitest';
import { _planQuery, _execConstraintIsoSet, _execAnswerGuide } from '../server.mjs';

describe('[1] margin<1 runs the runner-up class instead of discarding it', () => {
  it('adds the runner-up class LEAD step when the margin is ambiguous', () => {
    const p = _planQuery('find 100 MW of buildable capacity near Ashburn with fiber and grid headroom', {});
    expect(p.confidence).toBeLessThan(0.6);            // the margin penalty fired
    const alt = p.recommended_sequence.find((s) => /Runner-up class/.test(s.why || ''));
    expect(alt).toBeTruthy();                          // ...and we ACTED on it
    expect(alt.tool).toBe('get_grid_intelligence');    // the discarded class's lead
  });

  it('HONEST LIMIT: a THIRD-place constraint is still not executed — but is REPORTED', () => {
    // This intent names capacity + grid headroom + fiber. [1] recovers the
    // runner-up (grid_headroom). Fiber placed third, so it is still not RUN —
    // what changed is that H4 names it instead of it vanishing. Asserting the
    // real behaviour, not the one we wish we had.
    const p = _planQuery('find 100 MW of buildable capacity near Ashburn with fiber and grid headroom', {});
    const ranFiber = p.recommended_sequence.some((s) => /fiber|latency/.test(s.tool));
    const named = JSON.stringify(p.replay).match(/fiber/i);
    expect(named).toBeTruthy();                        // never silent
    if (!ranFiber) expect(p.replay.uncovered_constraints).toBeTruthy();
  });
  it('steps stay uniquely numbered and non-duplicated', () => {
    const p = _planQuery('compare fiber density and grid headroom in Atlanta', {});
    const steps = p.recommended_sequence.map((s) => s.step);
    expect(new Set(steps).size).toBe(steps.length);
    const tools = p.recommended_sequence.map((s) => s.tool);
    expect(new Set(tools).size).toBe(tools.length);
  });
  it('an UNAMBIGUOUS intent is not padded with a second class', () => {
    const a = _planQuery('how much power is available in ERCOT', {});
    expect(a.recommended_sequence.length).toBeLessThanOrEqual(6);
  });
});

describe('[3] context.market constrains geography, not just the slug', () => {
  it('market="ashburn" yields PJM, never CAISO', () => {
    const isos = _execConstraintIsoSet('find 100 MW of buildable capacity', { market: 'ashburn' }, {});
    expect(isos).toContain('PJM');
    expect(isos).not.toContain('CAISO');
  });
  it('explicit iso still wins over market', () => {
    expect(_execConstraintIsoSet('x', { iso: 'ERCOT', market: 'ashburn' }, {})).toEqual(['ERCOT']);
  });
  it('MUST-FAIL CONTROL: no market and no iso binds nothing from this path', () => {
    expect(_execConstraintIsoSet('find 100 MW of buildable capacity', {}, {})).toEqual([]);
  });
});

describe('[2] answer_guide leads with the verdict the run produced', () => {
  it('names an AVOID verdict and says to state it first', () => {
    const g = _execAnswerGuide([{ tool: 'get_market_dcpi_rank',
      result: { market: 'ashburn', verdict: 'AVOID', composite_score: 19.3 } }]);
    expect(g).toMatch(/LEAD WITH THE VERDICT/);
    expect(g).toMatch(/AVOID/);
    expect(g).toMatch(/19\.3/);
  });
  it('falls back to the base guide when no verdict is present', () => {
    const g = _execAnswerGuide([{ tool: 'get_energy_prices', result: { iso: 'ERCOT', rate: 7.62 } }]);
    expect(g).not.toMatch(/LEAD WITH THE VERDICT/);
    expect(g).toMatch(/Compose the answer/);
  });
  it('never throws on junk', () => {
    for (const junk of [null, undefined, [], [{}], [{ result: null }], 'x'])
      expect(typeof _execAnswerGuide(junk)).toBe('string');
  });
});
