// grid-intelligence-source-composed.test.mjs: G-2 (2026-10-06).
//
// MEASURED live before: get_grid_intelligence PJM returned provenance.source "DC Hub",
// basis_class unknown, no method, although the backend's EIA grid block names its source.
// The handler reads four upstreams and shapeGridIntelligence rebuilds the payload without
// any of their provenance. lib/grid-provenance.mjs now composes one block from what
// contributed, and the handler attaches it. Drives the lib directly and the real handler
// (keyed and anonymous) with a stubbed backend.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { composeGridProvenance, LICENSE_COMPOSITE } from '../lib/grid-provenance.mjs';

const EIA = 'EIA-930 hourly RTO/BA feed (PJM) + DC Hub grid intelligence';
const QUEUE = 'US ISO public interconnection queues (ERCOT GIS / PJM NSQ / MISO GI / SPP / CAISO / NYISO / ISO-NE)';
const gi = () => ({ iso: 'PJM', demand_mw: 100000, demand_period: '2026-10-06T10',
  generation_mix: { NG: { mw: 50000 }, NUC: { mw: 30000 } },
  provenance: { provenance_version: 1, source: EIA, as_of: '2026-10-06T10:00:00Z', basis_class: 'derived' } });
const cmp = () => ({ isos: [{ iso: 'PJM', iso_name: 'PJM', avg_constraint: 50, avg_excess: 60, market_count: 10, build_count: 3 }] });
const qsnap = () => ({ by_iso: [{ iso: 'PJM', queued_load_total_gw: 100 }],
  provenance: { source: QUEUE, as_of: null, as_of_basis: 'UNMEASURED at collection level: PJM is a live feed.' } });

describe('composeGridProvenance', () => {
  it('names every contributing upstream, the backend\'s own name where it sent one', () => {
    const p = composeGridProvenance('PJM', { gi: gi(), cmp: cmp(), qsnap: qsnap(), ext: { available: true } });
    expect(p.sources.map((s) => s.id)).toEqual(['eia930', 'dcpi', 'iso_queues', 'gridstatus']);
    expect(p.sources[0].name).toBe(EIA);
    expect(p.sources[1].name).toBe('DC Hub Data Center Power Index (DCPI)');
    expect(p.sources[2].name).toBe(QUEUE);
    expect(p.source).toBe(p.sources.map((s) => s.name).join('; '));
    expect(p.basis).toBe('mixed');
    expect(p.provenance_revision).toBe('1.2');
    expect(p.provenance_version).toBe(1);
  });
  it('as_of only where that upstream stated one, never invented', () => {
    const p = composeGridProvenance('PJM', { gi: gi(), cmp: cmp(), qsnap: qsnap() });
    expect(p.sources[0].as_of).toBe('2026-10-06T10:00:00Z');
    expect(p.sources[1]).not.toHaveProperty('as_of');
    expect(p.sources[2]).not.toHaveProperty('as_of');     // the queue block said null
    expect(p).not.toHaveProperty('as_of');                // left to the merge
  });
  it('the collection licence is Mixed, and a source carries one only where DC Hub names it', () => {
    const p = composeGridProvenance('PJM', { gi: gi(), cmp: cmp(), qsnap: qsnap(), ext: { available: true } });
    expect(p.license).toBe(LICENSE_COMPOSITE);
    expect(p.license).not.toMatch(/CC-BY/);               // never the blanket claim over third-party data
    const by = Object.fromEntries(p.sources.map((s) => [s.id, s.license]));
    expect(by.eia930).toBe('public domain (US government)');
    expect(by.dcpi).toBe('CC-BY-4.0');                    // DC Hub-computed scores
    expect(by.iso_queues).toBeUndefined();                // the ISOs' terms are theirs: none claimed
    expect(by.gridstatus).toBeUndefined();
  });
  it('a single contributor keeps its own block, licence untouched', () => {
    const own = { ...gi().provenance, license: 'CC-BY-4.0' };
    expect(composeGridProvenance('AZPS', { gi: { ...gi(), iso: 'AZPS', provenance: own } })).toEqual(own);
  });
  it('an upstream with no row for this region is not named', () => {
    // AZPS has telemetry but no DCPI row and no queue row (a balancing authority)
    const p = composeGridProvenance('AZPS', { gi: { ...gi(), iso: 'AZPS' }, cmp: cmp(), qsnap: qsnap(), ext: { available: false } });
    expect(p.source).toBe(EIA);                           // one contributor: its own block, unchanged
    expect(p.sources).toBeUndefined();
  });
  it('a failed upstream is not named', () => {
    // telemetry and queue failed; DCPI alone contributed and sent no block of its own
    expect(composeGridProvenance('PJM', { gi: { error: 'API 500' }, cmp: cmp(), qsnap: { error: 'x' } })).toBeNull();
    const p = composeGridProvenance('PJM', { gi: gi(), cmp: cmp(), qsnap: { error: 'x' } });
    expect(p.sources.map((s) => s.id)).toEqual(['eia930', 'dcpi']);
  });
  it('one contributor with a block returns that block unchanged; without one, null', () => {
    const only = composeGridProvenance('AZPS', { gi: { ...gi(), iso: 'AZPS' } });
    expect(only).toEqual(gi().provenance);
    expect(composeGridProvenance('AZPS', { gi: { demand_mw: 1 } })).toBeNull();
    expect(composeGridProvenance('PJM', {})).toBeNull();
    expect(composeGridProvenance('PJM', undefined)).toBeNull();
  });
  it('the HQ/ISO-NE DCPI codes and punctuation resolve like the shaper', () => {
    const c = { isos: [{ iso: 'ISONE' }] };
    const q = { by_iso: [{ iso: 'ISO-NE' }] };
    const p = composeGridProvenance('ISO-NE', { gi: gi(), cmp: c, qsnap: q });
    expect(p.sources.map((s) => s.id)).toEqual(['eia930', 'dcpi', 'iso_queues']);
  });
  it('Hydro-Quebec is found under its DCPI code HQ', () => {
    const p = composeGridProvenance('HYDROQUEBEC', { gi: gi(), cmp: { isos: [{ iso: 'HQ' }] } });
    expect(p.sources.map((s) => s.id)).toEqual(['eia930', 'dcpi']);
  });
  it('never throws on garbage', () => {
    expect(composeGridProvenance(null, { gi: 5, cmp: 'x', qsnap: [], ext: null })).toBeNull();
    expect(composeGridProvenance('PJM', { gi: { provenance: 7 }, cmp: cmp() })).toBeTruthy();
  });
});

// ── through the real handler ────────────────────────────────────────────────
const BASE = 'http://127.0.0.1:1';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, N = 0;
let extAvailable = false;

const KEYED = { api_key: 'dch_live_grid_prov_test', tier: 'pro', platform: 'claude', client_name_raw: 'claude-ai', session_id: 'sess-gp-k' };
const FREE = { api_key: 'dch_free_grid_prov_test', tier: 'free', platform: 'claude', client_name_raw: 'claude-ai', session_id: 'sess-gp-f' };
async function call(args, seat) {
  N += 1;
  const s = { ...seat, session_id: `${seat.session_id}-${N}`, client_ip: `198.51.100.${N % 250 + 1}` };
  const T = TOOLS.get_grid_intelligence;
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues).slice(0, 300));
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}

// Owner 2026-10-08: the free-key grid brief is a preview; its transport is DCHUB_PREVIEW_ISERROR
// (production runs 0, see the r-wall-transport comment in server.mjs), so the harness sets it.
let prevIsError;
beforeAll(async () => {
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (!url.startsWith(BASE)) return json(503, { ok: false, error: 'fenced' });
    const path = new URL(url).pathname;
    if (path === '/api/v1/keys/validate') {
      const who = JSON.stringify([init && init.headers, init && init.body, url]);
      return json(200, { valid: true, tier: /dch_free/.test(who) ? 'free' : 'pro', developer_id: 'dev_gp' });
    }
    if (path === '/api/v1/grid/intelligence/PJM') return json(200, gi());
    if (path === '/api/v1/dcpi/iso-comparison') return json(200, cmp());
    if (path === '/api/v1/interconnection-queue/snapshot') return json(200, qsnap());
    if (path === '/api/v1/grid/extended/PJM') return json(200, extAvailable ? { available: true, zone_lmp_usd_mwh: 31.2 } : { available: false });
    return json(404, { error: 'not stubbed' });
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs?gridprov=' + Math.random());
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevIsError === undefined) delete process.env.DCHUB_PREVIEW_ISERROR; else process.env.DCHUB_PREVIEW_ISERROR = prevIsError;
});

describe('get_grid_intelligence through the handler', () => {
  it('the gridstatus extended read is named when it contributed, and only then', async () => {
    extAvailable = true;
    const withExt = (await call({ region_id: 'PJM' }, KEYED)).structuredContent.provenance;
    extAvailable = false;
    const without = (await call({ region_id: 'PJM' }, KEYED)).structuredContent.provenance;
    expect(withExt.sources.map((s) => s.id)).toContain('gridstatus');
    expect(withExt.source).toContain('gridstatus.io');
    expect(without.sources.map((s) => s.id)).not.toContain('gridstatus');
  }, 30_000);

  for (const [label, seat] of [['keyed', KEYED], ['free key (trimmed preview)', FREE]]) {
    it(`${label}: provenance names its upstreams, not "DC Hub"`, async () => {
      const r = await call({ region_id: 'PJM' }, seat);
      expect(r.isError, JSON.stringify(r.content).slice(0, 400)).toBeFalsy();
      const p = r.structuredContent.provenance;
      expect(p.source).toContain(EIA);
      expect(p.source).toContain('DC Hub Data Center Power Index (DCPI)');
      expect(p.source).toContain('US ISO public interconnection queues');
      expect(p.source).not.toBe('DC Hub');
      expect(p.sources).toHaveLength(3);                  // the anon trim keeps the credit list whole
      expect(p.basis).toBe('mixed');
      expect(p.basis_class).toBe('unknown');              // mixed has no v1.1 class; "unknown", not a guess
      expect(p.provenance_revision).toBe('1.2');
      expect(p.license).toBe(LICENSE_COMPOSITE);          // not the blanket CC-BY-4.0
      expect(r.structuredContent.citation.license).toBe(LICENSE_COMPOSITE);
      expect(typeof p.method).toBe('string');
      expect(p.as_of).toBeTruthy();                       // derived by the merge from the payload stamps
      expect(JSON.parse(r.content[0].text).provenance.sources).toHaveLength(3);
    }, 30_000);
  }
});
