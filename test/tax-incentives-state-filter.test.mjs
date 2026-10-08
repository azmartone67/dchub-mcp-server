// Grok 2026-10-07: get_tax_incentives(state="OH") returned 3 unrelated rows because the backend list
// route ignores ?state=. The tool narrows the list itself.
import { describe, it, expect } from 'vitest';
import { _filterTaxIncentivesByState as f } from '../server.mjs';

const body = () => ({ status: 'success', count: 3, data: [
  { abbr: 'AL', name: 'Alabama' }, { abbr: 'OH', name: 'Ohio' }, { abbr: 'VA', name: 'Virginia' }] });

describe('_filterTaxIncentivesByState', () => {
  it('keeps only the asked state, by code or name, any case', () => {
    for (const s of ['OH', 'oh', ' Ohio ']) {
      const r = f(body(), s);
      expect(r.data.map((x) => x.abbr)).toEqual(['OH']);
      expect(r.count).toBe(1);
      expect(r.state).toBe('OH');
    }
  });
  it('an unknown state is an empty answer with a note, not the unfiltered list', () => {
    const r = f(body(), 'ZZ');
    expect(r.data).toEqual([]);
    expect(r.count).toBe(0);
    expect(r.state_note).toMatch(/2-letter/);
  });
  it('no state or a non-list body passes through untouched', () => {
    expect(f(body(), undefined).data).toHaveLength(3);
    expect(f({ error: 'x' }, 'OH')).toEqual({ error: 'x' });
    const noIdentity = { data: [{ name: 'Site 0', score: 1 }] };
    expect(f(noIdentity, 'OH')).toBe(noIdentity);
  });
});
