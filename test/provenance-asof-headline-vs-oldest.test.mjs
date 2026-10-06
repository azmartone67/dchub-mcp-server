import { describe, it, expect } from 'vitest';
import { buildProvenance, mergeProvenance } from '../lib/attribution.mjs';

// get_grid_data 2026-10-06: backend as_of = demand hour won the merge while the derived
// basis said "OLDEST of 23" and as_of_range.oldest was 2025-12-17 — one block, two answers.
const payload = {
  extended_metrics: {
    capacity_price: { as_of: '2025-12-17T00:00:00+00:00', value: 333.44 },
    lmp: { as_of: '2026-10-06T09:10:00+00:00', value: 13.94 },
    demand: { as_of: '2026-10-06T08', value: 1 },
  },
};
const NOW = Date.parse('2026-10-06T09:18:00Z');

describe('mergeProvenance: backend headline as_of vs derived oldest', () => {
  it('does not call the headline as_of "OLDEST" when older inputs exist', () => {
    const derived = buildProvenance(payload, { now: NOW });
    expect(derived.as_of.startsWith('2025-12-17')).toBe(true);
    const m = mergeProvenance({ as_of: '2026-10-06T08', source: 'EIA' }, derived);
    expect(m.as_of).toBe('2026-10-06T08');
    expect(m.as_of_basis).not.toMatch(/^OLDEST/);
    expect(m.as_of_basis).toMatch(/headline/);
    expect(m.as_of_basis).toContain(derived.as_of);
    expect(m.as_of_range.oldest.startsWith('2025-12-17')).toBe(true);
  });
  it('control: a backend as_of equal to the derived oldest keeps the derived basis', () => {
    const derived = buildProvenance(payload, { now: NOW });
    const m = mergeProvenance({ as_of: derived.as_of }, derived);
    expect(m.as_of_basis).toBe(derived.as_of_basis);
  });
  it('control: a backend that states its own as_of_basis keeps it', () => {
    const derived = buildProvenance(payload, { now: NOW });
    const m = mergeProvenance({ as_of: '2026-10-06T08', as_of_basis: 'mine' }, derived);
    expect(m.as_of_basis).toBe('mine');
  });
});
