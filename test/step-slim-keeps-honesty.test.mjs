// ── truncating a step must not truncate its honesty ────────────────────────
//
// FOUND LIVE minutes after backend #3327 deployed and caused it.
//
// execute_plan slims any step result over 6KB. It did that by replacing the
// object with a 1,200-character PREFIX OF ITS JSON — and JSON key order decides
// what a prefix keeps. #3327 added `excluded_top` (the AVOID rows) to the
// canvas, pushing the Ohio response past 6KB for the first time:
//
//   execute_plan "rank Ohio markets for a 100 MW AI build"
//     step1 -> {truncated, preview, note}
//     preview cut off inside `constraint_coverage`; `empty_result` sorts after
//     it and was GONE.
//
// The front door lost the block explaining WHY the shortlist is empty — the
// exact thing three agents asked for — as a side effect of adding data. The
// direct tool call was unaffected; only the planner path regressed.
import { describe, it, expect } from 'vitest';
import { _slimStepResult } from '../server.mjs';

const OHIO_ROW = (n) => ({ market: 'Market' + n, slug: 'market-' + n, state: 'OH',
  iso: 'PJM', verdict: 'AVOID', composite_score: 29 - n / 10, excess_power_score: 40,
  constraint_score: 18, time_to_power_months: 42,
  dcpi_url: 'https://dchub.cloud/dcpi/market-' + n });

// A canvas response shaped like the live one, deliberately over the 6KB limit.
const FAT = {
  applied_filters: { region: 'OH', verdicts: ['BUILD', 'CAUTION'] },
  citation: { source: 'DC Hub', cite_as: 'DC Hub, dchub.cloud' },
  constraint_coverage: { capacity_mw: { applied: false, reason: 'x'.repeat(500) } },
  empty_result: {
    reason: 'no_market_met_the_verdict_filter',
    markets_in_region: 9,
    verdict_counts: { BUILD: 0, CAUTION: 0, AVOID: 9 },
    excluded_top: Array.from({ length: 12 }, (_, i) => OHIO_ROW(i)),
    excluded_total: 9,
    next_best_action: { action: 'answer_from_excluded_top', reason: 'y'.repeat(200) },
  },
  matched: 0,
  universe: 323,
  ok: true,
  synthesis: { locked: true, message: 'z'.repeat(3000) },   // the bulk
  shortlist: [],
};

describe('_slimStepResult', () => {
  it('a payload under the limit is returned untouched, same object', () => {
    const small = { ok: true, matched: 2 };
    expect(_slimStepResult(small, 'x')).toBe(small);
  });

  // ★ The regression this exists for.
  it('keeps empty_result STRUCTURED when it slims — not inside a string preview', () => {
    const s = _slimStepResult(FAT, 'site_selection_canvas');
    expect(s.truncated).toBe(true);
    expect(s.empty_result).toBeTruthy();
    expect(s.empty_result.reason).toBe('no_market_met_the_verdict_filter');
    expect(s.empty_result.verdict_counts).toEqual({ BUILD: 0, CAUTION: 0, AVOID: 9 });
    expect(s.empty_result.next_best_action.action).toBe('answer_from_excluded_top');
  });

  it('keeps every other block that states what the answer does not cover', () => {
    const s = _slimStepResult(FAT, 'site_selection_canvas');
    for (const k of ['constraint_coverage', 'applied_filters', 'citation', 'matched', 'ok']) {
      expect(s[k], `slim dropped ${k}`).toBeDefined();
    }
    expect(s.constraint_coverage.capacity_mw.applied).toBe(false);
  });

  it('still actually slims — the bulk goes to the preview', () => {
    const s = _slimStepResult(FAT, 'site_selection_canvas');
    expect(JSON.stringify(s).length).toBeLessThan(JSON.stringify(FAT).length);
    expect(typeof s.preview).toBe('string');
  });

  it('the preview carries the REST, never a copy of what was already kept', () => {
    const s = _slimStepResult(FAT, 'site_selection_canvas');
    expect(s.preview).not.toContain('no_market_met_the_verdict_filter');
    expect(s.preview).toContain('synthesis');
  });

  it('rows are the recoverable part, so they are trimmed before the block is', () => {
    // 60 rows makes the kept block itself oversized; excluded_top gives way,
    // empty_result does not.
    const huge = { ...FAT, empty_result: { ...FAT.empty_result,
      excluded_top: Array.from({ length: 60 }, (_, i) => OHIO_ROW(i)) } };
    const s = _slimStepResult(huge, 'site_selection_canvas');
    expect(s.empty_result.reason).toBe('no_market_met_the_verdict_filter');
    expect(s.empty_result.excluded_top.length).toBe(3);
    expect(s.empty_result.verdict_counts).toEqual({ BUILD: 0, CAUTION: 0, AVOID: 9 });
  });

  it('the note tells the caller the coverage blocks were NOT truncated', () => {
    expect(_slimStepResult(FAT, 'site_selection_canvas').note)
      .toMatch(/does and does not cover/);
  });

  it('never throws on a malformed step result', () => {
    for (const bad of [null, undefined, 'a string', 42, []]) {
      expect(() => _slimStepResult(bad, 'x')).not.toThrow();
    }
  });
});
