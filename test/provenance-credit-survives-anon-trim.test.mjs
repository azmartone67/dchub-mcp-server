// provenance-credit-survives-anon-trim.test.mjs: G-2 (2026-10-06).
//
// MEASURED on origin/main before this change (trimForTrial on a payload with a
// 6-entry provenance.sources and a 4-entry provenance.caveats): sources came back
// 3 long with `_sources_total_in_pro: 6`, caveats 3 long. A per-source licence and
// attribution list cut to 3 is a half-true credit, the failure G-1 fixed for
// ercotqueue_provenance. Only `provenance.sources|caveats|fields` are exempt;
// every other array and key under provenance still goes through the normal trim.
// Nothing emits these keys yet. Pure function, no network.
import { describe, it, expect } from 'vitest';
import { trimForTrial, _teaseDepth } from '../server.mjs';

const src = (i) => ({ id: `s${i}`, name: `Source ${i}`, license: 'public domain (US government)', attribution: null });
const cav = (i) => ({ code: 'preliminary', text: `caveat ${i}` });
const payload = () => ({
  results: [1, 2, 3, 4, 5, 6].map((i) => ({ market: `m${i}`, tag: `t${i}` })),
  provenance: {
    provenance_version: 1, source: 'x', basis: 'filed',
    sources: [1, 2, 3, 4, 5, 6].map(src),
    caveats: [1, 2, 3, 4].map(cav),
    fields: { a: { basis: 'filed', source_id: 's1' }, b: { basis: 'filed', source_id: 's2' },
              c: { basis: 'filed', source_id: 's3' }, d: { basis: 'filed', source_id: 's4' } },
    other_list: [1, 2, 3, 4, 5, 6],
  },
});

describe('anon trim keeps the provenance credit lists whole', () => {
  const out = trimForTrial(payload(), 'get_market_intel');

  it('control: the trim is active (results are cut, with the honest total)', () => {
    expect(out.results.length).toBeLessThan(6);
    expect(out._results_total_in_pro).toBe(6);
  });
  it('sources and caveats come back whole', () => {
    expect(out.provenance.sources).toHaveLength(6);
    expect(out.provenance.caveats).toHaveLength(4);
    expect(out.provenance.sources[5]).toEqual(src(6));
  });
  it('fields (label-only entries) is not cut by the normal trim, so it needs no exemption', () => {
    expect(out.provenance.fields).toEqual(payload().provenance.fields);
  });
  it('no stale "_total" marker is left beside a list that was not cut', () => {
    for (const k of ['sources', 'caveats']) {
      expect(out.provenance[`_${k}_total_in_pro`]).toBeUndefined();
      expect(out.provenance[`_${k}_total_unlocks_at`]).toBeUndefined();
    }
  });
  it('the exemption is exact: another list under provenance is still trimmed', () => {
    expect(out.provenance.other_list.length).toBeLessThan(6);
    expect(out.provenance._other_list_total_in_pro).toBe(6);
  });
  it('a payload without these keys is unchanged by the new branch', () => {
    const p = { results: [1, 2, 3, 4, 5, 6].map((i) => ({ market: `m${i}` })),
                provenance: { provenance_version: 1, source: 'x', as_of: '2026-10-03T16:00:00Z' } };
    expect(trimForTrial(p, 'get_market_intel').provenance).toEqual(p.provenance);
  });
  it('a non-object provenance is passed through as before', () => {
    expect(trimForTrial({ results: [], provenance: 'text' }, 'get_market_intel').provenance).toBe('text');
  });
});

describe('the Developer-depth tease (_teaseDepth) keeps the same lists whole', () => {
  const out = _teaseDepth(payload(), 3);
  it('control: the tease is active', () => {
    expect(out.results).toHaveLength(3);
    expect(out._results_total_in_developer).toBe(6);
  });
  it('sources and caveats whole, no stale marker, other lists still cut', () => {
    expect(out.provenance.sources).toHaveLength(6);
    expect(out.provenance.caveats).toHaveLength(4);
    expect(out.provenance._sources_total_in_developer).toBeUndefined();
    expect(out.provenance.other_list).toHaveLength(3);
  });
});
