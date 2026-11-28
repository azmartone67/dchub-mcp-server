// canvas-coverage-notes-deadline-1128 — plan_query coverage_notes describe the
// site_selection_canvas deadline as the backend serves it since be#9525
// (owner 2026-11-27): max_months applies for every caller; only the list of
// markets the cut removed needs full access. The old line said the cut was not
// applied below full access, which stopped being true when be#9525 went live.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const notes = [...SRC.matchAll(/coverage_notes: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])
  .filter((n) => n.includes('site_selection_canvas'));

describe('canvas deadline in plan_query coverage_notes', () => {
  it('finds the canvas coverage note', () => { expect(notes.length).toBeGreaterThan(0); });
  it('says the max_months cut applies for every caller', () => {
    for (const n of notes.filter((x) => x.includes('max_months'))) {
      expect(n).toContain('applies the max_months cut for every caller');
    }
    expect(notes.some((n) => n.includes('max_months'))).toBe(true);
  });
  it('never says the cut was not applied', () => {
    for (const n of notes) expect(n).not.toMatch(/cut was not applied|max_months cut, need/);
  });
});
