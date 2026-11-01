// Item 1 leftover (owner-approved 2026-10-16/17): wall and gated-result text on /mcp states the
// neutral partial line (CHATGPT_NOTICE) where it said "need(s) a paid DC Hub plan", "opens with a
// paid DC Hub plan", "comes with a paid DC Hub plan" or "the fields above are in a paid DC Hub plan".
// Each wall keeps its one offer link, which is human_url.
//
// /mcp/chatgpt is FROZEN (the ChatGPT app is in OpenAI review): it keeps every old sentence, including
// inside an execute_plan started there (its steps run on /mcp and carry a single-use legacy-wall token).
//
// Real server.mjs app on loopback, stub backend; no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { CHATGPT_NOTICE, DIRECTORY_PROFILE } from '../lib/chatgpt-directory.mjs';
import { CLAUDE_PROFILE } from '../lib/claude-directory.mjs';
// This file pins the analyze_site wall / preview, which serves once a caller's daily full site runs
// are spent (DCHUB_KEYLESS_SITE_FULL, owner 2026-11-01); test/keyless-site-full-daily.test.mjs pins the runs.
process.env.DCHUB_KEYLESS_SITE_FULL = '0';
// This file exercises the free-tier gate on markets (Northern Virginia, Dallas, Houston, Santa Clara)
// that the top-20-metros decision (owner 2026-10-20, lib/top-metros.mjs) now opens to every caller.
// The gate still applies to every other market, so it is tested here with that decision switched
// off; the open top-20 behaviour is pinned in test/agent-qa-a-signals-metros.test.mjs.
process.env.DCHUB_TOP_METROS_FREE = '0';

const FREE_KEY = 'dch_live_FREEitem1Key0123456789abcdefg';
const SHORT = 'https://dchub.cloud/u/item1x';
// The sentence family this change removes from /mcp walls. The offer lines that stay ("Tell your
// human: ... a paid DC Hub plan → link", the relay line "those fields are in a paid DC Hub plan, and
// the page shows the options — open <link>") are not in it.
const FAMILY = /(?:needs?|opens? with|comes? with) a (?:different )?paid DC Hub plan|(?:fields above|details) are in a paid DC Hub plan/;
const NEUTRAL = CHATGPT_NOTICE.replace(/\.$/, '');
const OFFER_LINK = /https:\/\/dchub\.cloud\/(?:upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}|u\/[A-Za-z0-9]+|go\/c\/[A-Za-z0-9_.-]+)/g;

const GI = { demand_mw: 95021, demand_period: '2026-10-08T07', generation_mix_period: '2026-10-08T03',
  generation_mix: { NG: { mw: 33582 }, NUC: { mw: 27692 }, WND: { mw: 5943 }, SUN: { mw: 28 } },
  peak_mw: 95021, min_mw: 74723, load_factor: 0.786,
  demand_24h: Array.from({ length: 22 }, (_, i) => ({ period: `2026-10-08T${String(i + 1).padStart(2, '0')}`, mw: 80000 + i * 500 })) };
const CMP = { isos: [{ iso: 'PJM', iso_name: 'PJM Interconnection', avg_constraint: 49.2, avg_excess: 28.8,
  avg_time_to_power_months: 30.3, avg_queue_wait_months: 30.4, avg_reserve_margin_pct: 12.5, avg_kwh_cents: 14.4,
  market_count: 64, build_count: 0, latest_computed_at: '2026-10-08T06:00:00Z' }] };
const QUEUE = { iso: 'PJM', as_of: '2026-10-08', queued_load_total_gw: 135.1, queued_load_total_gw_basis: 'generation_queue',
  queued_load_data_center_gw: 40.2, queued_load_dc_share_pct: 29.7, historical_completion_pct: 18.5, queued_generation_gw: 135.1,
  source_url: 'https://www.pjm.com/planning/service-requests', source_name: 'PJM queue', project_count: 972,
  projects: Array.from({ length: 25 }, (_, i) => ({ queue_id: `AG1-${100 + i}`, project_name: `Project ${i}`, capacity_mw: 100 + i, fuel_type: 'SOLAR', state: 'VA' })) };
const MARKET = { success: true, market: { id: 'northern-virginia', name: 'Northern Virginia', cities: ['Ashburn'] },
  stats: { facility_count: 857, total_power_mw: 13366.0, avg_power_mw: 41.2, provider_count: 90 }, as_of: '2026-10-06T14:22:31Z',
  top_providers: Array.from({ length: 10 }, (_, i) => ({ name: `Provider ${i}`, facilities: 30 - i, power_mw: 900 - i * 40 })),
  by_status: { operational: 600, under_construction: 150, planned: 107 },
  market_pricing: { available: true, basis: 'broker_report', asking_rate: 160.0, unit: '$/kW/mo', vacancy_percent: 4.0, period: 'H1 2026', source: 'CBRE / JLL market reports' },
  siting: { available: true, dcpi: { verdict: 'CAUTION', band: 'x', data_basis: 'measured', as_of: '2026-10-07' } }, _gated: false };
const GAS = { region: 'TX', region_name: 'Texas', dcgi_score: 71.2, dcgi_verdict: 'BUILD', dcgi_score_band: 'strong',
  henry_hub_usd_mmbtu: 2.9, basis_usd_mmbtu: 2.5, delivered_price_usd_mmbtu: 3.1, gas_to_grid_usd_per_mwh: { new_ccgt: 40.1, existing_ccgt: 36.2 },
  headline: { delta_usd_mwh: -8.3, gas_to_grid_new_ccgt_usd_mwh: 40.1, interpretation: 'cheaper' }, gas_access_score: 81,
  burner_tip: { method: 'ttm', usd_mmbtu: 2.8, status: 'ok', state: 'TX' } };
const SITE = { success: true, location: { lat: 33.45, lon: -112.07, state: 'AZ' }, overall_score: 81.8, composite_score: 77.1,
  scores: { power_infrastructure: 96.9, fiber_connectivity: 64.2, gas_pipeline_access: 55.1, market_conditions: 72.3, risk_resilience: 48.6 },
  sub_scores: { power_grid: { score: 80, coverage: 'validated' }, fiber: { score: 60 }, water: { score: 50 }, risk: { score: 55 }, market: { score: 70 } },
  nearby: { facilities_100km: 41, substations_50km: 12 }, source: 'DC Hub Site Intelligence' };
const ENERGY = { filter: { state: 'TX', sector: 'industrial' }, retail_rates: { avg_cents_kwh: 8.1, period: '2026' },
  rates: Array.from({ length: 8 }, (_, i) => ({ state: 'TX', sector: 'industrial', period: '2026-0' + (i + 1), cents_kwh: 8 + i / 10 })), success: true };
const INFRA = { success: true, lat: 39.04, lon: -77.48,
  substations: Array.from({ length: 6 }, (_, i) => ({ name: 'Sub ' + i, kv: 230 + i, distance_km: 1.2 + i, hifld_id: 'H' + i })) };

let H, fence;
const loopbackHeaders = [];
let realFetch;

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({
    env: { DCHUB_PREVIEW_ISERROR: '0' },
    extraRoutes: (p, req, body) => {
      if (p === '/api/v1/keys/validate') {
        return (body && body.api_key === FREE_KEY)
          ? { valid: true, tier: 'free', developer_id: 'dev_item1', email: null, tier_detail: { users_plan: null } } : undefined;
      }
      if (p === '/api/v1/mcp/anon-usage') return { ok: true, count: 0 };
      if (p === '/api/v1/relay/short') return { ok: true, url: SHORT };
      if (p.startsWith('/api/v1/grid/intelligence/')) return structuredClone(GI);
      if (p === '/api/v1/dcpi/iso-comparison') return structuredClone(CMP);
      if (p === '/api/v1/interconnection-queue/by-iso') return structuredClone(QUEUE);
      if (p.startsWith('/api/v1/markets/')) return structuredClone(MARKET);
      if (p.startsWith('/api/v1/gas/')) return structuredClone(GAS);
      if (p.includes('site-score') || p.includes('composite') || p.includes('site-analysis')) return structuredClone(SITE);
      if (p.includes('energy') || p.includes('electricity')) return structuredClone(ENERGY);
      if (p.includes('infrastructure') || p.includes('substation')) return structuredClone(INFRA);
      return undefined;
    },
  });
  H.S._readDeadline.signal = () => AbortSignal.timeout(120_000);
  // execute_plan's steps are fetches to this server's own /mcp: record their headers.
  realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (url === `http://127.0.0.1:${H.PORT}/mcp` && init && init.headers) loopbackHeaders.push({ ...init.headers });
    return realFetch(input, init);
  };
}, 120_000);
afterAll(async () => {
  if (realFetch) globalThis.fetch = realFetch;
  if (H) await H.stop();
  if (fence) fence.restore();
});

let ipN = 0;
async function call(path, name, args, { key = null, extra = {} } = {}) {
  if (H.S._anonUsageCounts) H.S._anonUsageCounts.clear();
  const hdr = { 'user-agent': 'Claude-User', 'x-dc-client-ip': `198.51.100.${(++ipN % 250) + 1}`, ...(key ? { 'x-api-key': key } : {}), ...extra };
  const r = await H.call(path, name, args, hdr);
  const res = (r.msg && r.msg.result) || {};
  const sc = res.structuredContent || {};
  const text = (res.content || []).map((b) => b.text || '').join('\n');
  return { res, sc, text, all: text + '\n' + JSON.stringify(sc) };
}
const humanUrl = (sc) => sc.human_url || (sc.for_your_human && sc.for_your_human.url) || null;
const strip = (u) => String(u).replace(/[?#].*$/, '');

// [tool, args, seat, carries an offer link]
const WALLS = [
  ['get_market_intel', { market: 'northern-virginia' }, 'anon', true],
  ['get_grid_intelligence', { region_id: 'PJM' }, 'anon', true],
  ['get_interconnection_queue', { iso: 'PJM' }, 'anon', true],
  ['get_energy_prices', { state: 'TX' }, 'anon', true],
  ['get_gas_index', { region: 'TX' }, 'anon', true],
  ['get_gas_economics', { market: 'dallas' }, 'anon', true],
  ['get_composite_site_score', { lat: 33.45, lon: -112.07 }, 'anon', true],
  ['get_infrastructure', { lat: 39.04, lon: -77.48 }, 'anon', true],
  ['compare_sites', { locations: '39.04,-77.48;33.45,-112.07' }, 'anon', true],
  ['generate_site_analysis', { lat: 33.45, lon: -112.07 }, 'anon', true],
  ['list_transactions', {}, 'anon', true],
  ['get_market_intel', { market: 'northern-virginia' }, 'free', true],
  ['get_grid_intelligence', { region_id: 'PJM' }, 'free', true],
  ['get_interconnection_queue', { iso: 'PJM' }, 'free', true],
  ['get_gas_economics', { market: 'dallas' }, 'free', false],
  ['get_infrastructure', { lat: 39.04, lon: -77.48 }, 'free', true],
  ['analyze_site', { lat: 33.45, lon: -112.07 }, 'free', true],
  ['compare_sites', { locations: '39.04,-77.48;33.45,-112.07' }, 'free', true],
  ['generate_site_analysis', { lat: 33.45, lon: -112.07 }, 'free', true],
  ['search_facilities', { state: 'VA' }, 'free', true],
  ['get_facility', { facility_id: 'test-facility' }, 'free', true],
  ['list_transactions', {}, 'free', true],
];

describe('/mcp walls: the neutral partial line, no paid-plan sentence, one offer link (= human_url)', () => {
  for (const [tool, args, seat, offer] of WALLS) {
    it(`${seat} ${tool}`, async () => {
      const r = await call('/mcp', tool, args, { key: seat === 'free' ? FREE_KEY : null });
      expect(r.text.length, `${tool}: empty response`).toBeGreaterThan(0);
      const fam = r.all.replace(/\\"/g, '"').match(FAMILY);
      expect(fam && fam[0], `${seat} ${tool}: a paid-plan sentence is still on the wall`).toBeNull();
      expect(r.all.replace(/\\"/g, '"'), `${seat} ${tool}: the neutral line`).toContain(NEUTRAL);
      const links = [...new Set((r.all.match(OFFER_LINK) || []).map(strip))];
      if (offer) {
        const hu = humanUrl(r.sc);
        expect(hu, `${seat} ${tool}: human_url`).toBeTruthy();
        expect(links, `${seat} ${tool}: exactly one offer link, and it is human_url`).toEqual([strip(hu)]);
      } else {
        expect(links, `${seat} ${tool}: no offer link appeared`).toEqual([]);
      }
    });
  }
});

describe('/mcp/chatgpt is frozen: the sentences it served are unchanged', () => {
  // Measured on origin/main 4ac625e with this harness: the only "paid DC Hub plan" sentences
  // /mcp/chatgpt returns for the WALLS above. Each must still be there, verbatim.
  const FROZEN = [
    ['get_energy_prices', { state: 'TX' }, null, 'Nothing is nulled in place. The fields above are in a paid DC Hub plan.'],
    ['get_gas_economics', { market: 'dallas' }, null, 'Numeric gas prices and the full $/MWh table need a paid DC Hub plan, the same rule the REST API applies.'],
    ['get_gas_economics', { market: 'dallas' }, FREE_KEY, 'Numeric gas prices and the full $/MWh table need a paid DC Hub plan, the same rule the REST API applies.'],
    ['get_market_intel', { market: 'northern-virginia' }, FREE_KEY, 'It does not open full get_market_intel answers: that is a preview on every free seat, and full needs a paid DC Hub plan.'],
  ];
  for (const [tool, args, key, sentence] of FROZEN) {
    it(`${key ? 'free' : 'anon'} ${tool}`, async () => {
      const r = await call('/mcp/chatgpt', tool, args, { key });
      expect(r.all.replace(/\\"/g, '"')).toContain(sentence);
    });
  }
  it('no /mcp/chatgpt wall gained the neutral line inline: every occurrence is the profile\'s own closing notice', async () => {
    for (const [tool, args, seat] of WALLS) {
      const r = await call('/mcp/chatgpt', tool, args, { key: seat === 'free' ? FREE_KEY : null });
      const s = r.all.replace(/\\"/g, '"');
      // the neutral line followed by more wall text is the /mcp copy; the profile's own notice ends a text block
      expect(s, `${seat} ${tool}`).not.toMatch(new RegExp(NEUTRAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\.? (?:The page|Relay|The count|Upgrade|Every score|Or the owner|The preview|A free key)| →)'));
    }
  });
  it('an execute_plan started on /mcp/chatgpt marks every step with the legacy-wall token; one on /mcp does not', async () => {
    loopbackHeaders.length = 0;
    await call('/mcp/chatgpt', 'execute_plan', { intent: 'Is northern virginia good for a 200 MW campus? grid and market intel' });
    const fromChatgpt = loopbackHeaders.splice(0);
    expect(fromChatgpt.length, 'the plan ran no step: the check below would be vacuous').toBeGreaterThan(0);
    for (const h of fromChatgpt) expect(typeof h['x-dchub-legacy-wall-loopback']).toBe('string');
    await call('/mcp', 'execute_plan', { intent: 'Is northern virginia good for a 200 MW campus? grid and market intel' });
    const fromMcp = loopbackHeaders.splice(0);
    expect(fromMcp.length).toBeGreaterThan(0);
    for (const h of fromMcp) expect(h['x-dchub-legacy-wall-loopback']).toBeUndefined();
  });
  it('the legacy-wall token is honoured once, from this process only', async () => {
    const legacy = 'Numeric gas prices and the full $/MWh table need a paid DC Hub plan';
    const tok = H.S._mintLegacyWallLoopbackToken();
    const a = await call('/mcp', 'get_gas_economics', { market: 'dallas' }, { extra: { 'x-dchub-legacy-wall-loopback': tok } });
    expect(a.all).toContain(legacy);
    const b = await call('/mcp', 'get_gas_economics', { market: 'dallas' }, { extra: { 'x-dchub-legacy-wall-loopback': tok } });
    expect(b.all, 'a spent token').not.toContain(legacy);
    const c = await call('/mcp', 'get_gas_economics', { market: 'dallas' }, { extra: { 'x-dchub-legacy-wall-loopback': 'forged' } });
    expect(c.all, 'a forged token').not.toContain(legacy);
    expect(c.all.replace(/\\"/g, '"')).toContain(CHATGPT_NOTICE);
  });
});

describe('_legacyWallCopy / _wallCopy', () => {
  it('legacy on the directory profiles and a marked plan step, neutral everywhere else', () => {
    const S = H.S;
    expect(S._legacyWallCopy({ profile: DIRECTORY_PROFILE })).toBe(true);
    expect(S._legacyWallCopy({ profile: CLAUDE_PROFILE })).toBe(true);
    expect(S._legacyWallCopy({ legacy_wall_copy: true })).toBe(true);
    expect(S._legacyWallCopy({ profile: null })).toBe(false);
    expect(S._legacyWallCopy(null)).toBe(false);   // outside a request: no ctx, the /mcp copy
    expect(S._wallCopy('n', 'l', { profile: DIRECTORY_PROFILE })).toBe('l');
    expect(S._wallCopy('n', 'l', {})).toBe('n');
    expect(S.WALL_NEUTRAL_LINE).toBe(CHATGPT_NOTICE);
  });
});

// The wall builders the HTTP walls above do not reach with this stub, called directly: outside a request
// (the /mcp copy, no profile) and inside a /mcp/chatgpt request context (the frozen copy).
describe('each wall builder: the neutral line on /mcp, the old sentence on /mcp/chatgpt', () => {
  const S = () => H.S;
  // `_mu` holds a gate id no rung opens, so _missedUpgradeFor returns null and each builder shows its
  // own sentence (with a real gate record, two of them hand the message to the missed-upgrade prompt).
  const seat = (profile) => ({ profile, tier: 'free', api_key: null, _mu: { gates: new Set(['item1-no-rung']), masked: [] } });
  const asChatgpt = (fn) => S()._ctxALS.run(seat(DIRECTORY_PROFILE), fn);
  const asMcp = (fn) => S()._ctxALS.run(seat(null), fn);
  const flat = (v) => (typeof v === 'string' ? v : JSON.stringify(v)).replace(/\\"/g, '"');
  const both = (label, build, legacy) => {
    it(label, () => {
      const n = flat(asMcp(build));
      expect(n, `${label} (/mcp)`).toContain(NEUTRAL);
      const fam = n.match(FAMILY);
      expect(fam && fam[0], `${label} (/mcp): a paid-plan sentence`).toBeNull();
      const l = flat(asChatgpt(build));
      expect(l, `${label} (/mcp/chatgpt)`).toContain(legacy);
    });
  };
  const RET = { data: [{ generator: { name: 'G1', capacity_mw: 500, retirement_date: '2027-01-01', generator_id: '1' },
    queue_pressure: { competing_mw: 300 } }], total_retiring_mw: 500 };
  both('get_retirement_headroom mask', () => S()._maskRetirementHeadroom(structuredClone(RET), '')._upgrade.message,
    'names and exact distance need a paid DC Hub plan');
  both('analyze_site monthly free runs spent', () => S()._withLpFreeRunsSpent(
    { content: [{ type: 'text', text: '{}' }], structuredContent: {} },
    { limit: 3, used: 3, resets_at: '2026-11-01T00:00:00Z' }, 'analyze_site').structuredContent.free_monthly_runs.message_for_user,
    'Full analyses need a paid DC Hub plan; the count resets');
  both('Land & Power keyless wall (compare_sites)', () => S()._lpWallResult('compare_sites', null),
    'is Land & Power, which needs a paid DC Hub plan.');
  both('Land & Power keyless wall message (compare_sites)', () => S()._lpWallResult('compare_sites', null).structuredContent.message,
    'Land & Power details need a paid DC Hub plan.');
  both('analyze_site keyless B2 wall', () => S()._lpWallResult('analyze_site', { verdict: 'BUILD', weakest_factor: 'fiber connectivity' }).structuredContent,
    'Scores and figures need a paid DC Hub plan.');
  both('analyze_site keyless B2 limiting factor', () => S()._lpWallResult('analyze_site', { verdict: 'BUILD', weakest_factor: 'fiber connectivity' }).structuredContent.limiting_factor,
    'scores with a paid DC Hub plan');
  both('Land & Power wall headline on a non-B2 tool (limiting factor)', () => S()._lpWallResult('generate_site_analysis', { verdict: 'BUILD', weakest_factor: 'fiber connectivity' }).structuredContent.limiting_factor,
    'its score and the full breakdown come with a paid DC Hub plan');
  both('analyze_site B2 weakest-factor line', () => S()._b2WeakestFactorLine({ verdict: 'BUILD', weakest_factor: 'fiber connectivity' }),
    'weakest factor fiber connectivity. Scores and figures need a paid DC Hub plan.');
  both('B2 substation free view', () => S()._substationFreeViewB2({ substations: [{ distance_km: 3.2, kv_band: '115-229 kV' }], search_radius_km: 50 }).note,
    'need a paid DC Hub plan (7-day trial)');
  both('Land & Power preview note', () => S()._lpPreviewResult('analyze_site', { content: [{ type: 'text', text: JSON.stringify(SITE) }] }, false).structuredContent._preview_note,
    'Land & Power details need a paid DC Hub plan: every score');
  both('Land & Power preview headline (limiting factor)', () => S()._lpPreviewResult('analyze_site', { content: [{ type: 'text', text: JSON.stringify(SITE) }] }, true).structuredContent.limiting_factor,
    'its score and the full breakdown come with a paid DC Hub plan');
  both('site headline tease: limiting factor note', () => S().buildSiteHeadlineTease(structuredClone(SITE)).limiting_factor,
    'The full per-factor breakdown needs a paid DC Hub plan.');
  both('site headline tease: headline sentence', () => S().buildSiteHeadlineTease(structuredClone(SITE)),
    'the full per-factor breakdown need a paid DC Hub plan.');
  both('keyless decision-layer nudge', () => S().applyTrialGuardIfFree('rank_markets', { markets: [{ name: 'A', verdict: 'BUILD' }] }, false),
    'needs a paid DC Hub plan. That’s the part worth paying for.');
  // Growth freeze (owner 2026-10-19): get_market_intel joined the email allowance on /mcp, so the
  // preview-only quota hint (neutral line) is the one it serves with the allowance switch off. With the
  // switch on (prod), /mcp states the email allowance and no paid-plan sentence, while /mcp/chatgpt
  // stays FROZEN on the old sentence either way.
  const withSwitch = (v, fn) => () => {
    const k = 'DCHUB_EMAIL_FULL_DECISION_TOOLS', was = process.env[k];
    process.env[k] = v;
    try { return fn(); } finally { if (was === undefined) delete process.env[k]; else process.env[k] = was; }
  };
  both('quota hint on a preview-only tool (email allowance switch off)', withSwitch('0', () => S()._buildQuotaHint('get_market_intel')),
    'charged for it. Full needs a paid DC Hub plan.');
  it('quota hint on get_market_intel with the email allowance on: /mcp names the allowance, /mcp/chatgpt is frozen', withSwitch('1', () => {
    const n = flat(asMcp(() => S()._buildQuotaHint('get_market_intel')));
    expect(n).toContain('A key with a bound email gets 10 full answers a day.');
    expect((n.match(FAMILY) || [null])[0], '/mcp: a paid-plan sentence').toBeNull();
    const l = flat(asChatgpt(() => S()._buildQuotaHint('get_market_intel')));
    expect(l, '/mcp/chatgpt').toContain('charged for it. Full needs a paid DC Hub plan.');
    expect(l, '/mcp/chatgpt').not.toContain('bound email gets');
  }));
  it('get_market_intel email allowance: open on /mcp, closed on /mcp/chatgpt and its plan steps (review freeze)', withSwitch('1', () => {
    expect(asMcp(() => S()._emailFullDecisionTool('get_market_intel'))).toBe(true);
    expect(asChatgpt(() => S()._emailFullDecisionTool('get_market_intel'))).toBe(false);
    expect(S()._ctxALS.run({ legacy_wall_copy: true }, () => S()._emailFullDecisionTool('get_market_intel'))).toBe(false);
    expect(asChatgpt(() => S()._emailFullDecisionTool('get_grid_intelligence')), 'grid keeps its allowance there').toBe(true);
    expect(asMcp(() => S().applyTierGate('get_market_intel', {}, 'free', true, false, undefined, true).email_full)).toBe(true);
    expect(asChatgpt(() => S().applyTierGate('get_market_intel', {}, 'free', true, false, undefined, true).email_full)).toBeUndefined();
  }));
  both('auto-trial block on a paid-plan tool', () => S().buildAutoMintBlock({ api_key: 'dch_trial_item1test0123456789', trial_days: 7, daily_calls: 10 }, 'compare_sites', false, null),
    'compare_sites needs a paid DC Hub plan, or the owner pays per call');
});
