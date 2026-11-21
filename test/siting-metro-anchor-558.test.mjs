// siting-metro-anchor-558.test.mjs — planner 5.58 (Grok QA 2026-11-20 item 1; owner 2026-11-20: "anchor
// fastest-site-near-X asks to the metro"). Pure functions, no network.
//
// "fastest 250 MW data center site near Chicago Illinois within 30 months" routed to siting_search and its find_sites
// step searched state=IL, which ranks Chicago's AVOID markets last: the areas named were downstate, up to 170 km out.
// A one-state siting plan whose question puts the site NEAR one named metro now searches around it (market=<slug>,
// the state kept as the backend's fallback). "In Dallas: any faster sites?" asks for alternatives, so it stays
// state-wide, as do two named markets, several states and a region of a state.
import { describe, it, expect } from 'vitest';
import { _planQuery } from '../server.mjs';
import { nearMetroSlug, nearMetroRadiusKm } from '../lib/metro-anchor.mjs';

const EXACT = 'fastest 250 MW data center site near Chicago Illinois within 30 months';
const fsArgs = (p) => (p.recommended_sequence.find((s) => s.tool === 'find_sites') || {}).args_hint;
const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint]));

describe('nearMetroSlug', () => {
  for (const [t, slugs, want] of [
    ['site near Chicago', ['chicago'], 'chicago'],
    ['around Salt Lake City, Utah', ['salt-lake-city'], 'salt-lake-city'],
    ['close to Columbus, OH', ['columbus-oh'], 'columbus-oh'],
    ['just outside Atlanta', ['atlanta'], 'atlanta'],
    ['within 50 miles of Phoenix', ['phoenix'], 'phoenix'],
    ['an hour from Dallas', ['dallas'], 'dallas'],
    ['in the Dallas area', ['dallas'], 'dallas'],
    ['Chicago-area substations', ['chicago'], 'chicago'],
    ['Phoenix metro sites', ['phoenix'], 'phoenix'],
    ['50 MW in Dallas, TX: any faster sites?', ['dallas'], null],
    ['near Eagle Mountain or Salt Lake City', ['eagle-mountain', 'salt-lake-city'], null],
    ['near Chicago', [], null],
    ['near Chicagoland', ['chicago'], null],
    ['near the lake, Chicago later', ['chicago'], null],
  ]) {
    it(`${JSON.stringify(t)} -> ${want}`, () => { expect(nearMetroSlug(t, slugs)).toBe(want); });
  }
  it('never throws', () => { expect(nearMetroSlug(null, null)).toBe(null); expect(nearMetroSlug('near x', [42])).toBe(null); });
});

describe('nearMetroRadiusKm', () => {
  it('miles and km, clamped 5-400', () => {
    expect(nearMetroRadiusKm('within 50 miles of Phoenix')).toBe(80);
    expect(nearMetroRadiusKm('within 30 km of Dallas')).toBe(30);
    expect(nearMetroRadiusKm('within 1 km of Dallas')).toBe(5);
    expect(nearMetroRadiusKm('within 900 miles of Dallas')).toBe(400);
    expect(nearMetroRadiusKm('near Dallas within 24 months')).toBe(null);
  });
});

describe('planner 5.58: a siting search near one named metro is centred on it', () => {
  it('THE EXACT GROK INTENT: find_sites market=chicago, state IL beside it; canvas and timeline stay state-wide', () => {
    const p = _planQuery(EXACT, {});
    expect(p.intent_class, show(p)).toBe('siting_search');
    expect(fsArgs(p), show(p)).toEqual({ market: 'chicago', state: 'IL' });
    const fs = p.recommended_sequence.find((s) => s.tool === 'find_sites');
    expect(fs.metro_anchor).toBe('chicago');
    expect(fs.why).toMatch(/around chicago, the metro the question names \(find_sites market=chicago: centred on the market, 60 km\)/);
    expect(fs.why).toMatch(/falls back to IL/);
    expect(p.recommended_sequence.find((s) => s.tool === 'site_selection_canvas').args_hint.region).toBe('IL');
    expect(p.recommended_sequence.find((s) => s.tool === 'get_power_availability_timeline').args_hint.state).toBe('IL');
    expect(p.recommended_sequence[0]).toMatchObject({ tool: 'get_market_dcpi_rank', args_hint: { market_slug: 'chicago' } });
  });

  it('other proximity wordings anchor too, each in its own state', () => {
    for (const [q, slug, st] of [
      ['fastest site for 200 MW near Atlanta within 24 months', 'atlanta', 'GA'],
      ['quickest 100 MW site in the Dallas area within 24 months', 'dallas', 'TX'],
      ['fastest 300 MW data center site near Dallas Texas within 36 months', 'dallas', 'TX'],
    ]) {
      const p = _planQuery(q, {});
      expect(p.intent_class, q + ' ' + show(p)).toBe('siting_search');
      expect(fsArgs(p), q).toEqual({ market: slug, state: st });
    }
  });

  it('a stated radius reaches find_sites', () => {
    const p = _planQuery('fastest 300 MW site within 50 miles of Phoenix by 2029', {});
    expect(fsArgs(p), show(p)).toEqual({ market: 'phoenix', state: 'AZ', radius_km: 80 });
  });

  it('no deadline and no time-to-power words: the class 5.44 / 5.46 pinned stands (it runs no find_sites to anchor)', () => {
    const p = _planQuery('fastest place to get 300 MW near Dallas', {});
    expect(p.intent_class).not.toBe('siting_search');
    expect(p.recommended_sequence.map((s) => s.tool)).not.toContain('find_sites');
  });

  it('"in Dallas: any faster sites?" asks for alternatives: the search stays state-wide', () => {
    const p = _planQuery('50 MW data center in Dallas, TX: time to power, any faster sites?', {});
    expect(p.intent_class).toBe('siting_search');
    expect(fsArgs(p)).toEqual({ state: 'TX' });
  });

  it('two named markets, several states and a region of a state keep their searches', () => {
    expect(fsArgs(_planQuery('100 MW data center in Eagle Mountain or Salt Lake City, Utah: what is the time to power and are there faster sites?', {})))
      .toEqual({ state: 'UT' });
    const multi = _planQuery('Find sites for a 100 MW data center in Texas or Arizona, energized by 2028', {});
    expect(multi.recommended_sequence.filter((s) => s.tool === 'find_sites').map((s) => s.args_hint)).toEqual([{ state: 'TX' }, { state: 'AZ' }]);
    const region = _planQuery('how soon can I get 300 MW in western Pennsylvania', {});
    const rf = fsArgs(region);
    if (rf) expect(rf.market).toBeUndefined();
  });

  it('a metro outside the plan\'s state never centres that state\'s search (market=dallas with state=AZ finds nothing)', () => {
    const p = _planQuery('fastest 100 MW site near Dallas or anywhere in Arizona within 24 months', {});
    for (const s of p.recommended_sequence.filter((x) => x.tool === 'find_sites')) expect(s.args_hint.market, show(p)).toBeUndefined();
  });

  it('a several-state fan-out keeps one state-wide search per state, even with one metro named', () => {
    const p = _planQuery('fastest 200 MW site near Phoenix, Arizona or Nevada, energized within 30 months', {});
    expect(p.recommended_sequence.filter((s) => s.tool === 'find_sites').map((s) => s.args_hint), show(p))
      .toEqual([{ state: 'AZ' }, { state: 'NV' }]);
  });

  it('a one-market timing question with no siting superlative keeps its class', () => {
    const p = _planQuery('how fast can 300 MW near Abilene TX get power', {});
    expect(p.intent_class).not.toBe('siting_search');
  });
});
