// tool-results-no-plan-or-price.test.mjs — owner decision 2026-11-15 (results half of the listing rule).
//
// Keep both free offers in plain words, worded exactly ("50 MCP calls/day with an email",
// "1 free Land & Power map search a month"); no plan names, no prices, no pricing links, no
// "free tier" label and no "paid plan" wording. test/tool-descriptions-no-plan-or-price.test.mjs guards
// tools/list; this guards what an agent READS AFTER it connects:
//   1. the initialize instructions on every MCP path (the lean handshake, /mcp/grok, every pack path)
//      and the full text served as the resource dchub://instructions;
//   2. the RESULTS of the five energy tools (execute_plan, get_grid_intelligence,
//      get_interconnection_queue, get_grid_data, get_energy_prices), keyless, rendered three ways each:
//      the first call of the day (the first full answer until owner 2026-11-23 made all five paid-only; a preview
//      now), the next call from the same caller, and the preview
//      (DCHUB_KEYLESS_FIRST_FULL=0), for a coding-agent seat and a Grok seat with a browser UA.
//
// Measured on 2.12.55 by an outside tester (anonymous, clientInfo grok): a "FREE TIER" block with
// "50 calls/day" in initialize; "paid plan" on the keyless first full get_grid_intelligence answer;
// `tier_required: "lite-pro"` and "available on paid plans" on execute_plan "50 MW data center in Dallas, TX".
// The data API's rows here carry `tier_required: 'lite-pro'` the way that answer did, so the guard proves
// the boundary drops it rather than assuming the backend never sends it.
//
// Real tool handlers through the dispatch (execute_plan's steps loop back over real HTTP), the backend
// stubbed at the fetch boundary, every other host fenced. Lean responses at their production default.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { assignArm, ARM_CONTROL } from '../lib/continuation.mjs';
import { FREE_OFFER_EMAIL, FREE_OFFER_LAND_POWER, TIER_CANON } from '../lib/tier-canon.mjs';


// This file reads execute_plan step bodies and envelope keys, so it runs the full answer (what detail:"full" returns).
// The compact default is covered by test/plan-compact-1117 and, through the real handler, test/plan-fact-header.
const _compactWas = process.env.DCHUB_PLAN_COMPACT;
beforeAll(() => { process.env.DCHUB_PLAN_COMPACT = '0'; });
afterAll(() => { if (_compactWas === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = _compactWas; });

// ── what is banned ───────────────────────────────────────────────────────────────────────────────────
// Case-insensitive wording.
export const BANNED_WORDING = new RegExp([
  '\\bfree[- ]tiers?\\b',
  '\\bpaid[- ](?:DC Hub )?(?:plans?|tiers?|keys?)\\b',
  '\\bDC Hub plans?\\b(?!\\s+(?:the|a|an|its|each|and)\\b)',
  'quote verbatim',
  'available on paid',
  '\\bhigher limits?\\b',
  '/pricing\\b',
  '\\bpricing page\\b',
  '\\blite[-_ ]?pro\\b',
  '\\$\\s?\\d',
].join('|'), 'i');
// A plan named in prose: capitalised, case-sensitive ("enterprise buyers" and a project developer are data).
export const PLAN_NAME_PROSE = /\b(?:Developer|Pro|Lite|Enterprise|Starter|Founding|Founder)\b/;
// A field whose whole value is a plan id (`tier_required: 'lite-pro'`, `unlocks_at: 'developer'`).
export const PLAN_ID_VALUE = /^(?:pro|developer|lite|lite[-_ ]?pro|enterprise|starter|founding|founder)$/i;
// Field names that carry a plan in the NAME. (`unlocks_at` / `required_tier` name a rung, and are judged by
// their value above: 'free' is not a plan; test/agent-output-names-no-plan.test.mjs bans the names outright.)
export const PLAN_KEY = /(?:^|_)in_(?:pro|developer|starter|enterprise)$|^pro_hint$/i;

// Every offender in one result: [where, excerpt].
export function resultOffenders(result) {
  const hits = [];
  const seen = new Set();
  const add = (where, s, m) => {
    const ex = s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40).replace(/\s+/g, ' ');
    const k = where + '|' + ex;
    if (!seen.has(k)) { seen.add(k); hits.push(`${where}: "…${ex}…"`); }
  };
  const scanText = (where, s) => {
    const m = BANNED_WORDING.exec(s) || PLAN_NAME_PROSE.exec(s);
    if (m) add(where, s, m);
  };
  const walk = (o, at, d = 0) => {
    if (d > 40 || o === null || o === undefined) return;
    if (typeof o === 'string') {
      const t = o.trim();
      if (PLAN_ID_VALUE.test(t)) { add(at, t, { index: 0, 0: t }); return; }
      if (t[0] === '{' || t[0] === '[') { try { walk(JSON.parse(t), at + '<json>', d + 1); return; } catch (_) { /* text */ } }
      scanText(at, o);
      return;
    }
    if (typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${at}[${i}]`, d + 1)); return; }
    for (const [k, v] of Object.entries(o)) {
      if (PLAN_KEY.test(k)) add(`${at}.${k}`, k, { index: 0, 0: k });
      walk(v, `${at}.${k}`, d + 1);
    }
  };
  walk(result && result.structuredContent, 'sc');
  ((result && result.content) || []).forEach((b, i) => {
    if (!b || typeof b.text !== 'string') return;
    const t = b.text;
    scanText(`content[${i}]`, t);
    const a = t.indexOf('{'), z = t.lastIndexOf('}');
    if (a >= 0 && z > a) { try { walk(JSON.parse(t.slice(a, z + 1)), `content[${i}]<json>`); } catch (_) { /* prose */ } }
  });
  return hits;
}

// ── fixtures: what the data API answers (this server's internal key reads at full depth) ─────────────
const BASE = 'https://backend.tool-results-no-plan.test';
const SECRET = 'tool-results-no-plan-internal-key-not-real';
const GI = {
  iso: 'ERCOT', demand_mw: 53825, demand_period: '2026-11-14T14', peak_mw: 62346, min_mw: 45900, load_factor: 0.839,
  queue_depth_gw: 373.6, queue_depth_basis: 'generation_queue', market_count: 24, build_count: 0, build_rate_pct: 0,
  generation_mix: { NG: { mw: 30289 }, WND: { mw: 10748 } }, as_of: '2026-11-14T14:00:00Z',
  demand_24h: Array.from({ length: 8 }, (_, i) => ({ period: `2026-11-14T${String(i + 1).padStart(2, '0')}`, mw: 50000 + i * 400 })),
};
const QUEUE = {
  iso: 'ERCOT', total_projects: 1174, total_gw: 373.6, as_of: '2026-11-14', by_fuel: { solar: 120.1, storage: 90.2, gas: 60.3 },
  projects: Array.from({ length: 6 }, (_, i) => ({ name: `Q${i}`, mw: 100 + i, fuel: 'solar', status: 'active', state: 'TX' })),
};
const ENERGY = { success: true, avg_rate_kwh: 0.0841, scope: 'iso_footprint_avg', filter: { iso: 'ERCOT', sector: 'all', state: null },
  retail_rates: { avg_cents_kwh: 8.41, latest_period: '2026', max_cents_kwh: 10.1, min_cents_kwh: 7.2, states_covered: 1 } };
// A score / facility row as the data API passes it through, plan column included.
const ROW = { market_slug: 'dallas', market_name: 'Dallas', name: 'Dallas', market: 'dallas', score: 71, verdict: 'CAUTION',
  capacity_mw: 60, tier_required: 'lite-pro', iso: 'ERCOT', state: 'TX' };
const GENERIC = { success: true, ...ROW, count: 2, total: 2, data: [ROW, { ...ROW, name: 'Dallas 2' }], results: [ROW], markets: [ROW], facilities: [ROW] };

const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
let S, TOOLS, realFetch, httpServer, PORT, PACKS = [];
const ENV_KEYS = ['DCHUB_INTERNAL_KEY', 'DCHUB_API_BASE', 'PORT', 'DCHUB_KEYLESS_FIRST_FULL', 'DCHUB_PLAN_FREE_FIELDS_V1'];
const prevEnv = {};
let liteProServed = 0;
const INIT = {};
let FULL_TEXT = '';
const R = {};   // `${tool}@${seat}` -> { first, next, preview, extra: [] }

const TOOLS5 = {
  get_grid_intelligence: { iso: 'ERCOT' },
  get_interconnection_queue: { iso: 'ERCOT' },
  get_grid_data: { iso: 'ERCOT' },
  get_energy_prices: { iso: 'ERCOT' },
  execute_plan: { intent: '50 MW data center in Dallas, TX' },
};
const PLAN_MORE = ['how soon can a 100 MW load get power in ERCOT', 'interconnection queue and energy prices in ERCOT for a 200 MW campus'];
const SEATS = {
  cursor: { platform: 'cursor', client_name_raw: 'cursor', user_agent: 'cursor/1.0' },
  grok: { platform: 'grok', client_name_raw: 'grok', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' },
};

let n = 0;
function seat(over) {
  n += 1;
  while (assignArm({ sessionId: `sess-trnp-${n}`, eligible: true }) !== ARM_CONTROL) n += 1;
  return { tier: 'free', client_ip: `198.51.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`, session_id: `sess-trnp-${n}`, ...over };
}
async function call(name, s, args) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
async function rpc(path, body, headers = {}) {
  const res = await realFetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const b = raw.includes('data: ') ? raw.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : raw;
  let msg = null; try { msg = JSON.parse(b); } catch (_) { msg = null; }
  return { headers: res.headers, msg };
}
const initBody = { jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok', version: '1.0' } } };
const UA = { 'user-agent': SEATS.grok.user_agent };

beforeAll(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  process.env.DCHUB_INTERNAL_KEY = SECRET;
  delete process.env.DCHUB_KEYLESS_FIRST_FULL;
  delete process.env.DCHUB_PLAN_FREE_FIELDS_V1;
  realFetch = globalThis.fetch;
  // execute_plan's steps loop back to http://127.0.0.1:<PORT>/mcp, and PORT is read once at import.
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
    if (p.startsWith('/api/v1/grid/intelligence/')) return json(structuredClone(GI));
    if (p.startsWith('/api/v1/interconnection-queue/')) return json(structuredClone(QUEUE));
    if (p.startsWith('/api/v1/energy/')) return json(structuredClone(ENERGY));
    liteProServed += 1;
    return json(structuredClone(GENERIC));
  };
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
  httpServer = await new Promise((r) => { const h = S.app.listen(PORT, '127.0.0.1', () => r(h)); });
  PACKS = [...S.MCP_PACKS.keys()];

  // 1. initialize on every path, and the full text behind dchub://instructions.
  for (const p of ['/mcp', '/mcp?catalog=full', '/mcp/oauth', '/mcp/grok', ...PACKS]) {
    INIT[p] = (await rpc(p, initBody, UA)).msg?.result?.instructions;
  }
  const init = await rpc('/mcp', initBody, UA);
  const sid = init.headers.get('mcp-session-id');
  await rpc('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { ...UA, 'mcp-session-id': sid });
  const rr = await rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'dchub://instructions' } },
    { ...UA, 'mcp-session-id': sid });
  FULL_TEXT = rr.msg?.result?.contents?.[0]?.text || '';

  // 2. the five tools, three renders each, two seats.
  for (const [sn, over] of Object.entries(SEATS)) {
    for (const [tool, args] of Object.entries(TOOLS5)) {
      const s = seat(over);
      const first = await call(tool, s, args);
      // execute_plan: a different question for the second call, so no answer cache can repeat the first.
      const next = await call(tool, s, tool === 'execute_plan' ? { intent: '50 MW data center near Dallas, Texas' } : args);
      process.env.DCHUB_KEYLESS_FIRST_FULL = '0';
      const preview = await call(tool, seat(over), args);
      const extra = [];
      if (tool === 'execute_plan') for (const intent of PLAN_MORE) extra.push(await call(tool, seat(over), { intent }));
      delete process.env.DCHUB_KEYLESS_FIRST_FULL;
      R[`${tool}@${sn}`] = { first, next, preview, extra };
    }
  }
}, 240_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => (httpServer ? httpServer.close(r) : r()));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const head = (r) => {
  const t = (r && r.content && r.content[0] && r.content[0].text) || '';
  try { return JSON.parse(t); } catch (_) { /* fallthrough */ }
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (_) { return null; }
};
const isFirstFull = (r) => !!((r.structuredContent || {}).first_full_answer || (head(r) || {}).first_full_answer);
const isPreview = (r) => {
  const h = head(r) || {}; const sc = r.structuredContent || {};
  return !!(h.taste || h.free_preview_only || h.preview_is_partial || sc.trial_preview || sc.preview_is_partial
    || /preview/i.test(JSON.stringify(sc.provenance || h.provenance || {})));
};

// Option A (owner 2026-11-16): the handshake and the full text carry the neutral connect line in place of the two
// free offers (lib/neutral-connect.mjs); the canon phrases themselves are unchanged.
const CONNECT_LINE = 'More detail is available at dchub.cloud/connect.';
describe('initialize instructions: the neutral connect line, no offers, no tier label, no plan, no price', () => {
  it('every path is served (non-vacuous)', () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(5);
    for (const [p, t] of Object.entries(INIT)) {
      expect(typeof t, p).toBe('string');
      expect(t.length, p).toBeGreaterThan(200);
    }
    expect(FULL_TEXT.length, 'dchub://instructions was not served').toBeGreaterThan(2000);
  });
  it('the offers are the owner\'s exact phrases, and the email figure is the canon rung', () => {
    expect(FREE_OFFER_EMAIL).toBe('50 MCP calls/day with an email');
    expect(FREE_OFFER_LAND_POWER).toBe('1 Land & Power map search a month');
    expect(TIER_CANON.calls_per_day.identified, 'the email rung moved: the owner rewords the offer').toBe(50);
  });
  for (const p of ['/mcp', '/mcp?catalog=full', '/mcp/oauth', '/mcp/grok']) {
    it(`${p}: carries the connect line, not the offers, and nothing banned`, () => {
      const t = INIT[p];
      expect(t).toContain(CONNECT_LINE);
      expect(t).not.toContain(FREE_OFFER_EMAIL);
      expect(t).not.toContain(FREE_OFFER_LAND_POWER);
      expect(t).not.toMatch(/FREE TIER/);
      expect(resultOffenders({ content: [{ type: 'text', text: t }] })).toEqual([]);
    });
  }
  it('every pack path: the connect line, no offers, nothing banned', () => {
    const bad = [];
    for (const p of PACKS) {
      if (!INIT[p].includes(CONNECT_LINE)) bad.push(p + ': connect line missing');
      if (INIT[p].includes(FREE_OFFER_EMAIL)) bad.push(p + ': offer still there');
      for (const h of resultOffenders({ content: [{ type: 'text', text: INIT[p] }] })) bad.push(p + ' ' + h);
    }
    expect(bad).toEqual([]);
  });
  it('dchub://instructions (the full text): the connect line, no offers, nothing banned', () => {
    expect(FULL_TEXT).toContain(CONNECT_LINE);
    expect(FULL_TEXT).not.toContain(FREE_OFFER_EMAIL);
    expect(resultOffenders({ content: [{ type: 'text', text: FULL_TEXT }] })).toEqual([]);
  });
});

describe('the five energy tools\' results name no plan and state no price (keyless)', () => {
  it('the renders are what they claim to be (non-vacuous)', () => {
    for (const sn of Object.keys(SEATS)) {
      for (const tool of Object.keys(TOOLS5)) {
        const r = R[`${tool}@${sn}`];
        // Owner 2026-11-23 (lib/paid-full-only.mjs): all five are paid-only, so the keyless first full answer of the
        // day no longer serves any of them: call 1 is the preview too (it was the first full answer before).
        expect(isFirstFull(r.first), `${tool}@${sn}: call 1 is a first full answer`).toBe(false);
        expect(isFirstFull(r.preview), `${tool}@${sn}: the flag-off call carries a first-full block`).toBe(false);
        if (tool !== 'execute_plan') {
          expect(isFirstFull(r.next), `${tool}@${sn}: call 2 is a first full answer`).toBe(false);
          expect(isPreview(r.first), `${tool}@${sn}: call 1 is not a preview`).toBe(true);
          expect(isPreview(r.preview), `${tool}@${sn}: the flag-off call is not a preview`).toBe(true);
        }
      }
    }
    // the plan read the planted plan column, so its absence below is the boundary's doing
    expect(liteProServed).toBeGreaterThan(0);
    const plan = R['execute_plan@cursor'].first.structuredContent || {};
    expect((plan.executed || []).length, 'execute_plan ran no steps').toBeGreaterThan(0);
  });
  for (const sn of Object.keys(SEATS)) {
    for (const tool of Object.keys(TOOLS5)) {
      it(`${tool} @ ${sn}: first full answer, next call and preview carry no plan, price or tier wording`, () => {
        const r = R[`${tool}@${sn}`];
        const hits = [];
        for (const [label, res] of [['first', r.first], ['next', r.next], ['preview', r.preview],
          ...r.extra.map((x, i) => [`plan${i + 2}`, x])]) {
          for (const h of resultOffenders(res)) hits.push(`${label} ${h}`);
        }
        expect(hits).toEqual([]);
      });
    }
  }
});

describe('must-fail controls: the scan catches the measured 2.12.55 copy', () => {
  const bad = (text) => resultOffenders({ content: [{ type: 'text', text }] });
  it('wording', () => {
    for (const s of [
      ' FREE TIER (quote verbatim): Anonymous: previews, no key needed.',
      'full per-substation available-MW needs a paid plan (use get_grid_data or analyze_site).',
      'Broker lease rates (CBRE/JLL): available on paid plans',
      'Free-tier taste: `taste` is the one headline this tier publishes',
      'Your AI assistant hit DC Hub’s free-tier limit on get_grid_data',
      '[Get the full DC Hub brief behind this answer — paid DC Hub plan]',
      'Paid plans: on the page behind the human_url link',
      'see https://dchub.cloud/pricing',
      'higher limits on a key',
      'Developer $49/mo',
      'needs DC Hub Pro',
    ]) expect(bad(s), s).not.toEqual([]);
  });
  it('plan values and plan keys, in structure and in JSON text', () => {
    expect(resultOffenders({ structuredContent: { executed: [{ result: { data: [{ tier_required: 'lite-pro' }] } }] } })).not.toEqual([]);
    expect(resultOffenders({ structuredContent: { withheld: [{ section: 'x', unlocks_at: 'developer' }] } })).not.toEqual([]);
    expect(resultOffenders({ structuredContent: { _peak_mw_in_pro: true } })).not.toEqual([]);
    expect(resultOffenders({ structuredContent: { pro_hint: 'x' } })).not.toEqual([]);
    expect(bad('{"ok":true,"result":{"tier_required":"lite-pro"}}')).not.toEqual([]);
  });
  it('passes what is not plan or price wording', () => {
    for (const s of [FREE_OFFER_EMAIL, FREE_OFFER_LAND_POWER, 'a DC Hub key (claim_free_key) adds more',
      'for enterprise buyers and the agents that procure for them', 'withheld from this answer',
      'the 2027/2028 capacity auction', 'DC Hub plans the lookups']) expect(bad(s), s).toEqual([]);
  });
});
