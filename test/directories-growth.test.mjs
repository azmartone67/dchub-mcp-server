// /mcp/directories growth line + rank link (owner ask 2026-10-23: show the
// growing list and where DC Hub ranks). Growth counts from added_at, the day a
// row entered canonical/directories.json; the first day is a launch baseline.
import { describe, it, expect } from 'vitest';
import {
  loadDirectories, directoryGrowth, growthSentence, directoriesJson, renderDirectoriesPage, STANDING_RANKS_URL,
} from '../lib/directories-page.mjs';

const NOW = new Date('2026-10-24T02:00:00Z');
const row = (id, added_at, status = 'live') => ({ id, name: id, status, listing_url: `https://${id}.dev`, added_at });
const DATA = { directories: [
  row('a', '2026-10-09'), row('b', '2026-10-09'),
  row('c', '2026-10-15'), row('d', '2026-10-20'),
  row('e', '2026-10-21', 'pending'),          // not live: never counted
  row('f', undefined),                        // live, undated
] };

describe('directoryGrowth', () => {
  it('splits the launch baseline from what was added after it', () => {
    expect(directoryGrowth(DATA, NOW)).toEqual({
      live: 5, tracked_since: '2026-10-09', at_start: 2, added_since_start: 2,
      last_7_days: 1, last_30_days: 2, undated: 1,
    });
  });

  it('never counts the baseline day as recent growth', () => {
    const g = directoryGrowth({ directories: [row('a', '2026-10-20'), row('b', '2026-10-20')] }, NOW);
    expect(g).toMatchObject({ at_start: 2, added_since_start: 0, last_7_days: 0 });
  });

  it('with nothing dated there is no growth claim at all', () => {
    const g = directoryGrowth({ directories: [row('a', undefined)] }, NOW);
    expect(g.tracked_since).toBeNull();
    expect(growthSentence(g)).toBe('');
  });
});

describe('the page and its JSON twin', () => {
  it('say how the list grew in one sentence', () => {
    expect(growthSentence(directoryGrowth(DATA, NOW)))
      .toBe('5 live listings: 2 when this list started on 9 Oct 2026, +2 since (+1 in the last 7 days).');
    const html = renderDirectoriesPage(DATA, { tools: 94, now: NOW });
    expect(html).toContain('<p class="growth">5 live listings: 2 when this list started on 9 Oct 2026');
    expect(html).toContain(`href="${STANDING_RANKS_URL}"`);
  });

  it('the JSON twin carries the count, the growth and each row\'s added_at', () => {
    const j = directoriesJson(DATA);
    expect(j.count).toBe(5);
    expect(j.growth.at_start).toBe(2);
    expect(j.ranks).toBe('https://dchub.cloud/mcp-standing#ranks');
    expect(j.directories.find((d) => d.id === 'c').added_at).toBe('2026-10-15');
    expect(j.directories.find((d) => d.id === 'f').added_at).toBeNull();
  });

  it('every row in the real file carries a valid added_at', () => {
    const bad = loadDirectories().directories.filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d.added_at || ''));
    expect(bad.map((d) => d.id), 'set added_at (YYYY-MM-DD, the day the row is added) on every new row').toEqual([]);
  });
});
