/**
 * A typed ISO is SCOPE, not evidence about the question — issue #209.
 *
 * Reported as "typed `market` does not bind". It binds fine. What actually
 * happened, measured live 2026-08-21:
 *
 *   market+capacity, no iso  -> class capacity_search, minted slug:["ashburn"]
 *   market+capacity+iso=PJM  -> class grid_headroom,   NO slug
 *
 * `d.iso` gives grid_headroom +1.5, enough to overturn a class the intent text
 * had already established — and grid_headroom's sequence is ISO-scoped, so the
 * market slug stopped being minted. The caller got a worse plan for supplying
 * MORE correct information, which is the opposite of what anyone would test.
 *
 * The rule this pins: scope may RESCUE an intent the text could not route at
 * all; it may never OVERRULE one the text did route.
 *
 * Pure planner functions. No network, no DB, no server boot.
 */
import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals } from '../server.mjs';

const ASHBURN = 'find 100 MW of buildable capacity near Ashburn with fiber and grid headroom';
const cls = (intent, ctx) => _planQuery(intent, ctx || {}).intent_class;

describe('a typed ISO is scope, not intent evidence (#209)', () => {
  it('does not let a typed ISO overturn the class the text established', () => {
    // THE DEFECT. Same sentence; the only difference is scope the caller typed.
    expect(cls(ASHBURN)).toBe('capacity_search');
    expect(cls(ASHBURN, { iso: 'PJM' })).toBe('capacity_search');
  });

  it('keeps the market-scoped step that mints the slug', () => {
    // The slug vanished because grid_headroom's sequence is ISO-scoped. Pinning
    // the class alone would not catch a future sequence edit that drops it.
    const seq = _planQuery(ASHBURN, { iso: 'PJM' }).recommended_sequence.map((s) => s.tool);
    expect(seq).toContain('get_market_dcpi_rank');
  });

  it('still lets scope RESCUE an intent the text cannot route', () => {
    // The boost's legitimate job — do not throw it away fixing the defect.
    expect(cls('what is the situation')).toBe('unknown');
    expect(cls('what is the situation', { iso: 'PJM' })).toBe('grid_headroom');
  });

  it('still treats an ISO NAMED IN THE TEXT as evidence', () => {
    // Naming the operator IS a grid question — that is what the +1.5 was for.
    expect(_planSignals('grid headroom in PJM', {}).isoFromText).toBe('PJM');
    expect(cls('grid headroom in PJM')).toBe('grid_headroom');
  });

  it('separates a typed ISO from a text ISO in the signals', () => {
    const typed = _planSignals('find 100 MW near Ashburn', { iso: 'PJM' });
    expect(typed.iso).toBe('PJM');          // unchanged — argument binding still works
    expect(typed.isoFromText).toBeNull();   // but it is NOT evidence about the question
    const spoken = _planSignals('capacity in ERCOT', {});
    expect(spoken.iso).toBe('ERCOT');
    expect(spoken.isoFromText).toBe('ERCOT');
  });

  it('leaves the other context boosts alone', () => {
    // Only the ISO boost was conditioned; coords/market/comparePair are untouched.
    expect(cls('site at 39.04,-77.48')).toBe('site_analysis');
    expect(cls('compare phoenix vs columbus')).toBe('market_comparison');
  });
});
