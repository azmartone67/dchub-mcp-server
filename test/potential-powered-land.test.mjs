// potential-powered-land.test.mjs — owner 2026-11-23: "add potential powered land sites to our tool".
// A Capacity Source browse with no land listing named nothing, and no tool screened on distance to water.
// find_sites (backend be: max_water_km, include_parcels) now does both; this server routes land questions
// to it, hands an empty land browse to it, and keeps hosted parcel ids and points Pro (like the anchor).
// The routing and the hand-off sit behind DCHUB_POTENTIAL_LAND (default off); the mask is always on.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { landWaterKm, landSearchExtras, landSearchAsk, potentialLandCall, potentialLandOn, POTENTIAL_LAND_LINE,
  landSearchLead } from '../lib/land-search.mjs';

describe('landWaterKm', () => {
  it.each([
    ['is there a powered land site within 1 km of a natural body of water?', 1],
    ['powered land within 2 miles of a river in Ohio', 3.219],
    ['powered land within 500 m of a lake', 0.5],
    ['sites less than 3 kilometers from a reservoir', 3],
    ['waterfront powered land in Texas', 2],
    ['powered land within 40 km of a river', 10],   // capped
  ])('%s -> %s', (t, km) => expect(landWaterKm(t)).toBe(km));
  it.each([
    'find land for 100 MW near Columbus',
    'powered land within 5 km of a 345 kV substation',
    'water risk for a site in Phoenix',
  ])('no water distance in %s', (t) => expect(landWaterKm(t)).toBeNull());
});

describe('landSearchExtras / landSearchAsk', () => {
  it('always lists parcels; adds the water screen only when asked; canals only when named', () => {
    expect(landSearchExtras('find land for 100 MW near Columbus')).toEqual({ include_parcels: true });
    expect(landSearchExtras('powered land within 1 km of water')).toEqual({ include_parcels: true, max_water_km: 1 });
    expect(landSearchExtras('powered land within 1 km of a canal'))
      .toEqual({ include_parcels: true, max_water_km: 1, water_include_canals: true });
  });
  it('a sizeless water-bound land question is a land search only with the flag', () => {
    const t = 'is there a powered land site within 1 km of a natural body of water?';
    expect(landSearchAsk(t, {})).toBe(false);
    expect(landSearchAsk(t, {}, { potentialLand: true })).toBe(true);
    // a point is a site screen, not a search, flag or no flag
    expect(landSearchAsk(t, { coords: { lat: 1, lon: 2 } }, { potentialLand: true })).toBe(false);
    // the sized question keeps its old answer
    expect(landSearchAsk('find land for 100 MW near Columbus', { mw: 100 })).toBe(true);
  });
  it('the flag reads on/1/true/yes and nothing else', () => {
    for (const v of ['on', '1', 'true', 'yes', ' ON ']) expect(potentialLandOn({ DCHUB_POTENTIAL_LAND: v })).toBe(true);
    for (const v of [undefined, '', '0', 'off', 'false']) expect(potentialLandOn({ DCHUB_POTENTIAL_LAND: v })).toBe(false);
  });
});

describe('potentialLandCall', () => {
  it('an empty land browse hands to find_sites with its own geography, labelled not a listing', () => {
    const c = potentialLandCall({ delivery_type: 'land', state: 'tx' });
    expect(c.tool).toBe('find_sites');
    expect(c.args).toEqual({ state: 'TX', include_parcels: true });
    expect(c.what_this_is).toMatch(/not listings/);
    expect(c.needs).toBeUndefined();
  });
  it('no geography says what it needs instead of guessing one', () => {
    const c = potentialLandCall({});
    expect(c.args).toEqual({ include_parcels: true });
    expect(c.needs).toMatch(/state, market, or lat and lon/);
  });
  it('a colocation or turnkey browse is not a land question', () => {
    expect(potentialLandCall({ delivery_type: 'colocation' })).toBeNull();
    expect(potentialLandCall({ delivery_type: 'turnkey', state: 'TX' })).toBeNull();
  });
  it('the line carries no digit and no link (inventory and one-link rules)', () => {
    expect(POTENTIAL_LAND_LINE).not.toMatch(/\d/);
    expect(POTENTIAL_LAND_LINE).not.toMatch(/https?:/);
    expect(POTENTIAL_LAND_LINE).toMatch(/not land listed or known to be for sale/);
  });
});

describe('landSearchLead names water and the largest parcel', () => {
  it('per area', () => {
    const e = { tool: 'find_sites', status: 'executed', step: 1, args: { state: 'VA' },
      result: { count: 1, candidates: [{ lat: 39.0, lon: -77.5, anchor: { kv_band: '500 kV+' },
        water: { status: 'answered', nearest: { name: 'Broad Run', distance_km: 0.41 } },
        parcels: { status: 'covered', parcels: [{ acres: 223.4, distance_km: 0.97 }] } }] } };
    const h = landSearchLead([e], null, null).headline;
    expect(h).toMatch(/Broad Run 0\.41 km/);
    expect(h).toMatch(/largest hosted parcel 223 acres at 0\.97 km/);
  });
  it('an unread water check is said, never dropped', () => {
    const e = { tool: 'find_sites', status: 'executed', step: 1, args: { state: 'VA' },
      result: { count: 1, candidates: [{ lat: 39.0, lon: -77.5, anchor: {}, water: { status: 'not_evaluated' } }] } };
    expect(landSearchLead([e], null, null).headline).toMatch(/water not checked/);
  });
});

// ── server.mjs: the below-Pro parcel mask and the empty-browse hand-off ─────────────────────────────
// Loopback only, as in p0-1-substation-tail-doors.test.mjs: the backend is faked before server.mjs loads.
let S; let realFetch; let prevBase; let prevInternal;
beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY; process.env.DCHUB_INTERNAL_KEY = 'potential-land-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  prevBase = process.env.DCHUB_API_BASE; process.env.DCHUB_API_BASE = 'https://backend.potential-land.test';
  S = await import('../server.mjs');
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
  delete process.env.DCHUB_POTENTIAL_LAND;
});

describe('_lockFindSitesAnchors: hosted parcels below Pro', () => {
  const parcel = { county: 'Loudoun', state: 'VA', acres: 223.4, acres_basis: 'gis', distance_km: 0.97,
    parcel_id: '089360535000', lat: 39.053, lon: -77.487, source: 'loudoun', license: 'x', attribution: 'y',
    next_call: 'analyze_parcel lat=39.053 lon=-77.487' };
  it('keeps county, acreage and distance; removes id, point, source and next call', () => {
    const o = S._lockFindSitesAnchors({ candidates: [{ anchor: { name: 'X', voltage_kv: 500 },
      parcels: { status: 'covered', parcels: [parcel] } }] });
    expect(o.candidates[0].parcels.parcels[0]).toEqual(
      { county: 'Loudoun', state: 'VA', acres: 223.4, acres_basis: 'gis', distance_km: 0.97 });
    expect(o.candidates[0].parcels.status).toBe('covered');
    expect(o._locked_fields).toEqual(expect.arrayContaining(S.FIND_SITES_PARCEL_LOCKED));
    expect(JSON.stringify(o)).not.toMatch(/089360535000|39\.053/);
  });
  it('a candidate whose anchor is malformed still loses the parcel detail', () => {
    const o = S._lockFindSitesAnchors({ candidates: [{ parcels: { status: 'covered', parcels: [parcel] } }] });
    expect(JSON.stringify(o)).not.toMatch(/089360535000/);
  });
  it('without parcels the locked list is the anchor list alone', () => {
    const o = S._lockFindSitesAnchors({ candidates: [{ anchor: { name: 'X' } }] });
    expect(o._locked_fields).toEqual(S.FIND_SITES_ANCHOR_LOCKED);
  });
});

describe('_listingBrowseExtras: empty land browse', () => {
  const empty = { ok: true, items: [], count: 0 };
  it('flag off: no hand-off', () => {
    delete process.env.DCHUB_POTENTIAL_LAND;
    const x = S._listingBrowseExtras(empty, { delivery_type: 'land', state: 'TX' });
    expect(x.fields.potential_land).toBeUndefined();
    expect(x.tail).not.toContain(POTENTIAL_LAND_LINE);
  });
  it('flag on: find_sites named, line in the tail', () => {
    process.env.DCHUB_POTENTIAL_LAND = 'on';
    const x = S._listingBrowseExtras(empty, { delivery_type: 'land', state: 'TX' });
    expect(x.fields.potential_land.args).toEqual({ state: 'TX', include_parcels: true });
    expect(x.tail).toContain(POTENTIAL_LAND_LINE);
  });
  it('flag on: a browse with listings, or a colocation browse, gets none', () => {
    process.env.DCHUB_POTENTIAL_LAND = 'on';
    expect(S._listingBrowseExtras({ ok: true, items: [{ slug: 'a' }], count: 1 }, { delivery_type: 'land' })
      .fields.potential_land).toBeUndefined();
    expect(S._listingBrowseExtras(empty, { delivery_type: 'colocation' }).fields.potential_land).toBeUndefined();
  });
});
