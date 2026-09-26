// fetch cites the record's as_of (OpenAI review note, 2026-09-26): the demo's
// fetch on Level 3 Ashburn (8484) returned no as_of. The backend now stamps
// provenance.as_of from the record's last_updated; fetch carries it into
// metadata.as_of and an "As of <date>." line. Output only: the tool's name,
// description and input schema are frozen (frz-chatgpt-toolset).
import { describe, it, expect } from 'vitest';
import { _facilityFetch } from '../server.mjs';

const REC = { id: 8484, name: 'Level 3 Ashburn', city: 'Ashburn', state: 'VA', country: 'US',
  latitude: 39.02, longitude: -77.46, status: 'Operational' };

describe('fetch carries the record vintage', () => {
  it('metadata.as_of and an "As of" line from provenance.as_of', async () => {
    const api = async (path) => (path.endsWith('/carriers') ? { carrier_count: 516 }
      : { success: true, data: REC, provenance: { as_of: '2026-09-20T04:11:02Z' } });
    const r = await _facilityFetch('8484', api);
    const rec = JSON.parse(r.content[0].text);
    expect(rec.metadata.as_of).toBe('2026-09-20T04:11:02Z');
    expect(rec.text).toMatch(/As of 2026-09-20\./);
    expect(r.structuredContent.metadata.as_of).toBe('2026-09-20T04:11:02Z');
  });

  it('no provenance date: no as_of and no line, nothing invented', async () => {
    const api = async (path) => (path.endsWith('/carriers') ? null : { success: true, data: REC });
    const rec = JSON.parse((await _facilityFetch('8484', api)).content[0].text);
    expect(rec.metadata.as_of).toBeUndefined();
    expect(rec.text).not.toMatch(/As of/);
  });
});
