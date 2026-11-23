// Grok daily adoption loop 2026-11-23, item 1: the cite an agent speaks says "as of YYYY-MM-DD" in
// America/Phoenix, never a time of day and never the UTC serve clock (lib/cite-day.mjs).
import { describe, it, expect } from 'vitest';
import { phoenixDay, phoenixToday, citeDayText, citeDayDeep } from '../lib/cite-day.mjs';
import { stampOutreach, citeAsFor } from '../lib/agent-outreach.mjs';
import { buildCitation } from '../lib/attribution.mjs';

describe('phoenixDay', () => {
  it('a plain date is that date; a timestamp is its Phoenix (UTC-7) day', () => {
    expect(phoenixDay('2026-11-23')).toBe('2026-11-23');
    expect(phoenixDay('2026-11-23T05:00:00.000Z')).toBe('2026-11-22');
    expect(phoenixDay('2026-11-23T07:00:00Z')).toBe('2026-11-23');
    expect(phoenixDay('2026-11-23T06:59Z')).toBe('2026-11-22');
    expect(phoenixDay('2026-11-23T14:42:06.214Z')).toBe('2026-11-23');
    expect(phoenixDay('2026-11-23T04')).toBe('2026-11-22');              // EIA hour, no zone = UTC
    expect(phoenixDay('2026-11-23T01:00:00+00:00')).toBe('2026-11-22');
    expect(phoenixDay('2026-11-23T01:00:00-07:00')).toBe('2026-11-23');
    expect(phoenixDay('not a date')).toBeNull();
    expect(phoenixDay(null)).toBeNull();
    expect(phoenixToday(Date.parse('2026-11-24T03:00:00Z'))).toBe('2026-11-23');
  });
});

describe('citeDayText / citeDayDeep', () => {
  it('rewrites every "as of <timestamp>" and leaves a date-only cite untouched', () => {
    expect(citeDayText('DC Hub (dchub.cloud), as of 2026-11-23T05:00:00.000Z')).toBe('DC Hub (dchub.cloud), as of 2026-11-22');
    expect(citeDayText('DC Hub, dchub.cloud — PARTIAL preview (not the full dataset) (as of 2026-11-23T15:00Z)'))
      .toBe('DC Hub, dchub.cloud — PARTIAL preview (not the full dataset) (as of 2026-11-23)');
    const plain = 'DC Hub (dchub.cloud), as of 2026-11-23';
    expect(citeDayText(plain)).toBe(plain);
    expect(citeDayText('DC Hub (dchub.cloud) - headline unmeasured in this response, no data date')).toMatch(/no data date$/);
  });
  it('reaches nested cite_as keys (plan citations[]) and nothing else', () => {
    const sc = { as_of: '2026-11-23T15:00:00Z', citations: [{ step: 2, as_of: '2026-11-23', cite_as: 'X (as of 2026-11-23T15:00Z)' }],
      citation: { cite_as: 'Y (as of 2026-11-23T05:00Z)', as_of: '2026-11-23T05:00:00Z' } };
    const out = citeDayDeep(sc);
    expect(out.citations[0].cite_as).toBe('X (as of 2026-11-23)');
    expect(out.citation.cite_as).toBe('Y (as of 2026-11-22)');
    expect(out.citation.as_of).toBe('2026-11-23T05:00:00Z');   // the machine field keeps the hour
    expect(out.as_of).toBe('2026-11-23T15:00:00Z');
    expect(sc.citations[0].cite_as).toBe('X (as of 2026-11-23T15:00Z)');   // input not mutated
    const same = { a: { cite_as: 'Z, as of 2026-11-23' } };
    expect(citeDayDeep(same)).toBe(same);
  });
});

describe('stampOutreach: no cite an agent can quote carries a time of day', () => {
  it('top-level, citation and per-step cites are all Phoenix days', () => {
    const r = stampOutreach({ content: [{ type: 'text', text: 'x' }], structuredContent: {
      cite_as: 'DC Hub (dchub.cloud), as of 2026-11-23T05:00:00.000Z',
      citation: { cite_as: 'DC Hub, dchub.cloud (as of 2026-11-23T14:42:06.214Z)' },
      citations: [{ cite_as: 'DC Hub, dchub.cloud — PARTIAL preview (not the full dataset) (as of 2026-11-23T15:00Z)' }],
    } }, 'execute_plan', {});
    const sc = r.structuredContent;
    expect(sc.cite_as).toBe('DC Hub (dchub.cloud), as of 2026-11-22');
    expect(sc.citation.cite_as).toBe('DC Hub, dchub.cloud (as of 2026-11-23)');
    expect(sc.citations[0].cite_as).toMatch(/\(as of 2026-11-23\)$/);
    expect(JSON.stringify(r)).not.toMatch(/as of \d{4}-\d{2}-\d{2}T/);
  });
});

describe('the day every builder writes', () => {
  it('a month-only date keeps its month (no Phoenix shift into the previous month)', () => {
    expect(citeAsFor({ citation: { cite_as: 'DC Hub, dchub.cloud' }, provenance: { as_of: '2026-08' } }))
      .toBe('DC Hub (dchub.cloud), as of 2026-08-01');
  });
  it('buildCitation says the Phoenix day and keeps the timestamp in as_of', () => {
    const c = buildCitation({}, {}, { as_of: '2026-11-23T05:00:00Z', retrieved_at: '2026-11-23T16:00:00Z', completeness: 'unrestricted' });
    expect(c.cite_as).toMatch(/\(as of 2026-11-22\)$/);
    expect(c.as_of).toBe('2026-11-23T05:00:00Z');
  });
});
