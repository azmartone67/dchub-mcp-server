// paid-only-six-more-tools-1123.test.mjs — owner decisions 2026-11-23 (added scope, same rule as
// test/paid-only-plan-and-grid-data-1123): rank_markets, get_market_context, get_energy_prices, ai_capacity_index,
// get_grid_intelligence and get_interconnection_queue give a FULL answer only to a paid key (Developer and up;
// lib/paid-full-only.mjs). A keyless caller and every free-class key (no email, a bound email, a validated trial
// key) get the tool's existing preview on every call. The lanes that used to open them:
//   * rank_markets, ai_capacity_index: _freeTasteTool put them on the capped trial_taste path, so a free key, an
//     email-bound key and a trial key got full lists (8 a day per IP);
//   * get_market_context: any lane that set trial_taste skipped the depth tease, and a returning key
//     (DCHUB_RETURN_REWARD, ON in this file) got a full pack a day;
//   * get_energy_prices: KEYED_FREE_BONUS (any free key, full) and the keyless first full answer of the day;
//   * get_grid_intelligence, get_interconnection_queue: the bound-email key's 10 full answers a day
//     (_emailFullDecisionTool) and the keyless first full answer of the day.
// The keyless first full lane is left with no tools (flag and code kept): it charges nothing and the free-tier rule
// carries no "first call each UTC day" clause. A paid key still gets the full answer from all six.
//
// The stub backend answers every read with the FULL payload, whoever asks (this server's internal key is honoured
// ahead of the caller's), so a preview here is this server's doing.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as F from '../lib/keyless-first-full.mjs';
import * as K from '../lib/keyless-full-trial.mjs';
import { PAID_FULL_ONLY_TOOLS, isPaidFullOnly } from '../lib/paid-full-only.mjs';
import { KEYLESS_FIRST_FULL_CLAUSE, _freeTierRuleText } from '../lib/tier-canon.mjs';

const BASE = 'https://backend.paid-only-six-1123.test';
// Each payload carries figures only the full answer shows (the "deep" markers), odd and distinct.
const RANK = { criteria: 'best_overall', region: 'us', tier: 'developer', count: 10, as_of: '2026-11-22',
  results: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, market: 'Rankmkt' + (70 + i), slug: 'rankmkt-' + (70 + i),
    score: 81.3 - i, score_basis: 'best_overall composite', facility_count: 37 + i })) };
const PACK = (slug) => ({
  ok: true, market: slug, name: 'Dallas', tier: 'full', max_tokens: 4000, used_tokens: 1183, as_of: '2026-11-23T01:00:00Z',
  sections: [
    { id: 'hero', title: 'Market & DCPI verdict', tokens: 60, as_of: '2026-11-23T01:00:00Z', text: 'Dallas (TX, ERCOT) — DCPI verdict: CAUTION.' },
    { id: 'outlook', title: '12-month outlook', tokens: 40, as_of: '2026-11-23T01:00:00Z', text: 'Outlook: Quillfeather substation expansion lands Q3.' },
    { id: 'deals', title: 'M&A deals', tokens: 30, as_of: '2026-11-20T00:00:00Z', text: 'Deals: Marrowgate Capital bought 3 campuses.' },
  ],
  _free_preview: { used_tokens: 60, sections: [{ id: 'hero', title: 'Market & DCPI verdict', tokens: 40,
    text: 'Dallas (TX, ERCOT) — DCPI verdict: CAUTION.' }], locked_sections: ['outlook', 'deals'] },
});
const ENERGY = { success: true, caller_tier: 'pro', avg_rate_kwh: 0.2341, retail_rate_kwh: 0.2341, industrial_rate_kwh: 0.0911,
  scope: 'iso_footprint_avg', filter: { iso: 'PJM', sector: 'all', state: null },
  retail_rates: { avg_cents_kwh: 23.41, latest_period: '2026-08', max_cents_kwh: 31.77, min_cents_kwh: 17.13, states_covered: 13 } };
const AICAP = JSON.parse(readFileSync(new URL('./fixtures/ai-capacity-index-90.json', import.meta.url), 'utf8'));
const GI = { iso: 'PJM', region: 'PJM', rto_code: 'PJM', demand_mw: 93825, demand_period: '2026-11-23T14', peak_mw: 102347,
  min_mw: 85903, load_factor: 0.839, queue_depth_gw: 373.6, market_count: 64, as_of: '2026-11-23T14:00:00Z',
  generation_mix: { NG: { mw: 40289 }, NUC: { mw: 30757 } },
  demand_24h: Array.from({ length: 8 }, (_, i) => ({ period: `2026-11-23T${String(i + 1).padStart(2, '0')}`, mw: 90011 + i * 400 })) };
const QUEUE = { iso: 'PJM', total_projects: 1174, total_gw: 373.6, as_of: '2026-11-23',
  by_fuel: { solar: 120.1, storage: 90.2, gas: 60.3 },
  projects: Array.from({ length: 8 }, (_, i) => ({ name: 'Qproj' + (50 + i), mw: 151 + i, fuel: 'solar', status: 'active', state: 'PA' })) };

const CASES = {
  rank_markets: { args: { criteria: 'best_overall', limit: 10 }, deep: ['Rankmkt76', 'Rankmkt77', 'Rankmkt78', 'Rankmkt79'] },
  get_market_context: { args: { market: 'dallas' }, deep: ['Quillfeather', 'Marrowgate'] },
  get_energy_prices: { args: { iso: 'PJM' }, deep: ['31.77', '17.13'] },
  ai_capacity_index: { args: { limit: 20 }, deep: ['houston-tx', 'denver-co', 'sydney-nsw'] },
  get_grid_intelligence: { args: { region_id: 'PJM' }, deep: ['102347', '40289', '90011'] },
  get_interconnection_queue: { args: { iso: 'PJM' }, deep: ['Qproj55', 'Qproj56', 'Qproj57'] },
};
const SIX = Object.keys(CASES);

let S, TOOLS, realFetch, n = 0;
const ENV = ['DCHUB_API_BASE', 'DCHUB_INTERNAL_KEY', 'DCHUB_TOP_METROS_FREE', 'DCHUB_PREVIEW_ISERROR', 'DCHUB_KEYLESS_FULL_TRIAL',
  'DCHUB_KEYLESS_FULL_TRIAL_TOOLS', 'DCHUB_KEYLESS_FIRST_FULL', 'DCHUB_ANON_DAILY_CAP', 'DCHUB_RETURN_REWARD'];
const prev = {};
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

beforeAll(async () => {
  for (const k of ENV) prev[k] = process.env[k];
  delete process.env.DCHUB_TOP_METROS_FREE;            // the top-20 metro lane ON, as in prod
  process.env.DCHUB_INTERNAL_KEY = 'paid-only-six-1123-key-not-real';
  process.env.DCHUB_PREVIEW_ISERROR = '0';
  process.env.DCHUB_ANON_DAILY_CAP = '1000';
  process.env.DCHUB_RETURN_REWARD = '1';                // read once at import; every key below reads as returning
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    if (new URL(url).origin !== new URL(BASE).origin) throw new Error('network fence: ' + url);
    const p = new URL(url).pathname;
    if (p.startsWith('/api/v1/context/market/')) return json(PACK(decodeURIComponent(p.split('/').pop())));
    if (p === '/api/v1/mcp/tools/rank_markets') return json(structuredClone(RANK));
    if (p === '/api/v1/energy/summary') return json(structuredClone(ENERGY));
    if (p === '/api/v1/ai-capacity-index') return json(structuredClone(AICAP));
    if (p.startsWith('/api/v1/grid/intelligence/')) return json(structuredClone(GI));
    if (p.startsWith('/api/v1/interconnection-queue/')) return json(structuredClone(QUEUE));
    if (p === '/api/v1/keys/standing') return json({ returning: true });
    if (p === '/api/v1/mcp/full-cap/consume' || p === '/api/v1/mcp/full-cap/peek') return json({ ok: false });
    if (p.startsWith('/api/v1/mcp/credits/balance')) return json({ credits: 0, had_pack: false });
    return json({});
  };
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
});
afterEach(() => { for (const k of ['DCHUB_KEYLESS_FULL_TRIAL', 'DCHUB_KEYLESS_FULL_TRIAL_TOOLS', 'DCHUB_KEYLESS_FIRST_FULL']) delete process.env[k]; });

const base = () => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-code', user_agent: 'claude-code/2.0',
  client_ip: '203.0.113.' + (10 + (n % 230)), session_id: 'six-1123-' + (++n) });
const SEATS = {
  keyless: () => base(),
  'free key, no email': () => ({ ...base(), api_key: 'dch_live_six1123_free_' + n, tier: 'free' }),
  'free key, bound email': () => ({ ...base(), api_key: 'dch_live_six1123_bound_' + n, tier: 'identified', email: 'six1123@example.com' }),
  'validated trial key': () => ({ ...base(), api_key: 'dch_trial_six1123_' + n, tier: 'trial', is_trial: true, source: 'auto_trial' }),
};
const developer = () => ({ ...base(), api_key: 'dch_live_six1123_dev_' + n, tier: 'developer' });

async function call(tool, seat) {
  const T = TOOLS[tool];
  const parsed = await T.inputSchema.safeParseAsync(CASES[tool].args);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const allText = (r) => (r.content || []).map((c) => c.text || '').join('\n') + '\n' + JSON.stringify(r.structuredContent || {});
const deepSeen = (tool, r) => CASES[tool].deep.filter((m) => allText(r).includes(m));
// The preview says it is one: a withheld marker, a partial flag, a locked section or the relay link.
const PREVIEW_MARK = /_withheld|_in_pro|preview_is_partial|locked_sections|"withheld"|human_url/;

describe('the list and the lanes', () => {
  it('lib/paid-full-only.mjs names all six', () => {
    for (const t of SIX) { expect(PAID_FULL_ONLY_TOOLS, t).toContain(t); expect(isPaidFullOnly(t)).toBe(true); }
  });
  it('no free-key capped full taste and no bound-email full answers', () => {
    for (const t of SIX) {
      expect(S._freeTasteTool(t), t).toBe(false);
      expect(S._emailFullDecisionTool(t, {}), t).toBe(false);
    }
    expect(S._freeTasteTool('get_fiber_intel'), 'CONTROL: a tool outside the list keeps its taste').toBe(true);
    expect(S._emailFullDecisionTool('get_market_intel', {}), 'CONTROL: get_market_intel keeps its email answers').toBe(true);
  });
  it('the keyless first full lane is empty and safe: no seat, no charge, no clause', async () => {
    expect(F.KEYLESS_FIRST_FULL_TOOLS).toEqual([]);
    const c = { client_ip: '198.51.100.40', user_agent: 'cursor/1.0', session_id: 's-six-1123' };
    for (const t of [...SIX, 'execute_plan', 'get_grid_data']) {
      expect(F.keylessFirstFullSeat(t, c, { env: { DCHUB_KEYLESS_FIRST_FULL: '1' } }), t).toBeNull();
      expect(F.planStepSeat(t, { ...c, loopback_step: true, plan_first_full: true }), t).toBeNull();
      expect(await S._keylessFirstFullCharge({ ...c }, t, 1), t).toBe(false);
    }
    expect(KEYLESS_FIRST_FULL_CLAUSE).toBe('');
    const rule = _freeTierRuleText();
    expect(rule).toBeTruthy();
    expect(rule).not.toMatch(/first call each UTC day|is a full answer|^ /);
    expect([...K.keylessFullTrialTools({ DCHUB_KEYLESS_FULL_TRIAL_TOOLS: SIX.join(',') })]).toEqual([]);
  });
});

for (const tool of SIX) {
  describe(`${tool}: below a paid key, the preview on every call`, () => {
    for (const [who, seat] of Object.entries(SEATS)) {
      it(`${who}: three calls, each the preview, none full`, async () => {
        const s = seat();
        for (let i = 1; i <= 3; i++) {
          const r = await call(tool, { ...s });
          expect(deepSeen(tool, r), `${who} call ${i}: full ${tool}: ${allText(r).slice(0, 400)}`).toEqual([]);
          expect(allText(r), `${who} call ${i}: not marked a preview`).toMatch(PREVIEW_MARK);
          expect(r.isError === true, `${who} call ${i}: an error, not the preview`).toBe(false);
        }
      });
    }
    it('keyless with the keyless full trial and the first full answer ON, listing the tool: still the preview', async () => {
      process.env.DCHUB_KEYLESS_FULL_TRIAL = '1';
      process.env.DCHUB_KEYLESS_FULL_TRIAL_TOOLS = tool;
      process.env.DCHUB_KEYLESS_FIRST_FULL = '1';
      const r = await call(tool, SEATS.keyless());
      expect(deepSeen(tool, r), allText(r).slice(0, 400)).toEqual([]);
    });
    it('a developer key gets the full answer (the checks above are not vacuous)', async () => {
      const r = await call(tool, developer());
      expect(deepSeen(tool, r), allText(r).slice(0, 400)).toEqual(CASES[tool].deep);
    });
  });
}

describe('copy: no free full promise', () => {
  it('the descriptions no longer promise a key or an email full answers', () => {
    expect(TOOLS.rank_markets.description).not.toMatch(/a key unlocks full lists/);
    expect(TOOLS.get_energy_prices.description).not.toMatch(/an email-bound key opens them/);
    expect(TOOLS.get_interconnection_queue.description).not.toMatch(/bound email unlocks full answers/);
    expect(TOOLS.get_grid_intelligence.description).not.toMatch(/a key unlocks full briefs/);
  });
  it('no preview below a paid key says an email opens the full answer', async () => {
    const PROMISE = /markets in this ranking\.|markets in this index with their scores\.|unlock the full brief with their email|An email on this page opens the full answer|gets \d+ full answers a day|opens fuller (grid|queue)/;
    for (const tool of SIX) for (const seat of [SEATS.keyless(), SEATS['free key, no email'](), SEATS['free key, bound email']()]) {
      expect(allText(await call(tool, seat)), tool).not.toMatch(PROMISE);
    }
  });
});
