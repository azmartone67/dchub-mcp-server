// keyless-results-no-plan-wording.test.mjs — Grok Note V item 1 / Note F M1 (2026-11-16): a keyless tool result
// names no plan, trial, upgrade or price and links no pricing page. lib/keyless-plan-wording.mjs, server.mjs
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
//   * a keyed caller is left as it was (the step is keyless only);
//   * the scan itself catches every measured sentence (must-fail controls).
//
// Qualifies for the hard gate: real handlers, backend stubbed at the fetch boundary, every other host fenced.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';
import * as K from '../lib/keyless-plan-wording.mjs';

// ── the scan ─────────────────────────────────────────────────────────────────────────────────────────
// Data rows a fixture plants on purpose (a tax incentive's "$150M+" is the state's figure, not a DC Hub price):
// a price is judged outside these keys only.
const DATA_KEYS = new Set(['deals', 'incentives', 'site_context']);
const URL_RE = /https?:\/\/[^\s"'<>)\]`]+/g;
const PRICING_LINK = /https?:\/\/(?:www\.)?dchub\.cloud\/(?:pricing|plans|checkout)\b[^\s"'<>)\]`]*|dchub\.cloud\/[^\s"'<>)\]`]*#pricing\b|(?:buy|checkout)\.stripe\.com/;
export function offenders(result) {
  const hits = [];
  const add = (where, s, m) => hits.push(`${where}: "…${s.slice(Math.max(0, m.index - 70), m.index + m[0].length + 50).replace(/\s+/g, ' ')}…"`);
  // A URL is judged as a link (a pricing / plans page, a #pricing anchor, a checkout); its path words are not
  // copy (the relay's long form is /upgrade/h/<token>, a route name the person never reads as a sentence).
  const scan = (where, s, data) => {
    const u = PRICING_LINK.exec(s);
    if (u) { add(where, s, u); return; }
    const w = s.replace(URL_RE, (x) => ' '.repeat(x.length));
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
}, 240_000);

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
    expect(c.user_message).toMatch(/^This preview leaves out the full side-by-side comparison: .+\. Open https:\/\/dchub\.cloud\/u\/\w{6} to see what your agent found, or reply with your email for a free DC Hub key\.$/);
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
    for (const x of s) expect(x.link, x.id).toMatch(/^https:\/\/dchub\.cloud\/[^#\s]*\?via=agent-referral&src=services$/);
  });
  it('with the kill switch off, the same calls carry the measured wording (the step is what removes it)', () => {
    const offHits = Object.entries(OFF).map(([t, r]) => [t, offenders(r).length]);
    for (const t of ['compare_sites', 'deal_autopsy', 'analyze_site']) {
      expect(offHits.find((x) => x[0] === t)[1], t).toBeGreaterThan(0);
    }
  });
  it('a keyed caller is left to its own copy (the step is keyless only)', () => {
    expect(offenders(KEYED).length, 'the keyed compare_sites wall no longer carries its owner-approved copy').toBeGreaterThan(0);
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

describe('must-fail controls: the scan catches each measured sentence', () => {
  const bad = (text) => offenders({ content: [{ type: 'text', text }] });
  for (const s of [
    "DC Hub's paid plan has the full side-by-side comparison. Start a 7-day trial: https://dchub.cloud/u/paa8t3",
    '[Start a 7-day DC Hub trial](https://dchub.cloud/u/paa8t3)',
    'Your AI assistant hit DC Hub’s paid data boundary on compare_sites.',
    'Every field of every tool, with no previews or withheld values, on a paid DC Hub plan.',
    'https://dchub.cloud/pricing?via=agent-referral&src=services',
    'https://dchub.cloud/ai?via=agent-referral&src=services#pricing',
    OLD_AUTOPSY, OLD_RATES, 'Northern Virginia ' + OLD_MARK,
    'this answer hid scores; the plans that return them are on the page behind the link',
    'the lowest plan that returns them is a free DC Hub key',
    'The plans that include the full CAISO brief are on this page: https://dchub.cloud/connect',
    'A sentence like "you need to upgrade" without this URL is a dead end',
    'needs DC Hub Pro', 'a one-time pack for $10',
  ]) it(s.slice(0, 60), () => expect(bad(s)).not.toEqual([]));
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
