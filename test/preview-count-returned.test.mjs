// A backend `count_returned` counts the rows of the list it returned. Free-preview trimming cuts that list, so
// the number stopped matching the rows on the wire: get_retirement_headroom's free preview said
// count_returned 5 with three rows (Grok 2026-10-06). The honest full length is the list's own
// `_<field>_total_in_<tier>` marker; count_returned now equals the rows present.
// Pure: trimForTrial and _teaseDepth are deterministic, no network.
import { describe, it, expect } from 'vitest';
import { trimForTrial, _teaseDepth } from '../server.mjs';

const rows = (n) => Array.from({ length: n }, (_, i) => ({ generator: { name: 'Plant ' + i, retirement_date: '2027-0' + ((i % 9) + 1) + '-01' }, iso_context: 'PJM' }));
const retirement = (n, count = n) => ({ ok: true, count_returned: count, data: rows(n), meta: { source: 'x' } });

describe('trimForTrial (anonymous / free preview)', () => {
  it('control: the list was trimmed and the marker carries the full length', () => {
    const o = trimForTrial(retirement(5), 'get_retirement_headroom');
    expect(o.data.length).toBeLessThan(5);
    expect(o._data_total_in_pro).toBe(5);
  });
  it('count_returned equals the rows actually present, not the backend count', () => {
    const o = trimForTrial(retirement(5), 'get_retirement_headroom');
    expect(o.count_returned).toBe(o.data.length);
    expect(o.count_returned).toBeLessThan(5);
    expect(o._data_total_in_pro, 'the full count is still told, by its documented marker').toBe(5);
  });
  it('is left alone when nothing was trimmed', () => {
    const o = trimForTrial(retirement(2), 'get_retirement_headroom');
    expect(o.data.length).toBe(2);
    expect(o.count_returned).toBe(2);
    expect(Object.keys(o).some((k) => k.endsWith('_total_in_pro'))).toBe(false);
  });
  it('is left alone when the backend number is not the count of the trimmed list', () => {
    // 10 reported, the list held 5 and was trimmed: the 5 does not equal 10, so this is not a count of that list
    const o = trimForTrial(retirement(5, 10), 'get_retirement_headroom');
    expect(o._data_total_in_pro).toBe(5);
    expect(o.count_returned).toBe(10);
  });
  it('never invents a count_returned, and ignores a non-numeric one', () => {
    const none = trimForTrial({ ok: true, data: rows(5) }, 'get_retirement_headroom');
    expect('count_returned' in none).toBe(false);
    const str = trimForTrial({ ok: true, count_returned: '5', data: rows(5) }, 'get_retirement_headroom');
    expect(str.count_returned).toBe('5');
  });
});

describe('_teaseDepth (keyed free preview)', () => {
  it('count_returned follows the rows kept, and the developer marker keeps the full length', () => {
    const o = _teaseDepth(retirement(5), 3);
    expect(o.data.length).toBe(3);
    expect(o._data_total_in_developer).toBe(5);
    expect(o.count_returned).toBe(3);
  });
  it('is left alone when the list is within the keep limit', () => {
    const o = _teaseDepth(retirement(3), 3);
    expect(o.count_returned).toBe(3);
  });
});
