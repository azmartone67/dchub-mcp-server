// b2-analyze-site-keyless-headline.test.mjs — B2 (owner 2026-10-03)
//
// DO NOT MERGE BEFORE 2026-10-19 (pricing A/B 10-04..10-18).
//
// analyze_site, keyless: the verdict band, the NAME of the weakest factor and
// counts, on every arm (it used to be the plain wall outside the paywall-
// contract arms). No numeric score, factor band, MW, distance or substation name.
// A key below Pro: the Land & Power preview plus factor bands and
// nearest_substations as distance band + kV band (no name, HIFLD id, exact kV
// or exact distance; P0-1 rule), with test_sub_* fixture rows dropped (P0-2).
// compare_sites and the other Land & Power tools are untouched (D6 remainder: NO).
// The analyze_site description says exactly this (flips A3's "Keyless returns
// no site data" assertion).
//
// Real registered handlers under a real caller seat, backend stubbed (same
// harness as test/lp-pro-only.test.mjs).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'https://backend.b2-site-headline.test';
let S, TOOLS, realFetch;
let credits = 0, grandfathered = false;
const burns = [];
const backendPaths = [];
let planFor = {};

const SITE_SCORE = {
  success: true, location: { lat: 39.0412345, lon: -77.4845678, state: 'VA' },
  capacity_requested_mw: 100, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  power_cost: { industrial_cents_kwh: 8.37, commercial_cents_kwh: 11.29, period: '2026-07',
                state: 'Virginia', basis: 'EIA state retail average', source: 'EIA via DC Hub' },
  nearby: { facilities_100km: 685, total_capacity_mw: 8336.4, substations_50km: 212,
            gas_pipelines_50km: 14, power_plants_80km: 37, generation_capacity_mw: 5123.9,
            fiber_carriers_in_state: 44 },
  fiber: { connectivity_score: 95.4, near_net_bucket: 'near-net', nearest_carrier_km: 0.41,
           carrier_count: 623, single_carrier_risk: false, basis: 'parcel',
           top_carriers: [{ carrier: 'Amazon.com', distance_km: 0.41 }, { carrier: 'Google LLC', distance_km: 0.77 },
                          { carrier: 'Oracle Cloud', distance_km: 0.78 }, { carrier: 'Zayo', distance_km: 1.23 }],
           verdict: 'Carrier-rich: 623 carriers, fiber near-net (0.41 km).' },
  interpretation: 'Excellent site', source: 'DC Hub Site Intelligence',
  // P0-1 (mcp#702): a name and exact kV outside nearest_substations must not reach below Pro either.
  nearest: { hv_substation: { name: 'WESTWING', voltage_kv: 500, km: 3.2 } },
  nearest_substations: {
    substations: [
      { hifld_id: 'test_sub_xyz', name: 'test_sub_xyz', max_kv: 230, distance_km: 0.4, kv_band: '230-344 kV',
        source: 'HIFLD Electric Substations', as_of: '2021-02-01', basis_class: 'published' },
      { hifld_id: '107655', name: 'HOLCOMBE', max_kv: 138, distance_km: 2.3, kv_band: '115-229 kV',
        source: 'HIFLD Electric Substations', as_of: '2021-02-01', basis_class: 'published' },
      { hifld_id: '107656', name: 'WESTRIDGE', max_kv: 500, distance_km: 7.6, kv_band: '500 kV+',
        source: 'HIFLD Electric Substations', as_of: '2021-02-01', basis_class: 'published' },
    ],
    search_radius_km: 50, coverage: 'HIFLD (United States and territories) only' },
  upgrade_url: 'https://dchub.cloud/pricing',
};
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let prevInternal;
beforeAll(async () => {
  // _goUrl signs a checkout only when it has the internal key; without one it
  // falls back to the direct Stripe link, and the plan could not be read back.
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'lp-pro-only-test-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    backendPaths.push(p);
    if (p === '/api/site-score') return json(SITE_SCORE);
            if (p.startsWith('/api/v1/mcp/credits/balance'))
      return json({ credits, had_pack: credits > 0, lp_grandfathered: grandfathered });
    if (p.startsWith('/api/v1/mcp/credits/burn')) {
      burns.push(p);
      return json({ ok: true, remaining: Math.max(0, credits - 5) });
    }
    if (p === '/api/v1/keys/validate') {
      let apiKey = ''; try { apiKey = JSON.parse((init && init.body) || '{}').api_key || ''; } catch { /* ignore */ }
      const plan = Object.prototype.hasOwnProperty.call(planFor, apiKey) ? planFor[apiKey] : null;
      return json({
        valid: true, tier: 'paid', developer_id: null, email: 'caller@example.com',
        tier_detail: { mcp_dev_keys: 'paid', users_plan: plan, api_key_tier: null, effective: 'paid' },
      });
    }
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
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});
beforeEach(() => { credits = 0; grandfathered = false; burns.length = 0; backendPaths.length = 0; planFor = {}; S.keyCache.clear(); });

let seatN = 0;
const seat = (tier, key, extra = {}) => ({
  ...(key ? { api_key: key } : {}), tier, ...extra, platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '198.51.100.' + (10 + (seatN % 200)), session_id: 'sess-lp-pro-only-' + (++seatN),
});
async function call(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const textOf = (r) => (r.content || []).map((c) => c.text || '').join('\n');
// Wall-clock ISO timestamps (retrieved_at, as_of …) are masked before the
// "no figure" substring checks: a withheld figure like '0.53' or '8.37' can
// occur by chance inside "…T06:27:50.534Z" and fail the test at random
// (measured 2026-09-26: 1 in ~7 local runs; mcp#571 smoke run 36220517830).
const _ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const all = (r) => (textOf(r) + '\n' + JSON.stringify(r.structuredContent || {})).replace(_ISO_TS, '<ts>');

// The paywall-contract arm must not be what produces the headline: force v1.
let _prevPc;
beforeAll(() => { _prevPc = process.env.DCHUB_PAYWALL_CONTRACT; process.env.DCHUB_PAYWALL_CONTRACT = '0'; });
afterAll(() => { if (_prevPc === undefined) delete process.env.DCHUB_PAYWALL_CONTRACT; else process.env.DCHUB_PAYWALL_CONTRACT = _prevPc; });

const LOC = { lat: 39.04, lon: -77.48, capacity_mw: 100 };
const SCORES = ['83.7', '88.1', '71.3', '95.4', '60.6', '72.2', '8336.4', '5123.9', '0.41', '8.37'];

describe('B2 keyless analyze_site: verdict band, weakest factor, counts', () => {
  it('returns the headline with no numeric score (contract arm off)', async () => {
    const r = await call('analyze_site', LOC, seat('free'));
    const sc = r.structuredContent;
    expect(sc.verdict).toBe('BUILD');
    expect(sc.limiting_factor.factor).toBe('market conditions');
    expect(sc.limiting_factor.band).toBeUndefined();            // factor bands need a key
    expect(sc.interpretation_label).toBeUndefined();            // finer than the band
    expect(sc.site_counts).toEqual({ facilities_100km: 685, substations_50km: 212,
      gas_pipelines_50km: 14, power_plants_80km: 37, fiber_carriers_in_state: 44 });
    const a = all(r);
    for (const f of SCORES) expect(a).not.toContain(f);
    expect(a).not.toMatch(/HOLCOMBE|WESTRIDGE|WESTWING|107655|test_sub_/);
    expect(a).not.toMatch(/overall_score|"scores"/);
    expect(textOf(r)).toContain('BUILD');
    expect(textOf(r)).toContain('weakest factor market conditions');
    expect(sc.message).toMatch(/verdict band, the weakest factor and counts/);
  });

  it('kill switch DCHUB_B2_SITE_HEADLINE=0: the plain wall again', async () => {
    process.env.DCHUB_B2_SITE_HEADLINE = '0';
    try {
      const r = await call('analyze_site', LOC, seat('free'));
      expect(r.structuredContent.verdict).toBeUndefined();
      expect(r.structuredContent.site_counts).toBeUndefined();
    } finally { delete process.env.DCHUB_B2_SITE_HEADLINE; }
  });

  it('D6 remainder: compare_sites keyless stays the plain wall', async () => {
    const r = await call('compare_sites', { sites: [{ lat: 39.04, lon: -77.48 }, { lat: 33.45, lon: -112.07 }] }, seat('free'))
      .catch(() => null);
    if (r) {
      expect(r.structuredContent.site_verdicts).toBeUndefined();
      expect(r.structuredContent.site_counts).toBeUndefined();
    }
  });
});

describe('B2 free key: factor bands + substation distance/kV bands', () => {
  it('nearest_substations: distance band + kv_band, no name/id/exact kV/exact distance, no test_sub_', async () => {
    const r = await call('analyze_site', LOC, seat('free', 'dch_live_b2_free_fixture'));
    const sc = r.structuredContent;
    const subs = sc.nearest_substations;
    expect(subs.substations).toEqual([
      { distance_band: 'within 5 km', kv_band: '115-229 kV', source: 'HIFLD Electric Substations',
        as_of: '2021-02-01', basis_class: 'published' },
      { distance_band: 'within 10 km', kv_band: '500 kV+', source: 'HIFLD Electric Substations',
        as_of: '2021-02-01', basis_class: 'published' },
    ]);
    expect(subs.substations_in_radius).toBe(2);
    expect(subs.locked_fields).toEqual(['hifld_id', 'name', 'max_kv', 'distance_km']);
    expect(subs.tier_required).toBe('pro');
    expect(subs.note).not.toMatch(/\$/);
    const a = all(r);
    expect(a).not.toMatch(/HOLCOMBE|WESTRIDGE|WESTWING|107655|107656|test_sub_/);
    expect(a).not.toMatch(/"voltage_kv"/);
    const rows = JSON.stringify(subs.substations);
    expect(rows).not.toMatch(/max_kv|distance_km|hifld_id|"name"/);
    expect(a).not.toContain('2.3');
    expect(a).not.toContain('7.6');
  });

  it('factor bands for every scored factor, and still no score', async () => {
    const r = await call('analyze_site', LOC, seat('free', 'dch_live_b2_free_fixture2'));
    const sc = r.structuredContent;
    expect(sc.factor_bands).toEqual({ power_infrastructure: 'BUILD', gas_pipeline_access: 'BUILD',
      fiber_connectivity: 'BUILD', market_conditions: 'CAUTION', risk_resilience: 'BUILD' });
    expect(sc.overall_score).toBeNull();
    for (const f of ['83.7', '88.1', '71.3', '95.4', '60.6', '72.2']) expect(all(r)).not.toContain(f);
  });
});

describe('B2 helpers', () => {
  it('distance bands mirror substation_band_producer._BANDS', () => {
    expect(S._substationDistanceBand(0.2)).toBe('within 1 km');
    expect(S._substationDistanceBand(1.0)).toBe('within 1 km');
    expect(S._substationDistanceBand(4.9)).toBe('within 5 km');
    expect(S._substationDistanceBand(10)).toBe('within 10 km');
    expect(S._substationDistanceBand(24.99)).toBe('within 25 km');
    expect(S._substationDistanceBand(40)).toBe('over 25 km');
    expect(S._substationDistanceBand(null)).toBeNull();
  });
  it('fixture rows are recognised by name or id, case-insensitive', () => {
    expect(S._isFixtureSubstation({ name: 'TEST_SUB_diag' })).toBe(true);
    expect(S._isFixtureSubstation({ hifld_id: 'test_sub_xyz', name: 'X' })).toBe(true);
    expect(S._isFixtureSubstation({ name: 'HOLCOMBE' })).toBe(false);
    // the backend's rule (util/substation_filters, be#6282): exact diagnostics sources
    expect(S._isFixtureSubstation({ name: 'X', source: ' Diagnostic ' })).toBe(true);
    expect(S._isFixtureSubstation({ name: 'test_subway' })).toBe(false);
    expect(S._isFixtureSubstation({ name: 'X', source: 'HIFLD Electric Substations' })).toBe(false);
  });
});

describe('B2 description matches behaviour (flips A3)', () => {
  const DESC_B2 = 'Keyless returns the verdict band and weakest factor; a free key adds factor bands '
    + 'and substation distance bands; scores and figures are Pro.';
  it('analyze_site says keyless gets the headline, and keyless does', async () => {
    const d = TOOLS.analyze_site.description;
    expect(d).toContain(DESC_B2);
    expect(d).not.toMatch(/Keyless returns no site data/);
    const r = await call('analyze_site', LOC, seat('free'));
    expect(r.structuredContent.verdict).toBeTruthy();   // the claim is true
  });
});
