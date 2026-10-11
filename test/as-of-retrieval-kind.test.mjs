// analyze_site provenance (owner 2026-10-10): a backend block that says as_of_kind "retrieval"
// keeps that as_of in the block AND in the citation; per-row substation dates (the live defect:
// 2015-05-08 on an answer served that day) neither replace it nor ride beside it as a range.
import { describe, it, expect } from 'vitest';
import { stampEnvelopeAttribution } from '../lib/attribution.mjs';

const NOW = '2026-10-10T18:00:00Z';
const ROWS = { substations: [{ name: 'A', as_of: '2015-05-08' }, { name: 'B', as_of: '2024-01-02' }] };
const stamp = (payload) => JSON.parse(stampEnvelopeAttribution(
  { content: [{ type: 'text', text: JSON.stringify(payload) }] },
  { toolName: 'analyze_site', now: Date.parse(NOW) }).content[0].text);

describe('as_of_kind retrieval', () => {
  const payload = (kind) => ({
    success: true, overall_score: 81.8, nearest_substations: ROWS,
    provenance: { as_of: NOW, ...(kind ? { as_of_kind: kind } : {}),
      as_of_basis: 'retrieval time: when this answer was computed.',
      layer_dates: { nearest_substations: { oldest: '2015-05-08', newest: '2024-01-02', stale: true } },
      stale_layers: ['nearest_substations'] },
  });
  it('as_of, citation and basis all say the retrieval time; layer dates stay separate', () => {
    const o = stamp(payload('retrieval'));
    expect(o.provenance.as_of).toBe(NOW);
    expect(o.provenance.as_of_range).toBeUndefined();
    expect(o.provenance.as_of_basis).toMatch(/retrieval time/);
    expect(o.citation.as_of).toBe(NOW);
    expect(o.citation.cite_as).toContain('as of 2026-10-10');
    expect(o.provenance.layer_dates.nearest_substations.oldest).toBe('2015-05-08');
    expect(o.provenance.stale_layers).toEqual(['nearest_substations']);
  });
  it('without the kind the citation still keeps the oldest stamp (contract unchanged)', () => {
    const o = stamp(payload(null));
    expect(o.citation.as_of).toBe('2015-05-08');
  });
});
