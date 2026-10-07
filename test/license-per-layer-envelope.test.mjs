// Grok 2026-10-06 item 10: one licence per envelope, and never a flat CC-BY-4.0
// over a third-party layer.
import { describe, it, expect } from 'vitest';
import { stampEnvelopeAttribution } from '../lib/attribution.mjs';

const wrap = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], structuredContent: obj });
const sc = (r) => r.structuredContent;

describe('licence per layer in the attribution envelope', () => {
  it('search_facilities: citation follows the backend "Mixed" provenance licence', () => {
    const r = stampEnvelopeAttribution(wrap({
      data: [{ id: 1 }],
      provenance: { source: 'DC Hub facilities registry', license: 'Mixed — see https://dchub.cloud/data-sources' },
      citation: { source: 'DC Hub', license: 'CC-BY-4.0', cite_as: 'DC Hub, dchub.cloud' },
    }), { toolName: 'search_facilities' });
    expect(sc(r).provenance.license).toMatch(/^Mixed/);
    expect(sc(r).citation.license).toBe(sc(r).provenance.license);
  });
  it('get_peering_intel: provenance and citation both carry the PeeringDB terms', () => {
    const r = stampEnvelopeAttribution(wrap({ connectivity: { score: 100 }, source: 'PeeringDB' }), { toolName: 'get_peering_intel' });
    expect(sc(r).provenance.license).toMatch(/PeeringDB data, not CC-BY/);
    expect(sc(r).citation.license).toBe(sc(r).provenance.license);
  });
  it('a DC Hub-derived tool keeps CC-BY-4.0 in both', () => {
    const r = stampEnvelopeAttribution(wrap({ verdict: 'BUILD' }), { toolName: 'get_market_dcpi_rank' });
    expect(sc(r).provenance.license).toBe('CC-BY-4.0');
    expect(sc(r).citation.license).toBe('CC-BY-4.0');
  });
});
