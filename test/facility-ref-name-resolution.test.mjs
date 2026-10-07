// Grok 2026-10-06 item 14: get_facility / score_facility take a name in words.
import { describe, it, expect } from 'vitest';
import { pickFacilityByName, resolveFacilityRef, looksLikeName } from '../lib/facility-ref.mjs';

const rows = [
  { slug: 'da11-irving', name: 'Equinix DA11 Dallas' },
  { slug: 'da1-dallas', name: 'Equinix DA1 Dallas' },
  { slug: 'da11-dallas', name: 'Equinix DA11 - Dallas' },
  { slug: 'infomart', name: 'Dallas Infomart Data Center' },
];

describe('facility name resolution', () => {
  it('DA1 resolves to DA1, never DA11', () => {
    expect(pickFacilityByName('Equinix DA1', rows).slug).toBe('da1-dallas');
  });
  it('matches a leading phrase and an all-words phrase', () => {
    expect(pickFacilityByName('Dallas Infomart', rows).slug).toBe('infomart');
    expect(pickFacilityByName('infomart dallas', rows).slug).toBe('infomart');
  });
  it('returns null when nothing matches or on bad input', () => {
    expect(pickFacilityByName('Equinix DA2', rows)).toBeNull();
    expect(pickFacilityByName('', rows)).toBeNull();
    expect(pickFacilityByName('x y', null)).toBeNull();
  });
  it('only words go through search; a slug or id never does', async () => {
    let calls = 0;
    const search = async () => { calls += 1; return { data: rows }; };
    expect(await resolveFacilityRef('equinix-da1-dallas-4301711e', search)).toBeNull();
    expect(await resolveFacilityRef('530d4c02-035', search)).toBeNull();
    expect(calls).toBe(0);
    expect((await resolveFacilityRef('Equinix DA1', search)).slug).toBe('da1-dallas');
    expect(looksLikeName('Equinix DA1')).toBe(true);
  });
  it('a failing search resolves to null, not a throw', async () => {
    expect(await resolveFacilityRef('Equinix DA1', async () => { throw new Error('x'); })).toBeNull();
  });
});
