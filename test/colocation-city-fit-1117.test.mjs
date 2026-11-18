// Grok colocation head-to-head 2026-11-17 midday, item 2 (owner-approved 1:03 PM MST): "Ashburn 500 kW" is searched
// as Ashburn (search_facilities city=), not the Northern Virginia metro or Virginia; rows placed in another town are
// cut after the call; and each row of a sized search says, in fit_note, when the size asked could not be checked.
// The real-server half is in planner-532-colocation-e2e.test.mjs (the NoVA 500 kW question).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { _planQuery, _execSubmarketOut, _coloScopeWidened } from '../server.mjs';
import { coloCity, coloFitNotes, coloSignals, COLO_METROS } from '../lib/colocation-plan.mjs';

const metro = (id) => COLO_METROS.find((m) => m.id === id);
const search = (p) => p.recommended_sequence.find((s) => s.tool === 'search_facilities');

describe('the town a colocation ask names', () => {
  it('a town inside the metro is that town, title-cased', () => {
    expect(coloCity('Ashburn 500 kW', metro('northern-virginia'))).toBe('Ashburn');
    expect(coloCity('Colocation options in Northern Virginia (Ashburn) for about 500 kW', metro('northern-virginia'))).toBe('Ashburn');
    expect(coloCity('colo in richardson', metro('dallas'))).toBe('Richardson');
    expect(coloCity('cabinets in Fort Worth', metro('dallas'))).toBe('Fort Worth');
    expect(coloCity('colo in Duluth, GA', metro('atlanta'))).toBe('Duluth');
  });
  it('a county, region, building, the metro\'s own search word, or two towns is not one town', () => {
    expect(coloCity('colocation in Loudoun County', metro('northern-virginia'))).toBe(null);
    expect(coloCity('colocation in Northern Virginia', metro('northern-virginia'))).toBe(null);
    expect(coloCity('colocation in Dallas', metro('dallas'))).toBe(null);
    expect(coloCity('colocation in DFW', metro('dallas'))).toBe(null);
    expect(coloCity('colo at 350 E Cermak', metro('chicago'))).toBe(null);
    expect(coloCity('colo at 60 Hudson in Manhattan', metro('new-york'))).toBe(null);
    expect(coloCity('colocation in Ashburn and Sterling', metro('northern-virginia'))).toBe(null);
    expect(coloCity('Ashburn', null)).toBe(null);
  });
  it('a facility pair and a two-metro comparison carry no town', () => {
    expect(coloSignals('Compare Equinix DC2 vs CoreSite VA1 for colocation in Ashburn', {}).city).toBe(null);
    expect(coloSignals('Compare colocation in Ashburn vs Dallas for 1 MW', {}).city).toBe(null);
    expect(coloSignals('colocation in Ashburn for 500 kW', {}).city).toBe('Ashburn');
  });
});

describe('the plan for "Ashburn 500 kW"', () => {
  it('searches Ashburn with the size, kept to VA: not the metro query and not the state alone', () => {
    const p = _planQuery('Ashburn 500 kW colocation', {});
    expect(p.intent_class).toBe('colocation');
    expect(search(p).args_hint).toEqual({ city: 'Ashburn', state: 'VA', limit: 10, min_capacity_mw: 0.5 });
    expect(search(p).why).toMatch(/Facilities in Ashburn \(city filter, kept to VA\)/);
    expect(p.recommended_sequence[0].args_hint).toEqual({ market_slug: 'northern-virginia' });
  });
  it('is not disclosed as widened: the search read the town asked', () => {
    const cs = coloSignals('Ashburn 500 kW colocation', {});
    expect(_coloScopeWidened(cs, null, null)).toBe(null);
    // control: without the town, an Ashburn-alias ask that only reads the metro is disclosed at the metro grain
    expect(_coloScopeWidened({ ...cs, city: null }, null, null)).toEqual({ widened_from: 'Ashburn', to: 'Northern Virginia metro', grain: 'metro' });
  });
});

describe('fit notes', () => {
  const body = (rows, notApplied) => ({ data: rows, ...(notApplied ? { _params_not_applied: ['min_capacity_mw'] } : {}) });
  it('a size the read could not apply: every row says so', () => {
    const out = coloFitNotes(body([{ name: 'A', city: 'Ashburn' }, { name: 'B', city: 'Ashburn', power_mw: 12 }], true), 500);
    expect(out.data.map((r) => r.fit_note)).toEqual([
      'Size not checked: the 500 kW asked was not applied to this row, because capacity is not in this read.',
      'Size not checked: the 500 kW asked was not applied to this row, because capacity is not in this read.',
    ]);
  });
  it('a size the read applied: a row with capacity on record needs no note; one without says it could not be compared', () => {
    const out = coloFitNotes(body([{ name: 'A', power_mw: 12 }, { name: 'B', power_mw: null }], false), 500);
    expect(out.data[0].fit_note).toBeUndefined();
    expect(out.data[1].fit_note).toBe('Size not checked: this facility has no capacity on record, so the 500 kW asked could not be compared.');
  });
  it('nothing to note: the same object back; the input rows are never mutated', () => {
    const b = body([{ name: 'A', power_mw: 12 }], false);
    expect(coloFitNotes(b, 500)).toBe(b);
    expect(coloFitNotes(b, null)).toBe(b);
    const b2 = body([{ name: 'A' }], true);
    coloFitNotes(b2, 500);
    expect(b2.data[0].fit_note).toBeUndefined();
    expect(coloFitNotes('not a body', 500)).toBe('not a body');
  });
});

describe('the executor: the town search is cut to the town, a pair search is not', () => {
  const sig = (text) => ({ __colo: coloSignals(text, {}) });
  const out = () => ({ ok: true, result: { _params_not_applied: ['min_capacity_mw'], data: [
    { name: 'NTT Ashburn VA7', city: 'Ashburn' }, { name: 'CyrusOne Sterling NVA9', city: 'Sterling' }, { name: 'CoreSite VA1', city: 'Reston' }] } });

  it('city search: other towns cut and counted, Ashburn rows noted', () => {
    const o = out();
    const scope = _execSubmarketOut('search_facilities', o, sig('Ashburn 500 kW colocation'), { city: 'Ashburn', state: 'VA', min_capacity_mw: 0.5 });
    expect(o.result.data.map((r) => r.name)).toEqual(['NTT Ashburn VA7']);
    expect(o.result.data[0].fit_note).toMatch(/^Size not checked: the 500 kW asked/);
    expect(scope).toMatchObject({ submarket: 'Ashburn', kept: 1, dropped_outside_submarket: 2 });
  });
  it('a search the town did not drive (a facility pair, the metro query) keeps every row', () => {
    const o = out();
    expect(_execSubmarketOut('search_facilities', o, sig('Compare Equinix DC2 vs CoreSite VA1 for colocation in Ashburn'), { query: 'CoreSite VA1', state: 'VA' })).toBe(null);
    expect(o.result.data).toHaveLength(3);
    const o2 = out();
    expect(_execSubmarketOut('search_facilities', o2, sig('colocation in Loudoun County for 500 kW'), { query: 'Northern Virginia', state: 'VA', min_capacity_mw: 0.5 })).toBe(null);
    expect(o2.result.data).toHaveLength(3);
    expect(o2.result.data.every((r) => /^Size not checked/.test(r.fit_note))).toBe(true);
  });
  it('an unsized search gets no fit note', () => {
    const o = out();
    _execSubmarketOut('search_facilities', o, sig('colo cage in Ashburn'), { city: 'Ashburn', state: 'VA' });
    expect(o.result.data.map((r) => r.fit_note)).toEqual([undefined]);
  });
});

// Item 1 (owner 2026-11-17 "Specs, no address"): the allowlist every keyless and free-key facility answer is projected
// to (server.mjs _FACILITY_FREE_FIELDS, via _maskFacilityFieldsForFree) carries the specs, and still not the street
// address or power. Read from the source: the set is module-private.
describe('item 1: the keyless facility allowlist', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const _FACILITY_FREE_FIELDS = new Set(['), src.indexOf(']);', src.indexOf('const _FACILITY_FREE_FIELDS = new Set([')));
  const keys = new Set([...block.replace(/\/\/[^\n]*/g, '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  it('carries the specs and the operator', () => {
    for (const k of ['floor_space_sqft', 'tier_level', 'certifications', 'source_url', 'operator_url', 'specs_not_on_record', 'operator', 'provider', 'facility_type']) {
      expect(keys.has(k), k).toBe(true);
    }
  });
  it('does not carry the street address, power or the raw record', () => {
    for (const k of ['address', 'address1', 'street_address', 'power_mw', 'raw_data', 'source']) expect(keys.has(k), k).toBe(false);
  });
});
