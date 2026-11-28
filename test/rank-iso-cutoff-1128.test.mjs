// 2026-11-28 (live read with the QA key): the backend ranking returns at most 50 rows, so rank_markets iso=ERCOT
// found 1 ERCOT market (midland-tx) in the national top 50 while the DCPI market index lists 19. The iso_filter now
// says the search stopped at the top 50 and names the grid's markets below that cutoff.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { filterRankRowsByIso, RANK_READ_CAP } from '../lib/plan-quality-1127.mjs';
import { NOTE_F_WORDS } from '../lib/continuity-ask.mjs';
import { DCPI_MARKETS } from '../lib/dcpi-market-match.mjs';

// The live shape on 2026-11-28: 50 rows, one on ERCOT (rank 1), El Paso on WECC (rank 16).
const LIVE50 = Array.from({ length: 50 }, (_, i) => ({ rank: i + 1, market: `m${i + 1}`, iso: i % 2 ? 'WECC' : 'SPP', state: 'XX' }));
LIVE50[0] = { rank: 1, market: 'midland-tx', metro_slug: 'midland-tx', iso: 'ERCOT', state: 'TX', dcpi_verdict: 'BUILD' };
LIVE50[15] = { rank: 16, market: 'el-paso', iso: 'WECC', state: 'TX', dcpi_verdict: 'BUILD' };
const IDX = { as_of: '2026-11-08T00:43:13Z', markets: [
  { slug: 'midland-tx', iso: 'ERCOT' }, { slug: 'dallas', iso: 'ERCOT' }, { slug: 'abilene', iso: 'ERCOT' },
  { slug: 'el-paso', iso: 'WECC' }, { slug: 'ashburn', iso: 'PJM' }] };

describe('filterRankRowsByIso: the top-50 cutoff is said, never implied away', () => {
  it('a full 50-row read names the grid markets below the cutoff', () => {
    const f = filterRankRowsByIso({ results: LIVE50 }, 'ERCOT', 10, IDX).iso_filter;
    expect(f).toMatchObject({ iso: 'ERCOT', rows_read: 50, rows_on_grid: 1, rows_returned: 1, searched_top: 50, below_cutoff: 2 });
    expect(f.below_cutoff_markets).toEqual(['dallas', 'abilene']);
    expect(f.note).toMatch(/not a full ERCOT ranking: 2 more ERCOT markets in the DCPI market index \(as of 2026-11-08\) rank below that cutoff/);
  });
  it('a read under the cap reached every ranked market: no cutoff fields', () => {
    const f = filterRankRowsByIso({ results: LIVE50.slice(0, 12) }, 'ERCOT', 10, IDX).iso_filter;
    expect(f.searched_top).toBeUndefined();
    expect(f.below_cutoff).toBeUndefined();
    expect(f.note).not.toMatch(/cutoff/);
  });
  it('every index market on the grid already in the rows: below_cutoff 0, note unchanged', () => {
    const f = filterRankRowsByIso({ results: LIVE50 }, 'WECC', 5, IDX).iso_filter;
    expect(f.below_cutoff).toBe(0);
    expect(f.below_cutoff_markets).toBeUndefined();
    expect(f.note).not.toMatch(/cutoff/);
  });
  it('no index passed: the 11-27 shape, byte for byte', () => {
    expect(filterRankRowsByIso({ results: LIVE50 }, 'ERCOT', 10).iso_filter).toEqual({ iso: 'ERCOT', rows_read: 50, rows_on_grid: 1, rows_returned: 1,
      note: 'Rows are held to ERCOT: markets on other grids were removed before the limit was applied.' });
  });
  it('the cutoff note passes the copy rules', () => {
    expect(filterRankRowsByIso({ results: LIVE50 }, 'ERCOT', 10, IDX).iso_filter.note).not.toMatch(NOTE_F_WORDS);
  });
  it('RANK_READ_CAP is 50 (the handler reads that page)', () => { expect(RANK_READ_CAP).toBe(50); });
});

// The handler end to end, stubbed backend returning the live-shaped 50 rows; the real DCPI index counts ERCOT.
let S; let realFetch;
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = new URL(String(input && input.url ? input.url : input));
    const body = u.pathname === '/api/v1/mcp/tools/rank_markets' ? { criteria: 'ai_ready', results: LIVE50.map((r) => ({ ...r })) } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://rank-iso-cutoff.test';
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });

describe('rank_markets iso=ERCOT handler: the cutoff reaches the caller', () => {
  it('names the ERCOT markets of the DCPI index below the top 50', async () => {
    const tools = S.createServer()._registeredTools;
    const T = tools.rank_markets;
    const parsed = await T.inputSchema.safeParseAsync({ criteria: 'ai_ready', iso: 'ERCOT', limit: 10 });
    expect(parsed.success).toBe(true);
    const seat = { tier: 'free', platform: 'claude', client_name_raw: 'claude-code', client_ip: '203.0.117.9', session_id: 'sess-isocut-1' };
    const r = await S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
    const t = (r.content || []).map((c) => c.text).join('\n');
    const ercot = DCPI_MARKETS.filter((m) => String(m[3]).toUpperCase() === 'ERCOT').length;
    expect(ercot).toBeGreaterThan(1);
    expect(t).toMatch(new RegExp(`"below_cutoff":\\s*${ercot - 1}\\b`));
    expect(t).toMatch(/"searched_top":\s*50/);
    expect(t).toMatch(/not a full ERCOT ranking/);
  });
});
