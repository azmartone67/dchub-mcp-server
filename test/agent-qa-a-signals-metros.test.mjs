// agent-qa-a-signals-metros.test.mjs — agent QA A (owner-approved 2026-10-20), items 2 and 3.
//
//   2a  a context pack served in full is not labelled a partial preview (`_free_preview` dropped)
//   2b  the "call N of M" meter counts THIS tool's answers on the bucket charged, and says which
//   2c  no answer carries the load-named queued_load_total_gw (lib/queue-kind-fields.mjs)
//   3   the full market briefing is open to every caller for the top 20 metros (lib/top-metros.mjs);
//       broker rates stay withheld; kill switch DCHUB_TOP_METROS_FREE=0
//
// Real registered handlers, backend stubbed through globalThis.fetch (same harness as
// test/keyed-budget-per-key-826.test.mjs). No network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { renameQueueTotals } from '../lib/queue-kind-fields.mjs';
import { TOP_METROS, topMetroSlug, topMetroFreeCall, datePackSections } from '../lib/top-metros.mjs';

const BASE = 'https://backend.agent-qa-a.test';
let S, TOOLS, realFetch, prevInternal;
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

const PACK = (slug) => ({
  ok: true, market: slug, name: slug, tier: 'full', max_tokens: 4000, used_tokens: 600, as_of: '2026-10-20T01:00:20Z',
  sections: [
    { id: 'hero', title: 'Market & DCPI verdict', text: 'Dallas: CAUTION. DCPI scores: excess-power 61/100, constraint 48/100.', tokens: 20, as_of: '2026-10-20T01:00:20Z' },
    { id: 'grid', title: 'Power & grid', text: 'Grid: ERCOT. queue wait ~30 months.', tokens: 12, as_of: '2026-10-20T01:00:20Z' },
    { id: 'pipeline', title: 'Construction pipeline', text: 'Pipeline: 12 projects.', tokens: 8, as_of: null },
    { id: 'risk', title: 'Risk factors', text: 'Risk: water stress medium.', tokens: 8, as_of: null },
  ],
  _free_preview: { sections: [{ id: 'hero', text: 'Dallas: CAUTION.', tokens: 5 }], used_tokens: 5, locked_sections: ['grid', 'risk'] },
});
const MARKET = (slug) => ({
  success: true, market: { id: slug, name: slug }, as_of: '2026-10-20T01:00:20Z',
  stats: { facility_count: 249, total_power_mw: 3610, provider_count: 108 },
  top_providers: [{ name: 'P1', facilities: 16, power_mw: 900 }],
  siting: { available: true, iso: { code: 'ERCOT', as_of: '2026-10-19' },
    dcpi: { verdict: 'CAUTION', as_of: '2026-10-20' }, time_to_power: { band: '24_to_48_months', as_of: '2026-10-20' } },
  market_pricing: { available: true, asking_rate: 160, asking_rate_range: [160, 185], unit: '$/kW/mo',
    source: 'CBRE / JLL market reports, H1 2026 $160-185/kW/mo' },
});
const DCPI = (slug) => ({ market_slug: slug, market_name: slug, verdict: 'CAUTION', composite_score: 55.1,
  constraint_score: 48.2, excess_power_score: 61.0, time_to_power_months: 30, queue_wait_months: 28,
  computed_at: '2026-10-20T01:00:20Z', iso: 'ERCOT' });
const QUEUE = { iso: 'PJM', as_of: '2026-10-19', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_generation_gw: 135.1, project_count: 2, projects: [{ queue_id: 'A1', capacity_mw: 100 }],
  deprecated_fields: { queued_load_total_gw: 'Deprecated alias' } };

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'agent-qa-a-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = new URL(String(input && input.url ? input.url : input));
    const p = u.pathname;
    let m;
    if ((m = /^\/api\/v1\/context\/market\/([^/]+)$/.exec(p))) return json(PACK(decodeURIComponent(m[1])));
    if ((m = /^\/api\/v1\/markets\/([^/]+)$/.exec(p))) return json(MARKET(m[1]));
    if ((m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p))) return json(DCPI(m[1]));
    if (p === '/api/v1/interconnection-queue/by-iso') return json(QUEUE);
    if (p.startsWith('/api/v1/grid/intelligence/')) return json({ iso: 'ERCOT', demand_mw: 70000, generation_mix: { NG: 4000 } });
    if (p === '/api/v1/dcpi/iso-comparison') return json({ isos: [{ iso: 'ERCOT', avg_constraint: 46.5, avg_excess: 60, market_count: 5 }] });
    return json({});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});

let n = 0;
const anon = () => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-code',
  client_ip: '203.0.116.' + (10 + (n % 200)), session_id: 'sess-qa-a-' + (++n) });
async function call(name, args, seat = anon()) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const body = (r) => { try { return JSON.parse(r.content[0].text); } catch (_) { return null; } };
const env = (k, v) => { const p = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; return () => { if (p === undefined) delete process.env[k]; else process.env[k] = p; }; };

describe('3: the top 20 metros (lib/top-metros.mjs)', () => {
  it('is one list of 20 with aliases, and the predicate is per tool and per market', () => {
    expect(TOP_METROS).toHaveLength(20);
    expect(new Set(TOP_METROS.map((m) => m.slug)).size).toBe(20);
    expect(topMetroSlug('Dallas')).toBe('dallas');
    expect(topMetroSlug('Northern Virginia')).toBe('northern-virginia');
    expect(topMetroSlug('ashburn')).toBe('northern-virginia');
    expect(topMetroSlug('hillsboro')).toBe('portland');
    expect(topMetroSlug('boise')).toBeNull();
    expect(topMetroFreeCall('get_market_context', { market: 'dallas' })).toBe('dallas');
    expect(topMetroFreeCall('get_market_dcpi_rank', { market_slug: 'phoenix' })).toBe('phoenix');
    expect(topMetroFreeCall('get_grid_intelligence', { market: 'dallas' })).toBeNull();
    expect(topMetroFreeCall('get_market_context', { market: 'dallas' }, { DCHUB_TOP_METROS_FREE: '0' })).toBeNull();
  });

  it('keyless get_market_context for Dallas: the full pack, grid and risk included, every section dated, labelled full', async () => {
    const r = await call('get_market_context', { market: 'dallas' });
    const j = body(r);
    expect(j.tier).toBe('full');
    expect(j.sections.map((s) => s.id)).toEqual(['hero', 'grid', 'pipeline', 'risk']);
    for (const s of j.sections) expect(s.as_of, s.id).toBeTruthy();
    expect(j.sections.find((s) => s.id === 'risk').as_of_basis).toMatch(/briefing build date/);
    expect(j).not.toHaveProperty('_free_preview');
    expect(j).not.toHaveProperty('locked_sections');
    expect(j.access).toBe('full');
    expect(j.access_basis).not.toMatch(/\bPro\b|Developer|\$\d/);       // no plan name, no price
    const prov = (r.structuredContent || {}).provenance || {};
    expect(prov.completeness).not.toBe('partial_preview');
    expect(JSON.stringify(r)).not.toMatch(/PARTIAL preview/);
  });

  it('a market outside the 20 is still the free preview (the control)', async () => {
    const j = body(await call('get_market_context', { market: 'boise' }));
    expect(j.tier).toBe('free');
    expect(j.sections.map((s) => s.id)).toEqual(['hero']);
  });

  it('kill switch DCHUB_TOP_METROS_FREE=0 restores the preview for Dallas', async () => {
    const restore = env('DCHUB_TOP_METROS_FREE', '0');
    try {
      const j = body(await call('get_market_context', { market: 'dallas' }));
      expect(j.tier).toBe('free');
    } finally { restore(); }
  });

  it('keyless get_market_intel for Dallas: full answer with time to power, broker rates withheld', async () => {
    const j = body(await call('get_market_intel', { market: 'dallas' }));
    expect(j.taste).toBeUndefined();
    expect(j.siting.time_to_power).toMatchObject({ band: '24_to_48_months', as_of: '2026-10-20' });
    expect(j.top_providers[0].power_mw).toBe(900);
    expect(j.market_pricing.asking_rate).toBeNull();
    expect(j.market_pricing.asking_rate_range).toBeNull();
    expect(j.market_pricing.rates_withheld).toBe(true);
    expect(JSON.stringify(j.market_pricing)).not.toMatch(/160|185/);
  });

  it('keyless get_market_dcpi_rank: detailed scores for Dallas, masked for Boise', async () => {
    const d = body(await call('get_market_dcpi_rank', { market_slug: 'dallas' }));
    expect(d.constraint_score).toBe(48.2);
    expect(d.excess_power_score).toBe(61);
    expect(d.time_to_power_months).toBe(30);
    expect(d.computed_at).toBeTruthy();
    const b = body(await call('get_market_dcpi_rank', { market_slug: 'boise' }));
    expect(b.constraint_score).toBeNull();
  });
});

describe('2a: a full context pack is not labelled partial', () => {
  it('_dropServedFreePreview removes the copy only from a tier:"full" pack', () => {
    const full = { content: [{ type: 'text', text: JSON.stringify(PACK('dallas')) }], structuredContent: PACK('dallas') };
    const r = S._dropServedFreePreview(full, 'get_market_context');
    expect(JSON.parse(r.content[0].text)).not.toHaveProperty('_free_preview');
    expect(r.structuredContent).not.toHaveProperty('_free_preview');
    const free = { content: [{ type: 'text', text: JSON.stringify({ ...PACK('x'), tier: 'free' }) }] };
    expect(S._dropServedFreePreview(free, 'get_market_context')).toBe(free);
    expect(S._dropServedFreePreview(full, 'get_market_intel')).toBe(full);
  });
  it('datePackSections drops the copy and dates an undated section from the pack', () => {
    const p = datePackSections({ as_of: null, sections: [{ id: 'risk', as_of: null }], _free_preview: {} });
    expect(p).not.toHaveProperty('_free_preview');
    expect(p.sections[0]).toMatchObject({ as_of: null, as_of_basis: expect.stringMatching(/undated/) });
  });
});

describe('2b: the meter counts this tool on the charged bucket', () => {
  it('a first grid answer reads call 1 even when other tools spent the caller budget', async () => {
    const restoreA = env('DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY', '0');
    try {
      const k = 'dch_live_qa_a_meter_key_0001';
      // Other tools spend the key's all-tools caller budget today (cap 2 x mult 2 = 4).
      for (const t of ['get_fiber_intel', 'get_energy_prices', 'get_pipeline']) await S._trialFullCallsExceeded(k, t, 2, k);
      const seat = { api_key: k, tier: 'free', platform: 'claude', client_name_raw: 'claude-code',
        client_ip: '198.51.100.71', session_id: 'sess-qa-a-meter' };
      const r = await call('get_grid_intelligence', { iso: 'ERCOT' }, seat);
      const mt = (r.structuredContent || {})._metered_trial;
      expect(mt, 'a full metered answer').toBeDefined();
      expect(mt.call).toBe(1);
      expect(mt.counted).toBe('per API key, per UTC day, on this tool');
      expect(S._fullCallsUsedToday(k, 'get_grid_intelligence')).toBe(1);
    } finally { restoreA(); }
  });
});

describe('2c: no answer carries queued_load_total_gw', () => {
  it('renameQueueTotals puts each total under the name of what it measures', () => {
    const rows = [
      { iso: 'PJM', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue', queued_generation_gw: 135.1 },
      { iso: 'MISO', queued_load_total_gw: 250 },
      { iso: 'ERCOT', queued_load_total_gw: 474, queued_load_total_gw_basis: 'large_load', queued_generation_gw: 453.8 },
      { iso: 'NESO', queued_load_total_gw: 700 },
    ];
    const frozen = JSON.parse(JSON.stringify({ by_iso: rows }));
    Object.freeze(frozen); frozen.by_iso.forEach(Object.freeze);
    const out = renameQueueTotals(frozen).by_iso;
    expect(JSON.stringify(out)).not.toMatch(/queued_load_total_gw/);
    expect(out[0]).toMatchObject({ queue_kind: 'generation_queue', queued_generation_gw: 135.1 });
    expect(out[1]).toMatchObject({ queue_kind: 'generation_queue', queued_generation_gw: 250 });
    expect(out[2]).toMatchObject({ queue_kind: 'large_load', queued_large_load_gw: 474, queued_generation_gw: 453.8 });
    expect(out[3]).toMatchObject({ queue_kind: 'mixed_connection_queue', queued_connections_gw: 700 });
    // the shared splitter reads both shapes the same
    for (let i = 0; i < rows.length; i++) expect(S._splitQueueRow(out[i])).toEqual(S._splitQueueRow(rows[i]));
  });
  it('get_interconnection_queue (PJM) serves no queued_load_total_gw anywhere: the full answer and the preview', async () => {
    // A paid seat gets the backend row itself (the path that would carry the field through).
    const paid = { api_key: 'dch_live_qa_a_paid_0001', tier: 'enterprise', platform: 'claude', client_name_raw: 'claude-code',
      client_ip: '198.51.100.72', session_id: 'sess-qa-a-paid' };
    const full = await call('get_interconnection_queue', { iso: 'PJM' }, paid);
    expect(JSON.stringify(full)).toMatch(/"queue_kind":"generation_queue"/);
    expect(JSON.stringify(full)).toMatch(/135\.1/);
    expect(JSON.stringify(full)).not.toMatch(/queued_load_total_gw/);
    const r = await call('get_interconnection_queue', { iso: 'PJM' });
    expect(JSON.stringify(r)).not.toMatch(/queued_load_total_gw/);
  });
});
