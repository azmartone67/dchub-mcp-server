// ── a row's own vintage never dates the response; the citation names the headline date ──
//
// QA 2026-10-14 MCP-3 / issue #827. Live, keyless execute_plan (the front door) for a 50 MW
// Columbus, Ohio question returned
//   citation.cite_as  "DC Hub, dchub.cloud — PARTIAL preview, 1 of 1385 shown (as of 2016-01-01)"
//   provenance.as_of  2016-01-01, as_of_basis "OLDEST of 13 source timestamps", newest 2026-10-14
// The 2016 is not a dataset date. ONE route in get_fiber_intel's features[] carries
// properties.as_of "2016", a per-feature vintage label the backend adds on purpose while its
// provenance block omits a collection as_of. The stamp collector read it as a response
// timestamp, so get_fiber_intel's own citation said "as of 2016-01-01", and the plan's
// OLDEST-of-N rule carried it to the headline. compare_sites did the same with per-substation
// rows ("as of 2014-08-28").
//
// Pinned here:
//   1. a collection key inside a data row (feature, substation) is that row's vintage, never a
//      response stamp; sub-envelopes (execute_plan steps, compare_sites sites), provenance
//      blocks and sources/sections lists still count;
//   2. the citation carries the response's stated date, or with none stated the NEWEST input;
//      provenance.as_of stays the oldest and the range keeps both ends.
import { describe, it, expect } from 'vitest';
import {
  buildProvenance, buildCitation, collectTimestamps, stampEnvelopeAttribution,
  CITE_AS_OF_NEWEST_BASIS,
} from '../lib/attribution.mjs';

const NOW = Date.parse('2026-10-14T00:36:46Z');
const stamp = (payload, toolName) => JSON.parse(stampEnvelopeAttribution(
  { content: [{ type: 'text', text: JSON.stringify(payload) }] }, { toolName, now: NOW },
).content[0].text);
const blocks = (o) => JSON.stringify({ citation: o.citation, provenance: o.provenance });
// A DATE from that year anywhere in the two blocks: a value starting with it, or YYYY-MM.
// (The backend's method prose names the 2016 vintage in words; that is not a date stamp.)
const dated = (o, yyyy) => new RegExp(`"${yyyy}|${yyyy}-\\d\\d`).test(blocks(o));

// get_fiber_intel, the shape served live: GeoJSON features, a backend provenance block that
// deliberately states no as_of, and one route carrying the 2016 vintage label.
const FIBER_PROV = {
  provenance_version: 1, provenance_revision: '1.1', basis_class: 'derived',
  source: 'DC Hub fiber_routes (surveyed carrier KMZ + NTIA middle-mile + synthetic endpoint pairs)',
  method: 'per-feature v: published or inferred; per-feature as_of flags known vintages (e.g. 2016 wayback)',
  license: 'CC-BY-4.0',
};
const route = (props = {}) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[-83.65, 41.11], [-82.99, 39.96]] },
  properties: { carrier: 'Carrier', route_type: 'longhaul', v: 'inferred', ...props },
});
const fiberPayload = (vintage = true) => ({
  features: [route(), route(vintage ? { as_of: '2016', v: 'published' } : {}), route()],
  total: 500,
  type: 'FeatureCollection',
  provenance: { ...FIBER_PROV },
});

describe('a feature or row vintage is not a response timestamp', () => {
  it('get_fiber_intel: the one 2016 route does not date the response or its citation', () => {
    const o = stamp(fiberPayload(), 'get_fiber_intel');
    expect(o.provenance.as_of).toBeNull();
    expect(o.provenance.as_of_record_fields).toEqual(['as_of']);
    expect(o.provenance.as_of_basis).toMatch(/PER-RECORD/);
    expect(o.citation.as_of).toBeUndefined();
    expect(o.citation.cite_as).not.toMatch(/as of/i);
    expect(dated(o, 2016)).toBe(false);
    // the row keeps its own vintage: it is suppressed as a response stamp, not deleted
    expect(o.features[1].properties.as_of).toBe('2016');
  });

  it('property: one route\'s vintage label cannot move the response date', () => {
    const a = buildProvenance(fiberPayload(true), { now: NOW });
    const b = buildProvenance(fiberPayload(false), { now: NOW });
    expect(a.as_of).toBe(b.as_of);
    expect(buildCitation(fiberPayload(true), { now: NOW }).cite_as)
      .toBe(buildCitation(fiberPayload(false), { now: NOW }).cite_as);
    expect(collectTimestamps(fiberPayload(true), NOW)).toEqual([]);
  });

  it('compare_sites: per-substation row dates do not date the answer', () => {
    const site = (lat, lon) => ({
      lat, lon, overall_score: 70,
      nearest_substations: { substations: [
        { name: 'Sub A', voltage_kv: 345, as_of: '2014-08-28' },
        { name: 'Sub B', voltage_kv: 138, as_of: '2019-02-01' },
      ] },
      provenance: { as_of: '2026-10-14T00:30:00Z', as_of_kind: 'retrieval',
        as_of_basis: 'retrieval time: when this answer was computed.' },
    });
    const o = stamp({ sites: [site(39.96, -82.99), site(33.45, -112.07)], winner: null }, 'compare_sites');
    expect(dated(o, 2014)).toBe(false);
    expect(dated(o, 2019)).toBe(false);
    expect(o.provenance.as_of.startsWith('2026-10-14')).toBe(true);
    expect(o.citation.cite_as).toContain('(as of 2026-10-14)');
  });
});

describe('execute_plan (the front door): the citation agents are told to quote', () => {
  // Production runs each step through the full tool pipeline (loopback), so every step result
  // is stamped by this module BEFORE the plan envelope is stamped. Mirror that here: with the
  // old collector, step 2's own provenance already said 2016 and the plan inherited it.
  const steps = [
    ['get_metro_fiber', { market: 'columbus-oh', carriers: [],
      provenance: { source: 'DC Hub metro dataset', as_of: '2026-03-17' } }],
    ['get_fiber_intel', fiberPayload()],
    ['get_market_dcpi_rank', { market: 'columbus', rank: null,
      provenance: { source: 'DCPI', as_of: '2026-10-14T00:32:58.558147+00:00' } }],
    ['get_grid_intelligence', { iso: 'PJM', as_of: '2026-10-13T23:00:00Z',
      provenance: { source: 'EIA', sources: [{ name: 'EIA-930', as_of: '2026-10-13T03:00:00Z' }] } }],
  ];
  const plan = () => ({
    _entity: 'plan_execution', ok: true, intent_class: 'fiber_power_pairing',
    executed: steps.map(([tool, payload], i) => ({
      step: i + 1, tool, status: 'executed', result: stamp(payload, tool),
    })),
  });

  it('no step and no headline says 2016', () => {
    const o = stamp(plan(), 'execute_plan');
    expect(dated(o, 2016)).toBe(false);
    for (const st of o.executed) expect(dated(st.result, 2016)).toBe(false);
  });

  it('cite_as and citation.as_of carry the newest input; provenance keeps the oldest real one', () => {
    const o = stamp(plan(), 'execute_plan');
    expect(o.citation.cite_as).toMatch(/\(as of 2026-10-14\)$/);
    expect(o.citation.as_of.startsWith('2026-10-14T00:32:58')).toBe(true);
    expect(o.citation.as_of_basis).toBe(CITE_AS_OF_NEWEST_BASIS);
    // the stalest REAL input (the metro dataset date) binds provenance.as_of and the range
    expect(o.provenance.as_of).toBe('2026-03-17');
    expect(o.provenance.as_of_basis).toMatch(/^OLDEST of \d+ source timestamps/);
    expect(o.provenance.as_of_range.oldest).toBe('2026-03-17');
    expect(o.provenance.as_of_range.newest.startsWith('2026-10-14T00:32:58')).toBe(true);
  });
});

describe('what must still count, and the citation date rule', () => {
  it('provenance sources[] and sections[] dates still count; a row-level *_provenance does not', () => {
    const p = {
      provenance: { source: 'EIA', sources: [{ name: 'EIA-930', as_of: '2026-10-01T00:00:00Z' }] },
      sections: [{ derived_from: 'grid', as_of: '2026-09-01' }],
      results: [{ id: 1, row_provenance: { as_of: '2015-01-01' } }],
    };
    const keys = collectTimestamps(p, NOW).map((s) => s.iso.slice(0, 10)).sort();
    expect(keys).toEqual(['2026-09-01', '2026-10-01']);
  });

  it('any list inside a provenance block is a statement about the data, not rows', () => {
    // `feeds` is not a named source/section list; it counts because it sits in provenance.
    const p = { provenance: { source: 'ISO', feeds: [{ name: 'load', as_of: '2026-10-02T00:00:00Z' }] },
      dcpi_provenance: { inputs: [{ as_of: '2026-10-03T00:00:00Z' }] } };
    const keys = collectTimestamps(p, NOW).map((s) => s.iso.slice(0, 10)).sort();
    expect(keys).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('a single source date is cited as is, with no basis note', () => {
    const c = buildCitation({ as_of: '2026-10-01' }, { now: NOW });
    expect(c.as_of).toBe('2026-10-01');
    expect(c.as_of_basis).toBeUndefined();
  });

  it('no stated date and several inputs: the citation names the newest, the block the oldest', () => {
    const p = { comparison: { PJM: { as_of: '2026-10-14T01:00:00Z' }, ERCOT: { as_of: '2026-10-12T02:00:00Z' } } };
    const o = stamp(p, 'compare_isos');
    expect(o.citation.as_of).toBe('2026-10-14T01:00:00.000Z');
    expect(o.citation.as_of_basis).toBe(CITE_AS_OF_NEWEST_BASIS);
    expect(o.provenance.as_of).toBe('2026-10-12T02:00:00.000Z');
  });

  it('a top-level as_of the tool states is the citation date, over a newer side stamp', () => {
    // get_market_intel shape: dataset date at the top, a computed headline stamped later
    const o = stamp({ as_of: '2026-09-26', taste: { headline: { as_of: '2026-10-14T00:00:00Z' } } },
      'get_market_intel');
    expect(o.citation.as_of).toBe('2026-09-26');
    expect(o.citation.cite_as).toContain('(as of 2026-09-26)');
    expect(o.citation.as_of_basis).toBeUndefined();
  });

  it('a backend-stated as_of is the citation date, over older stamps around it', () => {
    // get_grid_data shape: backend headline hour vs an older extended metric
    const o = stamp({
      extended_metrics: { capacity_price: { as_of: '2025-12-17T00:00:00+00:00', value: 1 } },
      provenance: { source: 'EIA', as_of: '2026-10-06T08:00:00Z' },
    }, 'get_grid_data');
    expect(o.provenance.as_of).toBe('2026-10-06T08:00:00Z');
    expect(o.citation.as_of).toBe('2026-10-06T08:00:00Z');
    expect(o.citation.cite_as).toContain('(as of 2026-10-06)');
    expect(o.provenance.as_of_range.oldest.startsWith('2025-12-17')).toBe(true);
    expect(o.provenance.as_of_basis).toMatch(/the citation uses the headline/);
  });
});
