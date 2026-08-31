// ── analyze_site location= must resolve to a REAL point, or refuse ─────────
//
// THE ASK (handoff 2026-08-31, REMAINS #6): let an agent name a place instead
// of typing coordinates. The trap is the shortcut: adding `location` to
// ARG_ALIASES as a rename of `lat`. test/arg-aliases.test.mjs already forbids
// exactly that and names this case —
//
//     // analyze_site {location:"Ashburn, VA"} likewise needs geocoding to lat/lon.
//     expect(ARG_ALIASES.analyze_site?.location).toBeUndefined();
//
// — because a rename hands the scorer a place NAME where it expects a number
// and returns a confident wrong point. So `location` is DECLARED and resolved
// by VALUE against the published DCPI market row, and the answer carries a
// resolved_from block naming what it resolved to. Same shape
// get_grid_intelligence uses for market -> ISO.
//
// ★ THE SECOND TRAP, from r-marketresolve: `market` was READ by that handler
// for weeks while never DECLARED, and Zod strips undeclared arguments before
// the handler runs — so the read could never see a value, and reading the line
// suggested coverage that did not exist. The declaration is pinned below.
//
// ★ Fixtures are LIVE CAPTURES 2026-08-31 from https://dchub.cloud/api/v1/dcpi/scores/<slug>.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { _locationPoint, _coordsRequired, ARG_ALIASES } from '../server.mjs';

// GET /api/v1/dcpi/scores/ashburn -> 200 (trimmed to the fields read)
const ASHBURN = { market_slug: 'ashburn', market_name: 'Ashburn', state: 'VA',
                  latitude: 39.019135, longitude: -77.47156 };
// GET /api/v1/dcpi/scores/dallas -> 200
const DALLAS  = { market_slug: 'dallas', market_name: 'Dallas', state: 'TX',
                  latitude: 32.800747, longitude: -96.81941 };
// GET /api/v1/dcpi/scores/ashburn-virginia -> 404. A trailing state is NOT
// stripped, deliberately: guessing which token is the state risks answering
// for the wrong market. callAPI does not throw on 404 — it returns this shape.
const NOT_FOUND = { error: 'market not found' };

describe('location resolves to the published market centroid', () => {
  it('returns the row\'s real coordinates, not a guess', () => {
    const r = _locationPoint('ashburn', 'ashburn', ASHBURN);
    expect(r.ok).toBe(true);
    expect(r.lat).toBe(39.019135);
    expect(r.lon).toBe(-77.47156);
    expect(r.state).toBe('VA');
  });

  it('names the source it resolved through', () => {
    const { resolved_from } = _locationPoint('dallas', 'dallas', DALLAS);
    expect(resolved_from.via).toContain('/api/v1/dcpi/scores');
    expect(resolved_from.market_slug).toBe('dallas');
    expect(resolved_from.resolved_lat).toBe(32.800747);
    expect(resolved_from.resolved_lon).toBe(-96.81941);
  });

  it('★ says the answer is MARKET-level, not the parcel the caller named', () => {
    // analyze_site's whole premise is ONE specific parcel. Handing back a
    // market centroid without saying so is the silent-wrong-answer this
    // feature could most easily become.
    const { resolved_from } = _locationPoint('ashburn', 'ashburn', ASHBURN);
    expect(resolved_from.note).toMatch(/CENTROID/);
    expect(resolved_from.note).toMatch(/not the parcel you named/);
    expect(resolved_from.note).toMatch(/pass lat\/lon for a specific site/);
  });
});

describe('an unresolved location is REFUSED, never scored at a guessed point', () => {
  it('a 404 row fails loudly', () => {
    const r = _locationPoint('Karaburun', 'karaburun', NOT_FOUND);
    expect(r.ok).toBe(false);
    expect(r.error.error).toBe('location not resolved');
    expect(r.error._error_mitigation.error_code).toBe('location_not_resolved');
    expect(r.error.tried_market_slug).toBe('karaburun');
  });

  it('"Ashburn, VA" does not resolve, and the error SAYS why', () => {
    const r = _locationPoint('Ashburn, VA', 'ashburn-va', NOT_FOUND);
    expect(r.ok).toBe(false);
    expect(r.error.hint).toMatch(/trailing state is NOT stripped/);
  });

  it('a null row (empty slug) fails loudly', () => {
    expect(_locationPoint('', '', null).ok).toBe(false);
  });

  it('★ a row that EXISTS but carries no coordinates must not resolve', () => {
    // The partial-data case. Number(null) is 0 and Number(undefined) is NaN —
    // a coercion here would score the site at (0, 0), open ocean, and return
    // it as the answer. This is the case a shape check alone would miss.
    for (const row of [{ ...ASHBURN, latitude: null, longitude: null },
                       { ...ASHBURN, latitude: 39.02, longitude: null },
                       { ...ASHBURN, latitude: undefined, longitude: undefined },
                       { ...ASHBURN, latitude: 'n/a', longitude: 'n/a' },
                       { ...ASHBURN, latitude: true, longitude: true },
                       { ...ASHBURN, latitude: '', longitude: '' },
                       { ...ASHBURN, latitude: 91, longitude: -77.47 },
                       { ...ASHBURN, latitude: 39.02, longitude: 181 }]) {
      const r = _locationPoint('ashburn', 'ashburn', row);
      expect(r.ok, JSON.stringify(row)).toBe(false);
    }
  });
});

describe('the wiring, not just the helper', () => {
  it('location satisfies the coordinate requirement so the call reaches the handler', () => {
    // _coordsRequired runs BEFORE the handler. Without this the call is
    // refused with missing_coordinates and nothing ever resolves.
    expect(_coordsRequired('analyze_site', { location: 'ashburn' })).toBe(false);
    expect(_coordsRequired('analyze_site', { candidate_id: 'cand_1' })).toBe(false);
    expect(_coordsRequired('analyze_site', {})).toBe(true);
    expect(_coordsRequired('analyze_site', { lat: 39 })).toBe(true);
  });

  it('★ location is DECLARED in the schema — an undeclared arg is stripped by Zod', () => {
    // r-marketresolve: `market` was read for weeks while undeclared, so the
    // read could never see a value. A handler that reads an undeclared
    // argument reads as coverage and provides none.
    const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    const start = SRC.indexOf("trackedTool(srv, 'analyze_site'");
    expect(start, 'analyze_site registration not found').toBeGreaterThan(-1);
    const schema = SRC.slice(start, SRC.indexOf('async (a) => {', start));
    expect(schema).toMatch(/\blocation:\s*S\.describe\(/);
  });

  it('location is still NOT an ARG_ALIAS — it is resolved, not renamed', () => {
    expect(ARG_ALIASES.analyze_site?.location).toBeUndefined();
  });
});
