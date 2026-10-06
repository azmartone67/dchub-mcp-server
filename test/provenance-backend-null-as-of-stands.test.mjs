// provenance-backend-null-as-of-stands.test.mjs: G-2 quick fix 5c (2026-10-06), MCP half.
//
// MEASURED live before: get_interconnection_queue's provenance.as_of was today's date
// (the payload's top-level `as_of` is the latest INGEST date), over an ERCOT report dated
// 2026-08-31. mergeProvenance replaced a backend `as_of: null` with the derived stamp, and the
// derived stamp read the payload's top-level load date. dchub-backend now sends as_of null with
// its own as_of_basis ("UNMEASURED ...") plus fetched_at when a collection has no report date.
// This pins: that null stands, the citation does not date the answer, fetched_at passes through,
// and a backend that sends null WITHOUT a reason still gets the derived fallback as before.
import { describe, it, expect } from 'vitest';
import { buildProvenance, mergeProvenance, stampEnvelopeAttribution } from '../lib/attribution.mjs';

const NOW = Date.parse('2026-10-06T11:00:00Z');
const BASIS = 'UNMEASURED at collection level: MISO, PJM are live feeds with no published report date.';
const payload = () => ({
  as_of: '2026-10-06',                        // the documented top-level field: latest ingest date
  data_as_of: '2026-10-05T23:00:00',          // a second, zoneless stamp, so the derived block has a range and a zone
  by_iso: [{ iso: 'MISO', as_of: '2026-10-06', source_as_of: '2026-10-06' }],
  provenance: { provenance_version: 1, source: 'US ISO public interconnection queues',
    as_of: null, as_of_basis: BASIS, fetched_at: '2026-10-06T10:16:06+00:00', basis_class: 'published' },
});

describe('a backend as_of null with its own reason stands', () => {
  it('control: the derived block WOULD carry a date, a range and a zone to leak', () => {
    const d = buildProvenance(payload(), { now: NOW });
    expect(d.as_of).toBeTruthy();
    expect(d.as_of_range).toBeTruthy();
    expect(d.as_of_zone).toBe('unstated');
  });
  it('mergeProvenance keeps null, the backend reason and fetched_at', () => {
    const p = payload();
    const out = mergeProvenance(p.provenance, buildProvenance(p, { now: NOW }));
    expect(out.as_of).toBeNull();
    expect(out.as_of_basis).toBe(BASIS);
    expect(out.fetched_at).toBe('2026-10-06T10:16:06+00:00');
    expect(out.as_of_range).toBeUndefined();
    expect(out.as_of_zone).toBeUndefined();
  });
  it('a backend that sends as_of_zone keeps it', () => {
    const p = payload(); p.provenance.as_of_zone = 'unstated';
    expect(mergeProvenance(p.provenance, buildProvenance(p, { now: NOW })).as_of_zone).toBe('unstated');
  });
  it('control: null with NO reason still falls back to the derived date and basis', () => {
    const p = payload(); delete p.provenance.as_of_basis;
    const d = buildProvenance(p, { now: NOW });
    const out = mergeProvenance(p.provenance, d);
    expect(out.as_of).toBe(d.as_of);
    expect(out.as_of_basis).toBe(d.as_of_basis);
  });
  it('control: an empty-string reason is not a reason', () => {
    const p = payload(); p.provenance.as_of_basis = '  ';
    const d = buildProvenance(p, { now: NOW });
    expect(mergeProvenance(p.provenance, d).as_of).toBe(d.as_of);
  });
  it('control: a dated backend block is unchanged', () => {
    const p = payload(); p.provenance.as_of = '2026-08-31';
    expect(mergeProvenance(p.provenance, buildProvenance(p, { now: NOW })).as_of).toBe('2026-08-31');
  });
});

describe('through the real stamp', () => {
  it('structuredContent provenance and citation do not date the answer', () => {
    const p = payload();
    const res = stampEnvelopeAttribution({ content: [{ type: 'text', text: JSON.stringify(p) }],
      structuredContent: p }, { now: NOW, tool: 'get_interconnection_queue' });
    const sc = res.structuredContent;
    expect(sc.provenance.as_of).toBeNull();
    expect(sc.provenance.as_of_basis).toBe(BASIS);
    expect(sc.provenance.fetched_at).toBe('2026-10-06T10:16:06+00:00');
    expect(sc.citation.as_of ?? null).toBeNull();
    expect(JSON.stringify(sc.citation)).not.toMatch(/as of 2026-10-06/);
  });
});
