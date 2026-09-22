// lp-pro-only.test.mjs — Land & Power details are Pro (owner rule, 2026-09-22).
//
// MEASURED, live and keyless, before this change:
//   analyze_site              the verdict band, the verdict and the top limiting
//                             factor (the free "headline")
//   compare_sites             every site's fiber read: nearest carrier 0.41 km,
//                             each carrier's distance, "623 carriers ... (0.41 km)"
//   get_composite_site_score  the band and the per-factor coverage map
//   generate_site_analysis    a preview whose wall sold the $10 pack
// and a pack holder got every one of them in full.
//
// One matrix: every Land & Power tool (LP_TOOLS) against every kind of caller.
//   no key                             the wall: no verdict, band, name or figure;
//                                      Pro the only rung; claim_free_key for the preview
//   free, trial, Starter, Developer,   the preview: verdicts, bands, names, counts;
//   a pack bought after the cutover    every score, MW, distance, price and report
//                                      link null; coordinates at 2 dp; no credit spent
//   a pack bought before the cutover   the full answer, credits spent as before
//   Pro, enterprise                    the full answer
//
// These run the REAL registered handlers (createServer()._registeredTools) under
// a real caller seat (_ctxALS), with only the backend stubbed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const BASE = 'https://backend.lp-pro-only.test';
let S, TOOLS, realFetch;
let credits = 0, grandfathered = false;
const burns = [];
const backendPaths = [];

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
  upgrade_url: 'https://dchub.cloud/pricing',
};
const COMPOSITE = {
  success: true, _entity: 'site', location: { lat: 39.0412345, lng: -77.4845678, state: 'VA', address: '' },
  composite_score: 81.2, verdict: 'BUILD', confidence: 'conditional',
  coverage: { power_grid: 'validated', fiber: 'validated', water: 'validated', risk_resilience: 'validated',
              market_dcpi: 'unavailable' },
  coverage_ratio: '4/5',
  sub_scores: { power_grid: { score: 88.4, coverage: 'validated', basis: 'HIFLD substations within 50 km' },
                fiber: { score: 92.1, coverage: 'validated' }, water: { score: 61.5, coverage: 'validated' },
                risk_resilience: { score: 70.3, coverage: 'validated' },
                market_dcpi: { score: null, coverage: 'unavailable' } },
  weights_over_validated: { power_grid: 0.376, fiber: 0.235 },
  methodology: 'Weighted mean over VALIDATED factors only.',
  meta: { version: 'v1.0', timestamp: '2026-09-22T07:00:00' },
};
const SITE_REPORT = {
  ok: true, lat: 39.0412345, lon: -77.4845678,
  survey: { verdict: 'BUILD', power: { nearest_substation: { name: 'Ashburn 500kV', distance_mi: 0.53 },
                                       headroom_mw: 350.5 },
            water: { stress: 'Low', index: 1.27 } },
  // Digit-free on purpose: a signed report link must be dropped by name, not
  // only when a digit in it happens to trip the figure rule.
  pdf_report_url: 'https://dchub.cloud/report?sig=abcdefsigned',
  deliverable: 'Branded 5-page DC Hub Site Analysis PDF',
  share_text: 'DC Hub Site Analysis, download: https://dchub.cloud/report?sig=abcdefsigned',
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
    if (p === '/api/v1/site-planner/composite-score') return json(COMPOSITE);
    if (p === '/api/v1/site-report') return json(SITE_REPORT);
    if (p.startsWith('/api/v1/mcp/credits/balance'))
      return json({ credits, had_pack: credits > 0, lp_grandfathered: grandfathered });
    if (p.startsWith('/api/v1/mcp/credits/burn')) {
      burns.push(p);
      return json({ ok: true, remaining: Math.max(0, credits - 5) });
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
beforeEach(() => { credits = 0; grandfathered = false; burns.length = 0; backendPaths.length = 0; });

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
const all = (r) => textOf(r) + '\n' + JSON.stringify(r.structuredContent || {});
function head(r) {
  const t = textOf(r);
  try { return JSON.parse(t); } catch { /* prose */ }
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { return null; }
}
function plansOf(r) {
  return [...all(r).matchAll(/https:\/\/dchub\.cloud\/go\/c\/([A-Za-z0-9_-]+)\./g)]
    .map((m) => Buffer.from(m[1], 'base64url').toString().split('|')[0]);
}

const LOC = { lat: 39.0412345, lon: -77.4845678, state: 'VA' };
const CASES = {
  analyze_site: {
    args: LOC,
    figures: ['83.7', '88.1', '8.37', '11.29', '8336.4', '5123.9', '0.41', '0.77', '95.4', '39.0412345'],
    kept: (p) => [p.interpretation, p.nearby.substations_50km, p.fiber.carrier_count, p.fiber.top_carriers[0].carrier],
    keptWant: ['Excellent site', 212, 623, 'Amazon.com'],
    full: '83.7',
  },
  compare_sites: {
    args: { locations: '39.0412345,-77.4845678;33.45,-112.07' },
    figures: ['83.7', '88.1', '0.41', '8336.4', '(83.7)'],
    kept: (p) => [p.sites.length, p.sites[0].interpretation, p.winner],
    keptWant: [2, 'Excellent site', null],
    full: '83.7',
  },
  get_composite_site_score: {
    args: LOC,
    figures: ['81.2', '88.4', '92.1', '61.5', '70.3', '0.376', '39.0412345'],
    kept: (p) => [p.verdict, p.coverage_ratio, p.coverage.water],
    keptWant: ['BUILD', '4/5', 'validated'],
    full: '81.2',
  },
  generate_site_analysis: {
    args: { lat: 39.0412345, lon: -77.4845678, capacity_mw: 100 },
    figures: ['350.5', '0.53', '1.27', 'sig=abcdefsigned', '39.0412345'],
    kept: (p) => [p.survey.verdict, p.survey.water.stress, p.pdf_report_url],
    keptWant: ['BUILD', 'Low', null],
    full: 'sig=abcdefsigned',
  },
};
const PREVIEW_SEATS = {
  free: () => seat('free', 'dch_live_lp_free'),
  trial: () => seat('trial', 'dch_trial_lp_trial', { is_trial: true }),
  starter: () => seat('starter', 'dch_live_lp_starter'),
  developer: () => seat('developer', 'dch_live_lp_developer'),
  'pack after the cutover': () => { credits = 400; return seat('free', 'dch_live_lp_new_pack'); },
};
const LOWER_RUNG = ['$10', 'Developer', 'credit pack', '1,000 API credits', 'Starter', '$49'];

describe.each(Object.keys(CASES))('%s is Land & Power: Pro only', (tool) => {
  const K = CASES[tool];

  it('a keyless caller gets the wall and no data', async () => {
    const r = await call(tool, K.args, seat('anonymous', null));
    const sc = r.structuredContent || {};
    expect(sc._wall).toBe(true);
    expect(sc.error).toBe('pro_required');
    const text = all(r);
    for (const f of [...K.figures, 'Excellent site', 'BUILD', 'Amazon.com', 'validated']) expect(text).not.toContain(f);
    expect(plansOf(r).length).toBeGreaterThan(0);
    expect(new Set(plansOf(r))).toEqual(new Set(['pro']));
    for (const l of LOWER_RUNG) expect(text).not.toContain(l);
    expect(text).toContain('claim_free_key');
    expect(burns).toEqual([]);
  });

  it.each(Object.keys(PREVIEW_SEATS))('%s gets the preview: verdicts, names and counts, no figure', async (who) => {
    const r = await call(tool, K.args, PREVIEW_SEATS[who]());
    const p = head(r);
    expect(p && p._gated).toBe(true);
    expect(p._preview_only).toBe(true);
    const text = all(r);
    for (const f of K.figures) expect(text).not.toContain(f);
    expect(K.kept(p)).toEqual(K.keptWant);
    expect(new Set(plansOf(r))).toEqual(new Set(['pro']));
    for (const l of LOWER_RUNG) expect(text).not.toContain(l);
    expect(burns).toEqual([]);          // a preview spends no credit
  });

  it('a pack bought before the cutover keeps the full answer', async () => {
    credits = 400; grandfathered = true;
    const r = await call(tool, K.args, seat('free', 'dch_live_lp_old_pack'));
    expect(all(r)).toContain(K.full);
    expect(head(r)?._gated).not.toBe(true);
  });

  it.each(['pro', 'enterprise'])('%s gets the full answer', async (tier) => {
    const r = await call(tool, K.args, seat(tier, 'dch_live_lp_' + tier));
    expect(all(r)).toContain(K.full);
    expect(head(r)?._gated).not.toBe(true);
    expect(burns).toEqual([]);
  });
});

it('LP_TOOLS names the four Land & Power twins, and each is a registered tool', () => {
  expect([...S.LP_TOOLS].sort()).toEqual(['analyze_site', 'compare_sites', 'generate_site_analysis',
    'get_composite_site_score']);
  for (const t of S.LP_TOOLS) expect(TOOLS[t], t).toBeTruthy();
});

it('a grandfathered pack is read from the backend, never assumed', async () => {
  credits = 400; grandfathered = false;
  const r = await call('analyze_site', LOC, seat('free', 'dch_live_lp_not_grandfathered'));
  expect(head(r)?._gated).toBe(true);
  expect(backendPaths.some((p) => p.startsWith('/api/v1/mcp/credits/balance'))).toBe(true);
});

it('the preview keeps a coordinate at two decimals, not zero decimals', () => {
  const p = S._lpPreviewPayload({ lat: 39.0412345, lon: -77.4845678, n: { substations_50km: 3, mw: 12.5 } });
  expect(p).toEqual({ lat: 39.04, lon: -77.48, n: { substations_50km: 3, mw: null } });
});
