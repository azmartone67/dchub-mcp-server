// keyed-budget-per-key-826.test.mjs — mcp#826 (owner-approved 2026-10-20).
// A keyed caller's daily full-answer budget is counted on the KEY, not on the IP it
// shares with anonymous traffic. Hosted agents (ChatGPT, Claude, Smithery) share egress,
// so a freshly claimed key used to read the IP bucket anonymous callers had already spent
// and its first answer said remaining_today: 0. A per-IP ceiling across keys still bounds
// key cycling. Real handler (get_grid_intelligence), backend stubbed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const NEWS_URL = 'https://news.example/rss/articles/ABCDEF123?oc=5';
const BASE = 'https://backend.keyed-budget-826.test';
let S, TOOLS, realFetch, prevInternal;
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
// ★ Owner 2026-10-08 (test/free-decision-tools-preview-only.test.mjs): get_grid_intelligence,
// get_interconnection_queue and get_market_intel are previews on every non-paid seat, so
// the capped full taste this file pins on the grid brief is dormant by default. This file
// runs with the kill switch off (DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY=0, read per call)
// so the mechanics it pins stay driven; the per-seat truth under the switch is pinned there.
let prevFreeDecision;
beforeAll(async () => {
  prevFreeDecision = process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY;
  process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = '0';
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'grid-sell-test-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const p = new URL(String(input && input.url ? input.url : input)).pathname;
    if (p.startsWith('/api/v1/grid/intelligence/')) {
      return json({ iso: 'ERCOT', generation_mix: { NG: 4000, WND: 3000, SUN: 1000 }, demand_mw: 70000,
        related_intel: [{ kind: 'news', source: 'news_articles', title: 'Headline', text: 'Headline body',
          url: NEWS_URL, cosine: 0.8,
          citation: 'Source: the publisher (link: ' + NEWS_URL + '); copyright stays with the publisher',
          license: { id: 'publisher-copyright', reuse: 'link_only', source_url: NEWS_URL, url: NEWS_URL, terms: 'T' } }] });
    }
    if (p === '/api/v1/dcpi/iso-comparison') {
      return json({ isos: [{ iso: 'ERCOT', avg_constraint: 46.5, avg_excess: 60, avg_time_to_power_months: 30,
        market_count: 5, build_count: 3 }] });
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
  if (prevFreeDecision === undefined) delete process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY; else process.env.DCHUB_FREE_DECISION_TOOLS_PREVIEW_ONLY = prevFreeDecision;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});

let n = 0;
const seat = (extra = {}) => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '203.0.115.' + (10 + (n % 200)), session_id: 'sess-826-' + (++n), ...extra });
async function grid(s, args = { iso: 'ERCOT' }) {
  const T = TOOLS.get_grid_intelligence;
  const parsed = await T.inputSchema.safeParseAsync(args);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const text = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const env = (k, v) => { const p = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; return () => { if (p === undefined) delete process.env[k]; else process.env[k] = p; }; };




const GRID = 'get_grid_intelligence';
const keyed = (ip, key) => ({ api_key: key, tier: 'free', platform: 'chatgpt', client_name_raw: 'openai-mcp',
  client_ip: ip, session_id: 'sess-826-k-' + (++n) });

describe('#826 keyed budget is per key, not per shared IP', () => {
  it('a fresh key on an IP whose anonymous bucket is spent still gets its 2 full answers', async () => {
    const ip = '198.51.100.26';
    // Anonymous traffic from the same NAT spends the per-IP bucket (cap 2) today.
    await S._trialFullCallsExceeded(ip, GRID, 2, ip);
    await S._trialFullCallsExceeded(ip, GRID, 2, ip);
    expect(S._trialFullRemaining(ip, GRID, 2, ip)).toBe(0);
    const k = 'dch_live_826_fresh_key_0001';
    const r1 = await grid(keyed(ip, k));
    expect(r1.structuredContent._metered_trial).toBeDefined();          // a full answer, not a preview
    expect(r1.structuredContent._metered_trial.remaining_today).toBe(1);
    const r2 = await grid(keyed(ip, k));
    expect(r2.structuredContent._metered_trial.remaining_today).toBe(0);
    const r3 = await grid(keyed(ip, k));
    expect(r3.structuredContent._metered_trial).toBeUndefined();        // the key's own cap still bites
    // ...and the anonymous IP bucket was not charged by the keyed calls.
    expect(S._trialFullRemaining(ip, GRID, 2, ip)).toBe(0);
    expect(S._trialFullRemaining('203.0.113.250', GRID, 2, '203.0.113.250')).toBe(2);
  });

  it('two keys behind one IP each get their own budget', async () => {
    const ip = '198.51.100.27';
    const a = await grid(keyed(ip, 'dch_live_826_key_a')); await grid(keyed(ip, 'dch_live_826_key_a'));
    const b = await grid(keyed(ip, 'dch_live_826_key_b'));
    expect(a.structuredContent._metered_trial.remaining_today).toBe(1);
    expect(b.structuredContent._metered_trial.remaining_today).toBe(1);
  });

  it('the per-IP ceiling across keys stops key cycling', async () => {
    const ip = '198.51.100.28';
    const ceiling = 2 * S.KEYED_IP_CEILING_MULT;
    expect(ceiling).toBeGreaterThan(2);
    let served = 0;
    for (let i = 0; i < S.KEYED_IP_CEILING_MULT + 1; i++) {
      const key = 'dch_live_826_cycle_' + i;
      for (let j = 0; j < 2; j++) {
        const r = await grid(keyed(ip, key));
        if (r.structuredContent && r.structuredContent._metered_trial) served++;
      }
    }
    expect(served).toBe(ceiling);
    // and the peek states the ceiling, not the fresh key's own 2
    expect(S._keyedFullRemaining({ api_key: 'dch_live_826_cycle_new', client_ip: ip }, GRID, 2)).toBe(0);
    expect(S._keyedFullRemaining({ api_key: 'dch_live_826_cycle_new', client_ip: '198.51.100.29' }, GRID, 2)).toBe(2);
  });

  it('_fullBudgetId: key when presented, IP only for a keyless seat', () => {
    expect(S._fullBudgetId({ api_key: 'k1', client_ip: '1.2.3.4' })).toBe('k1');
    expect(S._fullBudgetId({ client_ip: '1.2.3.4' })).toBe('1.2.3.4');
    expect(S._fullBudgetId(null)).toBe(null);
  });
});
