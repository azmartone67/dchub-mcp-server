// p0-1-substation-tail-doors.test.mjs — P0-1 tail (owner 2026-10-05).
// find_sites, get_retirement_headroom (and so execute_plan) and
// get_hosting_capacity answered the substation question that analyze_site locks
// below Pro. Measured keyless on 2026-10-05: anchor name + voltage_kv 750,
// nearest_substations distance_km 0.2, feeder substation labels.
import { describe, it, expect } from 'vitest';
import { _kvBandOf, _lockFindSitesAnchors, _lockRetirementSubstations,
  _lockHostingSubstations, _substationDetailOpen } from '../server.mjs';

const LEAK = /Fillmore|OSM-1467|Test Sub|Acme Power|APS/;

describe('kv band', () => {
  it('matches the backend bands', () => {
    expect([750, 500, 499, 345, 230, 115, 69, 13.2].map(_kvBandOf)).toEqual(
      ['500 kV+', '500 kV+', '345-499 kV', '345-499 kV', '230-344 kV', '115-229 kV', '69-114 kV', 'below 69 kV']);
    expect([null, undefined, '', 0, -5, 'x'].map(_kvBandOf)).toEqual([null, null, null, null, null, null]);
  });
});

describe('find_sites anchor', () => {
  const payload = { count: 1, candidates: [{ site_ref: 's1', lat: 33.4, lon: -112,
    anchor: { type: 'substation', name: 'Fillmore Substation', operator: 'Acme Power', voltage_kv: 750,
      capacity_mva: 900, city: 'Phoenix', state: 'AZ', status: 'active', voltage_basis: 'hifld' } }] };
  it('is {type, kv_band, voltage_basis} below Pro and names the lock', () => {
    const o = _lockFindSitesAnchors(payload);
    expect(o.candidates[0].anchor).toEqual({ type: 'substation', kv_band: '500 kV+', voltage_basis: 'hifld' });
    expect(JSON.stringify(o)).not.toMatch(LEAK);
    expect(o._required_tier).toBe('pro');
    expect(o._locked_fields).toContain('anchor.voltage_kv');
    expect(o.candidates[0].lat).toBe(33.4);   // coordinates are a separate rule
  });
  it('does not mutate the input and tolerates non-anchor candidates', () => {
    _lockFindSitesAnchors(payload);
    expect(payload.candidates[0].anchor.name).toBe('Fillmore Substation');
    expect(_lockFindSitesAnchors({ candidates: [null, { site_ref: 'x' }] }).candidates).toEqual([null, { site_ref: 'x' }]);
    expect(_lockFindSitesAnchors(null)).toBeNull();
  });
});

describe('get_retirement_headroom substations', () => {
  const d = { data: [{ generator: { name: 'Gen 1' }, substations_within_25km: 7,
    nearest_substations: [{ name: 'OSM-1467180896', distance_km: 0.2 }, { name: 'Test Sub', distance_km: 12 }] }] };
  it('keeps the count, bands the distance, drops the name', () => {
    const o = _lockRetirementSubstations(d);
    const row = o.data[0];
    expect(row.substations_within_25km).toBe(7);
    expect(row.nearest_substations).toEqual([{ distance_band: 'within 1 km' }, { distance_band: expect.any(String) }]);
    expect(JSON.stringify(o)).not.toMatch(LEAK);
    expect(JSON.stringify(o.data)).not.toContain('distance_km');
    expect(o._substation_required_tier).toBe('pro');
  });
  it('passes error and non-list payloads through', () => {
    expect(_lockRetirementSubstations({ error: 'x' })).toEqual({ error: 'x' });
    expect(_lockRetirementSubstations(null)).toBeNull();
  });
});

describe('get_hosting_capacity substation label', () => {
  const out = { headline: 'h', top_feeders: [{ feeder_id: 'F1', substation: 'APS Fillmore', capacity_mw_max: 7.5 }, { feeder_id: 'F2' }] };
  it('removes the label, keeps the feeder', () => {
    const o = _lockHostingSubstations(out);
    expect(o.top_feeders).toEqual([{ feeder_id: 'F1', capacity_mw_max: 7.5 }, { feeder_id: 'F2' }]);
    expect('substation' in o.top_feeders[0]).toBe(false);
    expect(o._required_tier).toBe('pro');
  });
});

describe('who is above the line', () => {
  it('keyless, free and Developer are below; unambiguous Pro and enterprise are above', async () => {
    expect(await _substationDetailOpen({})).toBe(false);
    expect(await _substationDetailOpen({ tier: 'free', api_key: 'k' })).toBe(false);
    expect(await _substationDetailOpen({ tier: 'developer', api_key: 'k' })).toBe(false);
    expect(await _substationDetailOpen({ tier: 'pro', api_key: 'k' })).toBe(true);
    expect(await _substationDetailOpen({ tier: 'enterprise', api_key: 'k' })).toBe(true);
  });
});
