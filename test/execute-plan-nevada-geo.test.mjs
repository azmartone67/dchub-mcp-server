// ── execute_plan: Nevada places bind a point, a metro and a balancing area ──
//
// Live 2026-11-05, anonymous execute_plan "find 75-100 MW of buildable land
// with power in Southern Nevada":
//   - the verdict step led with "Enterprise" (find_sites' nearest DCPI market),
//     not Las Vegas;
//   - find_sites searched all of Nevada (Reno included): no Nevada place in
//     the corridor table, so "near Las Vegas" also widened to WECC;
//   - get_retirement_headroom read the whole country and the NV cut kept
//     0 rows, while region_iso=NEVP returns Fort Churchill (Lyon County, NV).
import { describe, it, expect } from 'vitest';
import { _planCorridor, _planSignals, _planQuery, _execInjectGeo,
  _execConstraintSlug, _execConstraintIsoSet, _STATE_RETIREMENT_BA } from '../server.mjs';

const SNV = 'find 75-100 MW of buildable land with power in Southern Nevada';

describe('Nevada places bind a point and a radius', () => {
  it('"Southern Nevada" binds the Las Vegas Valley, not the whole state', () => {
    const c = _planCorridor(SNV);
    expect(c).toBeTruthy();
    expect(c.state).toBe('NV');
    expect(c.lat).toBeCloseTo(36.17, 1);
    expect(c.lon).toBeCloseTo(-115.14, 1);
    expect(c.radius_km).toBe(50);
  });

  it('"near Las Vegas" binds Las Vegas', () => {
    const c = _planCorridor('find 100 MW of land with power near Las Vegas');
    expect(c && c.places).toEqual(['Las Vegas, NV']);
  });

  it('"Northern Nevada" and the Tahoe Reno Industrial Center bind Reno-side points', () => {
    expect(_planCorridor('100 MW sites in Northern Nevada').lat).toBeCloseTo(39.53, 1);
    expect(_planCorridor('land at the Tahoe Reno Industrial Center').places)
      .toEqual(['Tahoe Reno Industrial Center, NV']);
  });

  it('Henderson, Sparks and Clark County bind only beside Nevada', () => {
    expect(_planCorridor('data center land in Henderson, Texas')).toBe(null);
    expect(_planCorridor('sites in Clark County, Ohio')).toBe(null);
    expect(_planCorridor('sites in Henderson, Nevada').places).toEqual(['Henderson, NV']);
    expect(_planCorridor('sites in Henderson, NV').places).toEqual(['Henderson, NV']);
    expect(_planCorridor('Sparks near Reno').places).toEqual(['Reno, NV', 'Sparks, NV']);
  });

  it('find_sites gets the point and radius, and keeps the planner state', () => {
    const sig = _planSignals(SNV);
    const args = { state: 'NV' };
    const set = _execInjectGeo('find_sites', args, sig);
    expect(set).toEqual(expect.arrayContaining(['lat', 'lon', 'radius_km']));
    expect(args).toMatchObject({ state: 'NV', lat: 36.1716, lon: -115.1391, radius_km: 50 });
  });

  it('the replay reports a place scope, not a widening to WECC', () => {
    for (const q of [SNV, 'find 100 MW of land with power near Las Vegas']) {
      const p = _planQuery(q);
      expect(p.intent_class, q).toBe('capacity_search');
      expect(p.replay.place_scope, q).toBeTruthy();
      expect(p.replay.scope_widened, q).toBeFalsy();
    }
  });
});

describe('the verdict step names the metro the region means', () => {
  it('Southern Nevada -> Las Vegas, Northern Nevada -> Reno', () => {
    expect(_execConstraintSlug(SNV)).toBe('las-vegas-nv');
    expect(_execConstraintSlug('100 MW in Northern Nevada')).toBe('reno-nv');
    expect(_execConstraintIsoSet(SNV, {}, _planSignals(SNV))).toEqual(['WECC']);
  });
});

describe('retirement headroom reads the state balancing area', () => {
  it('a Nevada intent sets region_iso=NEVP', () => {
    const args = { target_mw: 100, horizon_months: 24 };
    expect(_execInjectGeo('get_retirement_headroom', args, _planSignals(SNV))).toEqual(['region_iso']);
    expect(args.region_iso).toBe('NEVP');
  });

  it('never overwrites a region the planner, the caller or ISO injection set', () => {
    const args = { target_mw: 100, horizon_months: 24, region_iso: 'CAISO' };
    expect(_execInjectGeo('get_retirement_headroom', args, _planSignals(SNV))).toEqual([]);
    expect(args.region_iso).toBe('CAISO');
  });

  it('a state with no listed balancing area is left alone', () => {
    expect(_STATE_RETIREMENT_BA.TX).toBeUndefined();
    const args = { target_mw: 100, horizon_months: 24 };
    expect(_execInjectGeo('get_retirement_headroom', args, _planSignals('100 MW of land in Texas'))).toEqual([]);
    expect(args.region_iso).toBeUndefined();
  });
});
