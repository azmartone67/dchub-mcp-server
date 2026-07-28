// r-hosting-capacity (2026-07-28): behaviour pins for get_hosting_capacity.
//
// This tool wraps a feed with three traps that produce CONFIDENTLY WRONG answers
// rather than errors, so each one is pinned by asserting the OUTPUT an agent
// would read — never by grepping the handler for a comment or a helper name:
//
//   (1) ROWS ≠ FEEDERS. The table stores one row per GIS geometry VERTEX, so a
//       real bbox returns ~15-28 rows per feeder. Any statistic computed over
//       rows is weighted by how many vertices a line was drawn with. The fixture
//       below is built so the ROW median (20) and the DISTINCT-FEEDER median (15)
//       differ — if folding regresses, median_mw flips to 20 and this goes red.
//   (2) capacity-DESC TRUNCATION. The feed ORDERs capacity DESC then LIMITs, so a
//       capped read is the TOP-N head, not a sample. A capped read must declare
//       sample_complete:false and the floor above which it IS complete.
//   (3) gen ≠ load. 'gen' is DER EXPORT headroom, NOT what a data-center load can
//       draw. Each capacity block must carry its own gloss, and an empty result
//       must distinguish "no utility publishes here" from "no capacity here".
//
// Offline by construction: fetch is stubbed, so this never hits prod and never
// flaps (the reason regression/mcp tests are excluded from the local run).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, FREE_FULL_TOOLS, _coordsRequired } from '../server.mjs';

const COVERAGE = {
  total_feeders: 278799,
  markets: [
    { utility: 'Rhode Island Energy', market: 'Providence · Rhode Island', capacity_type: 'gen',
      feeders: 36727, max_capacity_mw: 26.9, center: { lat: 41.7397, lng: -71.4433 },
      bbox: { south: 41.3097, west: -71.8588, north: 42.0176, east: -71.1221 }, binned: false },
    { utility: 'Ameren Illinois (load)', market: 'Ameren Illinois (load)', capacity_type: 'load',
      feeders: 20000, max_capacity_mw: 9.9, center: { lat: 39.6638, lng: -89.2693 },
      bbox: { south: 37.1665, west: -91.4257, north: 41.4652, east: -87.5872 }, binned: false },
  ],
};

// 5 vertices of a 20 MW feeder + 1 vertex of a 10 MW feeder.
//   over ROWS            → median 20  (wrong: weighted by vertex count)
//   over DISTINCT feeders → median 15  (right)
const vertex = (id, mw, i, type = 'gen') => ({
  utility: 'Rhode Island Energy', feeder_id: id, substation: 'WARREN', region: 'EAST BAY',
  voltage_kv: 23, capacity_mw_max: mw, capacity_mw_min: null, capacity_type: type,
  lat: 41.73 + i / 1000, lng: -71.28 - i / 1000, src_updated: '1756080000000',
});
const VERTEX_FIXTURE = [
  vertex('A', 20, 0), vertex('A', 20, 1), vertex('A', 20, 2), vertex('A', 20, 3), vertex('A', 20, 4),
  vertex('B', 10, 5),
];

let realFetch, routes, T;

const jsonRes = (body) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});

beforeAll(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url && url.url ? url.url : url);
    if (u.includes('/hosting-capacity/coverage')) return jsonRes(routes.coverage);
    if (u.includes('/hosting-capacity/feeders')) return jsonRes(routes.feeders);
    return jsonRes({});   // telemetry / heartbeat — swallowed, never reaches prod
  };
  T = createServer()._registeredTools['get_hosting_capacity'];
});
afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => {
  routes = { coverage: COVERAGE, feeders: { feeders: VERTEX_FIXTURE, count: VERTEX_FIXTURE.length, limit: 4000 } };
});

const call = async (args) => {
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error('zod rejected: ' + JSON.stringify(parsed.error.issues));
  const r = await T.handler(parsed.data, { signal: new AbortController().signal });
  return { isError: !!r.isError, sc: r.structuredContent };
};

describe('registration + tier', () => {
  it('is registered', () => { expect(T).toBeTruthy(); });

  it('is FREE_FULL — public utility GIS, same class as get_global_power', () => {
    expect(FREE_FULL_TOOLS.has('get_hosting_capacity')).toBe(true);
  });

  it('does NOT require coordinates — the no-arg coverage mode must survive', () => {
    expect(_coordsRequired('get_hosting_capacity', {})).toBe(false);
  });

  it('declares the coordinate aliases so lng/latitude are not silently stripped', async () => {
    const { sc } = await call({ latitude: 41.7397, lng: -71.4433 });
    expect(sc.query.mode).toBe('point');
    expect(sc.query.lat).toBe(41.7397);
    expect(sc.query.lon).toBe(-71.4433);
  });
});

describe('trap 1 — GIS vertex rows must fold to distinct feeders', () => {
  it('reports distinct feeders and raw rows as SEPARATE numbers', async () => {
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(sc.sample.distinct_feeders).toBe(2);
    expect(sc.sample.geometry_rows_scanned).toBe(6);
  });

  it('computes the median over DISTINCT feeders (15), not rows (20)', async () => {
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(sc.totals.median_mw).toBe(15);
    expect(sc.totals.feeders).toBe(2);
  });

  it('max_mw is the true max, and a feeder appears ONCE in top_feeders', async () => {
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(sc.totals.max_mw).toBe(20);
    expect(sc.top_feeders.map((f) => f.feeder_id)).toEqual(['A', 'B']);
  });

  it('keeps the NEAREST vertex of a folded feeder, not an arbitrary one', async () => {
    // Query sits on vertex i=0; every 'A' vertex marches away from it.
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    const a = sc.top_feeders.find((f) => f.feeder_id === 'A');
    expect(a.distance_km).toBe(0);
  });

  it('states the ratio MEASURED on this read (3.0x), not a hardcoded typical', async () => {
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(sc.sample.basis).toContain('6 rows into 2 distinct records (3.0x)');
  });
});

describe('trap 2 — capacity-DESC truncation must be declared', () => {
  it('an UNCAPPED read is flagged complete and carries no floor', async () => {
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(sc.sample.sample_complete).toBe(true);
    expect(sc.sample.capacity_floor_mw).toBeUndefined();
  });

  it('a CAPPED read is flagged incomplete and names the floor it IS complete above', async () => {
    // 4000 rows = the backend hard cap; last row is the lowest capacity returned.
    const capped = Array.from({ length: 4000 }, (_, i) => vertex('F' + i, 100 - i / 1000, i));
    routes.feeders = { feeders: capped, count: 4000, limit: 4000 };
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(sc.sample.sample_complete).toBe(false);
    expect(sc.sample.capacity_floor_mw).toBe(96.0);
    expect(sc.sample.truncation_note).toMatch(/COMPLETE at or above 96/);
  });
});

describe('trap 3 — gen is not load', () => {
  it('splits by capacity_type and glosses each one in-band', async () => {
    routes.feeders = { feeders: [...VERTEX_FIXTURE, vertex('C', 9.9, 9, 'load')], count: 7, limit: 4000 };
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(Object.keys(sc.capacity_by_type).sort()).toEqual(['gen', 'load']);
    expect(sc.capacity_by_type.load.means).toMatch(/what a NEW DATA-CENTER LOAD can draw/);
    expect(sc.capacity_by_type.gen.means).toMatch(/NOT available load/);
  });

  it('capacity_type filters to just that type', async () => {
    routes.feeders = { feeders: [...VERTEX_FIXTURE, vertex('C', 9.9, 9, 'load')], count: 7, limit: 4000 };
    const { sc } = await call({ lat: 41.73, lon: -71.28, capacity_type: 'load' });
    expect(Object.keys(sc.capacity_by_type)).toEqual(['load']);
    expect(sc.totals.feeders).toBe(1);
  });
});

describe('an empty result must say WHICH kind of empty it is', () => {
  it('covered area + unmatched filter → no_match_reason (never a coverage claim)', async () => {
    const { sc } = await call({ lat: 41.73, lon: -71.28, capacity_type: 'load' });
    expect(sc.no_match_reason).toMatch(/HAS published hosting capacity/);
    expect(sc.no_data_reason).toBeUndefined();
  });

  it('no published data → no_data_reason + nearest covered markets, NOT "no capacity"', async () => {
    routes.feeders = { feeders: [], count: 0, limit: 4000 };
    const { sc } = await call({ lat: 37.7749, lon: -122.4194 });
    expect(sc.no_data_reason).toMatch(/COVERAGE gap, not a finding of zero available capacity/);
    expect(sc.nearest_published_markets.length).toBeGreaterThan(0);
    expect(sc.nearest_published_markets[0].distance_km).toBeGreaterThan(0);
    expect(sc.no_match_reason).toBeUndefined();
  });
});

describe('modes + refusals', () => {
  it('no args → the coverage list, with rows labelled as rows (not feeders)', async () => {
    const { sc } = await call({});
    expect(sc.mode).toBe('coverage');
    expect(sc.covered_utilities).toBe(2);
    expect(sc.coverage[0].published_rows).toBe(36727);
    expect(sc.coverage[0].feeders).toBeUndefined();   // the inflated count must not escape as "feeders"
  });

  it('utility name resolves to that utility\'s published extent', async () => {
    const { sc } = await call({ utility: 'Ameren' });
    expect(sc.query.mode).toBe('utility');
    expect(sc.query.utility).toBe('Ameren Illinois (load)');
    expect(sc.query.bbox).toBe('-91.4257,37.1665,-87.5872,41.4652');
  });

  it('the `market` alias resolves the same way', async () => {
    const { sc } = await call({ market: 'Providence' });
    expect(sc.query.utility).toBe('Rhode Island Energy');
  });

  it('an uncovered utility is an actionable error, not a silent empty', async () => {
    const { isError, sc } = await call({ utility: 'Pacific Gas & Electric' });
    expect(isError).toBe(true);
    expect(sc.error).toBe('utility_not_covered');
    expect(sc._error_mitigation.severity).toBe('parameter_adjustment');
    expect(sc.detail).toMatch(/NOT a statement about its available capacity/);
    expect(sc.covered_utilities.length).toBe(2);
  });

  it('half a coordinate pair is REFUSED, not widened to a coverage listing', async () => {
    const { isError, sc } = await call({ lat: 41.7397 });
    expect(isError).toBe(true);
    expect(sc.error).toBe('missing_coordinates');
    expect(sc._error_mitigation.error_code).toBe('missing_coordinates');
  });

  it('out-of-range coordinates are refused', async () => {
    const { isError, sc } = await call({ lat: 999, lon: -71.44 });
    expect(isError).toBe(true);
    expect(sc.error).toBe('bad_coordinates');
  });

  it('a backend error surfaces as isError WITH the query context to retry', async () => {
    routes.feeders = { error: 'API 429', detail: 'rate_limit_exceeded' };
    const { isError, sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(isError).toBe(true);
    expect(sc.error).toBe('API 429');
    expect(sc.query.lat).toBe(41.73);
  });
});

describe('provenance', () => {
  it('every successful read carries the source and the non-binding note', async () => {
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(sc.source).toMatch(/utility-published hosting-capacity GIS/);
    expect(sc.note).toBe('Informational, not binding interconnection guidance; verify with the utility.');
    expect(sc._entity).toBe('hosting_capacity_feeders');
  });

  it('converts the epoch src_updated string into a readable publish date', async () => {
    const { sc } = await call({ lat: 41.73, lon: -71.28 });
    expect(sc.top_feeders[0].published).toBe('2025-08-25');
  });
});
