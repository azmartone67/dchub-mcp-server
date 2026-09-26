// ── /mcp/chatgpt before the OpenAI resubmission (Grok no-key verify, 2026-09-25) ──
//
// B1 subscribe_digest was listed with readOnlyHint:false — every tool must be read-only.
// B2 paid-layer copy leaked: canvas "…is the paid layer", "Paid-tier synthesis prose only".
// B3 weak reviewer-visible results: the canvas answered "0 markets" (default
//    verdict BUILD,CAUTION), search returned "Golds Gym Ashburn", fetch printed
//    "Market n/a" and no location although the record had one.
// B4 a PJM-DOM outage exposed "budget_exhausted … spend the free 250 wisely
//    (owner directive …)" and env var names.
import { describe, it, expect } from 'vitest';
import { DIRECTORY_TOOLS, DIRECTORY_REMOVED, DIRECTORY_INSTRUCTIONS, scrubText, scrubToolResult,
  applyDirectoryArgDefaults } from '../lib/chatgpt-directory.mjs';
import { _isNonDcName, _facilityFetchRecord } from '../server.mjs';

describe('B1: every tool on the profile is read-only', () => {
  it('subscribe_digest is removed, and the instructions no longer name it', () => {
    expect(Object.keys(DIRECTORY_TOOLS)).not.toContain('subscribe_digest');
    expect(DIRECTORY_REMOVED).toContain('subscribe_digest');
    expect(DIRECTORY_INSTRUCTIONS).not.toMatch(/subscribe_digest|email/i);
    expect(DIRECTORY_INSTRUCTIONS).toMatch(/Every tool is a read-only lookup/);
  });
});

describe('B2: paid-layer copy is scrubbed', () => {
  it('drops the canvas and coverage sentences, keeps the data sentence', () => {
    expect(scrubText('The #1 pick and build sequence is the paid layer.')).toBe('');
    expect(scrubText('Paid-tier synthesis prose only.')).toBe('');
    expect(scrubText('12 markets matched. The decision layer is the paid layer.')).toBe('12 markets matched.');
  });
});

describe('B3: reviewer-visible results', () => {
  it('the canvas defaults to verdict ALL on the profile; an explicit verdict wins', () => {
    expect(applyDirectoryArgDefaults('site_selection_canvas', { region: 'VA' })).toEqual({ region: 'VA', verdict: 'ALL' });
    expect(applyDirectoryArgDefaults('site_selection_canvas', { verdict: 'BUILD' })).toEqual({ verdict: 'BUILD' });
    expect(applyDirectoryArgDefaults('search', { query: 'x' })).toEqual({ query: 'x' });
  });

  it('search drops a clear non-DC business, never a data-center name', () => {
    expect(_isNonDcName('Golds Gym Ashburn')).toBe(true);
    expect(_isNonDcName('Ashburn Pizza & Grill')).toBe(true);
    for (const n of ['Equinix DC1-DC15, DC21 - Ashburn', 'PowerHouse ABX-1', 'Ragingwire Data Centers Ashburn Va 5',
                     'Quality Technology Services Ashburn Shellhorn Dc2', 'CloudHQ Ashburn Campus', 'Gym Data Center LLC'])
      expect(_isNonDcName(n), n).toBe(false);
  });

  it('fetch states what the keyless record holds, with no "n/a" lines', () => {
    const d = { city: 'Ashburn', state: 'VA', country: 'US', connectivity_note: '498 on-site fiber carrier(s)',
      coordinates_status: 'approximate_2dp', latitude: 39.02, longitude: -77.46,
      name: 'Equinix DC1-DC15, DC21 - Ashburn', status: 'Operational', v: 'verified' };
    const r = _facilityFetchRecord('equinix-dc1', d, 'https://dchub.cloud/facility/equinix-dc1');
    expect(r.text).not.toMatch(/n\/a/);
    expect(r.text).toMatch(/Market: ashburn-va\./);
    expect(r.text).toMatch(/Approximate location: 39\.02, -77\.46\./);
    expect(r.text).toMatch(/Connectivity: 498 on-site fiber carrier\(s\)\./);
    expect(r.text).toMatch(/Status: Operational\./);
    expect(r.metadata).toMatchObject({ market: 'ashburn-va', lat: 39.02, lon: -77.46, coordinates: 'approximate',
      city: 'Ashburn', state: 'VA' });
  });
});

describe('fetch market for a metro the planner table has no slug for', () => {
  it('7453 CoreSite - Secaucus (NY3) prints Market: New York Metro', () => {
    const r = _facilityFetchRecord('7453', { name: 'CoreSite - Secaucus (NY3)', city: 'Secaucus', state: 'NJ',
      latitude: 40.78, longitude: -74.06, status: 'Operational' }, 'https://dchub.cloud/facility/7453');
    expect(r.text).toMatch(/Market: New York Metro\./);
    expect(r.metadata.market).toBe('New York Metro');
  });
});

describe('B4: a source outage is one plain line', () => {
  const OUT = { region: 'PJM-DOM', iso: 'PJM', zone: 'DOMINION', source_unavailable: true, temporary: true,
    retry_after_utc: '2026-10-01T00:00:00Z',
    needs: 'GRIDSTATUS_API_KEY (provisioned) or PJM_API_KEY (dataminer2.pjm.com)',
    note: 'budget_exhausted: spend the free 250 wisely (owner directive 2026-07-26)',
    message: 'gridstatus budget_exhausted for this month',
    source_errors: { gridstatus_pjm_load: 'budget_exhausted' } };

  it('keeps the region and retry time, drops the plumbing, says try PJM', () => {
    const r = scrubToolResult({ content: [{ type: 'text', text: JSON.stringify(OUT) }], structuredContent: OUT });
    const all = JSON.stringify(r);
    for (const bad of ['budget', 'owner directive', 'GRIDSTATUS_API_KEY', 'PJM_API_KEY', 'spend the free', 'source_errors', 'needs'])
      expect(all, bad).not.toContain(bad);
    expect(r.structuredContent).toMatchObject({ region: 'PJM-DOM', source_unavailable: true,
      retry_after_utc: '2026-10-01T00:00:00Z',
      message: 'This data source is temporarily unavailable. Try region PJM for the ISO-wide view.' });
  });

  it('env var names and owner-directive prose are scrubbed anywhere', () => {
    expect(scrubText('Set GRIDSTATUS_API_KEY to restore it.')).toBe('');
    expect(scrubText('Per owner directive, do not retry.')).toBe('');
  });
});
