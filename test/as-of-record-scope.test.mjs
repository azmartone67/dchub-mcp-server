// ── provenance.as_of must describe the COLLECTION, never a row ──────────────
//
// THE DEFECT (found live 2026-08-28, authenticated, limit=25 per slice)
// `search_facilities` reported a `provenance.as_of` that was not a collection
// date. The backend correctly emits NO as_of for this surface — routes/
// provenance.py's own contract says "omit for live row-level-dated
// collections". lib/attribution.mjs then filled the gap by walking the payload,
// finding the `last_updated` on every returned ROW, and publishing the OLDEST
// as the dataset's data date.
//
// That number is an artifact of the query, not of the data. The served SQL
// orders by `confidence DESC, power_mw DESC` — nothing to do with time — so the
// SAME registry answered 2026-01 for a GB slice and 2026-07 for an IE slice,
// and the value moves with limit/offset/filters on a corpus that did not
// change. Meanwhile /api/v1/ops/deadman showed facility-snapshot-daily,
// worker:facility_discovery and daily-infra-sync all running that day.
//
// This matters more than cosmetic staleness: the MCP initialize instructions
// tell every agent to "cite every figure WITH its as_of" and treat it as the
// data date. Liveness is the product's central claim and this is the field
// that evidences it.
//
// THE CONTRACT PINNED HERE: a per-record date stays per-record. When a response
// carries only per-record dates, `as_of` is null and `as_of_basis` says so —
// the same honest shape the fiber/water tools and the anonymous arm of this
// same tool already return. NOT the oldest row. NOT the newest row either:
// taking MAX would only hide a half-dead column behind a fresher-looking
// number.
import { describe, it, expect } from 'vitest';
import {
  buildProvenance, buildCitation, collectTimestamps, stampEnvelopeAttribution,
} from '../lib/attribution.mjs';

// ── fixtures ───────────────────────────────────────────────────────────────
// Verbatim shape of GET /api/v1/facilities?country=GB&limit=25 (live capture,
// 2026-08-28) — the authenticated arm, which serves `SELECT * FROM facilities`.
// The five `last_updated` serializations below are the ones actually present in
// that TEXT column on production, with their live row counts:
//   ISO-T micros no TZ  n=14,161   |  NULL       n=7,269 (31.7%)
//   DATE-ONLY           n= 1,425   |  ISO-T + Z  n=   28
//   space-separated     n=    15
const GB_ROW_DATES = [
  '2026-01-01T03:16:24.042376',   // ISO-T micros, no TZ  (the live MIN)
  '2026-01-01T03:18:38.661354',
  '2026-02-06 18:52:49',          // space-separated, second precision, no TZ
  '2026-02-22',                   // DATE ONLY, no time at all
  '2026-02-22T01:04:28Z',         // ISO-T seconds WITH a Z
  null,                           // absent entirely
];

const BACKEND_PROVENANCE = {
  provenance_version: 1,
  source: 'DC Hub facilities registry (curated facilities table)',
  method: 'multi-source discovery + editorial curation; per-record v: verified '
        + '= passes the canonical dedup fleet filter, tracked = not yet '
        + 'fleet-verified (conservative default)',
  default_v: 'tracked',
  cite_url_template: 'https://dchub.cloud/facilities/{slug}',
  fallback_url: 'https://dchub.cloud/facilities/directory',
  license: 'Mixed — see https://dchub.cloud/data-sources',
  cite_as: 'DC Hub, dchub.cloud',
  verification_counts: { verified: 19332, tracked: 27099 },
  // ★ no `as_of` — the backend deliberately omits it for this surface.
};

function facilityRow(i, lastUpdated) {
  return {
    id: `gb-${i}`, name: `Facility ${i}`, provider: 'Acme', city: 'London',
    country: 'GB', power_mw: 10, confidence: 0.9, v: 'tracked',
    last_updated: lastUpdated,
  };
}

function facilitiesPayload(dates) {
  return {
    success: true,
    data: dates.map((d, i) => facilityRow(i, d)),
    pagination: { page: 1, limit: dates.length, total: 834 },
    provenance: { ...BACKEND_PROVENANCE },
  };
}

const asResult = (p) => ({ content: [{ type: 'text', text: JSON.stringify(p) }] });
const parse0 = (r) => JSON.parse(r.content[0].text);

// ── the contract ───────────────────────────────────────────────────────────
describe('as_of describes the collection, not the rows that happened to return', () => {
  it('per-record last_updated does NOT become the collection as_of', () => {
    const p = buildProvenance(facilitiesPayload(GB_ROW_DATES),
                              { tier: 'pro', toolName: 'search_facilities' });

    expect(p.as_of).toBeNull();
    // The oldest row date must not surface anywhere as the collection's date —
    // this is the exact value the live tool was publishing.
    expect(p.as_of_range).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain('2026-01-01T03:16:24');
  });

  it('says WHY it is unmeasured and names the per-record field', () => {
    const p = buildProvenance(facilitiesPayload(GB_ROW_DATES),
                              { tier: 'pro', toolName: 'search_facilities' });

    expect(p.as_of_basis).toMatch(/UNMEASURED/);
    expect(p.as_of_basis).toMatch(/PER-RECORD/);
    expect(p.as_of_basis).toContain('last_updated');
    expect(p.as_of_record_fields).toEqual(['last_updated']);
    // It must tell an agent where the real answer lives, since the initialize
    // instructions demand an as_of for every cited figure.
    expect(p.as_of_basis).toContain('/api/v1/ops/deadman');
  });

  it('does not fall back to MAX — a fresher-looking number hides the same defect', () => {
    const p = buildProvenance(facilitiesPayload(GB_ROW_DATES),
                              { tier: 'pro', toolName: 'search_facilities' });
    expect(JSON.stringify(p)).not.toContain('2026-02-22T01:04:28');
    expect(p.as_of_basis).toMatch(/oldest OR newest/i);
  });

  it('★ THE PROPERTY: two pages of one unchanged corpus agree on as_of', () => {
    // This is the defect stated as an invariant. The GB slice and the IE slice
    // are the same registry; the served ORDER BY is confidence/power, so which
    // dates come back is arbitrary with respect to time. Any derivation that
    // reads row dates fails here; the honest one cannot.
    const gb = buildProvenance(facilitiesPayload(GB_ROW_DATES), { tier: 'pro' });
    const ie = buildProvenance(facilitiesPayload(
      ['2026-07-27T20:20:36.576190', '2026-07-27T20:20:31.000000']), { tier: 'pro' });
    const us = buildProvenance(facilitiesPayload(
      ['2026-03-09T01:00:00.000000', '2026-08-28T09:27:31.968154']), { tier: 'pro' });

    expect(gb.as_of).toBe(ie.as_of);
    expect(ie.as_of).toBe(us.as_of);
    expect(gb.as_of).toBeNull();
  });

  it('★ is independent of the SERVER timezone', () => {
    // `2026-01-01T03:16:24.042376` carries no offset, so Date.parse reads it as
    // LOCAL time — the live gateway emitted 10:16:24Z for a row stored at
    // 03:16:24. Measured across hosts the same stored string produced
    // 2025-12-31T13:16Z … 2026-01-01T11:16Z — a 22-hour spread that crosses a
    // year boundary. Worse, a bare `2026-02-22` is parsed as UTC while
    // `2026-02-22T01:04:28` is parsed as local, so ONE column is read in two
    // zones at once. A collection date must not be a function of $TZ.
    const payload = facilitiesPayload(GB_ROW_DATES);
    const seen = new Set();
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        seen.add(JSON.stringify(buildProvenance(payload, { tier: 'pro' }).as_of));
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
    expect([...seen]).toEqual(['null']);
  });

  it('the citation an agent quotes carries no "(as of …)" it cannot support', () => {
    const payload = facilitiesPayload(GB_ROW_DATES);
    const c = buildCitation(payload, { tier: 'pro', toolName: 'search_facilities' });
    expect(c.cite_as).not.toMatch(/as of/i);
    expect(c.as_of).toBeUndefined();
  });

  it('end to end: the stamped envelope carries the honest block on both channels', () => {
    const payload = facilitiesPayload(GB_ROW_DATES);
    const out = stampEnvelopeAttribution(
      { ...asResult(payload), structuredContent: payload },
      { tier: 'pro', toolName: 'search_facilities' });

    for (const prov of [parse0(out).provenance, out.structuredContent.provenance]) {
      expect('as_of' in prov).toBe(true);     // declared, so absence is legible
      expect(prov.as_of).toBeNull();
      expect(prov.as_of_basis).toMatch(/PER-RECORD/);
      // the backend's measured fields still win / survive
      expect(prov.verification_counts.verified).toBe(19332);
      expect(prov.method).toContain('editorial curation');
    }
  });
});

// ── the other half of the contract: what must STILL work ───────────────────
describe('collection-scoped timestamps are unaffected', () => {
  it('a collection as_of inside an array element still binds (composed envelopes)', () => {
    // execute_plan nests per-step results in an array; each step's own `as_of`
    // IS a collection date for that leg, and "no fresher than the stalest leg"
    // remains the right read. Narrowing must not silence composition.
    const composed = { steps: [
      { tool: 'get_grid_data', result: { as_of: '2026-08-28T00:00:00.000Z' } },
      { tool: 'rank_markets',  result: { generated_at: '2026-03-01T00:00:00.000Z' } },
    ] };
    const p = buildProvenance(composed, { tier: 'pro' });
    expect(p.as_of).toBe('2026-03-01T00:00:00.000Z');       // stalest leg binds
    expect(p.as_of_range.newest).toBe('2026-08-28T00:00:00.000Z');
  });

  it('a record-scoped key OUTSIDE any array still binds (feed-level stamp)', () => {
    // At the envelope level `updated_at` describes the feed, not a row.
    const feed = { updated_at: '2026-08-20T00:00:00.000Z', rows: [{ id: 1 }] };
    const p = buildProvenance(feed, { tier: 'pro' });
    expect(p.as_of).toBe('2026-08-20T00:00:00.000Z');
    expect(collectTimestamps(feed)).toHaveLength(1);
  });

  it('a real backend as_of still wins over anything derived', () => {
    const payload = facilitiesPayload(GB_ROW_DATES);
    // If the backend ever DOES measure a real collection date for this surface
    // (e.g. the facility-snapshot-daily run that rebuilt the corpus), it sits
    // at `provenance.as_of` — a collection-scoped key outside any array — and
    // must still bind. Narrowing rejects ROW dates, not measured dataset dates.
    payload.provenance.as_of = '2026-08-28T06:44:00.000Z';   // e.g. the snapshot run
    const p = buildProvenance(payload, { tier: 'pro' });
    expect(p.as_of).toBe('2026-08-28T06:44:00.000Z');
    expect(p.as_of_record_fields).toBeUndefined();   // not the UNMEASURED arm
    const out = stampEnvelopeAttribution(asResult(payload), { tier: 'pro' });
    expect(parse0(out).provenance.as_of).toBe('2026-08-28T06:44:00.000Z');
  });

  it('a payload with no dates at all keeps the original UNMEASURED wording', () => {
    // The fiber/water tools and the anonymous arm of search_facilities already
    // return this exact shape — narrowing must not change it.
    const p = buildProvenance({ ok: true, data: [{ id: 1 }] }, { tier: 'pro' });
    expect(p.as_of).toBeNull();
    expect(p.as_of_basis).toMatch(/^UNMEASURED — this response carries no source timestamp/);
    expect(p.as_of_record_fields).toBeUndefined();
  });
});
