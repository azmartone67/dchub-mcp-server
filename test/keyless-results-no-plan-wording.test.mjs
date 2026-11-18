// keyless-results-no-plan-wording.test.mjs — Grok Note V item 1 / Note F M1 (2026-11-16): a tool result, keyless and
// (since the keyed follow-up) keyed, names no plan, trial, upgrade or price and links no pricing page. lib/keyless-plan-wording.mjs, server.mjs
// _sourceLineCb (_keylessPlanWordingStep, the last rewrite).
//
// MEASURED live 2026-11-16 (POST https://dchub.cloud/mcp tools/call, no key):
//   compare_sites      "DC Hub's paid plan has the full side-by-side comparison ... Start a 7-day trial: <link>",
//                      "[Start a 7-day DC Hub trial]", "hit DC Hub's paid data boundary", error "pro_required"
//   dchub_services     full_depth "on a paid DC Hub plan" + https://dchub.cloud/pricing?..., deal_desk_brief .../ai#pricing
//   deal_autopsy       "The autopsy read is the paid layer ... opens with a paid DC Hub plan for agents."
//   analyze_site       "Broker lease rates (CBRE/JLL): available on paid plans", rates_upgrade_url .../pricing,
//                      "(figure on paid plans)"
//   get_intelligence_index  "the plans that return them are on the page behind the link"
//
// WHAT THIS PINS
//   * the real handlers through the dispatch, keyless, for those five tools, two seats (a coding agent and Grok
//     with a browser UA), each tool's first call, the next call from the same caller and the preview
//     (DCHUB_KEYLESS_FIRST_FULL=0): no banned wording in any string of the result, no pricing link, no
//     `rates_upgrade_url`, no `pro_required`;
//   * the backend is stubbed with the data API's CURRENT strings (deal_autopsy's locked line, the broker-rate
//     masks), so the guard proves this server drops them rather than assuming the data API never sends them;
//   * non-vacuity: the stubbed strings were served, the walls are walls (the person line and the relay link are
//     present), and with DCHUB_KEYLESS_NO_PLAN_WORDING=0 the same calls DO carry the banned wording;
//   * dchub_services and the execute_plan front-desk footers are neutral at the source for every caller (keyed
//     follow-up, 2026-11-16), so a KEYED caller is scanned too: dchub_services through the real handler (every
//     service, and `need` ranking each one first), and execute_plan through the real handler (the site and repeat
//     footers, the two that named a plan) plus every footer class through the real planner and step under a keyed
//     context (non-vacuous: the line is present before it is scanned, and the keyless step is OFF for those calls,
//     so only the source can be clean);
//   * Note V keyed follow-up, part 2 (owner 2026-11-16): the wall copy itself is neutral at the source, so
//       - a free, an email-bound and a paid key run every walled tool (compare_sites, analyze_site, deal_autopsy,
//         get_intelligence_index, dchub_services, plan_query, rank_markets, get_market_intel, get_grid_intelligence,
//         get_interconnection_queue, get_retirement_headroom, get_gas_economics) and four whole execute_plan answers,
//         twice each, keyless step OFF: no plan, trial, upgrade or price wording (the data API's own strings are
//         blanked: their source is the data API, the keyless step still rewrites them for keyless callers);
//       - keyless callers' whole execute_plan and plan_query answers are scanned the same way;
//       - the rung ladder (_rungsText) names no plan for any seat; provenance says `unlock offer present`, never
//         `upgrade CTA present`; UPGRADE_URL is /connect and no result links /ai#pricing;
//       - the keyed compare_sites wall, and the keyless one with the kill switch off, are clean at the source;
//     the whole-answer scans read past execute_plan's own "plan", the data topics named pricing and the machine
//     strings `access` / `error` (EXECUTE_PLAN_MASK, MACHINE_KEYS), and nothing else;
//   * the scan itself catches every measured sentence, with and without those masks (must-fail controls).
//
// Qualifies for the hard gate: real handlers, backend stubbed at the fetch boundary, every other host fenced.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';
import * as K from '../lib/keyless-plan-wording.mjs';
import * as FD from '../lib/dchub-services.mjs';

// ── the scan ─────────────────────────────────────────────────────────────────────────────────────────
// Data rows a fixture plants on purpose (a tax incentive's "$150M+" is the state's figure, not a DC Hub price):
// a price is judged outside these keys only.
const DATA_KEYS = new Set(['deals', 'incentives', 'site_context']);
const URL_RE = /https?:\/\/[^\s"'<>)\]`]+/g;
const PRICING_LINK = /https?:\/\/(?:www\.)?dchub\.cloud\/(?:pricing|plans|checkout)\b[^\s"'<>)\]`]*|dchub\.cloud\/[^\s"'<>)\]`]*#pricing\b|(?:buy|checkout)\.stripe\.com/;
// execute_plan's own "plan" (the step plan it ran) and the data topics named "pricing" are not plan or price wording;
// the whole-answer scans below mask exactly these phrases and nothing else.
export const EXECUTE_PLAN_MASK = /\b(?:ran|runs|run) the (?:ordered )?plan\b|\b(?:this|the) plan(?:'s)? (?:stated|step)|\bin this plan\b|\bshows the plan\b|\b(?:just )?the plan\b(?= (?:and|it|before|returns|only|—))|\ba plan the agent executes\b|\b(?:capacity|energy|power|lease|gas) pricing\b|\bvacancy\/pricing\b/gi;
// Machine fields a scan reads past (owner 2026-11-16: `_upgrade`, `trial_preview`, `next_tool`, `human_url` and error
// codes stay): plan_query's step `access` enum ('free' | 'paid') and a step's `error` code.
export const MACHINE_KEYS = new Set(['access', 'error']);
export function offenders(result, { mask = null, skipKeys = null } = {}) {
  const hits = [];
  const add = (where, s, m) => hits.push(`${where}: "…${s.slice(Math.max(0, m.index - 70), m.index + m[0].length + 50).replace(/\s+/g, ' ')}…"`);
  // A URL is judged as a link (a pricing / plans page, a #pricing anchor, a checkout); its path words are not
  // copy (the relay's long form is /upgrade/h/<token>, a route name the person never reads as a sentence).
  const scan = (where, s, data) => {
    const u = PRICING_LINK.exec(s);
    if (u) { add(where, s, u); return; }
    let w = s.replace(URL_RE, (x) => ' '.repeat(x.length));
    if (mask) w = w.replace(mask, (x) => ' '.repeat(x.length));
    const m = K.BANNED_WORDING.exec(w) || K.PLAN_NAME.exec(w) || (!data && K.PRICE.exec(w));
    if (m) add(where, s, m);
  };
  const walk = (o, at, data = false, d = 0) => {
    if (d > 60 || o == null) return;
    if (typeof o === 'string') {
      const t = o.trim();
      if (t[0] === '{' || t[0] === '[') { try { walk(JSON.parse(t), at + '<json>', data, d + 1); return; } catch (_) { /* text */ } }
      scan(at, o, data);
      return;
    }
    if (typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${at}[${i}]`, data, d + 1)); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'rates_upgrade_url') hits.push(`${at}.${k}: key present`);
      if (skipKeys && skipKeys.has(k) && typeof v === 'string') continue;
      walk(v, `${at}.${k}`, data || DATA_KEYS.has(k), d + 1);
    }
  };
  walk(result && result.structuredContent, 'sc');
  ((result && result.content) || []).forEach((b, i) => {
    if (!b || typeof b.text !== 'string') return;
    const t = b.text;
    const a = t.indexOf('{'), z = t.lastIndexOf('}');
    let parsed = false;
    if (a === 0 && z > a) { try { walk(JSON.parse(t.slice(a, z + 1)), `content[${i}]<json>`); parsed = true; } catch (_) { /* prose */ } }
    if (!parsed) scan(`content[${i}]`, t, false);
    else scan(`content[${i}]<tail>`, t.slice(z + 1), false);
  });
  return hits;
}

// ── fixtures: the data API's answers, with its current strings ─────────────────────────────────────
const BASE = 'https://backend.keyless-no-plan-wording.test';
const SECRET = 'keyless-no-plan-wording-internal-key-not-real';
const OLD_AUTOPSY = "🎯 The autopsy read is the paid layer. The deal flow + each market's DCPI verdict above are free — but "
  + "the 'what's the REAL play' call (long-dated option vs near-term build vs queue gamble) on each deal opens with "
  + 'a paid DC Hub plan for agents.';
const OLD_RATES = 'Broker lease rates (CBRE/JLL): available on paid plans';
const OLD_MARK = '(figure on paid plans)';
const DEALS = {
  ok: true, product: 'Deal Autopsy', count: 3, grid_checked: 0, tier: 'anonymous',
  citation: 'DC Hub Deal Autopsy — dchub.cloud/deal-autopsy (CC BY 4.0)',
  deals: Array.from({ length: 3 }, (_, i) => ({ buyer: `Buyer ${i}`, seller: null, date: '2026-11-16', type: 'M&A',
    market_raw: 'Global', dcpi: null, value_usd: 1e9 * (i + 1), source_url: `https://example.org/deal-${i}` })),
  autopsy: { locked: true, message: OLD_AUTOPSY, unlock: { url: 'https://dchub.cloud/upgrade?tool=deal_autopsy' } },
};
const SITE = {
  success: true, overall_score: 80.2, interpretation: 'Challenging site',
  interpretation_basis: 'Capped by the AVOID Data Center Power Index (DCPI) market verdict for ASHBURN: the site factors '
    + "score higher, but the market's outlook for new power limits it.",
  scores: { power_infrastructure: 88, fiber_connectivity: 92, gas_pipeline_access: 70, market_conditions: 60, risk_resilience: 75 },
  market_verdict: { available: true, verdict: 'AVOID', market: 'ASHBURN', slug: 'ashburn', iso: 'PJM', as_of: '2026-11-16' },
  nearby: { substations_50km: 41 }, location: { lat: 39.04, lon: -77.49, state: 'VA' },
};
const PRICING = { as_of: 'H1 2026', available: true, basis: 'broker_report', asking_rate: null, asking_rate_range: null,
  deal_size: null, period: 'H1 2026', rates_note: OLD_RATES, rates_upgrade_url: 'https://dchub.cloud/pricing',
  rates_withheld: true, source: 'CBRE North America Data Center Trends H1 2026 (250+ kW): Northern Virginia ' + OLD_MARK };
let short = 0;
const SHORTS = ['qux9j3', 'paa8t3', 'fexsng', 'rmbz3s'];
const SITE_CONTEXT = { ok: true, errors: {}, market: { name: 'Northern Virginia', pricing: PRICING },
  incentives: [{ program: 'Sales tax exemption', min_investment: '$150M+' }] };
const INDEX = { dc_hub_intelligence_index: {
  active_integrations: 7, global_pulse_score: 62.4, degraded: false, generated_at: '2026-11-16T18:41:45Z',
  data_summary: { facilities: 25674, pipeline_gw: 120.5, recent_deals_90d: 218, substations: 134643 },
  market_heat_map: { Ashburn: 20.6, Dallas: 19.8, Phoenix: 19.3 },
  top_markets: Array.from({ length: 5 }, (_, i) => ({ market: `M${i}`, score: 20 - i })),
} };

const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, httpServer, PORT;
const ENV_KEYS = ['DCHUB_INTERNAL_KEY', 'DCHUB_API_BASE', 'PORT', 'DCHUB_KEYLESS_FIRST_FULL', K.KEYLESS_NO_PLAN_WORDING_FLAG];
const prevEnv = {};
const served = { autopsy: 0, rates: 0 };
const R = {};      // `${tool}@${seat}` -> { first, next, preview }
const OFF = {};    // tool -> result with the kill switch off (same calls)
let KEYED = null;
const KEYED_SVC = {};   // label -> dchub_services result for a keyed caller
const KEYED_PLAN = {};  // label -> execute_plan result for a keyed caller
const KEY = 'dchub_test_key_not_real';
const KEY_EMAIL = 'dch_live_KNPWemail0123456789abcdef';
const KEY_PAID = 'dch_live_KNPWpaid00123456789abcdef';

const TOOLS5 = {
  compare_sites: { locations: '39.04,-77.49;32.78,-96.80' },
  dchub_services: {},
  deal_autopsy: {},
  analyze_site: { lat: 39.04, lon: -77.49 },
  get_intelligence_index: {},
};
const SEATS = {
  cursor: { platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0' },
  grok: { platform: 'grok', client_name_raw: 'grok', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' },
};

let n = 0;
function seat(over) {
  n += 1;
  while (assignArm({ sessionId: `sess-knpw-${n}`, eligible: true }) !== ARM_CONTROL) n += 1;
  return { tier: 'free', client_ip: `198.51.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`, session_id: `sess-knpw-${n}`, ...over };
}
async function call(name, s, args) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}

beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  delete process.env.DCHUB_KEYLESS_FIRST_FULL;
  delete process.env[K.KEYLESS_NO_PLAN_WORDING_FLAG];
  realFetch = globalThis.fetch;
  PORT = await new Promise((resolve) => {
    const t = createServer(); t.listen(0, '127.0.0.1', () => { const q = t.address().port; t.close(() => resolve(q)); });
  });
  process.env.PORT = String(PORT);
  globalThis.fetch = async (input, init) => {
    const url = String(input && input.url ? input.url : input);
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return realFetch(input, init);
    if (!url.startsWith(BASE)) throw new Error('network fence: ' + url);
    const p = new URL(url).pathname;
    if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return json({ ok: false });
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/sources/')) return json({ ok: true });
    if (p === '/api/v1/keys/validate') {
      let k = null; try { k = JSON.parse(String(init && init.body || '{}')).api_key; } catch (_) { /* no body */ }
      // the keyed follow-up's callers: a valid email-tier key and a valid paid key (the real validate carries the plan)
      if (k === KEY_EMAIL) return json({ valid: true, tier: 'identified', developer_id: 'dev_knpw_email', email: 'knpw@example.org', tier_detail: { users_plan: null } });
      if (k === KEY_PAID) return json({ valid: true, tier: 'pro', developer_id: 'dev_knpw_paid', email: null, tier_detail: { users_plan: 'pro' } });
    }
    if (p.startsWith('/api/v1/keys/')) return json({ valid: false, tier: 'free' });
    if (p === '/api/v1/deal-autopsy') { served.autopsy += 1; return json(structuredClone(DEALS)); }
    if (p === '/api/site-score') return json(structuredClone(SITE));
    if (p === '/api/v1/land-power/site-context') {
      if (new URL(url).searchParams.get('view') === 'preview') {
        return json({ ok: true, view: 'preview', blocks: [{ key: 'market', title: 'Market', status: 'answered' }] });
      }
      served.rates += 1;
      return json(structuredClone(SITE_CONTEXT));
    }
    // the relay short link, as the data API mints it (dchub-backend relay_short_link)
    if (p === '/api/v1/relay/short') { short += 1; return json({ ok: true, url: 'https://dchub.cloud/u/' + SHORTS[short % SHORTS.length] }); }
    if (p === '/api/agents/intelligence-index') return json(structuredClone(INDEX));
    return json({ success: true });
  };
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
  httpServer = await new Promise((r) => { const h = S.app.listen(PORT, '127.0.0.1', () => r(h)); });

  for (const [sn, over] of Object.entries(SEATS)) {
    for (const [tool, args] of Object.entries(TOOLS5)) {
      const s = seat(over);
      const first = await call(tool, s, args);
      const next = await call(tool, s, args);
      process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
      const preview = await call(tool, seat(over), args);
      delete process.env.DCHUB_KEYLESS_FIRST_FULL;
      R[`${tool}@${sn}`] = { first, next, preview };
    }
  }
  // the kill switch: the same calls, as they were
  process.env[K.KEYLESS_NO_PLAN_WORDING_FLAG] = '0';
  for (const [tool, args] of Object.entries(TOOLS5)) {
    const s = seat(SEATS.cursor);
    await call(tool, s, args);
    OFF[tool] = await call(tool, s, args);
  }
  delete process.env[K.KEYLESS_NO_PLAN_WORDING_FLAG];
  // a keyed caller (any key): the step leaves its copy alone
  KEYED = await call('compare_sites', seat({ ...SEATS.cursor, api_key: 'dchub_test_key_not_real', tier: 'free' }), TOOLS5.compare_sites);

  // Keyed callers on dchub_services and execute_plan (keyed follow-up). The keyless step is switched OFF for these
  // calls as well, so a clean result can only come from the source copy, never from a rewrite.
  process.env[K.KEYLESS_NO_PLAN_WORDING_FLAG] = '0';
  KEYED_SVC.default = await call('dchub_services', seat({ ...SEATS.cursor, path: '/mcp', api_key: KEY }), {});
  for (const [label, need] of Object.entries(SERVICE_NEEDS)) {
    KEYED_SVC[label] = await call('dchub_services', seat({ ...SEATS.cursor, path: '/mcp', api_key: KEY }), { need });
  }
  S._fdCallMemoForTest.clear();
  // site: a paid key (its answer is not walled, so the line goes out); the intent is site-class ("my site") with
  // small steps, so no step is slimmed (a slimmed plan gets no line by design)
  const sc1 = seat({ ...SEATS.cursor, path: '/mcp', api_key: KEY_PAID, tier: 'pro' });
  KEYED_PLAN.site = await call('execute_plan', sc1, { intent: SITE_PLAN_INTENT });
  KEYED_PLAN.site_ctx = { plan: sc1._frontDeskPlan, shown: sc1._frontDeskShown };
  // repeat: an email-tier key's second call plans the unpaid repeat line (its stubbed steps are previews, so the
  // answer is walled and the step holds the line back; the planned line is what the real handler would send)
  const re1 = seat({ ...SEATS.cursor, path: '/mcp', api_key: KEY_EMAIL, tier: 'identified' });
  KEYED_PLAN.repeat_first = await call('execute_plan', re1, { intent: REPEAT_INTENT });
  KEYED_PLAN.repeat_first_ctx = { plan: re1._frontDeskPlan };
  const re2 = seat({ ...SEATS.cursor, path: '/mcp', api_key: KEY_EMAIL, tier: 'identified' });
  KEYED_PLAN.repeat = await call('execute_plan', re2, { intent: REPEAT_INTENT });
  KEYED_PLAN.repeat_ctx = { plan: re2._frontDeskPlan };

  // Note V keyed follow-up, part 2 (owner 2026-11-16): every keyed seat, on the walled tools and on whole
  // execute_plan / plan_query answers, still with the keyless step OFF, so only the source copy can be clean.
  for (const [sn, over] of Object.entries(KEYED_SEATS)) {
    for (const [tool, args] of Object.entries(KEYED_TOOLS)) {
      const s = seat({ ...SEATS.cursor, path: '/mcp', ...over });
      KEYED_ALL[`${tool}@${sn}`] = [await call(tool, s, args), await call(tool, s, args)];
    }
    for (const [label, intent] of Object.entries(PLAN_INTENTS)) {
      const s = seat({ ...SEATS.cursor, path: '/mcp', ...over });
      KEYED_ALL[`execute_plan:${label}@${sn}`] = [await call('execute_plan', s, { intent }), await call('execute_plan', s, { intent })];
    }
  }
  delete process.env[K.KEYLESS_NO_PLAN_WORDING_FLAG];
  // ...and the keyless caller's whole execute_plan / plan_query answers (the keyless step ON, as served)
  for (const [sn, over] of Object.entries(SEATS)) {
    for (const [label, intent] of Object.entries(PLAN_INTENTS)) {
      const s = seat({ ...over, path: '/mcp' });
      KEYLESS_PLAN[`execute_plan:${label}@${sn}`] = [await call('execute_plan', s, { intent }), await call('execute_plan', s, { intent })];
      KEYLESS_PLAN[`plan_query:${label}@${sn}`] = [await call('plan_query', seat({ ...over, path: '/mcp' }), { intent })];
    }
  }
}, 360_000);

const KEYED_SEATS = {
  free: { api_key: KEY, tier: 'free' },
  email: { api_key: KEY_EMAIL, tier: 'identified' },
  paid: { api_key: KEY_PAID, tier: 'pro' },
};
const KEYED_TOOLS = {
  ...TOOLS5,
  plan_query: { intent: 'evaluate 100 MW power headroom for a GPU training cluster in PJM' },
  rank_markets: {},
  get_market_intel: { market: 'northern-virginia' },
  get_grid_intelligence: { iso: 'PJM' },
  get_interconnection_queue: { iso: 'ERCOT' },
  get_retirement_headroom: { target_mw: 50, horizon_months: 18 },
  get_gas_economics: { market: 'dallas' },
};
const PLAN_INTENTS = {
  site: 'analyze the site at 32.77,-96.79 for a data center',
  gas: 'gas economics for on-site generation in Texas',
  power: 'evaluate 100 MW power headroom for a GPU training cluster in PJM',
  rank: 'rank markets for a 200 MW AI campus',
};
const KEYED_ALL = {};     // `${tool}@${seat}` -> [first, next], keyed, keyless step off
const KEYLESS_PLAN = {};  // `${tool}:${intent}@${seat}` -> results, keyless

const SERVICE_NEEDS = { full_depth: 'full depth answers, no previews, every field', deal_desk_brief: 'a PDF brief to share with my board' };
const SITE_INTENT = 'analyze the site at 32.77,-96.79 for a data center';
const SITE_PLAN_INTENT = 'gas economics for on-site generation at my site in Texas';
const REPEAT_INTENT = 'gas economics for on-site generation in Texas';

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const all = (r) => JSON.stringify(r);
const sc = (r) => (r && r.structuredContent) || {};

describe('the renders are what they claim to be (non-vacuous)', () => {
  it('the data API strings were served', () => {
    expect(served.autopsy).toBeGreaterThan(0);
    expect(served.rates).toBeGreaterThan(0);
  });
  it('compare_sites keyless is a wall with a person line and the relay link', () => {
    for (const sn of Object.keys(SEATS)) {
      const r = R[`compare_sites@${sn}`].first;
      expect(sc(r)._wall, sn).toBe(true);
      expect(String(sc(r).user_message || ''), sn).toMatch(/https:\/\/dchub\.cloud\//);
      expect(sc(r).error, sn).not.toBe('pro_required');
    }
    const c = sc(R['compare_sites@cursor'].first);
    expect(c.error).toBe(K.WITHHELD_ERROR);
    expect(c.user_message).toMatch(/^This preview leaves out the full side-by-side comparison: .+\. Open https:\/\/dchub\.cloud\/u\/\w{6} to see what your agent found\. More detail is available at dchub\.cloud\/connect\.$/);
    expect(c.copy_version).toBe(K.KEYLESS_COPY_VERSION);
  });
  it('deal_autopsy carries the locked line and analyze_site the broker-rate block, reworded', () => {
    const d = all(R['deal_autopsy@cursor'].first);
    expect(d).toContain(K.AUTOPSY_LOCKED.slice(0, 40));
    const a = all(R['analyze_site@cursor'].first);
    expect(a).toContain(K.BROKER_RATES_WITHHELD);
    expect(a).toContain(K.RATE_FIGURE_WITHHELD);
  });
  it('dchub_services keeps every service and one link each', () => {
    const s = sc(R['dchub_services@cursor'].first).services || [];
    expect(s.length).toBeGreaterThanOrEqual(8);
    // an #anchor may follow the query (lib/dchub-services.mjs referralLink; sample_dataset -> /partners#licence)
    for (const x of s) expect(x.link, x.id).toMatch(/^https:\/\/dchub\.cloud\/[^#\s]*\?via=agent-referral&src=services(#[a-z-]+)?$/);
  });
  it('with the kill switch off, the data API\'s strings come back (the step is what removes them)', () => {
    const offHits = Object.entries(OFF).map(([t, r]) => [t, offenders(r).length]);
    for (const t of ['deal_autopsy', 'analyze_site']) {
      expect(offHits.find((x) => x[0] === t)[1], t).toBeGreaterThan(0);
    }
  });
  it('with the kill switch off, compare_sites is still clean: its wall copy is neutral at the source (keyed follow-up)', () => {
    expect(sc(OFF.compare_sites)._wall).toBe(true);
    expect(offenders(OFF.compare_sites, SCAN_OPTS)).toEqual([]);   // its `error` code stays (a machine field)
  });
  it('a keyed compare_sites wall (the keyless step skips it) is a wall, and clean at the source', () => {
    expect(sc(KEYED)._wall).toBe(true);
    expect(String(sc(KEYED).user_message || '')).toMatch(/This preview leaves out .+\. Open https:\/\/dchub\.cloud\/\S+ to see what your agent found\./);
    expect(offenders(KEYED)).toEqual([]);
  });
});

describe('keyless results: no plan, trial, upgrade or price wording, no pricing link', () => {
  for (const sn of Object.keys(SEATS)) {
    for (const tool of Object.keys(TOOLS5)) {
      it(`${tool} @ ${sn}: first, next and preview`, () => {
        const r = R[`${tool}@${sn}`];
        const hits = [];
        for (const [label, res] of [['first', r.first], ['next', r.next], ['preview', r.preview]]) {
          for (const h of offenders(res)) hits.push(`${label} ${h}`);
        }
        expect(hits).toEqual([]);
      });
    }
  }
});

describe('keyed callers: dchub_services and the execute_plan front-desk footers carry no plan wording either', () => {
  const lineOf = (r) => ((r && r.content) || []).map((b) => b && b.text).filter((t) => FD.isFrontDeskLine(t));
  it('dchub_services, keyed: every service, and each formerly-paid service ranked first, is clean', () => {
    const d = sc(KEYED_SVC.default);
    expect(d._entity).toBe('dchub_services');
    expect((d.services || []).map((x) => x.id)).toEqual(FD.DCHUB_SERVICES.map((x) => x.id));
    for (const [label, r] of Object.entries(KEYED_SVC)) {
      if (label !== 'default') expect(sc(r).services[0].id, label).toBe(label);   // the need ranked it first
      expect(offenders(r), label).toEqual([]);
      for (const x of sc(r).services) expect(x.link, `${label} ${x.id}`).toMatch(/\?via=agent-referral&src=services/);
    }
  });
  // The scope here is the front-desk line: the rest of a keyed execute_plan answer keeps its own copy (and the scan
  // reads "DC Hub ran the plan" as plan wording), so the whole answer is checked only for a front-desk-tagged
  // pricing link, the shape the footers used to carry.
  const FD_PRICING_LINK = /dchub\.cloud\/(?:pricing|plans)\b[^\s"]*src=(?:footer|services)|#pricing[^\s"]*src=(?:footer|services)|src=(?:footer|services)[^\s"]*#pricing/;
  it('execute_plan, keyed, real handler: the site footer goes out and is clean', () => {
    expect(KEYED_PLAN.site_ctx.plan && KEYED_PLAN.site_ctx.plan.cls, 'precondition: the planner chose the site line').toBe('site');
    expect(KEYED_PLAN.site_ctx.shown, 'precondition: the step attached it').toBe('footer:site');
    const fd = lineOf(KEYED_PLAN.site);
    expect(fd).toEqual([KEYED_PLAN.site_ctx.plan.line]);
    expect(fd[0]).toMatch(/Deal Desk Brief/);
    expect(offenders({ content: [{ type: 'text', text: fd[0] }] })).toEqual([]);
    expect(JSON.stringify(KEYED_PLAN.site)).not.toMatch(FD_PRICING_LINK);
  });
  it('execute_plan, keyed, real handler: the second call plans the unpaid repeat line, and it is clean', () => {
    expect(KEYED_PLAN.repeat_first_ctx.plan, 'first call: no class, no line').toBeUndefined();
    const planned = KEYED_PLAN.repeat_ctx.plan;
    expect(planned && planned.cls, 'precondition: the second keyed call plans the repeat line').toBe('repeat');
    expect(planned.service).toBe('full_depth');
    expect(offenders({ content: [{ type: 'text', text: planned.line }] })).toEqual([]);
    for (const r of [KEYED_PLAN.repeat, KEYED_PLAN.repeat_first]) expect(JSON.stringify(r)).not.toMatch(FD_PRICING_LINK);
  });
  it('every footer class, keyed and paid-keyed, through the real planner and step: present and clean', async () => {
    const intents = { site: SITE_INTENT, capacity: 'lease colocation space in Dallas', comparison: 'compare Dallas vs Phoenix',
      repeat: REPEAT_INTENT };
    for (const tier of ['free', 'pro']) {
      for (const [cls, intent] of Object.entries(intents)) {
        const c = { path: '/mcp', api_key: KEY, tier, platform: 'cursor', user_agent: 'cursor/1.0', _priorCalls: cls === 'repeat' ? 1 : 0 };
        const planned = await S._ctxALS.run(c, async () => S._frontDeskPlanFor({ intent, args: { intent }, c }));
        expect(planned && planned.cls, `${tier} ${cls}: planned`).toBe(cls);
        c._frontDeskPlan = planned;
        const base = { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } };
        const out = await S._ctxALS.run(c, async () => S._frontDeskStep(base, 'execute_plan', c));
        expect(lineOf(out), `${tier} ${cls}: the line went out`).toEqual([planned.line]);
        expect(offenders(out), `${tier} ${cls}`).toEqual([]);
      }
    }
  });
});

// The data API's own strings (stubbed above with its CURRENT copy) reach a keyed caller as the data API sends them:
// their source is the data API, and the keyless step rewrites them for keyless callers only. They are blanked here,
// exactly and nothing else, so this scan judges the copy this server writes.
const _DATA_API_STRINGS = [OLD_AUTOPSY, OLD_RATES, OLD_MARK];
function withoutDataApiStrings(o) {
  if (typeof o === 'string') {
    let t = o;
    for (const x of _DATA_API_STRINGS) t = t.split(x).join('');
    return t.replace(/"rates_upgrade_url":"[^"]*"/g, '"rates_upgrade_url_data_api":null');   // the data API's field, whatever link it holds
  }
  if (Array.isArray(o)) return o.map(withoutDataApiStrings);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === 'rates_upgrade_url') continue;
      out[k] = withoutDataApiStrings(v);
    }
    return out;
  }
  return o;
}
const SCAN_OPTS = { mask: EXECUTE_PLAN_MASK, skipKeys: MACHINE_KEYS };
const everyResult = () => [
  ...Object.values(R).flatMap((x) => [x.first, x.next, x.preview]), ...Object.values(OFF), KEYED,
  ...Object.values(KEYED_SVC), ...['site', 'repeat', 'repeat_first'].map((k) => KEYED_PLAN[k]),
  ...Object.values(KEYED_ALL).flat(), ...Object.values(KEYLESS_PLAN).flat(),
];

describe('keyed callers, every walled tool and whole execute_plan / plan_query answers (Note V keyed follow-up, part 2)', () => {
  it('non-vacuous: every seat answered, the keyed walls are walls, and the unlock offer is there to scan', () => {
    for (const sn of Object.keys(KEYED_SEATS)) {
      for (const t of [...Object.keys(KEYED_TOOLS), ...Object.keys(PLAN_INTENTS).map((l) => 'execute_plan:' + l)]) {
        const rs = KEYED_ALL[`${t}@${sn}`];
        expect(rs && rs.length, `${t}@${sn}`).toBe(2);
        for (const r of rs) expect(JSON.stringify(r).length, `${t}@${sn}`).toBeGreaterThan(500);
      }
    }
    for (const sn of ['free', 'email']) {
      const w = sc(KEYED_ALL[`compare_sites@${sn}`][0]);
      expect(w._wall, sn).toBe(true);
      expect(String(w.user_message || ''), sn).toMatch(/^This preview leaves out .+\. Open https:\/\/dchub\.cloud\/\S+ to see what your agent found\.$/);
    }
    // the data API strings really reached the keyed caller (so blanking them is not hiding nothing)
    expect(JSON.stringify(KEYED_ALL['analyze_site@free'])).toContain(OLD_RATES);
  });
  it('provenance names an unlock offer, never an upgrade CTA', () => {
    const blobs = everyResult().map((r) => JSON.stringify(r));
    expect(blobs.filter((b) => b.includes('unlock offer present')).length, 'precondition: some answer carried an offer').toBeGreaterThan(0);
    expect(blobs.filter((b) => /upgrade CTA present/.test(b))).toEqual([]);
  });
  it('UPGRADE_URL is /connect, and no result links /ai#pricing', () => {
    expect(S.UPGRADE_URL).toBe('https://dchub.cloud/connect');
    const all = everyResult();
    expect(all.length).toBeGreaterThan(100);
    for (const r of all) expect(JSON.stringify(r)).not.toMatch(/\/ai#pricing|\/ai\?[^"\s]*#pricing/);
  });
  // The human ask most walls compose from (server.mjs _rungsText: the pack and the sub-rungs, each with its link),
  // through the real composer, keyless and keyed, on the walled tools. The credit pack's own "(usage capacity, not a
  // subscription)" is kept (owner 2026-10-08), so this asks only that no rung names a plan, trial, upgrade or price.
  it('the rung ladder names no plan, trial, upgrade or price, for any seat', () => {
    let n = 0;
    for (const t of ['rank_markets', 'get_grid_intelligence', 'get_market_intel', 'get_interconnection_queue', 'analyze_site', 'compare_sites']) {
      for (const tier of ['anonymous', 'free', 'trial', 'identified']) {
        for (const api_key of [null, KEY]) {
          const c = { tier, api_key, path: '/mcp', platform: 'cursor', session_id: `sess-knpw-rung-${t}-${tier}-${!!api_key}`, client_ip: '198.51.100.7' };
          const text = String(S._ctxALS.run(c, () => S._rungsText(t, tier, c.session_id)) || '');
          if (!text) continue;
          n += 1;
          expect(text.replace(URL_RE, ' '), `${t} ${tier} keyed=${!!api_key}`).not.toMatch(/\bpaid\b|\bplans?\b|\btrials?\b|\bupgrade\b|\bpricing\b|\$\s?\d|\b(?:Pro|Developer|Starter)\b/i);
          expect(text, `${t} ${tier}`).toMatch(/→ https:\/\/dchub\.cloud\//);   // a rung with its link: not vacuous
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(24);
  });
  for (const sn of Object.keys(KEYED_SEATS)) {
    for (const t of [...Object.keys(KEYED_TOOLS), ...Object.keys(PLAN_INTENTS).map((l) => 'execute_plan:' + l)]) {
      it(`${t} @ ${sn} (keyed, keyless step off): first and next carry no plan, trial, upgrade or price wording`, () => {
        const hits = KEYED_ALL[`${t}@${sn}`].flatMap((r, i) => offenders(withoutDataApiStrings(r), SCAN_OPTS).map((h) => `${i} ${h}`));
        expect(hits).toEqual([]);
      });
    }
  }
  for (const sn of Object.keys(SEATS)) {
    for (const t of ['execute_plan', 'plan_query']) {
      it(`${t} @ ${sn} (keyless, whole answer, every intent): clean`, () => {
        const hits = Object.keys(PLAN_INTENTS).flatMap((l) => (KEYLESS_PLAN[`${t}:${l}@${sn}`] || [])
          .flatMap((r, i) => offenders(r, SCAN_OPTS).map((h) => `${l}/${i} ${h}`)));
        expect(Object.keys(KEYLESS_PLAN).filter((k) => k.startsWith(t + ':') && k.endsWith('@' + sn)).length).toBe(Object.keys(PLAN_INTENTS).length);
        expect(hits).toEqual([]);
      });
    }
  }
});

describe('must-fail controls: the scan catches each measured sentence', () => {
  const bad = (text) => offenders({ content: [{ type: 'text', text }] });
  for (const s of [
    "DC Hub's paid plan has the full side-by-side comparison. Start a 7-day trial: https://dchub.cloud/u/paa8t3",
    '[Start a 7-day DC Hub trial](https://dchub.cloud/u/paa8t3)',
    'Your AI assistant hit DC Hub’s paid data boundary on compare_sites.',
    'Every field of every tool, with no previews or withheld values, on a paid DC Hub plan.',
    // the keyed front-desk footers before the keyed follow-up
    'DC Hub service for this: the Deal Desk Brief turns a site read like this one into a branded PDF your human can share (paid DC Hub plan): https://dchub.cloud/pricing?via=agent-referral&src=footer',
    'DC Hub service for this: full-depth answers, every field with no previews, come with a paid DC Hub plan: https://dchub.cloud/connect?via=agent-referral&src=footer',
    'https://dchub.cloud/pricing?via=agent-referral&src=services',
    'https://dchub.cloud/ai?via=agent-referral&src=services#pricing',
    OLD_AUTOPSY, OLD_RATES, 'Northern Virginia ' + OLD_MARK,
    'this answer hid scores; the plans that return them are on the page behind the link',
    'the lowest plan that returns them is a free DC Hub key',
    'The plans that include the full CAISO brief are on this page: https://dchub.cloud/connect',
    'A sentence like "you need to upgrade" without this URL is a dead end',
    'needs DC Hub Pro', 'a one-time pack for $10',
  ]) it(s.slice(0, 60), () => expect(bad(s)).not.toEqual([]));
  // Note V keyed follow-up (2026-11-16): what keyed callers read before it, caught WITH the keyed scan's masks on
  const badKeyed = (text) => offenders({ content: [{ type: 'text', text }], structuredContent: { reasons: [text] } }, SCAN_OPTS);
  for (const s of [
    'upgrade CTA present',
    '[Get the full DC Hub numbers behind this answer — one-time credit pack, no subscription]',
    '[Get the full DC Hub analysis behind this answer — paid plan, 7-day trial]',
    'https://dchub.cloud/ai#pricing',
    'https://dchub.cloud/ai?via=agent-referral#pricing',
    'get_gas_economics and get_market_intel need the paid layer',
    'get_interconnection_queue: a preview with no key; a paid DC Hub plan gets the full answer.',
    'Full-fidelity trial answer 1 of 3 today',
    '**the plans that include the full answer** → https://dchub.cloud/u/qux9j3',
    '· or **a paid DC Hub plan for agents** → https://dchub.cloud/u/qux9j3',
    "your agent got 3 of 10 `results` rows here — DC Hub's paid layer has the other 7 rows",
    'You need the branded Site Analysis PDF for the point (paid plan).',
    "DC Hub's paid plan has the full site analysis. Start a 7-day trial: https://dchub.cloud/u/qux9j3",
    'this answer hid MW; the lowest plan that returns them is a paid DC Hub plan',
    'Your AI assistant hit DC Hub’s paid data boundary on analyze_site',
  ]) it(`keyed scan: ${s.slice(0, 60)}`, () => expect(badKeyed(s)).not.toEqual([]));
  it('the keyed masks pass execute_plan\'s own plan and the pricing data topics, nothing more', () => {
    for (const s of ['DC Hub ran the plan below', 'not just the plan — one call', 'a plan the agent executes itself keeps every number',
      'energy pricing, whole-ISO briefings', 'You want data-center capacity PRICING ($/MW-day, vacancy)', 'full vacancy/pricing/pipeline report']) {
      expect(badKeyed(s), s).toEqual([]);
    }
    expect(offenders({ structuredContent: { recommended_sequence: [{ access: 'paid' }], error: 'pro_required' } }, SCAN_OPTS)).toEqual([]);
    expect(offenders({ structuredContent: { note: 'access: paid', message: 'pro_required' } }, SCAN_OPTS)).not.toEqual([]);
  });
  it('structure: the old wall code and the pricing-link key', () => {
    expect(offenders({ structuredContent: { error: 'pro_required' } })).not.toEqual([]);
    expect(offenders({ structuredContent: { pricing: { rates_upgrade_url: 'https://dchub.cloud/connect' } } })).not.toEqual([]);
  });
  it('passes what is not plan or price wording', () => {
    for (const s of ['DC Hub plans the lookups across markets', 'execute_plan', 'a free key (claim_free_key) adds more',
      'withheld from this answer', 'the 2027/2028 capacity auction', 'Open DC Hub: see what I found']) expect(bad(s), s).toEqual([]);
    expect(offenders({ structuredContent: { deals: [{ note: 'a $150M+ minimum' }] } })).toEqual([]);
  });
  it('every rewrite lands on wording the scan passes', () => {
    for (const [, f] of K.REWRITES) {
      const to = typeof f === 'function' ? f('', 'the full answer', 'https://dchub.cloud/u/qux9j3') : f;
      expect(offenders({ content: [{ type: 'text', text: to }] }), to).toEqual([]);
    }
  });
});

