// compare_isos-source-composed.test.mjs: G-2 (2026-10-06), companion to get_grid_intelligence's.
//
// MEASURED live before: compare_isos PJM,ERCOT returned provenance.source "DC Hub", basis_class
// unknown, no method. The handler shapes each ISO with shapeGridIntelligence and attached no
// provenance, so the backend's per-ISO EIA-named blocks never reached the caller.
// composeCompareProvenance builds one block for the comparison; the handler attaches it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { composeCompareProvenance, LICENSE_COMPOSITE } from '../lib/grid-provenance.mjs';

const EIA = (iso) => `EIA-930 hourly RTO/BA feed (${iso}) + DC Hub grid intelligence`;
const QUEUE = 'US ISO public interconnection queues (ERCOT GIS / PJM NSQ / MISO GI / SPP / CAISO / NYISO / ISO-NE)';
const gi = (iso) => ({ iso, demand_mw: 1000, demand_period: '2026-10-06T10', generation_mix: { NG: { mw: 500 } },
  provenance: { provenance_version: 1, source: EIA(iso), as_of: '2026-10-06T10:00:00Z', basis_class: 'derived' } });
const cmp = (...isos) => ({ isos: isos.map((iso) => ({ iso, iso_name: iso, avg_constraint: 50, avg_excess: 60, market_count: 10, build_count: 3 })) });
const qsnap = (...isos) => ({ by_iso: isos.map((iso) => ({ iso, queued_load_total_gw: 10 })),
  provenance: { source: QUEUE, as_of: null, as_of_basis: 'UNMEASURED at collection level: x.' } });

describe('composeCompareProvenance', () => {
  it('one telemetry source per ISO (each named by its own block) plus DCPI and the queue', () => {
    const p = composeCompareProvenance(['PJM', 'ERCOT'], [gi('PJM'), gi('ERCOT')], cmp('PJM', 'ERCOT'), qsnap('PJM', 'ERCOT'));
    expect(p.sources.map((s) => s.id)).toEqual(['eia930_pjm', 'eia930_ercot', 'dcpi', 'iso_queues']);
    expect(p.sources[0].name).toBe(EIA('PJM'));
    expect(p.sources[1].name).toBe(EIA('ERCOT'));
    expect(p.source).toBe(`${EIA('PJM')}; ${EIA('ERCOT')}; DC Hub Data Center Power Index (DCPI); ${QUEUE}`);
    expect(p.basis).toBe('mixed');
    expect(p.provenance_revision).toBe('1.2');
    expect(p.method).toMatch(/^Side-by-side of 2 regions composed from 4 upstream reads/);
  });
  it('as_of only where a telemetry block stated one; collection licence Mixed; a source licence only for EIA and DCPI', () => {
    const p = composeCompareProvenance(['PJM', 'ERCOT'], [gi('PJM'), gi('ERCOT')], cmp('PJM'), qsnap('PJM'));
    expect(p.sources[0].as_of).toBe('2026-10-06T10:00:00Z');
    expect(p.sources[2]).not.toHaveProperty('as_of');
    expect(p.sources[3]).not.toHaveProperty('as_of');
    expect(p.license).toBe(LICENSE_COMPOSITE);
    expect(p.sources.map((s) => s.license)).toEqual(
      ['public domain (US government)', 'public domain (US government)', 'CC-BY-4.0', undefined]);
    expect(p).not.toHaveProperty('as_of');
  });
  it('a telemetry block that states no as_of gets none (never invented)', () => {
    const bare = (iso) => ({ ...gi(iso), provenance: { source: EIA(iso) } });
    const p = composeCompareProvenance(['PJM', 'ERCOT'], [bare('PJM'), gi('ERCOT')], cmp('PJM'), null);
    expect(p.sources[0]).not.toHaveProperty('as_of');
    expect(p.sources[1].as_of).toBe('2026-10-06T10:00:00Z');
  });
  it('an ISO whose telemetry failed is not named; DCPI and queue need a row for ANY requested ISO', () => {
    const p = composeCompareProvenance(['PJM', 'ERCOT'], [gi('PJM'), { error: 'API 500' }], cmp('ERCOT'), qsnap('CAISO'));
    expect(p.sources.map((s) => s.id)).toEqual(['eia930_pjm', 'dcpi']);   // the queue has no PJM/ERCOT row here
  });
  it('ISO-NE resolves to its DCPI code', () => {
    const p = composeCompareProvenance(['PJM', 'ISO-NE'], [gi('PJM'), gi('ISO-NE')], { isos: [{ iso: 'ISONE' }] }, null);
    expect(p.sources.map((s) => s.id)).toEqual(['eia930_pjm', 'eia930_isone', 'dcpi']);
  });
  it('Hydro-Quebec is found under its DCPI code HQ', () => {
    const p = composeCompareProvenance(['PJM', 'HYDROQUEBEC'], [gi('PJM'), gi('HYDROQUEBEC')], { isos: [{ iso: 'HQ' }] }, null);
    expect(p.sources.map((s) => s.id)).toContain('dcpi');
  });
  it('a single contributor with a block returns it unchanged; without one, null', () => {
    expect(composeCompareProvenance(['PJM'], [gi('PJM')], null, null)).toEqual(gi('PJM').provenance);
    expect(composeCompareProvenance(['PJM'], [{ demand_mw: 1 }], null, null)).toBeNull();
    expect(composeCompareProvenance(['PJM'], [{ error: 'x' }], cmp('PJM'), null)).toBeNull();
  });
  it('never throws on garbage', () => {
    expect(composeCompareProvenance(null, 5, 'x', [])).toBeNull();
    expect(composeCompareProvenance(['PJM'], [{ provenance: 7, demand_mw: 1 }], null, null)).toBeNull();
    expect(composeCompareProvenance(['PJM', 'ERCOT'], undefined, cmp('PJM'), null)).toBeNull();
  });
});

// ── through the real handler ────────────────────────────────────────────────
const BASE = 'http://127.0.0.1:1';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, N = 0, failEricot = false;
const KEYED = { api_key: 'dch_live_cmp_prov_test', tier: 'pro', platform: 'claude', client_name_raw: 'claude-ai', session_id: 'sess-cp-k' };
const FREE = { api_key: 'dch_free_cmp_prov_test', tier: 'free', platform: 'claude', client_name_raw: 'claude-ai', session_id: 'sess-cp-f' };
async function call(args, seat) {
  N += 1;
  const s = { ...seat, session_id: `${seat.session_id}-${N}`, client_ip: `198.51.100.${N % 250 + 1}` };
  const T = TOOLS.compare_isos;
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues).slice(0, 300));
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (!url.startsWith(BASE)) return json(503, { ok: false, error: 'fenced' });
    const path = new URL(url).pathname;
    if (path === '/api/v1/keys/validate') {
      const who = JSON.stringify([init && init.headers, init && init.body, url]);
      return json(200, { valid: true, tier: /dch_free/.test(who) ? 'free' : 'pro', developer_id: 'dev_cp' });
    }
    if (path === '/api/v1/grid/intelligence/PJM') return json(200, gi('PJM'));
    if (path === '/api/v1/grid/intelligence/ERCOT') return failEricot ? json(500, { error: 'boom' }) : json(200, gi('ERCOT'));
    if (path === '/api/v1/dcpi/iso-comparison') return json(200, cmp('PJM', 'ERCOT'));
    if (path === '/api/v1/interconnection-queue/snapshot') return json(200, qsnap('PJM', 'ERCOT'));
    return json(404, { error: 'not stubbed' });
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs?cmpprov=' + Math.random());
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; });

describe('compare_isos through the handler', () => {
  for (const [label, seat] of [['keyed', KEYED], ['free key (trimmed preview)', FREE]]) {
    it(`${label}: provenance names its upstreams, not "DC Hub"`, async () => {
      failEricot = false;
      const r = await call({ isos: 'PJM,ERCOT' }, seat);
      // the free seat is walled with the upgrade card (isError by design) but still carries structuredContent
      if (seat === KEYED) expect(r.isError).toBeFalsy();
      expect(r.structuredContent && r.structuredContent.provenance).toBeTruthy();
      const p = r.structuredContent.provenance;
      expect(p.source).toContain(EIA('PJM'));
      expect(p.source).toContain(EIA('ERCOT'));
      expect(p.source).not.toBe('DC Hub');
      expect(p.sources.map((s) => s.id)).toEqual(['eia930_pjm', 'eia930_ercot', 'dcpi', 'iso_queues']);
      expect(p.basis).toBe('mixed');
      expect(p.basis_class).toBe('unknown');
      expect(p.provenance_revision).toBe('1.2');
      if (seat === KEYED) expect(JSON.parse(r.content[0].text).provenance.sources).toHaveLength(4);
    }, 30_000);
  }
  it('an ISO whose telemetry failed is left out of the sources', async () => {
    failEricot = true;
    const p = (await call({ isos: 'PJM,ERCOT' }, KEYED)).structuredContent.provenance;
    failEricot = false;
    expect(p.sources.map((s) => s.id)).toEqual(['eia930_pjm', 'dcpi', 'iso_queues']);
  }, 30_000);

  it('the body carries retrieved_at (serve time, zoned), not a data-date-named as_of', async () => {
    // G-2 (2026-10-07, audit rule 2): the body used to say as_of = new Date(), the SERVE time.
    const r = await call({ isos: 'PJM,ERCOT' }, KEYED);
    const body = JSON.parse(r.content[0].text);
    expect(body).not.toHaveProperty('as_of');
    expect(r.structuredContent).not.toHaveProperty('as_of');
    expect(Number.isNaN(Date.parse(body.retrieved_at))).toBe(false);
    expect(body.retrieved_at).toMatch(/Z$/);
    expect(Math.abs(Date.now() - Date.parse(body.retrieved_at))).toBeLessThan(120_000);
    // the data date is the stalest stamp, never the serve time
    const p = r.structuredContent.provenance;
    expect(p.as_of).toBeTruthy();
    expect(p.as_of).not.toBe(body.retrieved_at);
    expect(Date.parse(p.as_of)).toBeLessThan(Date.parse(body.retrieved_at) - 3_600_000);
  }, 30_000);
});
