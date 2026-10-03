// G-4 (2026-10-03): PeeringDB-derived answers must never carry a CC-BY-4.0
// grant. PeeringDB's AUP bars redistribution without permission.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PEERINGDB_TOOLS, PEERINGDB_LICENSE, _relicensePeeringDB } from '../server.mjs';

describe('G-4 PeeringDB licence', () => {
  it('get_peering_intel is in the relicensed set', () => {
    expect(PEERINGDB_TOOLS.has('get_peering_intel')).toBe(true);
    expect(PEERINGDB_LICENSE).not.toMatch(/^CC-BY/);
  });

  it('rewrites every CC-BY-4.0 stamp in content and structuredContent', () => {
    const r = _relicensePeeringDB({
      content: [
        { type: 'text', text: JSON.stringify({ data: [1], _source: { license: 'CC-BY-4.0' } }) },
        { type: 'text', text: 'Source: DC Hub (dchub.cloud). License CC-BY-4.0: cite this data' },
      ],
      structuredContent: { citation: { license: 'CC-BY-4.0' }, provenance: { license: 'CC-BY-4.0' } },
    });
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/CC-BY-4\.0/);
    expect(JSON.parse(r.content[0].text)._source.license).toBe(PEERINGDB_LICENSE);
    expect(r.structuredContent.provenance.license).toBe(PEERINGDB_LICENSE);
  });

  it('withCitation applies it for get_peering_intel (source wiring)', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).toMatch(/return PEERINGDB_TOOLS\.has\(toolName\) \? _relicensePeeringDB\(out\) : out;/);
  });

  it('the tool description no longer advertises IXP contacts', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).not.toContain('policy/tech contacts');
  });
});
