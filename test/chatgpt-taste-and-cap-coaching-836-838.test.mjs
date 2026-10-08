// chatgpt-taste-and-cap-coaching-836-838.test.mjs — the two residues of the 2026-10-08
// live verification of mcp#833 / mcp#837 (tracker dchub-frontend#1809).
//
//   #836  On X-MCP-Platform: chatgpt the free preview of get_grid_intelligence /
//         get_interconnection_queue / get_market_intel withheld correctly and carried the
//         hosted link, but structuredContent had no `taste`, no `free_preview_only`, no
//         `completeness.status` (the claude platform carried all three). The clean-platform
//         branch handed structuredContent a five-key envelope while content[0] carried the
//         preview. Now the preview rides structuredContent too — on the header form, on
//         /mcp/chatgpt and on /mcp/chatgpt/oauth (through the directory scrub) — with every
//         commerce scrub still applied. Kill switch DCHUB_CLEAN_PLATFORM_PREVIEW_SC=0.
//   #838  The anonymous over-cap coaching (credits_pitch and "Want more today? $10 … your
//         next call goes through") rode depth-teased responses (get_gas_intelligence anon,
//         `_dcgi_score_in_pro`), where the pack returns nothing more. The pack sentence now
//         rides only where a credit buys the next call in full (a tool that is not
//         depth-teased); on a depth tease the coaching names the free key and the page in
//         human_url, and the relay token is not stamped w-capacity. The keyless trim's
//         credits_hint follows the same rule. Kill switch DCHUB_CAP_COACH_DEPTH=0.
//
// Real registered handlers under a real caller seat; only the backend is stubbed (no network).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { DIRECTORY_PROFILE, DIRECTORY_OAUTH_SOURCE, scrubToolResult } from '../lib/chatgpt-directory.mjs';
import { isGatedResult } from '../lib/paywall-contract.mjs';

const BASE = 'https://backend.chatgpt-taste-836-838.test';
const INTERNAL = 'chatgpt-taste-836-838-internal-key';
const SHORT = 'https://dchub.cloud/u/abc836';
const PAGE_LINK = /https:\/\/(?:www\.)?dchub\.cloud\/[^\s"'`<>\\)\]}]*[^\s"'`<>\\)\]}.,;:!?*]/g;
const ENDPOINT = /^https:\/\/dchub\.cloud\/(?:api\/v1\/|mcp(?![A-Za-z0-9_-])|\.well-known\/)/;
let S, TOOLS, realFetch, prevInternal, prevBase, prevCap, prevMult, prevIsError;

// Backend fixtures: the live shapes, every decision scalar PRESENT (so an absent one is withheld).
const GI = {
  demand_mw: 95021, demand_period: '2026-10-08T07', generation_mix_period: '2026-10-08T03',
  generation_mix: { NG: { mw: 33582 }, NUC: { mw: 27692 }, WND: { mw: 5943 }, SUN: { mw: 28 } },
  peak_mw: 95021, min_mw: 74723, load_factor: 0.786,
  demand_24h: Array.from({ length: 22 }, (_, i) => ({ period: `2026-10-08T${String(i + 1).padStart(2, '0')}`, mw: 80000 + i * 500 })),
  related_intel: Array.from({ length: 4 }, (_, i) => ({ title: `intel ${i}`, url: `https://dchub.cloud/intel/${i}` })),
};
const CMP = { isos: [{ iso: 'PJM', iso_name: 'PJM Interconnection', avg_constraint: 49.2, avg_excess: 28.8,
  avg_time_to_power_months: 30.3, avg_queue_wait_months: 30.4, avg_curtailment_pct: 1, avg_reserve_margin_pct: 12.5,
  avg_kwh_cents: 14.4, total_stranded_capacity_mw: 1200, sum_emergency_30d: 0, market_count: 64, build_count: 0,
  latest_computed_at: '2026-10-08T06:00:00Z' }] };
const QSNAP = { by_iso: [{ iso: 'PJM', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_generation_gw: 135.1, as_of: '2026-10-08' }] };
const EXT = { available: true, forward_load_mw: 105415, committed_capacity_mw: 142206.4, operating_reserve_mw: 15859,
  grid_carbon_intensity_lb_mwh: 801.66, capacity_auction_price_usd_mw_day: 333.44 };
const QUEUE = { iso: 'PJM', as_of: '2026-10-08', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_load_data_center_gw: 40.2, queued_load_dc_share_pct: 29.7, new_applications_q_gw: 12.3, new_applications_period: '2026-Q2',
  historical_completion_pct: 18.5, queued_generation_gw: 135.1, queued_generation_gw_as_of: '2026-10-08',
  top_subregions: [{ name: 'Dominion', gw: 41.0 }], source_url: 'https://www.pjm.com/planning/service-requests',
  source_name: 'PJM queue', v: 'published', project_count: 972,
  projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: `AG1-${100 + i}`, project_name: `Project ${i}`,
    capacity_mw: 100 + i, fuel_type: 'SOLAR', state: 'VA', queue_status: 'active' })) };
const MARKET = {
  success: true,
  market: { id: 'northern-virginia', name: 'Northern Virginia', cities: ['Ashburn', 'Sterling', 'Reston', 'Herndon'] },
  stats: { facility_count: 857, total_power_mw: 13366.0, avg_power_mw: 41.2, provider_count: 90, mw_reporting_count: 320 },
  as_of: '2026-10-06T14:22:31Z',
  top_providers: Array.from({ length: 10 }, (_, i) => ({ name: `Provider ${i}`, facilities: 30 - i, power_mw: 900 - i * 40 })),
  by_status: { operational: 600, under_construction: 150, planned: 107 },
  recent_facilities: Array.from({ length: 5 }, (_, i) => ({ name: `Facility ${i}`, city: 'Ashburn', capacity_mw: 60 + i })),
  market_pricing: { available: true, basis: 'broker_report', asking_rate: 160.0, asking_rate_range: [160.0, 185.0],
    unit: '$/kW/mo', deal_size: '250-500 kW wholesale', vacancy_percent: 4.0, period: 'H1 2026', source: 'CBRE / JLL market reports' },
  siting: { available: true, iso: { code: 'PJM', class: 'RTO', operator: 'PJM Interconnection' },
    utilities: { names: ['Dominion Energy Virginia'], kind: 'IOU' },
    dcpi: { verdict: 'CAUTION', band: 'excess-power score at least 40 and grid-constraint score at most 60',
      data_basis: 'measured', as_of: '2026-10-07', method_url: 'https://dchub.cloud/dcpi/methodology' },
    time_to_power: { band: '24_to_48_months' }, mw: { total_mw: 13366.0, rows_total: 857 } },
  _gated: false,
};
const GAS = {
  region: 'TX', region_name: 'Texas', dcgi_score: 71.2, dcgi_verdict: 'BUILD', dcgi_score_band: 'strong',
  dcgi_status: 'restored_2026-08-30', gas_to_grid_status: 'restored_2026-09-27',
  henry_hub_usd_mmbtu: 2.9, basis_usd_mmbtu: 2.5, delivered_price_usd_mmbtu: 3.1,
  gas_to_grid_usd_per_mwh: { new_ccgt: 40.1, existing_ccgt: 36.2 }, headline_behind_meter_vs_grid_delta_usd_mwh: -8.3,
  headline: { delta_usd_mwh: -8.3, gas_to_grid_new_ccgt_usd_mwh: 40.1, interpretation: 'cheaper' },
  live_grid_gas_share_pct: 44.1, gas_access_score: 81,
  gas_access: { pipeline_count: 12, operators: ['Kinder Morgan', 'Energy Transfer', 'Enbridge'] },
  pipeline_presence: { operators: ['Kinder Morgan', 'Energy Transfer', 'Enbridge'],
    parent_midstreams: Array.from({ length: 8 }, (_, i) => `Midstream ${i}`) },
  matched_entities: Array.from({ length: 4 }, (_, i) => ({ name: `Entity ${i}` })),
  burner_tip: { method: 'trailing-12-month mean', rule: 'peu-ttm-v1', usd_mmbtu: 2.8, status: 'ok', state: 'TX' },
  data_basis: { henry_hub: 'live', dcgi: 'measured' }, omitted_no_fabrication: ['gas_storage', 'lng'],
};
const ROWS = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, name: 'Site ' + i, iso: 'PJM', score: 50 + i,
  lat: 39 + i / 10, lon: -77, city: 'Ashburn', state: 'VA', country: 'US', power_mw: 20 + i }));
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

// The anonymous per-IP counter the stub reports (DCHUB_ANON_DAILY_CAP=30, hard wall at 10x).
const usage = { count: 0, hits: 0 };
const CAP = 30;

beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = INTERNAL;
  prevCap = process.env.DCHUB_ANON_DAILY_CAP;
  prevMult = process.env.DCHUB_ANON_HARD_WALL_MULT;
  process.env.DCHUB_ANON_DAILY_CAP = String(CAP);
  process.env.DCHUB_ANON_HARD_WALL_MULT = '10';
  prevIsError = process.env.DCHUB_PREVIEW_ISERROR;
  process.env.DCHUB_PREVIEW_ISERROR = '0';   // production transport (see free-decision-tools-preview-only)
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let u = null; try { u = new URL(url); } catch { /* not a URL */ }
    const p = u ? u.pathname : '';
    if (p === '/api/v1/mcp/anon-usage') { usage.hits += 1; return json({ ok: true, count: usage.count }); }
    if (p === '/api/v1/relay/short') return json({ ok: true, url: SHORT });
    if (p === '/api/v1/mcp/trial-check') return json({ trial_used: false, prior_calls: 0 });
    if (p === '/api/v1/mcp/session-key') return json({ error: 'not found' }, 404);
    if (p === '/api/v1/keys/auto-mint') return json({ error: 'not found' }, 404);
    if (p === '/api/v1/mcp/should-mint-claim') return json({ should_mint: false });
    if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return json({ ok: false });
    if (p === '/api/v1/mcp/monthly-usage') return json({ error: 'not found' }, 404);
    if (p === '/api/v1/inbox') return json({ ok: false, error: 'not_a_partner_key' }, 403);
    if (p.startsWith('/api/v1/grid/intelligence/')) return json(structuredClone(GI));
    if (p === '/api/v1/dcpi/iso-comparison') return json(structuredClone(CMP));
    if (p === '/api/v1/interconnection-queue/snapshot') return json(structuredClone(QSNAP));
    if (p.startsWith('/api/v1/grid/extended/')) return json(structuredClone(EXT));
    if (p === '/api/v1/interconnection-queue/by-iso') return json(structuredClone(QUEUE));
    if (p === '/api/v1/markets/northern-virginia') return json(structuredClone(MARKET));
    if (p.startsWith('/api/v1/gas/intelligence/')) return json(structuredClone(GAS));
    return json({ success: true, count: ROWS.length, data: ROWS, results: ROWS, total_mw: 1234.5 });
  };
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  // The anon count read is bounded by a 2500 ms deadline; the stub answers in microseconds, so
  // under the full suite that deadline is a scheduler race that fails OPEN (count 0) and would
  // silently un-fire the cap branch (anon-hard-wall.test.mjs, 2026-09-04).
  S._readDeadline.signal = () => AbortSignal.timeout(120_000);
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [['DCHUB_INTERNAL_KEY', prevInternal], ['DCHUB_API_BASE', prevBase], ['DCHUB_ANON_DAILY_CAP', prevCap],
    ['DCHUB_ANON_HARD_WALL_MULT', prevMult], ['DCHUB_PREVIEW_ISERROR', prevIsError]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const k of ['DCHUB_CLEAN_PLATFORM_PREVIEW_SC', 'DCHUB_CAP_COACH_DEPTH']) delete process.env[k];
});
beforeEach(() => {
  for (const k of ['DCHUB_CLEAN_PLATFORM_PREVIEW_SC', 'DCHUB_CAP_COACH_DEPTH']) delete process.env[k];
  usage.count = 0; usage.hits = 0;
  S.keyCache.clear();
});

let n = 0;
// A keyless free seat (tier 'free', no api_key): the shape the HTTP edge builds for an anonymous caller.
const seat = (extra = {}) => ({
  tier: 'free', api_key: null, platform: 'claude', client_name_raw: 'claude-ai', ...extra,
  client_ip: '203.0.113.' + (10 + (n % 200)), session_id: 'sess-836-838-' + (++n),
});
const CHATGPT = (extra = {}) => seat({ platform: 'chatgpt', client_name_raw: 'openai-mcp', ...extra });
// /mcp/chatgpt and /mcp/chatgpt/oauth: the same seat with the directory profile on ctx; the HTTP
// edge then projects the result through lib/chatgpt-directory.mjs scrubToolResult (applied below).
const DIRECTORY = (extra = {}) => CHATGPT({ profile: DIRECTORY_PROFILE, ...extra });
const OAUTH = (extra = {}) => DIRECTORY({ source: DIRECTORY_OAUTH_SOURCE, ...extra });

async function call(name, args, s) {
  for (const m of [S._anonUsageCounts, S._fullCapHydrated]) if (m && m.clear) m.clear();
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const textOf = (r) => r.content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
const base = (u) => String(u).replace(/[?#].*$/, '');
// Provenance is not a pointer (the one-link doctrine of #837 keeps provenance, source and a taste
// descriptor's method_url): the license line's /data-sources and the DCPI method page are data.
const PROVENANCE_PAGES = new Set(['https://dchub.cloud/data-sources', 'https://dchub.cloud/dcpi/methodology']);
function pageLinks(r) {
  const all = JSON.stringify(r).match(PAGE_LINK) || [];
  return [...new Set(all.filter((u) => !ENDPOINT.test(u)).map(base))].filter((u) => !PROVENANCE_PAGES.has(u));
}
function tokenFields(url) {
  const m = /\/upgrade\/h\/([A-Za-z0-9_-]+)\.([0-9a-f]{32})/.exec(String(url || ''));
  if (!m) return null;
  const sig = createHmac('sha256', INTERNAL).update(m[1]).digest('hex').slice(0, 32);
  expect(sig, 'the token verifies under the internal key').toBe(m[2]);
  return Buffer.from(m[1], 'base64url').toString().split('|');
}

const DECISION = [
  ['get_grid_intelligence', { region_id: 'PJM' }, ['constraint_score', 'excess_power_score', 'queue_depth_gw', 'demand_24h']],
  ['get_interconnection_queue', { iso: 'PJM' }, ['projects', 'queued_load_data_center_gw', 'historical_completion_pct']],
  ['get_market_intel', { market: 'northern-virginia' }, ['top_providers', 'recent_facilities', 'by_status']],
];

// What #836 asks for, on every chatgpt surface: the honesty block in structuredContent.
function expectTasteBlock(sc, tool, scalars, { directory = false } = {}) {
  expect(sc && typeof sc === 'object', 'structuredContent is an object').toBe(true);
  expect(sc.taste && typeof sc.taste === 'object', `${tool}: taste block`).toBe(true);
  expect(sc.taste.headline && typeof sc.taste.headline === 'object', `${tool}: taste.headline`).toBe(true);
  expect(typeof sc.taste.headline.name).toBe('string');
  expect(Array.isArray(sc.withheld) && sc.withheld.length > 0, `${tool}: withheld non-empty`).toBe(true);
  for (const w of sc.withheld) {
    expect(typeof w.section).toBe('string');
    expect(typeof w.count).toBe('number');
    expect(w.count).toBeGreaterThan(0);
  }
  expect(sc.free_preview_only, `${tool}: free_preview_only`).toBe(true);
  expect(sc.completeness && sc.completeness.status, `${tool}: completeness.status`).toBe('partial');
  for (const k of scalars) expect(sc[k], `${tool}: decision scalar ${k} must be absent`).toBeUndefined();
  if (!directory) {
    // provenance.preview (lib/attribution detectGating) reads the _in_pro markers the taste carries
    const pv = sc.provenance && sc.provenance.preview;
    expect(pv && typeof pv === 'object', `${tool}: provenance.preview`).toBe(true);
    expect(pv.withholding_proven).toBe(true);
    expect(Array.isArray(pv.withheld_fields) && pv.withheld_fields.length > 0).toBe(true);
  }
}

// ── #836 ──────────────────────────────────────────────────────────────────────
describe('#836 — X-MCP-Platform: chatgpt (header form): the taste rides structuredContent', () => {
  for (const [tool, args, scalars] of DECISION) {
    it(`${tool}: taste.headline, withheld[{section,count}], free_preview_only, completeness partial; /u/ in user_message; no stripe.com`, async () => {
      const r = await call(tool, args, CHATGPT());
      const sc = r.structuredContent;
      expectTasteBlock(sc, tool, scalars);
      // the hosted link in the person's line (as #825 / #833 already verified), and no commerce
      expect(String(sc.user_message || '')).toContain(SHORT);
      expect(sc.human_url).toBe(SHORT);
      const all = JSON.stringify(r);
      expect(all).not.toContain('stripe.com');
      expect(all).not.toContain('/go/c/');
      expect(all).not.toContain('https://dchub.cloud/upgrade/h/');
      // one page link, the hosted one
      expect(pageLinks(r)).toEqual([SHORT]);
      // the text block still carries the same preview (data first)
      expect(textOf(r).trimStart().startsWith('{')).toBe(true);
      expect(JSON.parse(textOf(r).split('\n')[0]).taste.headline.name).toBe(sc.taste.headline.name);
    });
  }

  it('the claude platform carries the same block (parity, the shape the issue compared against)', async () => {
    const r = await call('get_grid_intelligence', { region_id: 'PJM' }, seat());
    expectTasteBlock(r.structuredContent, 'get_grid_intelligence', ['constraint_score']);
  });

  it('CONTROL — DCHUB_CLEAN_PLATFORM_PREVIEW_SC=0: the five-key envelope is back (no taste in structuredContent)', async () => {
    process.env.DCHUB_CLEAN_PLATFORM_PREVIEW_SC = '0';
    const r = await call('get_grid_intelligence', { region_id: 'PJM' }, CHATGPT());
    const sc = r.structuredContent;
    expect(sc.taste).toBeUndefined();
    expect(sc.free_preview_only).toBeUndefined();
    expect(sc.tool).toBe('get_grid_intelligence');
    expect(JSON.stringify(r)).not.toContain('stripe.com');
    // the text block carried it all along — which is why the issue could be measured
    expect(JSON.parse(textOf(r).split('\n')[0]).taste).toBeTruthy();
  });
});

describe('#836 — /mcp/chatgpt and /mcp/chatgpt/oauth: the directory scrub keeps the block and drops the commerce', () => {
  for (const [tool, args, scalars] of DECISION) {
    it(`${tool} on /mcp/chatgpt: taste + withheld + completeness survive scrubToolResult; no stripe.com, no $ amount, no key`, async () => {
      const raw = await call(tool, args, DIRECTORY());
      const r = scrubToolResult(raw, tool);
      const sc = r.structuredContent;
      expectTasteBlock(sc, tool, scalars, { directory: true });
      expect(typeof sc.notice).toBe('string');   // the gated-result notice the profile appends
      const all = JSON.stringify(r);
      expect(all).not.toContain('stripe.com');
      expect(all).not.toMatch(/\$\s?\d/);
      expect(all).not.toMatch(/\bdch_[A-Za-z]+_[A-Za-z0-9]+/);
      expect(all).not.toContain('/upgrade/h/');
      expect(all).not.toContain('/go/c/');
      // the directory's own renames apply to the markers the taste carries
      expect(Object.keys(sc).some((k) => /_in_pro$/.test(k))).toBe(false);
    });
  }

  it('get_interconnection_queue on /mcp/chatgpt/oauth (the oauth scrub keeps a tier for the account check): the same block', async () => {
    const raw = await call('get_interconnection_queue', { iso: 'PJM' }, OAUTH());
    const r = scrubToolResult(raw, 'get_interconnection_queue', { identity: true });
    const sc = r.structuredContent;
    expectTasteBlock(sc, 'get_interconnection_queue', ['projects'], { directory: true });
    expect(typeof sc.notice).toBe('string');
    const all = JSON.stringify(r);
    expect(all).not.toContain('stripe.com');
    expect(all).not.toMatch(/\$\s?\d/);
    expect(all).not.toContain('/upgrade/h/');
  });
});

// ── #838 ──────────────────────────────────────────────────────────────────────
const PACK_RE = /\$10/;
describe('#838 — the anonymous over-cap coaching sells the pack only where a credit buys the next call', () => {
  it('predicate: depth-teased tools never sell the pack; capacity-class tools do; the switch restores the old copy', () => {
    for (const t of ['get_gas_intelligence', 'get_grid_intelligence', 'get_interconnection_queue', 'get_market_intel',
      'list_transactions', 'get_fiber_intel', 'analyze_site']) {
      expect(S._depthTeasedTool(t), t).toBe(true);
      expect(S._capCoachSellsPack(t), t).toBe(false);
    }
    for (const t of ['search_facilities', 'get_grid_scoreboard', 'get_grid_data', 'hyperscaler_deals', 'get_energy_prices']) {
      expect(S._depthTeasedTool(t), t).toBe(false);
      expect(S._capCoachSellsPack(t), t).toBe(true);
    }
    process.env.DCHUB_CAP_COACH_DEPTH = '0';
    expect(S._capCoachSellsPack('get_gas_intelligence')).toBe(true);
  });

  it('anon get_gas_intelligence UNDER the cap: depth-teased (_dcgi_score_in_pro), no $10, no credits_pitch', async () => {
    usage.count = 3;
    const r = await call('get_gas_intelligence', { region: 'TX' }, seat());
    const sc = r.structuredContent;
    expect(sc._dcgi_score_in_pro, 'the depth tease this issue was measured on').toBe(true);
    expect(sc._upgrade && sc._upgrade.tier).not.toBe('anon_daily_cap');
    const all = JSON.stringify(r);
    expect(all).not.toMatch(PACK_RE);
    expect(all).not.toContain('credits_pitch');
    expect(all).not.toContain('credits_hint');
  });

  it('anon get_gas_intelligence OVER the cap: the cap branch fires, names the free key and human_url, no $10, no credits_pitch, token not w-capacity', async () => {
    usage.count = 50;   // carrot band: >= cap 30, < the 10x wall at 300
    const r = await call('get_gas_intelligence', { region: 'TX' }, seat());
    const sc = r.structuredContent;
    expect(usage.hits, 'the anon-usage read happened').toBeGreaterThan(0);
    expect(sc._upgrade && sc._upgrade.tier, 'the anon_daily_cap branch did not fire').toBe('anon_daily_cap');
    expect(sc._dcgi_score_in_pro).toBe(true);
    expect(sc._upgrade.pack_opens).toBe(false);
    expect(sc._upgrade.wall).toBe('depth');
    expect(sc._upgrade.remaining_today).toBe(0);
    expect(sc._upgrade.message).toContain('claim_free_key');
    expect(sc._upgrade.message).toContain('human_url');
    expect(sc._upgrade.message).toMatch(/Developer/);
    expect(sc._upgrade.credits_pitch).toBeUndefined();
    expect(sc._upgrade.credits_url).toBeUndefined();
    expect(sc._upgrade.unlock_tool).toBeUndefined();
    const all = JSON.stringify(r);
    expect(all).not.toMatch(PACK_RE);
    expect(all).not.toContain('credits_pitch');
    expect(all).not.toContain('goes through');
    // the one-link rule of #837 holds: one page link, human_url, no /go/c
    expect(isGatedResult(r)).toBe(true);
    expect(typeof sc.human_url).toBe('string');
    expect(pageLinks(r)).toEqual([base(sc.human_url)]);
    expect(all).not.toContain('/go/c/');
    // the token is not stamped capacity: the page would sell the pack
    expect(S._relayTokenKind(sc.human_url)).not.toBe('w-capacity');
  });

  it('anon search_facilities OVER the cap (not depth-teased): the pack pitch rides, the token is w-capacity', async () => {
    usage.count = 50;
    const r = await call('search_facilities', { query: 'ashburn' }, seat());
    const sc = r.structuredContent;
    expect(sc._upgrade && sc._upgrade.tier, 'the anon_daily_cap branch did not fire').toBe('anon_daily_cap');
    expect(sc._upgrade.credits_pitch).toMatch(PACK_RE);
    expect(sc._upgrade.message).toMatch(PACK_RE);
    expect(sc._upgrade.message).toContain('goes through');
    expect(sc._upgrade.pack_opens).toBeUndefined();
    expect(sc._upgrade.binding_limit).toBe('anon_ip_daily');
    if (typeof sc.human_url === 'string') {
      const f = tokenFields(sc.human_url);
      expect(f, 'a relay was minted for the capacity wall').not.toBeNull();
      expect(S._relayTokenKind(sc.human_url)).toBe('w-capacity');
    }
  });

  it('anon hard wall (10x the cap) keeps the pack sentence: a capacity wall, the pack buys the day', async () => {
    usage.count = 300;
    const r = await call('get_gas_intelligence', { region: 'TX' }, seat());
    expect(r.structuredContent.error).toBe('anon_hard_wall');
    expect(textOf(r)).toMatch(PACK_RE);
  });

  it('CONTROL — DCHUB_CAP_COACH_DEPTH=0: the depth-teased over-cap coaching sells the pack again', async () => {
    process.env.DCHUB_CAP_COACH_DEPTH = '0';
    usage.count = 50;
    const r = await call('get_gas_intelligence', { region: 'TX' }, seat());
    const sc = r.structuredContent;
    expect(sc._upgrade && sc._upgrade.tier).toBe('anon_daily_cap');
    expect(sc._upgrade.credits_pitch).toMatch(PACK_RE);
    expect(sc._upgrade.message).toContain('goes through');
    expect(sc._upgrade.pack_opens).toBeUndefined();
  });

  it('a keyed free caller on get_gas_intelligence is not coached by the anonymous cap at all', async () => {
    usage.count = 50;
    const r = await call('get_gas_intelligence', { region: 'TX' }, seat({ api_key: 'dch_live_cap836838test000001', auth_source: 'header' }));
    const sc = r.structuredContent;
    expect(sc._upgrade && sc._upgrade.tier).not.toBe('anon_daily_cap');
    expect(usage.hits).toBe(0);   // the !c.api_key guard: no anon-usage read for a keyed caller
  });

  it('_wallKindFor: the depth coaching is not capacity; the same coaching with pack_opens unset still is', () => {
    const c = { api_key: null, tier: 'free' };
    const coach = { tier: 'anon_daily_cap', remaining_today: 0, binding_limit: 'anon_ip_daily' };
    const depth = { _dcgi_score_in_pro: true, _upgrade: { ...coach, pack_opens: false, wall: 'depth' } };
    expect(S._wallKindFor(depth, c, 'get_gas_intelligence')).not.toBe(S.WALL_KIND_CAPACITY);
    const capacity = { _total_mw_in_pro: true, _upgrade: { ...coach } };
    expect(S._wallKindFor(capacity, c, 'search_facilities')).toBe(S.WALL_KIND_CAPACITY);
  });
});
