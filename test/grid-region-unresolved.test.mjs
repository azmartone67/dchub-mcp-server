// ── an unrecognised grid region must not come back wearing an invented ISO ──
//
// THE DEFECT (found 2026-08-29 in the call log of a live paying user)
// `get_grid_intelligence` never validated region_id. The handler did:
//
//     const ISO = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
//
// and shapeGridIntelligence copied that straight to `out.iso`. So
//
//     region_id: "Karaburun Peninsula, Izmir Province, Turkey"
//
// returned HTTP 200, status ok, isError unset, and a well-formed record:
//
//     {"iso":"KARABURUNPENINSULAIZMIRPROVINCETURKEY","iso_name":null,
//      "demand_mw":null,"constraint_score":null, … every field null}
//
// A caller cannot tell that from a covered ISO during a feed outage. The
// observed consequence is not hypothetical: one external user — 2,715 calls
// across 45 days, the single most engaged non-owner account on the platform —
// issued that exact call 5 times over 3 hours on 2026-08-10 together with
// get_power_pipeline and get_market_intel for the same peninsula, then stopped
// using ANY of those tools for that geography and fell back to tiling
// get_global_power by hand with 1°x1° bboxes (336 calls). The product had an
// answer for them — "no live grid telemetry outside the US, use
// get_global_power" — and instead returned a fabricated identifier.
//
// This is also the honesty layer inverted. DC Hub's differentiator is that it
// declares what it does NOT cover (constraint_coverage, withheld_fields,
// as_of_basis "UNMEASURED"). Inventing an ISO code is the opposite of that.
//
// THE CONTRACT PINNED HERE: the predicate must fire when NOTHING resolved, and
// must NOT fire for a covered region that merely lacks the optional layers.
// That distinction is the whole risk in the fix — the ~40 EIA balancing
// authorities are covered but have no DCPI row and no interconnection-queue
// row, so a naive "iso_name is null" or "constraint_score is null" test would
// silently cut off every BA. Fixtures below are LIVE CAPTURES, not invented.
import { describe, it, expect } from 'vitest';
import { _gridRegionUnresolved } from '../server.mjs';

// ── fixtures: live captures 2026-08-29 via POST https://dchub.cloud/mcp ─────
// Trimmed to the five fields the predicate reads; values verbatim.

// A covered region with the FULL stack — ISO with DCPI + queue rows.
const PJM = {
  iso: 'PJM', iso_name: 'PJM Interconnection (mid-Atlantic + Ohio Valley)',
  demand_mw: 105356, constraint_score: 50.7, queue_depth_gw: 171,
  generation_mix_mw: { NG: 51000, COL: 12000, NUC: 33000, WND: 2000, SUN: 1500, WAT: 900, OIL: 40, PS: -300 },
};

// A covered balancing authority WITH a DCPI score but no queue row.
const SOCO = {
  iso: 'SOCO', iso_name: 'Southern Company', demand_mw: 31539,
  constraint_score: 54.8, queue_depth_gw: null,
  generation_mix_mw: { NG: 18000, NUC: 8000, COL: 3000, WAT: 400, SUN: 900, BAT: -20, OIL: 5, GEO: 0, WND: 0, PS: 0, OTH: 10, UNK: 2 },
};

// ★ THE ONE THAT MATTERS. A covered balancing authority with NO iso_name, NO
// constraint_score and NO queue_depth_gw — only live telemetry. If the
// predicate keys on any of those three alone, AZPS (Phoenix — a top-10 US data
// centre market) starts returning "region not covered" to paying users.
const AZPS = {
  iso: 'AZPS', iso_name: null, demand_mw: 8005,
  constraint_score: null, queue_depth_gw: null,
  generation_mix_mw: { NG: 4200, NUC: 1100, SUN: 1800, COL: 500, WAT: 120, BAT: -90, WND: 30, OTH: 12, OIL: 3, GEO: 0 },
};

// A covered BA whose telemetry is fuel-mix-only (no demand reported this hour).
const MIX_ONLY = {
  iso: 'GCPD', iso_name: null, demand_mw: null,
  constraint_score: null, queue_depth_gw: null,
  generation_mix_mw: { WAT: 1900, WND: 45 },
};

// The defect, verbatim.
const TURKIYE = {
  iso: 'KARABURUNPENINSULAIZMIRPROVINCETURKEY', iso_name: null, demand_mw: null,
  constraint_score: null, queue_depth_gw: null, generation_mix_mw: {},
};

const ATLANTIS = {
  iso: 'KINGDOMOFATLANTISUNDERTHESEA', iso_name: null, demand_mw: null,
  constraint_score: null, queue_depth_gw: null, generation_mix_mw: {},
};

describe('_gridRegionUnresolved', () => {
  describe('covered regions stay covered', () => {
    it.each([
      ['PJM — full stack', PJM],
      ['SOCO — BA with a DCPI score', SOCO],
      ['AZPS — BA with telemetry ONLY (no name, no score, no queue)', AZPS],
      ['GCPD — fuel mix only, no demand this hour', MIX_ONLY],
    ])('%s is not reported as uncovered', (_label, fixture) => {
      expect(_gridRegionUnresolved(fixture)).toBe(false);
    });

    // Guards the exact regression the data-driven discriminator exists to
    // prevent: a region-allowlist implementation would pass every test above
    // except this one, because AZPS is absent from the 7-ISO list the tool's
    // own hint advertises.
    it('a single live signal is enough — one fuel key and nothing else', () => {
      expect(_gridRegionUnresolved({
        iso: 'X', iso_name: null, demand_mw: null, constraint_score: null,
        queue_depth_gw: null, generation_mix_mw: { WAT: 12 },
      })).toBe(false);
    });

    it('demand alone is enough', () => {
      expect(_gridRegionUnresolved({
        iso: 'X', iso_name: null, demand_mw: 1, constraint_score: null,
        queue_depth_gw: null, generation_mix_mw: {},
      })).toBe(false);
    });

    it('zero is a measurement, not an absence', () => {
      expect(_gridRegionUnresolved({
        iso: 'X', iso_name: null, demand_mw: 0, constraint_score: null,
        queue_depth_gw: null, generation_mix_mw: {},
      })).toBe(false);
    });
  });

  describe('unresolvable regions are caught', () => {
    it.each([
      ['the Türkiye call a live user made 5x in 3h', TURKIYE],
      ['pure nonsense', ATLANTIS],
    ])('%s is reported as uncovered', (_label, fixture) => {
      expect(_gridRegionUnresolved(fixture)).toBe(true);
    });

    it('an absent generation_mix_mw key is treated as empty, not as a crash', () => {
      expect(_gridRegionUnresolved({
        iso: 'X', iso_name: null, demand_mw: null,
        constraint_score: null, queue_depth_gw: null,
      })).toBe(true);
    });

    it.each([[null], [undefined], ['a string'], [42]])(
      'a non-object shape (%s) is uncovered rather than throwing', (bad) => {
        expect(_gridRegionUnresolved(bad)).toBe(true);
      });
  });

  // undefined and null must behave identically — the feeds use both.
  it('undefined fields read the same as null fields', () => {
    expect(_gridRegionUnresolved({
      iso: 'X', iso_name: undefined, demand_mw: undefined,
      constraint_score: undefined, queue_depth_gw: undefined, generation_mix_mw: {},
    })).toBe(true);
  });
});
