// The canon snapshot must copy EVERY phrase the feed publishes, not a list of
// names somebody remembered to extend.
//
// MEASURED 2026-09-20. /api/v1/canon/phrases published eleven string fields.
// scripts/refresh-canon-phrases.mjs copied five. Dropped: assets,
// dcpi_countries, fiber_routes, news_sources, transmission_lines.
//
// The visible cost was scripts/smithery_description.txt — the blurb a human
// pastes into the Smithery listing — publishing "64,000+ fiber routes" against
// a measured 58,183. Not stale: OVER by ~5,800, on a public listing, which is
// the canonical_floor_above_live_reality class the whole canon stack exists to
// prevent.
//
// ★ THE SHAPE OF THE ORIGINAL FIX IS WHY IT RECURRED. On 2026-09-09
// `substations` was added to the list, one name at a time, under a comment
// that already stated the general rule: "A field the source publishes and the
// snapshot drops is a number nothing owns." Six fields were still dropped the
// moment that fix landed. Eligibility is now decided by SHAPE; names survive
// only as a floor. test_a_field_the_feed_adds_later_needs_no_code_change is
// the guard that makes the third recurrence impossible rather than unlikely.
import { describe, it, expect } from 'vitest';
import { selectPhrases } from '../scripts/refresh-canon-phrases.mjs';

// The real body shape, measured 2026-09-20.
const LIVE = {
  ok: true,
  source: 'resolve_public_floors (live)',
  tools: 91,
  facilities: '22,900+', countries: '170+', deals: '2,200+', markets: '300+',
  substations: '127,000+', fiber_routes: '58,000+', transmission_lines: '95,000+',
  assets: '330,000+', dcpi_countries: '30+', news_sources: '2,000+',
  dcpi_regions: 'North America, Europe and Asia-Pacific',
};

const OLD_FIVE = ['facilities', 'countries', 'deals', 'markets', 'substations'];

describe('canon snapshot copies every published phrase', () => {
  it('copies all ten quantities, not the five it used to', () => {
    const { fields, bad } = selectPhrases(LIVE, null);
    expect(bad).toEqual([]);
    expect(Object.keys(fields).sort()).toEqual([
      'assets', 'countries', 'dcpi_countries', 'deals', 'facilities',
      'fiber_routes', 'markets', 'news_sources', 'substations',
      'transmission_lines',
    ]);
    // the five that already worked must not have been lost in the generalising
    for (const k of OLD_FIVE) expect(fields[k]).toBe(LIVE[k]);
    // and the one that mattered
    expect(fields.fiber_routes).toBe('58,000+');
  });

  it('skips prose, because dcpi_regions is a sentence and not a quantity', () => {
    const { fields, bad } = selectPhrases(LIVE, null);
    expect(fields.dcpi_regions).toBeUndefined();
    expect(bad).toEqual([]);          // prose is skipped, never a complaint
    expect(fields.source).toBeUndefined();
  });

  it('a field the feed adds later needs no code change here', () => {
    // ★ THE ANTI-RECURRENCE GUARD. If this ever fails, someone has put the
    // names back and the 2026-09-09 mistake is live again.
    const withNew = { ...LIVE, cable_landings: '1,900+' };
    const { fields, bad } = selectPhrases(withNew, null);
    expect(bad).toEqual([]);
    expect(fields.cable_landings).toBe('1,900+');
  });

  it('refuses an empty body instead of writing an empty snapshot', () => {
    // A scan that can find nothing needs a floor: discovery by shape would
    // otherwise yield zero fields, zero complaints, and overwrite a good file.
    const { bad } = selectPhrases({ ok: true, source: 'x (live)', tools: 91 }, null);
    expect(bad.length).toBeGreaterThan(0);
    for (const k of OLD_FIVE) expect(bad).toContain(k);
  });

  it('refuses a quantity that has turned into prose', () => {
    // Distinct from dcpi_regions: this field WAS a number in the committed
    // snapshot. Silently skipping it would republish the old value under a
    // green check — the exact silent-fallback failure this suite already
    // records for the marker predicate.
    const prev = { facilities: '22,100+', fiber_routes: '58,000+' };
    const corrupt = { ...LIVE, fiber_routes: 'lots' };
    const { fields, bad } = selectPhrases(corrupt, prev);
    expect(fields.fiber_routes).toBeUndefined();
    expect(bad.join(' ')).toContain('fiber_routes');
  });

  it('does not complain about prose that was always prose', () => {
    const prev = { dcpi_regions: 'North America and Europe' };
    const { bad } = selectPhrases(LIVE, prev);
    expect(bad).toEqual([]);
  });
});
