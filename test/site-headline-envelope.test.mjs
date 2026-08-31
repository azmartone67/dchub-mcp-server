// ── the free-tier headline must not project away what the answer does NOT cover ──
//
// ★ FOUND IN PRODUCTION, AFTER #280 SHIPPED. analyze_site gained location="ashburn",
// which resolves to that market's PUBLISHED CENTROID and returns a `resolved_from`
// block saying so. #280 unit-tested the resolver and pinned the wording of the note.
// It never exercised the TIER PROJECTION. Measured live on the anonymous tier:
//
//     analyze_site {location:"ashburn"}
//       -> composite_score 83.7, verdict "Excellent site"
//       -> resolved_from: ABSENT
//
// The caller was handed a score for a point they never named, with nothing saying
// so. buildSiteHeadlineTease() rebuilds the payload from an allowlist, so any field
// missing from it is dropped — and the honesty block was missing from it.
//
// ★ THE DOCTRINE IT BROKE is already written down twice in this repo:
//   test/fields-projection.test.mjs — "A PROJECTION NARROWS ROWS, NEVER THE
//     ENVELOPE … what it could not cover … is not data a caller may opt out of."
//   buildSiteHeadlineTease's own capacity_context comment — "paywalling caveats
//     leaves the free tier over-claiming more than the paid one."
//
// The paid path spreads the backend payload and was never affected. It is
// precisely the FREE tier — the one that over-claims by dropping a caveat —
// that lost it.
import { describe, it, expect } from 'vitest';
import { buildSiteHeadlineTease } from '../server.mjs';

// A backend /api/site-score payload, trimmed to what the tease reads, plus the
// resolved_from the handler attaches when location= was used.
const RESOLVED_FROM = {
  location: 'ashburn',
  market_slug: 'ashburn',
  market_name: 'Ashburn',
  resolved_lat: 39.019135,
  resolved_lon: -77.47156,
  via: '/api/v1/dcpi/scores — published DCPI market row',
  note: 'location="ashburn" is not a coordinate; it was resolved to the PUBLISHED '
      + 'CENTROID of the "ashburn" market (39.019135, -77.47156) before this site '
      + 'was scored. This is a MARKET-level read, not the parcel you named — pass '
      + 'lat/lon for a specific site.',
};
const scored = (extra = {}) => ({
  success: true,
  overall_score: 83.7,
  interpretation: 'Excellent site',
  scores: { power_infrastructure: 88, gas_pipeline_access: 74, fiber_connectivity: 91,
            market_conditions: 60, risk_resilience: 80 },
  location: 'Ashburn, VA',
  ...extra,
});

describe('the free headline carries the resolution caveat', () => {
  it('★ resolved_from survives the projection', () => {
    const out = buildSiteHeadlineTease(scored({ resolved_from: RESOLVED_FROM }));
    expect(out).not.toBeNull();
    expect(out.resolved_from, 'the caveat was projected away — the free tier now '
      + 'reports a centroid score as if it were the parcel the caller named')
      .toBeTruthy();
  });

  it('★ and it still SAYS it is not the caller\'s parcel', () => {
    // Carrying the key but losing the sentence would pass a shallow check and
    // still leave the caller misled.
    const { resolved_from } = buildSiteHeadlineTease(scored({ resolved_from: RESOLVED_FROM }));
    expect(resolved_from.note).toMatch(/CENTROID/);
    expect(resolved_from.note).toMatch(/not the parcel you named/);
    expect(resolved_from.market_slug).toBe('ashburn');
  });

  it('is CONDITIONAL — absence still means no resolution happened', () => {
    // Same contract as capacity_context: an always-present key would make
    // "the caller passed lat/lon directly" indistinguishable from "resolved".
    const out = buildSiteHeadlineTease(scored());
    expect(out).not.toBeNull();
    expect('resolved_from' in out).toBe(false);
  });

  it('the honesty envelope the headline already owed is still intact', () => {
    const out = buildSiteHeadlineTease(scored({ resolved_from: RESOLVED_FROM }));
    for (const k of ['citation', 'composite_score', 'verdict', 'limiting_factor', '_locked'])
      expect(out, `headline lost ${k}`).toHaveProperty(k);
  });

  it('still refuses to invent a headline when the backend gave no score', () => {
    expect(buildSiteHeadlineTease({ success: true, resolved_from: RESOLVED_FROM })).toBeNull();
    expect(buildSiteHeadlineTease({ success: false, overall_score: 80 })).toBeNull();
  });
});
