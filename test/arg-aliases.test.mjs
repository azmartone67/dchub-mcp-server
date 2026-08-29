import { describe, it, expect } from 'vitest';
import { ARG_ALIASES, TOOL_ALIASES } from '../server.mjs';

// r-argalias (2026-08-29). TOOL_ALIASES exists because agents guess tool NAMES.
// Nothing ever routed a guessed ARGUMENT name, and Zod STRIPS undeclared
// arguments before the handler — so a guess did not fail loudly, it returned a
// confident WRONG answer.
//
// Measured live against production that day, calling the top paid-demand tools
// the way an agent naturally would:
//   get_dchub_recommendation {intent:"..."}       -> stripped, generic blurb
//   get_fiber_intel {location:"Dallas"}           -> stripped, 200 OK, not Dallas
// 58 of 82 tools declare no `required`, so tools/list could not teach the right
// name either.
//
// ★VALIDATION LIMIT, STATED PLAINLY: this repo cannot check targets against the
// real schemas. The authoritative 82-tool manifest lives in
// dchub-backend/worker.js; this repo's toolspec.json is stale (79 tools, and
// `properties` is EMPTY for every one), so asserting against it would pass
// VACUOUSLY — the failure mode this whole file exists to prevent. What IS
// guarded here is structure. Cross-repo target validation is a known gap.

// The reviewed target list. Kept explicit so a change to the map is a change to
// this file too — the only signal available in-repo.
const EXPECTED_TARGETS = {
  get_dchub_recommendation: 'context',
  get_fiber_intel: 'market',
  get_metro_fiber: 'market',
  get_market_intel: 'market',
  get_energy_prices: 'state',
  list_transactions: 'limit',
};

describe('ARG_ALIASES structure', () => {
  it('every alias maps to the reviewed target for that tool', () => {
    for (const [tool, map] of Object.entries(ARG_ALIASES)) {
      expect(EXPECTED_TARGETS, `${tool} missing from EXPECTED_TARGETS`)
        .toHaveProperty(tool);
      for (const target of Object.values(map)) {
        expect(target, `${tool}: unreviewed target ${target}`)
          .toBe(EXPECTED_TARGETS[tool]);
      }
    }
  });

  it('no guess shadows the real argument it maps to', () => {
    // A self-map would delete the real argument and re-add it — a no-op that
    // reads as coverage.
    for (const [tool, map] of Object.entries(ARG_ALIASES)) {
      for (const [guess, real] of Object.entries(map)) {
        expect(guess, `${tool}: ${guess} maps to itself`).not.toBe(real);
      }
    }
  });

  it('no tool aliases the same guess twice and no map is empty', () => {
    for (const [tool, map] of Object.entries(ARG_ALIASES)) {
      const keys = Object.keys(map);
      expect(keys.length, `${tool}: empty alias map`).toBeGreaterThan(0);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('does NOT alias arguments whose VALUE needs translating', () => {
    // get_grid_intelligence takes an ISO (PJM/ERCOT/CAISO), so {market:"Ashburn"}
    // is NOT `region` — aliasing it would turn a loud, correct error into a
    // silently wrong answer, which is the bug this map exists to fix.
    // analyze_site {location:"Ashburn, VA"} likewise needs geocoding to lat/lon.
    expect(ARG_ALIASES).not.toHaveProperty('get_grid_intelligence');
    expect(ARG_ALIASES.analyze_site?.location).toBeUndefined();
  });

  it('alias targets never collide with a real tool NAME', () => {
    // Cheap cross-check that the two maps stay conceptually separate.
    for (const map of Object.values(ARG_ALIASES)) {
      for (const guess of Object.keys(map)) {
        expect(TOOL_ALIASES).not.toHaveProperty(guess);
      }
    }
  });
});

describe('the rename is applied without clobbering', () => {
  // Mirrors the server-side loop exactly; the guard is that an explicitly-sent
  // real argument always wins over a guessed one.
  const apply = (tool, args) => {
    const m = ARG_ALIASES[tool];
    if (!m) return args;
    for (const [guess, real] of Object.entries(m)) {
      if (Object.prototype.hasOwnProperty.call(args, guess)
          && !Object.prototype.hasOwnProperty.call(args, real)) {
        args[real] = args[guess];
        delete args[guess];
      }
    }
    return args;
  };

  it('renames a guessed argument', () => {
    expect(apply('get_dchub_recommendation', { intent: 'investment' }))
      .toEqual({ context: 'investment' });
  });

  it('an explicit real argument is never overwritten by a guess', () => {
    expect(apply('get_dchub_recommendation',
                 { intent: 'guessed', context: 'explicit' }))
      .toEqual({ intent: 'guessed', context: 'explicit' });
  });

  it('leaves untouched tools and unknown arguments alone', () => {
    expect(apply('search', { q: 'x' })).toEqual({ q: 'x' });
    expect(apply('get_fiber_intel', { carrier: 'Zayo' }))
      .toEqual({ carrier: 'Zayo' });
  });
});
