import { describe, it, expect } from 'vitest';
import { detectGating, buildProvenance, buildCitation } from '../lib/attribution.mjs';

// REST /api/v1/markets/list (free tier): count 10, total 132, locked 122 — read as
// completeness "full" / withheld [] because only array/object/true `locked` was recognised.
const list = () => ({
  count: 3, total: 132, locked: 129, tier: 'free',
  data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
});

describe('numeric locked = count of withheld rows', () => {
  it('is gating, with shown/total taken from count/total', () => {
    const g = detectGating(list());
    expect(g).not.toBeNull();
    expect(g.withheld_fields).toContain('data');
    expect(g.shown).toBe(3);
    expect(g.total).toBe(132);
    expect(g.withholding_proven).toBe(true);
  });
  it('the provenance block is partial_preview and the cite_as says 3 of 132', () => {
    const p = buildProvenance(list(), {});
    expect(p.completeness).toBe('partial_preview');
    expect(buildCitation(list(), {}, p).cite_as).toMatch(/3 of 132 shown/);
  });
  it('without a tying count/total it still counts as withholding', () => {
    const g = detectGating({ locked: 7, data: [1] });
    expect(g.withholding_proven).toBe(true);
    expect(g.reasons.join(' ')).toMatch(/7 row\(s\) locked/);
  });
  it('controls: locked 0, or absent, is not gating', () => {
    expect(detectGating({ count: 3, total: 3, locked: 0, data: [1, 2, 3] })).toBeNull();
    expect(detectGating({ count: 3, total: 3, data: [1, 2, 3] })).toBeNull();
  });
});
