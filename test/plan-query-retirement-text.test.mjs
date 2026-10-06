// plan_query text that said things that were not true (Grok re-probe, 2026-10-06):
//  1. get_retirement_headroom sat in the grid-headroom class's alternatives with a FIXED reason, "The intent
//     did not mention retirements", which printed for "retirement headroom: which retiring power plants in
//     PJM ...". The reason now follows the intent text.
//  2. The plan-only note said "there is no execute_plan tool to wait for". execute_plan exists (the same
//     payload's operator_note says so), so the note no longer claims otherwise.
// Pure: _planQuery is deterministic, no network. This does NOT change routing (a retirement question still
// plans the grid-headroom class); it only makes the explanation true.
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';

const MENTIONS = [
  'retirement headroom: which retiring power plants in PJM free up grid headroom',
  'which plants retiring in PJM in the next 24 months',
  'grid headroom in ERCOT after coal plant retirements',
];
const PLAIN = 'how much grid headroom is there in PJM';
const retAlt = (p) => (p.alternatives || []).find((a) => a.tool === 'get_retirement_headroom');

describe('the retirement alternative is explained from the intent', () => {
  it('control: every case lands in the grid-headroom class and lists the retirement alternative', () => {
    for (const t of [...MENTIONS, PLAIN]) {
      const p = _planQuery(t, {});
      expect(p.intent_class, t).toBe('grid_headroom');
      expect(retAlt(p), t).toBeTruthy();
    }
  });
  it('an intent that mentions retirements is no longer told it did not', () => {
    for (const t of MENTIONS) {
      const r = retAlt(_planQuery(t, {})).rejected_because;
      expect(r, t).not.toMatch(/did not mention retirements/);
      expect(r, t).toMatch(/mentioned retirements/);
      expect(r, t).toMatch(/call get_retirement_headroom directly/);
    }
  });
  it('an intent that does not mention retirements keeps the original reason, byte for byte', () => {
    expect(retAlt(_planQuery(PLAIN, {})).rejected_because)
      .toBe('The intent did not mention retirements — the general headroom read covers the broader question.');
  });
  it('is deterministic: same intent, same plan', () => {
    expect(_planQuery(MENTIONS[0], {})).toEqual(_planQuery(MENTIONS[0], {}));
  });
});

describe('the plan-only note', () => {
  it('no longer says there is no execute_plan tool, and points at it', () => {
    for (const t of [PLAIN, 'zzz completely unrelated gibberish qqq']) {
      const p = _planQuery(t, {});
      for (const note of [p.execution_strategy.note, p.note]) {
        expect(note, t).not.toMatch(/no execute_plan tool/);
        expect(note, t).toMatch(/execute_plan\(intent=/);
        expect(note, t).toMatch(/if it is in your tool list/);
        expect(note, t).toMatch(/only plans; execute the sequence yourself/);   // the phrase plan-query.test.mjs pins
      }
    }
  });
});
