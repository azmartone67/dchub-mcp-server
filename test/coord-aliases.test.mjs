// r-coord-aliases (2026-07-16): save_site's silent-strip trap (r-lonfix)
// generalized to every point-keyed tool. The MCP SDK's zod parse strips
// undeclared keys SILENTLY, so a call sent with `lng`/`longitude`/`latitude`
// reached a READ tool coordinate-less and the analysis was computed at lon=0
// (open ocean) — a silently wrong answer instead of a poisoned row. These
// tests pin (1) the fold helper pass-`a`-through handlers use, (2) which tools
// refuse a coordinate-less call with the parameter_adjustment envelope, and
// (3) which tools must NOT refuse because coords are genuinely optional.
import { describe, it, expect } from 'vitest';
import { _extractCoordArgs, _foldCoordArgs, _coordsRequired, _validateToolArgs } from '../server.mjs';

describe('_foldCoordArgs — alias folding for pass-through handlers', () => {
  it('folds lng into lon and DROPS the alias key (never leaks upstream)', () => {
    expect(_foldCoordArgs({ lat: 33.45, lng: -112.07, state: 'AZ' }))
      .toEqual({ lat: 33.45, lon: -112.07, state: 'AZ' });
  });
  it('folds latitude/longitude long names', () => {
    expect(_foldCoordArgs({ latitude: 33.45, longitude: -112.07 }))
      .toEqual({ lat: 33.45, lon: -112.07 });
  });
  it('canonical lat/lon win when both conventions are present', () => {
    expect(_foldCoordArgs({ lat: 1, latitude: 2, lon: 3, lng: 4, longitude: 5 }))
      .toEqual({ lat: 1, lon: 3 });
  });
  it('preserves unrelated params untouched', () => {
    expect(_foldCoordArgs({ lng: -77.48, lat: 39.04, radius_km: 25, layer: 'substations' }))
      .toEqual({ lat: 39.04, lon: -77.48, radius_km: 25, layer: 'substations' });
  });
  it('leaves a coordinate-less call coordinate-less (no defaults invented)', () => {
    expect(_foldCoordArgs({ state: 'TX' })).toEqual({ state: 'TX' });
    expect(_foldCoordArgs({})).toEqual({});
    expect(_foldCoordArgs(null)).toEqual({});
  });
  it('treats explicit 0 as a valid coordinate', () => {
    expect(_foldCoordArgs({ latitude: 0, lng: 0 })).toEqual({ lat: 0, lon: 0 });
  });
});

// Tools that must REFUSE a coordinate-less call (a missing coord would
// otherwise be analyzed at (0, 0) or, for save_site, persisted as (0, 0)).
const REQUIRED = [
  'save_site', 'get_composite_site_score', 'get_disaster_risk',
  'get_climate_intel', 'generate_site_analysis', 'get_infrastructure',
  'get_fiber_readiness',
];

describe('_validateToolArgs — missing-coordinate rejection', () => {
  for (const tool of REQUIRED) {
    it(`${tool}: refuses a coordinate-less call with the parameter_adjustment envelope`, () => {
      const r = _validateToolArgs(tool, {});
      expect(r).not.toBeNull();
      expect(r.isError).toBe(true);
      expect(r.structuredContent.error).toBe('missing_coordinates');
      expect(r.structuredContent._error_mitigation.error_code).toBe('missing_coordinates');
      expect(r.structuredContent._error_mitigation.severity).toBe('parameter_adjustment');
      expect(r.structuredContent.detail).toContain('lat and lon missing');
    });
    it(`${tool}: refuses lat-only (lon missing)`, () => {
      const r = _validateToolArgs(tool, { lat: 33.45 });
      expect(r).not.toBeNull();
      expect(r.structuredContent.detail).toContain('lon missing');
    });
    it(`${tool}: passes when coords arrive under ALIAS names`, () => {
      expect(_validateToolArgs(tool, { latitude: 33.45, lng: -112.07 })).toBeNull();
    });
    it(`${tool}: passes canonical lat/lon`, () => {
      expect(_validateToolArgs(tool, { lat: 33.45, lon: -112.07 })).toBeNull();
    });
  }
  it('only save_site claims "Nothing was saved" — read tools get the read-tool tail', () => {
    expect(_validateToolArgs('save_site', {}).structuredContent.detail)
      .toContain('Nothing was saved');
    expect(_validateToolArgs('get_disaster_risk', {}).structuredContent.detail)
      .not.toContain('Nothing was saved');
  });
});

describe('_validateToolArgs — conditionally-required coordinates', () => {
  it('analyze_site: refuses when NEITHER coords nor candidate_id given', () => {
    const r = _validateToolArgs('analyze_site', {});
    expect(r).not.toBeNull();
    expect(r.structuredContent.error).toBe('missing_coordinates');
    expect(r.structuredContent._error_mitigation.deterministic_hint).toContain('candidate_id');
  });
  it('analyze_site: candidate_id alone is enough (coords resolved from the mint)', () => {
    expect(_validateToolArgs('analyze_site', { candidate_id: 'cand_abc123' })).toBeNull();
  });
  it('analyze_site: lng alias satisfies the requirement', () => {
    expect(_validateToolArgs('analyze_site', { lat: 33.45, lng: -112.07 })).toBeNull();
  });
  it('analyze_parcel: refuses when NEITHER coords nor geometry given', () => {
    const r = _validateToolArgs('analyze_parcel', {});
    expect(r).not.toBeNull();
    expect(r.structuredContent.error).toBe('missing_coordinates');
    expect(r.structuredContent._error_mitigation.deterministic_hint).toContain('geometry');
  });
  it('analyze_parcel: a GeoJSON geometry alone is enough', () => {
    expect(_validateToolArgs('analyze_parcel',
      { geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } })).toBeNull();
  });
});

describe('_validateToolArgs — genuinely-optional coordinates are NEVER rejected', () => {
  it('get_water_risk: state-only (and even empty) calls pass — county/state fallbacks exist', () => {
    expect(_validateToolArgs('get_water_risk', { state: 'AZ' })).toBeNull();
    expect(_validateToolArgs('get_water_risk', {})).toBeNull();
  });
  it('get_renewable_energy: coords are an optional nearest-projects refinement', () => {
    expect(_validateToolArgs('get_renewable_energy', { state: 'TX' })).toBeNull();
    expect(_validateToolArgs('get_renewable_energy', {})).toBeNull();
  });
  it('get_interconnection_queue: nearest-projects coords stay optional', () => {
    expect(_coordsRequired('get_interconnection_queue', {})).toBe(false);
  });
  it('unrelated tools are untouched', () => {
    expect(_validateToolArgs('rank_markets', {})).toBeNull();
    expect(_validateToolArgs('get_grid_scoreboard', {})).toBeNull();
  });
});
