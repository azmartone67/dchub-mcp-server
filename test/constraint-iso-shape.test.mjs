// constraint-iso-shape.test.mjs — r-constraint-iso-shape (2026-08-11)
//
// constraint_iso is the field that PROVES an answer stayed inside the
// geography the user asked for. It was itself polymorphic — a bare string when
// exactly one ISO resolved, an array otherwise. Same defect class as the
// citation string/object break, in the honesty field.
//
// Observed live, same deploy, same intent shape:
//     "…in Texas" → constraint_iso ["ERCOT"]     (array)
//     "…in Ohio"  → constraint_iso "PJM"         (string)
//
// What a polymorphic geography proof costs a caller — both of these read as
// working code and are silently wrong on the string arm:
//     constraint_iso.length            → 3 for "PJM" (characters, not ISOs)
//     constraint_iso.includes("PJ")    → true (substring, not membership)
//
// And in combination with the anonymous trim it is worse than it looks: Texas
// resolves to FOUR ISOs (ERCOT/SPP/MISO/WECC), the trim truncates the array to
// one and adds _constraint_iso_total_in_pro. So a free-tier caller cannot tell
// "one ISO" from "four, trimmed" by shape alone — the array is not exhaustive
// and the _total_in_pro key is the only tell.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { _execConstraintIsoSet, _planSignals, _STATE_ISO_META } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const isoSet = (intent) => _execConstraintIsoSet(intent, null, _planSignals(intent));

describe('the underlying resolver already returns an array', () => {
  it('single-ISO and multi-ISO states both come back as arrays', () => {
    const ohio = isoSet('rank markets in Ohio');       // one ISO
    const texas = isoSet('rank markets in Texas');     // four
    expect(Array.isArray(ohio)).toBe(true);
    expect(Array.isArray(texas)).toBe(true);
    expect(ohio).toEqual(['PJM']);
    expect(texas.length).toBeGreaterThan(1);
  });

  it('the divergence was introduced at EMISSION, not resolution', () => {
    // Worth pinning: the resolver was always consistent. A length-based
    // scalar/array branch downstream is what made the published field
    // polymorphic — so the fix belongs at the emission site, not here.
    expect(_STATE_ISO_META.OH.length).toBe(1);
    expect(_STATE_ISO_META.TX.length).toBeGreaterThan(1);
  });
});

describe('emission is unconditionally an array', () => {
  it('no length-based scalar/array branch survives', () => {
    // The exact shape that produced the bug.
    expect(SRC).not.toMatch(/constraint_iso:\s*constraintIsoSet\.length === 1/);
    expect(SRC).toMatch(/constraint_iso:\s*\[\.\.\.constraintIsoSet\]/);
  });

  it('still omits the key entirely when no geography resolved', () => {
    // An empty array would be a claim ("we constrained to nothing"); absence
    // is the honest shape for "the intent named no geography".
    expect(SRC).toMatch(/\.\.\.\(constraintIsoSet\.length\s*\n?\s*\?\s*\{ constraint_iso/);
    expect(isoSet('rank markets for a 200 MW AI campus')).toEqual([]);
  });

  it('copies rather than aliasing the working set', () => {
    // constraintIsoSet is mutated during execution (mint rejection reads it).
    // Publishing the live reference would let a later push change what the
    // caller was told we constrained to.
    expect(SRC).toContain('constraint_iso: [...constraintIsoSet]');
  });
});

describe('what a caller can and cannot conclude', () => {
  it('membership is safe on an array and unsafe on a string', () => {
    // Documents WHY this matters, executably. The string arm returned true
    // for a partial ISO name; the array arm cannot.
    expect('PJM'.includes('PJ')).toBe(true);          // the old, wrong answer
    expect(['PJM'].includes('PJ')).toBe(false);       // the correct one
    expect(['PJM'].includes('PJM')).toBe(true);
  });

  it('length means ISOs on an array and characters on a string', () => {
    expect('PJM'.length).toBe(3);                     // the old trap
    expect(['PJM'].length).toBe(1);
  });

  it('an array is NOT proof the list is exhaustive at free tier', () => {
    // The trim truncates and flags. Callers must read _constraint_iso_total_in_pro
    // before treating the array as the complete constraint set — asserted here
    // so the caveat travels with the fix rather than living only in a brief.
    expect(SRC).toContain('_constraint_iso_total_in_pro');
  });
});
