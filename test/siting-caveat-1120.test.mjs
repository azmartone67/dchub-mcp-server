// siting-caveat-1120.test.mjs — planner 5.55 (Grok QA 2026-11-20 P2; owner: "anchor results to the metro and state
// the AVOID caveat"). Pure tests of lib/siting-caveat.mjs; the real server.mjs path is in
// test/find-sites-market-anchor-e2e-1120.test.mjs.
import { describe, it, expect } from 'vitest';
import { sitingCaveat, withSitingCaveat, haversineKm, FAR_KM } from '../lib/siting-caveat.mjs';
import { PLANNER_VERSION } from '../server.mjs';

const CHI = { lat: 41.87, lon: -87.63 };
const cand = (lat, lon, market, verdict) => ({ lat, lon, verdict, market: { market, verdict } });
const DOWNSTATE = [cand(38.9, -89.9, 'St. Louis', 'CAUTION'), cand(38.8, -90.1, 'Madison', 'CAUTION'), cand(39.8, -89.6, 'Springfield', 'CAUTION')];
const NEAR = [cand(41.9, -87.7, 'Chicago', 'AVOID'), cand(42.0, -87.97, 'Elk Grove Village', 'AVOID')];
const dcpi = (verdict = 'AVOID') => ({ tool: 'get_market_dcpi_rank', status: 'gated_preview', args: { market_slug: 'chicago' },
  result: { market_slug: 'chicago', market_name: 'Chicago', iso: 'PJM', verdict, latitude: CHI.lat, longitude: CHI.lon } });
const fs = (result, status = 'executed') => ({ tool: 'find_sites', status, args: {}, result });
const RANKED = { note: 'x', count: 1, markets: [{ market: 'Chicago', slug: 'chicago', iso: 'PJM', verdict: 'AVOID' }] };

describe('the line', () => {
  it('a backend avoid_note leads, first sentence only', () => {
    const c = sitingCaveat([fs({ candidates: NEAR, avoid_note: 'Chicago-area markets read AVOID on the Data Center Power Index (Chicago; PJM), so they rank last: any CAUTION or BUILD area elsewhere ranks ahead of them. These areas are listed because the search is centred on Chicago.' })], null);
    expect(c.line).toBe('Chicago-area markets read AVOID on the Data Center Power Index (Chicago; PJM), so they rank last: any CAUTION or BUILD area elsewhere ranks ahead of them.');
  });

  it('THE REPRO: a state search 100+ km from the named AVOID metro says how far and why Chicago is absent', () => {
    const c = sitingCaveat([dcpi(), fs({ candidates: DOWNSTATE })], null, { namedMarkets: ['chicago'] });
    expect(c.line).toMatch(/^3 of the 3 areas shown sit 100 km or more from Chicago \(up to about 4[0-9]0 km\)\. /);
    expect(c.line).toContain('Chicago-area markets (PJM) read AVOID on the Data Center Power Index (DCPI), so they rank last');
    expect(c.line).toContain('For areas near Chicago, call find_sites market=chicago.');
  });

  it('below full access (a preview result) the distance is said without a figure (mcp#1600)', () => {
    const coarse = DOWNSTATE.map((c) => ({ ...c, coordinate_precision_km: 11 }));
    for (const ex of [[dcpi(), fs({ candidates: coarse })], [dcpi(), fs({ candidates: DOWNSTATE, _gated: true })],
      [dcpi(), fs({ candidates: DOWNSTATE }, 'gated_preview')]]) {
      const c = sitingCaveat(ex, null, { namedMarkets: ['chicago'] });
      expect(c.line).toMatch(/^3 of the 3 areas shown sit well away from Chicago, outside its metro area\. Chicago-area markets \(PJM\) read AVOID/);
      expect(c.line).not.toMatch(/\d\s*km\b/);
    }
    // a full caller's 0.1 km precision keeps the figure
    const full = sitingCaveat([dcpi(), fs({ candidates: DOWNSTATE.map((c) => ({ ...c, coordinate_precision_km: 0.1 })) })], null, { namedMarkets: ['chicago'] });
    expect(full.line).toMatch(/100 km or more from Chicago \(up to about \d+ km\)/);
  });

  it('THE EXACT GROK POINT (41.787197, -89.710625) is far from Chicago', () => {
    const c = sitingCaveat([dcpi(), fs({ candidates: [cand(41.787197, -89.710625, 'Rockford', 'CAUTION'), ...NEAR] })], null, { namedMarkets: ['chicago'] });
    expect(c.line).toMatch(/^One of the 3 areas shown sits 100 km or more from Chicago \(up to about 170 km\)\. /);
  });

  it('far from a named metro that is not AVOID: the distance and the call, no AVOID claim', () => {
    const c = sitingCaveat([dcpi('CAUTION'), fs({ candidates: DOWNSTATE })], null, { namedMarkets: ['chicago-il'] });
    expect(c.line).toMatch(/sit 100 km or more from Chicago/);
    expect(c.line).not.toMatch(/AVOID/);
  });

  it('areas near an AVOID metro: the AVOID line, no distance part', () => {
    const c = sitingCaveat([dcpi(), fs({ candidates: NEAR })], null, { namedMarkets: ['chicago'] });
    expect(c.line).toMatch(/^Chicago-area markets \(PJM\) read AVOID/);
    expect(c.line).not.toMatch(/km or more/);
  });

  it('ranked_after with no named metro names the market and the call', () => {
    const c = sitingCaveat([fs({ candidates: DOWNSTATE, ranked_after: RANKED })], null);
    expect(c.line).toBe('Chicago (PJM, AVOID) ranks after every area listed here on the Data Center Power Index (DCPI), so none of its substations is shown. For areas near one of them, call find_sites market=chicago.');
  });

  it('a market= call far from its own centre is read from anchored_market and the filter', () => {
    const p = { candidates: DOWNSTATE, filter: { lat: CHI.lat, lon: CHI.lon },
      anchored_market: { resolved: true, market: 'Chicago', slug: 'chicago', iso: 'PJM', verdict: 'AVOID', search_centre: 'market_centre' } };
    const c = sitingCaveat([fs(p)], null);
    expect(c.line).toMatch(/from Chicago .* Chicago-area markets \(PJM\) read AVOID/);
  });

  it('a gated preview step counts; a step that did not run does not', () => {
    expect(sitingCaveat([dcpi(), fs({ candidates: NEAR }, 'gated_preview')], null, { namedMarkets: ['chicago'] })).not.toBeNull();
    expect(sitingCaveat([dcpi(), fs({ candidates: NEAR }, 'not_run')], null, { namedMarkets: ['chicago'] })).toBeNull();
  });

  it('nothing to say: near a BUILD/CAUTION metro, no find_sites, or a slimmed string that parses', () => {
    expect(sitingCaveat([dcpi('CAUTION'), fs({ candidates: [cand(41.9, -87.7, 'Chicago', 'CAUTION')] })], null, { namedMarkets: ['chicago'] })).toBeNull();
    expect(sitingCaveat([dcpi()], null, { namedMarkets: ['chicago'] })).toBeNull();
    expect(sitingCaveat([fs(JSON.stringify({ candidates: NEAR, avoid_note: 'Every area listed reads AVOID. More.' }))], null).line)
      .toBe('Every area listed reads AVOID.');
  });

  it('the full result wins over the slimmed one', () => {
    const e = fs({ candidates: [] });
    const full = new Map([[e, { candidates: NEAR, avoid_note: 'Full says AVOID.' }]]);
    expect(sitingCaveat([e], full).line).toBe('Full says AVOID.');
  });

  it('only the areas a lead names (top three) are measured', () => {
    const rows = [...NEAR, cand(41.8, -87.6, 'Chicago', 'AVOID'), cand(38.8, -90.1, 'Madison', 'CAUTION')];
    const c = sitingCaveat([dcpi('CAUTION'), fs({ candidates: rows })], null, { namedMarkets: ['chicago'] });
    expect(c).toBeNull();
  });

  it('FAR_KM is 100 and the distance is a real great-circle distance', () => {
    expect(FAR_KM).toBe(100);
    expect(Math.round(haversineKm(41.87, -87.63, 38.627, -90.199))).toBeGreaterThan(400);
    expect(Math.round(haversineKm(41.87, -87.63, 41.87, -87.63))).toBe(0);
  });
});

describe('withSitingCaveat', () => {
  const cav = { line: 'Chicago-area markets (PJM) read AVOID.' };
  it('puts the line first in the headline and on the answer', () => {
    const a = withSitingCaveat({ headline: 'Data Center Power Index (DCPI): Chicago: AVOID.', evidence: [] }, cav);
    expect(a.headline).toBe('Chicago-area markets (PJM) read AVOID. Data Center Power Index (DCPI): Chicago: AVOID.');
    expect(a.siting_caveat).toBe(cav.line);
  });
  it('no answer: a minimal one carrying the line; no line: the answer unchanged; never twice', () => {
    expect(withSitingCaveat(null, cav).headline).toBe(cav.line);
    const a = { headline: 'x' };
    expect(withSitingCaveat(a, null)).toBe(a);
    const once = withSitingCaveat(a, cav);
    expect(withSitingCaveat(once, cav)).toBe(once);
  });
  it('the line names no plan or price', () => {
    const c = sitingCaveat([dcpi(), fs({ candidates: DOWNSTATE, ranked_after: RANKED })], null, { namedMarkets: ['chicago'] });
    expect(c.line).not.toMatch(/\$|\bpro\b|developer|starter|upgrade|unlock|pricing|plan\b/i);
  });
});

it('is planner 5.55', () => { expect(PLANNER_VERSION).toBe('5.56'); });
