// grid-provenance-source-own-as-of.test.mjs (2026-10-21).
//
// MEASURED live 2026-10-20 23:27Z: get_grid_intelligence(iso=PJM) listed
// provenance.sources[eia930].as_of "2026-10-20T03:00:00Z" while the backend's own EIA-930 source
// entry said the newest hour, T22. lib/grid-provenance.mjs copied the backend block's COLLECTION
// as_of (the oldest labelled figure: fuel mix, which EIA publishes about once a day) onto the
// source entry, and dropped the backend's per-figure `fields` labels. The answer's overall as_of
// (oldest input wins) was right and must stay: here it stays T03, now carried by the fuel-mix
// figure's own label instead of a mislabelled source date.
//
// The backend block below has the shape routes/provenance_grid.py eia_grid_provenance emits.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { composeGridProvenance } from '../lib/grid-provenance.mjs';

const DEMAND_HOUR = '2026-10-20T22:00:00Z';
const MIX_HOUR = '2026-10-20T03:00:00Z';
const EIA = 'EIA-930 hourly RTO/BA feed (PJM) + DC Hub grid intelligence';
const gi = () => ({
  iso: 'PJM', demand_mw: 93038, demand_period: '2026-10-20T22', peak_mw: 99000,
  generation_mix: { NG: { mw: 50000 }, NUC: { mw: 30000 }, WND: { mw: 2000 } },
  generation_mix_period: '2026-10-20T03',
  provenance: {
    provenance_version: 1, provenance_revision: '1.2', source: EIA, basis: 'mixed',
    as_of: MIX_HOUR,                                     // collection: the OLDEST labelled figure
    sources: [{ id: 'eia930', name: 'EIA-930 Hourly Electric Grid Monitor',
      license: 'public domain (US government)', as_of: DEMAND_HOUR }],   // newest hour of the source
    fields: {
      demand_mw: { basis: 'measured', source_id: 'eia930', unit: 'MW', as_of: DEMAND_HOUR },
      generation_mix: { basis: 'measured', source_id: 'eia930', unit: 'MW', as_of: MIX_HOUR },
      peak_mw: { basis: 'derived', source_id: 'eia930', unit: 'MW', as_of: DEMAND_HOUR,
        method: 'maximum of the settled hourly demand points in the 24h series' },
    },
  },
});
const cmp = () => ({ isos: [{ iso: 'PJM', iso_name: 'PJM', avg_constraint: 50, avg_excess: 60, market_count: 10, build_count: 3 }] });
const qsnap = () => ({ by_iso: [{ iso: 'PJM', queued_load_total_gw: 100 }] });

describe('composeGridProvenance: each source carries its own as_of', () => {
  it('the eia930 entry states the backend source entry\'s hour, not the collection\'s oldest', () => {
    const p = composeGridProvenance('PJM', { gi: gi(), cmp: cmp(), qsnap: qsnap() });
    const eia = p.sources.find((s) => s.id === 'eia930');
    expect(eia.as_of).toBe(DEMAND_HOUR);
    expect(eia.as_of).not.toBe(MIX_HOUR);
    expect(p).not.toHaveProperty('as_of');               // the collection date stays the merge's
  });
  it('falls back to the collection as_of only when the backend names no source date', () => {
    const noSources = gi();
    delete noSources.provenance.sources;
    expect(composeGridProvenance('PJM', { gi: noSources, cmp: cmp() }).sources[0].as_of).toBe(MIX_HOUR);
    const undated = gi();
    delete undated.provenance.sources[0].as_of;
    expect(composeGridProvenance('PJM', { gi: undated, cmp: cmp() }).sources[0].as_of).toBe(MIX_HOUR);
    const other = gi();
    other.provenance.sources = [{ id: 'not_eia', as_of: DEMAND_HOUR }];   // sole entry: that source's date
    expect(composeGridProvenance('PJM', { gi: other, cmp: cmp() }).sources[0].as_of).toBe(DEMAND_HOUR);
  });
  it('keeps the per-figure hour labels the backend stated', () => {
    const p = composeGridProvenance('PJM', { gi: gi(), cmp: cmp(), qsnap: qsnap() });
    expect(p.fields.demand_mw).toEqual({ source_id: 'eia930', basis: 'measured', unit: 'MW', as_of: DEMAND_HOUR });
    expect(p.fields.generation_mix.as_of).toBe(MIX_HOUR);
    expect(p.fields.peak_mw.method).toMatch(/maximum/);
    for (const f of Object.values(p.fields)) {
      expect(p.sources.map((s) => s.id)).toContain(f.source_id);       // resolves in THIS block
    }
    expect(p.method).toMatch(/fields/);
  });
  it('a window label upstream is kept; no upstream labels -> no fields, old method text', () => {
    const w = gi();
    w.provenance.fields.demand_mw.window = '2026-10-20T22';
    expect(composeGridProvenance('PJM', { gi: w, cmp: cmp() }).fields.demand_mw.window).toBe('2026-10-20T22');
    const bare = gi();
    delete bare.provenance.fields;
    const p = composeGridProvenance('PJM', { gi: bare, cmp: cmp() });
    expect(p).not.toHaveProperty('fields');
    expect(p.method).toMatch(/not labelled yet/);
  });
});

// ── through the real handler: overall as_of is still the oldest input ──────
const BASE = 'http://127.0.0.1:1';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, N = 0;
const KEYED = { api_key: 'dch_live_grid_own_asof', tier: 'pro', platform: 'claude', client_name_raw: 'claude-ai', session_id: 'sess-goa-k' };
const FREE = { api_key: 'dch_free_grid_own_asof', tier: 'free', platform: 'claude', client_name_raw: 'claude-ai', session_id: 'sess-goa-f' };
async function call(args, seat) {
  N += 1;
  const s = { ...seat, session_id: `${seat.session_id}-${N}`, client_ip: `198.51.100.${N % 250 + 1}` };
  const T = TOOLS.get_grid_intelligence;
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues).slice(0, 300));
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
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
      return json(200, { valid: true, tier: /dch_free/.test(who) ? 'free' : 'pro', developer_id: 'dev_goa' });
    }
    if (path === '/api/v1/grid/intelligence/PJM') return json(200, gi());
    if (path === '/api/v1/dcpi/iso-comparison') return json(200, cmp());
    if (path === '/api/v1/interconnection-queue/snapshot') return json(200, qsnap());
    if (path === '/api/v1/grid/extended/PJM') return json(200, { available: false });
    return json(404, { error: 'not stubbed' });
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs?gridownasof=' + Math.random());
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevIsError === undefined) delete process.env.DCHUB_PREVIEW_ISERROR; else process.env.DCHUB_PREVIEW_ISERROR = prevIsError;
});

describe('get_grid_intelligence through the handler', () => {
  for (const [label, seat] of [['keyed', KEYED], ['free key (trimmed preview)', FREE]]) {
    it(`${label}: source as_of is the source's own; overall as_of is still the oldest figure`, async () => {
      const r = await call({ region_id: 'PJM' }, seat);
      expect(r.isError, JSON.stringify(r.content).slice(0, 400)).toBeFalsy();
      for (const p of [r.structuredContent.provenance, JSON.parse(r.content[0].text).provenance]) {
        expect(p.sources.find((s) => s.id === 'eia930').as_of).toBe(DEMAND_HOUR);
        expect(p.fields.generation_mix.as_of).toBe(MIX_HOUR);
        expect(p.fields.demand_mw.as_of).toBe(DEMAND_HOUR);
      }
      // The merged (stamped) block: oldest input wins, unchanged by this fix. The free preview's text
      // channel carries the composite unstamped (no as_of of its own), so the merge is read here.
      expect(Date.parse(r.structuredContent.provenance.as_of)).toBe(Date.parse(MIX_HOUR));
      expect(r.structuredContent.provenance.as_of_basis).toMatch(/^OLDEST of/);
    }, 30_000);
  }
});
