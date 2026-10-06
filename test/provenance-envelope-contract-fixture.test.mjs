// provenance-envelope-contract-fixture.test.mjs: G-2 (2026-10-06), reader side.
//
// canonical/provenance_envelope_1_2.json is a byte copy of dchub-backend
// routes/provenance_envelope_1_2.json. The backend test pins the same sha256, so
// editing the fixture on one side fails the other side until it is re-vendored.
// This file also pins what the readers here do with a 1.2 block: accept `basis`,
// alias it to the v1.1 `basis_class`, keep `fields` entries that carry only
// {basis, source_id}, and never guess. Nothing emits revision 1.2 yet.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BASIS_CLASSES, BASIS_12, BASIS_12_TO_V11, PROVENANCE_REVISION, isBasis12, basisV11Alias,
  deriveBasisClass, mergeProvenance, buildProvenance,
} from '../lib/attribution.mjs';

const PATH = new URL('../canonical/provenance_envelope_1_2.json', import.meta.url);
// Same constant lives in dchub-backend tests/test_provenance_envelope_contract_fixture.py.
const FIXTURE_SHA256 = '740adc96fa6f69a2fa01d2307d8ef09134a5fa45cb18393a52b533e4f04215ac';
const fx = JSON.parse(readFileSync(PATH, 'utf8'));

describe('contract fixture', () => {
  it('bytes are pinned', () => {
    expect(createHash('sha256').update(readFileSync(PATH)).digest('hex')).toBe(FIXTURE_SHA256);
  });
  it('in-code enums equal the fixture', () => {
    expect([...BASIS_12]).toEqual(fx.basis);
    expect([...BASIS_CLASSES]).toEqual(fx.basis_class_v11);
    expect({ ...BASIS_12_TO_V11 }).toEqual(fx.basis_to_v11_alias);
  });
  it('alias map stays inside the v1.1 enum and covers every 1.2 value', () => {
    expect(Object.keys(BASIS_12_TO_V11).sort()).toEqual([...BASIS_12].sort());
    for (const v of Object.values(BASIS_12_TO_V11)) expect(BASIS_CLASSES).toContain(v);
  });
  it('still revision 1.1: nothing here emits 1.2', () => {
    expect(PROVENANCE_REVISION).toBe('1.1');
    expect(buildProvenance({ x: 1 }).provenance_revision ?? '1.1').toBe('1.1');
  });
  it('isBasis12 / basisV11Alias do not guess', () => {
    expect(isBasis12('modelled')).toBe(true);
    expect(isBasis12('guess')).toBe(false);
    expect(isBasis12('toString')).toBe(false);          // prototype keys are not values
    expect(isBasis12(undefined)).toBe(false);
    expect(basisV11Alias('filed')).toBe('published');
    expect(basisV11Alias('mixed')).toBe('unknown');
    expect(basisV11Alias('guess')).toBeNull();
    expect(basisV11Alias('constructor')).toBeNull();
  });
});

describe('readers accept a 1.2 block', () => {
  const sample = fx.sample_envelope;
  const derived = () => buildProvenance({ data: [{ as_of: '2026-10-03T16:00:00Z' }] });

  it('deriveBasisClass reads the alias when only `basis` is stated', () => {
    const r = deriveBasisClass({ provenance: { basis: 'filed' } });
    expect(r.basis_class).toBe('published');
  });
  it('deriveBasisClass: basis_class wins over basis; disagreement across blocks is unknown', () => {
    expect(deriveBasisClass({ provenance: { basis_class: 'measured', basis: 'modelled' } }).basis_class).toBe('measured');
    expect(deriveBasisClass({ a: { provenance: { basis: 'filed' } }, b: { provenance: { basis: 'measured' } } }).basis_class).toBe('unknown');
  });
  it('mergeProvenance: a 1.2 block with only `basis` gets the alias class, not unknown', () => {
    const out = mergeProvenance({ source: 'EIA', basis: 'modelled' }, derived());
    expect(out.basis_class).toBe('derived');
    expect(out.basis_class_rejected).toBeUndefined();
    expect(out.basis_class_basis).toMatch(/1\.2 basis \(modelled\)/);
  });
  it('mergeProvenance: the full sample envelope keeps basis, fields, sources and caveats as sent', () => {
    const out = mergeProvenance(structuredClone(sample), derived());
    expect(out.basis).toBe('measured');
    expect(out.basis_class).toBe('measured');
    expect(out.sources).toEqual(sample.sources);
    expect(out.caveats).toEqual(sample.caveats);
    expect(out.fields.demand_mw).toMatchObject({ basis: 'measured', source_id: 'eia930', basis_class: 'measured' });
    expect(out.fields.renewable_share_pct).toMatchObject({ basis: 'derived', basis_class: 'derived' });
  });
  it('mergeProvenance: an off-enum `basis` is replaced and named, never passed on', () => {
    const out = mergeProvenance({ source: 'x', basis: 'guess' }, derived());
    expect(out.basis).toBe('unknown');
    expect(out.basis_rejected).toBe('guess');
    expect(out.basis_class).toBe(derived().basis_class);   // the derived class, not an alias of junk
  });
  it('mergeProvenance: basis_class and basis that disagree keep basis_class and say so', () => {
    const out = mergeProvenance({ source: 'x', basis_class: 'measured', basis: 'modelled' }, derived());
    expect(out.basis_class).toBe('measured');
    expect(out.basis_class_basis).toMatch(/disagree/);
  });
  it('fields: a {basis, source_id} entry is kept with its alias; junk basis reads unknown', () => {
    const out = mergeProvenance({ source: 'x', basis_class: 'derived', fields: {
      ok: { basis: 'filed', source_id: 's1' },
      bad: { basis: 'guess', source_id: 's1' },
      legacy: { basis_class: 'cited', source: 'DCPI' },
      none: {},
    } }, derived());
    expect(out.fields.ok).toEqual({ basis: 'filed', source_id: 's1', basis_class: 'published' });
    expect(out.fields.bad).toEqual({ basis: 'unknown', source_id: 's1', basis_class: 'unknown' });
    expect(out.fields.legacy).toEqual({ basis_class: 'cited', source: 'DCPI' });   // v1.1 entry unchanged
    expect(out.fields.none).toEqual({ basis_class: 'unknown' });
  });
});
