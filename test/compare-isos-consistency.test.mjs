// Grok "Note K" item 6 (2026-11-15): compare_isos consistency.
//
// Measured live 2026-11-15 on execute_plan "ERCOT vs PJM vs MISO":
//   (a) the compare_isos step said `isos: ["ERCOT"]` for a three-grid comparison (the step slim cut
//       every array to its first row, the scope list included);
//   (b) ERCOT's queue_depth_gw is its GENERATION queue, but queue_depth_basis said 'large_load';
//   (c) the direct call cited "3 of 21 shown" and the plan envelope "1 of 21 shown" for the same
//       withheld field: 3 = hourly demand rows kept per grid, 21 = ONE grid's (PJM) hour count, and
//       the plan's 1 was the size slim cutting the tier preview's rows again;
//   (d) PJM and MISO queue figures carried no date (their feeds publish none) and nothing said so.
import { describe, it, expect } from 'vitest';
import { shapeGridIntelligence, trimForTrial, _slimStepResult } from '../server.mjs';
import { detectGating, buildCitation, buildProvenance } from '../lib/attribution.mjs';
import { extractLockedFromPayload } from '../lib/continuation.mjs';

const NO_GRID = { error: 'API 503' };
const NO_CMP = { isos: [] };
// Row shapes as /api/v1/interconnection-queue/snapshot served them live 2026-11-15.
const QSNAP = { by_iso: [
  { iso: 'ERCOT', as_of: '2026-11-15', queue_kind: 'large_load', queued_load_total_gw: 474.0,
    queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-10-31',
    queued_load_dc_share_pct: 90.0, source_as_of: '2026-10-31', source_as_of_basis: 'published_report',
    last_refreshed: '2026-11-15T06:00:41.158406+00:00',
    source_name: 'ERCOT large-load queue (Senate presentation Jul 29 2026; June 19 LLWG) + generation queue (Oct 31 2026)',
    source_report: 'ERCOT GIS Report, October 2026 (posted 2026-11-02), Summary sheet (generation queue); ERCOT Senate presentation Jul 29 2026, June 2026 data (large load)',
    queued_generation_gw_source: 'cited: ERCOT GIS Report, October 2026 (posted 2026-11-02), Summary sheet: 1,847 generation interconnection or change requests, 461,414 MW (~461.4 GW) under study as of Oct 31 2026' },
  { iso: 'PJM', as_of: null, queue_kind: 'generation_queue', queued_generation_gw: 373.6,
    queued_generation_gw_as_of: null, source_as_of: '2026-11-15', source_as_of_basis: 'live_feed_fetch_date',
    fetched_at: '2026-11-15T06:00:51.937636+00:00', last_refreshed: '2026-11-15T06:00:51.937636+00:00',
    source_name: 'PJM cycle + serial service request status (active generation requests, sum of MFO)' },
  { iso: 'MISO', as_of: null, queue_kind: 'generation_queue', queued_generation_gw: 260.0,
    queued_generation_gw_as_of: null, source_as_of: '2026-11-15', source_as_of_basis: 'live_feed_fetch_date',
    fetched_at: '2026-11-15T06:00:52.238887+00:00', last_refreshed: '2026-11-15T06:00:52.238887+00:00',
    source_name: 'MISO GI Queue API (applicationStatus=Active, summer MW)' },
  { iso: 'CAISO', as_of: '2026-11-15', queue_kind: 'generation_queue', queued_generation_gw: 250.1,
    source_as_of: '2026-10-28', source_as_of_basis: 'source_file_date', last_refreshed: '2026-11-15T06:00:50Z',
    source_name: 'CAISO queue report' },
] };

describe('(b) which queue each ERCOT number comes from', () => {
  it('queue_depth_basis names what queue_depth_gw carries: the generation queue, ERCOT included', () => {
    for (const iso of ['ERCOT', 'PJM', 'MISO']) {
      const out = shapeGridIntelligence(iso, NO_GRID, NO_CMP, QSNAP);
      expect(out.queue_depth_basis, iso).toBe('generation_queue');
    }
    expect(shapeGridIntelligence('ERCOT', NO_GRID, NO_CMP, QSNAP).queue_depth_gw).toBe(461.4);
  });
  it('ERCOT names both queues and their sources, and no figure rides in the label', () => {
    const out = shapeGridIntelligence('ERCOT', NO_GRID, NO_CMP, QSNAP);
    expect(out.queue_depth_source).toMatch(/ERCOT GIS Report/);
    expect(out.queue_kinds_note).toMatch(/GENERATION interconnection queue/);
    expect(out.queue_kinds_note).toMatch(/LARGE-LOAD/);
    expect(out.queue_kinds_note).toMatch(/data_center_load/);
    // the withheld numbers must not leak through a label
    for (const k of ['queue_depth_source', 'queue_kinds_note']) {
      expect(out[k]).not.toMatch(/461|474|90(\.0)?\s*%/);
    }
    expect('queue_kinds_note' in shapeGridIntelligence('PJM', NO_GRID, NO_CMP, QSNAP)).toBe(false);
  });
  it('the labels survive the free-tier trim; the figure stays withheld', () => {
    const t = trimForTrial(shapeGridIntelligence('ERCOT', NO_GRID, NO_CMP, QSNAP), 'compare_isos');
    expect(t.queue_depth_gw).toBe(null);
    expect(t.queue_depth_basis).toBe('generation_queue');
    expect(t.queue_depth_source).toMatch(/ERCOT GIS Report/);
    expect(t.queue_depth_as_of).toBe('2026-10-31');
    expect(t.queue_kinds_note).toMatch(/LARGE-LOAD/);
  });
});

describe('(d) every queue figure carries its own date, or says it has none', () => {
  it('ERCOT: the published report date', () => {
    const out = shapeGridIntelligence('ERCOT', NO_GRID, NO_CMP, QSNAP);
    expect(out.queue_depth_as_of).toBe('2026-10-31');
    expect(out.queue_depth_as_of_basis).toBe('published_report');
  });
  it('PJM and MISO: no source date exists, so as_of is null and the collection time is named', () => {
    for (const iso of ['PJM', 'MISO']) {
      const out = shapeGridIntelligence(iso, NO_GRID, NO_CMP, QSNAP);
      expect(out.queue_depth_as_of, iso).toBe(null);   // never the fetch time under a data-date name
      expect(out.queue_depth_as_of_basis, iso).toMatch(/^none_published/);
      expect(out.queue_depth_collected_at, iso).toBe(QSNAP.by_iso.find((r) => r.iso === iso).fetched_at);
    }
  });
  it('a file-dated feed keeps its file date', () => {
    const out = shapeGridIntelligence('CAISO', NO_GRID, NO_CMP, QSNAP);
    expect(out.queue_depth_as_of).toBe('2026-10-28');
    expect(out.queue_depth_as_of_basis).toBe('source_file_date');
  });
});

// The trimmed compare_isos shape (trimForTrial per ISO keeps 3 hourly rows of 20/21/21).
const hours = (n) => Array.from({ length: n }, (_, i) => ({ mw: 50000 + i, period: `2026-11-15T${String(i).padStart(2, '0')}` }));
const trimmedCompare = () => ({
  isos: ['ERCOT', 'PJM', 'MISO'],
  comparison: {
    ERCOT: { iso: 'ERCOT', demand_24h: hours(3), _demand_24h_total_in_pro: 20, constraint_score: null, _constraint_score_in_pro: true },
    PJM: { iso: 'PJM', demand_24h: hours(3), _demand_24h_total_in_pro: 21, constraint_score: null, _constraint_score_in_pro: true },
    MISO: { iso: 'MISO', demand_24h: hours(3), _demand_24h_total_in_pro: 21, constraint_score: null, _constraint_score_in_pro: true },
  },
  // The rest of a live preview (relay, next_session, capacity_source ...): enough rows that the slim
  // goes all the way down to 1 row per array, as it did live ("truncation.over_budget": true).
  ...Object.fromEntries(Array.from({ length: 30 }, (_, k) => [`block_${k}`,
    Array.from({ length: 10 }, (_, i) => ({ a: 'p'.repeat(120), b: 'q'.repeat(120), i }))])),
});

describe('(c) one shown-of-total definition for the withheld hourly demand', () => {
  it('direct call: every grid counted, and the count names what it counts', () => {
    const g = detectGating(trimmedCompare());
    expect([g.shown, g.total]).toEqual([9, 62]);
    expect(g.noun).toMatch(/hourly demand readings/);
    const cite = buildCitation(trimmedCompare(), { now: Date.parse('2026-11-15T23:00:00Z') });
    expect(cite.cite_as).toMatch(/9 of 62 hourly demand readings/);
  });
  it('the continuation block uses the same count', () => {
    const l = extractLockedFromPayload(trimmedCompare());
    expect(l.field).toBe('demand_24h');
    expect([l.shown, l.total]).toEqual([9, 62]);
  });
  it('a single grid keeps its own count, now labelled', () => {
    const one = { iso: 'PJM', demand_24h: hours(3), _demand_24h_total_in_pro: 21 };
    const g = detectGating(one);
    expect([g.shown, g.total]).toEqual([3, 21]);
    expect(g.noun).toMatch(/hourly demand readings/);
  });
  it('execute_plan: the size slim does not cut rows the tier preview already cut, so the plan says the same', () => {
    const slim = _slimStepResult(trimmedCompare(), 'compare_isos');
    expect(slim.truncated).toBe(true);
    expect(slim.truncation.rows_kept_per_array).toBe(1);   // the live case: every other array cut to 1
    for (const iso of ['ERCOT', 'PJM', 'MISO']) expect(slim.comparison[iso].demand_24h).toHaveLength(3);
    const prov = buildProvenance({ executed: [{ step: 1, tool: 'compare_isos', result: slim }] });
    expect([prov.preview.shown, prov.preview.total]).toEqual([9, 62]);
  });
});

describe('(a) a slimmed compare_isos step lists every requested grid', () => {
  it('isos is kept whole', () => {
    const slim = _slimStepResult(trimmedCompare(), 'compare_isos');
    expect(slim.truncated).toBe(true);
    expect(slim.truncation.rows_kept_per_array).toBe(1);
    expect(slim.isos).toEqual(['ERCOT', 'PJM', 'MISO']);
    expect(Object.keys(slim.comparison)).toEqual(['ERCOT', 'PJM', 'MISO']);
  });
  it('an ordinary array is still cut (the slim still slims)', () => {
    const big = { isos: ['ERCOT', 'PJM'], rows: Array.from({ length: 40 }, (_, i) => ({ i, pad: 'y'.repeat(200) })) };
    const slim = _slimStepResult(big, 'x');
    expect(slim.rows.length).toBeLessThan(40);
    expect(slim.isos).toEqual(['ERCOT', 'PJM']);
  });
});
