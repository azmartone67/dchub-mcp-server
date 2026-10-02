// ── r-queue-kinds (2026-10-02): one queue figure per KIND, masked as before ──
//
// /api/v1/interconnection-queue/snapshot by_iso rows carry the load-NAMED
// column queued_load_total_gw, which is a GENERATION queue on PJM/MISO/SPP/
// CAISO/NYISO/ISO-NE, ERCOT's LARGE-LOAD (demand) queue, and a mixed
// generation + demand connections queue on NESO/IESO/AESO. get_grid_intelligence
// published it as queue_depth_gw and get_grid_scoreboard as queued_gw, so ERCOT
// showed 474 GW of demand beside six ISOs' generation queues.
//
// Rows below are the live 2026-10-02 snapshot values (backend #6174 shape).
import { describe, it, expect } from 'vitest';
import { shapeGridIntelligence, trimForTrial, _capTrim, _splitQueueRow, _scoreboardQueueBlock,
         _gridRegionUnresolved } from '../server.mjs';

const ERCOT = { iso: 'ERCOT', as_of: '2026-10-02', queued_generation_gw: 454.5,
  queued_load_total_gw: 474.0, queued_load_total_gw_basis: 'large_load',
  queued_load_data_center_gw: 426.6, queued_load_dc_share_pct: 90.0 };
const PJM = { iso: 'PJM', as_of: '2026-10-02', queued_generation_gw: 161.3,
  queued_load_total_gw: 161.3, queued_load_total_gw_basis: 'generation_queue',
  queued_load_data_center_gw: null, queued_load_dc_share_pct: null };
const ISONE = { iso: 'ISO-NE', as_of: '2026-10-02', queued_generation_gw: 14.2,
  queued_load_total_gw: 14.2, queued_load_total_gw_basis: 'generation_queue',
  queued_load_data_center_gw: null, queued_load_dc_share_pct: null };
const NESO = { iso: 'NESO', as_of: '2026-10-02', queued_generation_gw: null,
  queued_load_total_gw: 594.8, queued_load_total_gw_basis: 'mixed_connection_queue',
  queued_load_data_center_gw: 53.1, queued_load_dc_share_pct: 8.9 };
const QSNAP = { by_iso: [NESO, ERCOT, PJM, ISONE] };
const NO_GRID = { error: 'API 503' };
const NO_CMP = { isos: [] };

describe('_splitQueueRow: the backend util/queue_kinds.py vocabulary', () => {
  it('ERCOT: generation is the generation queue, never the 474 GW large-load column', () => {
    const k = _splitQueueRow(ERCOT);
    expect(k.basis).toBe('large_load');
    expect(k.generation_gw).toBe(454.5);
    expect(k.large_load_gw).toBe(474.0);
    expect(k.dc_load_gw).toBe(426.6);
    expect(k.dc_share_pct).toBe(90.0);
    expect(k.connections_gw).toBe(null);
  });
  it('ERCOT without queued_generation_gw does NOT fall back to the load column', () => {
    const { queued_generation_gw, ...old } = ERCOT;
    expect(_splitQueueRow(old).generation_gw).toBe(null);
  });
  it('a generation row reads queued_generation_gw, and the registry basis when unserved', () => {
    expect(_splitQueueRow(PJM).generation_gw).toBe(161.3);
    // pre-#6174 shape: no basis, no queued_generation_gw -> registry says generation
    expect(_splitQueueRow({ iso: 'ISO-NE', queued_load_total_gw: 14.2 }).generation_gw).toBe(14.2);
    expect(_splitQueueRow({ iso: 'ISO-NE', queued_load_total_gw: 14.2 }).basis).toBe('generation_queue');
  });
  it('NESO: a connections queue, no generation figure, no data-center share', () => {
    const k = _splitQueueRow(NESO);
    expect(k.generation_gw).toBe(null);
    expect(k.connections_gw).toBe(594.8);
    expect(k.dc_share_pct).toBe(null);
  });
  it('an unknown ISO is unclassified and yields nothing', () => {
    const k = _splitQueueRow({ iso: 'XYZ', queued_load_total_gw: 99 });
    expect(k.basis).toBe('unclassified');
    expect([k.generation_gw, k.large_load_gw, k.connections_gw]).toEqual([null, null, null]);
  });
});

describe('get_grid_intelligence: queue_depth_gw is the generation queue', () => {
  it('ERCOT publishes 454.5 (generation), not 474 (large load)', () => {
    const out = shapeGridIntelligence('ERCOT', NO_GRID, NO_CMP, QSNAP);
    expect(out.queue_depth_gw).toBe(454.5);
    expect(out.queue_depth_basis).toBe('large_load');
    expect(out.data_center_share_pct).toBe(90.0);
    expect('connections_queue_gw' in out).toBe(false);
  });
  it('ISO-NE matches the hyphenated row and carries no data-center share', () => {
    const out = shapeGridIntelligence('ISO-NE', NO_GRID, NO_CMP, QSNAP);
    expect(out.queue_depth_gw).toBe(14.2);
    expect(out.data_center_share_pct).toBe(null);
  });
  it('NESO: the connections queue under its own name, still a resolved region', () => {
    const out = shapeGridIntelligence('NESO', NO_GRID, NO_CMP, QSNAP);
    expect(out.queue_depth_gw).toBe(null);
    expect(out.connections_queue_gw).toBe(594.8);
    expect(out.data_center_share_pct).toBe(null);
    expect(_gridRegionUnresolved(out)).toBe(false);
  });
  it('the note no longer calls the queue a load total', () => {
    const out = shapeGridIntelligence('PJM', NO_GRID, NO_CMP, QSNAP);
    expect(out._scores_note).not.toMatch(/queue load total/i);
    expect(out._scores_note).toMatch(/queue_depth_gw is the live GENERATION/);
  });
});

describe('masking: the queue figures are withheld from a trial caller exactly as before', () => {
  for (const [iso, keys] of [['ERCOT', ['queue_depth_gw', 'data_center_share_pct']],
                             ['PJM', ['queue_depth_gw']],
                             ['NESO', ['connections_queue_gw']]]) {
    it(`${iso}: every queue figure is nulled; the basis label survives`, () => {
      const raw = shapeGridIntelligence(iso, NO_GRID, NO_CMP, QSNAP);
      for (const k of keys) expect(raw[k], `${iso} ${k} must be a number pre-trim`).toEqual(expect.any(Number));
      const t = trimForTrial(raw, 'get_grid_intelligence');
      for (const k of keys) expect(t[k], `${iso} ${k} must be masked`).toBe(null);
      expect(t.queue_depth_basis).toBe(raw.queue_depth_basis);
    });
  }
  it('a US row gains no connections_queue_gw key, so no new _in_pro marker', () => {
    const t = trimForTrial(shapeGridIntelligence('PJM', NO_GRID, NO_CMP, QSNAP), 'get_grid_intelligence');
    expect(Object.keys(t).filter((k) => /connections_queue/.test(k))).toEqual([]);
  });
});

describe('get_grid_scoreboard per-grid queue block', () => {
  it('ERCOT: generation and large-load queues under separate names', () => {
    const b = _scoreboardQueueBlock(ERCOT);
    expect(b.generation_queue_gw).toBe(454.5);
    expect(b.large_load_queue_gw).toBe(474.0);
    expect(b.large_load_data_center_share_pct).toBe(90.0);
    expect(b).not.toHaveProperty('queued_gw');
    expect(b.note).toMatch(/never add it to the generation queue/);
  });
  it('PJM: generation only, and no fabricated 0% data-center share', () => {
    const b = _scoreboardQueueBlock(PJM);
    expect(b.generation_queue_gw).toBe(161.3);
    expect(b).not.toHaveProperty('large_load_queue_gw');
    expect(b).not.toHaveProperty('large_load_data_center_share_pct');
    expect(b).not.toHaveProperty('dc_share_pct');
  });
  it('NESO: the connections queue, labelled as generation + demand', () => {
    const b = _scoreboardQueueBlock(NESO);
    expect(b.connections_queue_gw).toBe(594.8);
    expect(b).not.toHaveProperty('generation_queue_gw');
    expect(b.note).toMatch(/generation AND demand/);
  });
  it('an over-cap trim masks every figure in the block, as it masked queued_gw', () => {
    for (const row of [ERCOT, PJM, NESO]) {
      const t = _capTrim({ grids: [{ iso: row.iso, interconnection_queue: _scoreboardQueueBlock(row) }] },
                         'get_grid_scoreboard').grids[0].interconnection_queue;
      const nums = Object.entries(t).filter(([k]) => /_gw$|_pct$/.test(k));
      expect(nums.length, `${row.iso} block carries figures`).toBeGreaterThan(0);
      for (const [k, v] of nums) expect(v, `${row.iso} ${k}`).toBe(null);
    }
  });
  it('a row with no figure yields no block', () => {
    expect(_scoreboardQueueBlock({ iso: 'XYZ', queued_load_total_gw: 5 })).toBe(null);
    expect(_scoreboardQueueBlock(null)).toBe(null);
  });
});

// Production runs with DCHUB_GRID_HEADROOM_TIER on. That gate is read at module
// scope, so it gets its own import. Under it a gated field is nulled AND gets
// an `_<k>_in_pro` marker; the connections figure must get the same treatment
// queue_depth_gw gets, or the rename quietly moved it to a weaker mask.
describe('masking under the production headroom tier', () => {
  it('connections_queue_gw is gated with its marker, exactly like queue_depth_gw', async () => {
    const prev = process.env.DCHUB_GRID_HEADROOM_TIER;
    process.env.DCHUB_GRID_HEADROOM_TIER = '1';
    try {
      const M = await import('../server.mjs?queuekinds-headroom=' + Math.random());
      const us = M.trimForTrial(M.shapeGridIntelligence('PJM', NO_GRID, NO_CMP, QSNAP), 'get_grid_intelligence');
      expect(us.queue_depth_gw).toBe(null);
      expect(us._queue_depth_gw_in_pro).toBe(true);
      const mixed = M.trimForTrial(M.shapeGridIntelligence('NESO', NO_GRID, NO_CMP, QSNAP), 'get_grid_intelligence');
      expect(mixed.connections_queue_gw).toBe(null);
      expect(mixed._connections_queue_gw_in_pro).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.DCHUB_GRID_HEADROOM_TIER;
      else process.env.DCHUB_GRID_HEADROOM_TIER = prev;
    }
  });
});
