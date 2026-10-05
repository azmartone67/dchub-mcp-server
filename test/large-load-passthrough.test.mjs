// DCHUB_QUEUE_MOAT: get_interconnection_queue carries the backend large-load tracker as
// `large_load`, and the keyless trim leaves the freshness counts and those figures alone.
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { trimForTrial, _largeLoadBlock, _queueMoatOn, _withLargeLoad } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const row = (metric, mw, pub) => ({ metric, value_mw: mw, as_of_date: '2026-06-18', published_date: pub,
  source_title: 'ERCOT doc', source_url: 'https://www.ercot.com/files/docs/x.pdf', basis: 'published', notes: 'n' });

describe('_largeLoadBlock', () => {
  it('keeps the newest row per metric, each with source_url and published_date', () => {
    const b = _largeLoadBlock({ iso: 'ERCOT', rows: [row('large_load_queue_total', 474000, '2026-07-29'),
      row('approved_to_energize', 8927, '2026-06-19'), row('large_load_queue_total', 466497, '2026-06-19')] });
    expect(b.rows.map((r) => r.metric)).toEqual(['large_load_queue_total', 'approved_to_energize']);
    expect(b.rows[0].value_mw).toBe(474000);
    for (const r of b.rows) { expect(r.source_url).toMatch(/^https:\/\//); expect(r.published_date).toBeTruthy(); }
    expect(b.rows[0].notes).toBeUndefined();
  });
  it('is null with no rows, so the response is left untouched', () => {
    expect(_largeLoadBlock({ iso: 'PJM', rows: [] })).toBeNull();
    expect(_largeLoadBlock(null)).toBeNull();
    expect(_largeLoadBlock({ error: 'x' })).toBeNull();
  });
  it('passes the backend attribution through', () => {
    const b = _largeLoadBlock({ rows: [row('a', 1, '2026-01-01')], attribution: [{ credit: 'ERCOTQueue' }] });
    expect(b.attribution[0].credit).toBe('ERCOTQueue');
  });
});

describe('flag and wiring', () => {
  const was = process.env.DCHUB_QUEUE_MOAT;
  afterEach(() => { if (was === undefined) delete process.env.DCHUB_QUEUE_MOAT; else process.env.DCHUB_QUEUE_MOAT = was; });
  it('is off by default and on for 1/true', () => {
    delete process.env.DCHUB_QUEUE_MOAT; expect(_queueMoatOn()).toBe(false);
    process.env.DCHUB_QUEUE_MOAT = '0'; expect(_queueMoatOn()).toBe(false);
    process.env.DCHUB_QUEUE_MOAT = '1'; expect(_queueMoatOn()).toBe(true);
  });
  it('get_interconnection_queue routes its payload through _withLargeLoad and the description is unchanged', () => {
    expect(SRC).toMatch(/const data = await _withLargeLoad\(\s*await callAPI\(a\.iso \? '\/api\/v1\/interconnection-queue\/by-iso'/);
    expect(SRC).toContain("ERCOT also returns its large-load (data-center) queue; other ISOs don\\'t publish one.");
  });
});

describe('keyless trim', () => {
  it('keeps freshness counts and large_load figures, still nulls queue depth', () => {
    const out = trimForTrial(JSON.parse(JSON.stringify({
      iso: 'ERCOT', freshness: { fresh_iso_count: 10, stale_iso_count: 0 },
      by_iso: [{ iso: 'ERCOT', last_refreshed: '2026-10-05T06:10:00Z', queue_depth_gw: 454.5 }],
      large_load: { rows: [row('large_load_queue_total', 474000, '2026-07-29')] } })), 'get_interconnection_queue');
    expect(out.freshness.fresh_iso_count).toBe(10);
    expect(out.freshness.stale_iso_count).toBe(0);
    expect(out.large_load.rows[0].value_mw).toBe(474000);
    expect(out.by_iso[0].last_refreshed).toBe('2026-10-05T06:10:00Z');
    expect(out.by_iso[0].queue_depth_gw).toBeNull();
  });
});

describe('_withLargeLoad', () => {
  const was = process.env.DCHUB_QUEUE_MOAT;
  afterEach(() => { vi.unstubAllGlobals(); if (was === undefined) delete process.env.DCHUB_QUEUE_MOAT; else process.env.DCHUB_QUEUE_MOAT = was; });
  const stub = (rows, ok = true) => {
    const f = vi.fn(async () => ({ ok, status: ok ? 200 : 500, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ iso: 'ERCOT', rows }), text: async () => JSON.stringify({ iso: 'ERCOT', rows }) }));
    vi.stubGlobal('fetch', f); return f;
  };
  const base = { iso: 'ERCOT', projects: [] };
  it('flag off: payload untouched and no backend call', async () => {
    delete process.env.DCHUB_QUEUE_MOAT; const f = stub([row('a', 1, '2026-01-01')]);
    expect(await _withLargeLoad(base, 'ERCOT')).toBe(base); expect(f).not.toHaveBeenCalled();
  });
  it('flag on, ERCOT: adds large_load; other ISO or no rows: untouched', async () => {
    process.env.DCHUB_QUEUE_MOAT = '1'; const f = stub([row('a', 1, '2026-01-01')]);
    const out = await _withLargeLoad(base, 'ERCOT');
    expect(out.large_load.rows[0].source_url).toMatch(/^https:/); expect(out.projects).toEqual([]);
    expect(await _withLargeLoad(base, 'PJM')).toBe(base);
    stub([]); expect(await _withLargeLoad(base, undefined)).toBe(base);
    expect(f).toHaveBeenCalled();
  });
  it('backend failure leaves the payload alone', async () => {
    process.env.DCHUB_QUEUE_MOAT = '1'; vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await _withLargeLoad(base, 'ERCOT')).toBe(base);
  });
});
