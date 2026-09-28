// fetch carries the backend's unverified-directory-listing marker
// (r-unverified-fetch, 2026-09-28). Live 05:10Z, fetch id=568 — a Cloudscene
// row the backend labels on /api/v1/* — printed "Status: Operational. ...
// Record verified." fetch rebuilds the record, so the marker has to be carried
// here. Output only: the tool's name, description and input schema are frozen
// (frz-chatgpt-toolset).
import { describe, it, expect } from 'vitest';
import { _facilityFetch } from '../server.mjs';

const CS = { id: 568, name: 'Stack Portland 1', provider: 'Stack', city: 'Hillsboro',
  state: 'OR', country: 'US', status: 'Operational' };
const CONTROL = { id: 11109, name: 'Microsoft Mount Pleasant AI Campus', provider: 'Microsoft',
  city: 'Mount Pleasant', state: 'WI', country: 'US', status: 'Under Construction', v: 'verified' };

const run = async (rec) => {
  const api = async (path) => (path.endsWith('/carriers') ? null : { success: true, data: rec });
  const r = await _facilityFetch(String(rec.id), api);
  return { r, rec: JSON.parse(r.content[0].text) };
};

describe('fetch: unverified directory listing', () => {
  // Each marker the backend can send, alone, with a status it should have
  // dropped still present (an older path) — fetch must not print either.
  for (const marker of [
    { verification: 'unverified_directory_listing' },
    { v: 'unverified' },
    { listing: 'Unverified directory listing' },
  ]) {
    it(`marked by ${Object.keys(marker)[0]}: no status, no "verified", labelled`, async () => {
      const { r, rec } = await run({ ...CS, ...marker, v: marker.v || 'verified' });
      expect(rec.metadata.verification).toBe('unverified_directory_listing');
      expect(rec.metadata.status).toBeNull();
      expect(rec.text).not.toMatch(/Status:/);
      expect(rec.text).not.toMatch(/Operational/);
      expect(rec.text).not.toMatch(/Record verified/);
      expect(rec.text).toMatch(/Unverified directory listing/);
      expect(r.structuredContent.metadata.verification).toBe('unverified_directory_listing');
    });
  }

  it('an ordinary record is unchanged: status, "Record verified", no marker', async () => {
    const { rec } = await run(CONTROL);
    expect(rec.metadata.status).toBe('Under Construction');
    expect(rec.metadata.verification).toBeUndefined();
    expect(rec.text).toMatch(/Status: Under Construction\./);
    expect(rec.text).toMatch(/Record verified\./);
    expect(rec.text).not.toMatch(/Unverified/);
  });
});
