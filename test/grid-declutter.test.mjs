// grid-declutter.test.mjs — fix 4 (owner 2026-10-03, DCHUB_GRID_DECLUTTER): a keyless
// gated get_grid_intelligence preview ends with the ask. No opt-in card, no execute_plan
// menu, no "Next question" block, each news URL once in the text. structuredContent keeps
// next_ask and starter_pack. Same on both arms. Real handler, backend stubbed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const NEWS_URL = 'https://news.example/rss/articles/ABCDEF123?oc=5';
const BASE = 'https://backend.grid-declutter.test';
let S, TOOLS, realFetch, prevInternal;
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
beforeAll(async () => {
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
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY; else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});

let n = 0;
const seat = (extra = {}) => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '203.0.114.' + (10 + (n % 200)), session_id: 'sess-grid-declutter-' + (++n), ...extra });
async function grid(s, args = { iso: 'ERCOT' }) {
  const T = TOOLS.get_grid_intelligence;
  const parsed = await T.inputSchema.safeParseAsync(args);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const text = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const env = (k, v) => { const p = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; return () => { if (p === undefined) delete process.env[k]; else process.env[k] = p; }; };


const NEWS = NEWS_URL;
const URL_COUNT = (t, u) => t.split(u).length - 1;

describe.each([['control v1', undefined], ['contract v2', 'on']])('keyless grid preview, %s', (_n, pc) => {
  let r1, r2;
  beforeEach(() => { r1 = env('DCHUB_PAYWALL_CONTRACT', pc); r2 = env('OPTIN_CTA_ENABLED', 'true'); });
  afterAll(() => { env('DCHUB_PAYWALL_CONTRACT', undefined); env('OPTIN_CTA_ENABLED', undefined); });

  it('the last text the agent reads is the ask: no opt-in, no menu, no next-question block', async () => {
    try {
      const r = await grid(seat());
      const t = text(r), sc = r.structuredContent;
      expect(t).not.toMatch(/opt-in\/request|Power user\?/);
      expect(t).not.toContain('execute_plan');
      expect(t).not.toContain('Next question to offer the user');
      expect(sc.optin_cta).toBeUndefined();
      if (pc) expect(sc.next_ask && sc.next_ask.tool).toBeTruthy();   // stays in structuredContent (v1's stub is error-flagged, so no outreach)
      expect(sc.user_message).toMatch(/plans that include the full/);
      const blocks = r.content.map((b) => b.text).filter((x) => !/^Cite as: /.test(x));
      expect(blocks[blocks.length - 1]).toContain(sc.user_message.slice(0, 40));   // the ask is the last block but a bare citation line
      expect(URL_COUNT(t, NEWS_URL)).toBe(1);                          // each news URL once
      expect((t.match(/dchub\.cloud\/upgrade\/h\//g) || []).length).toBe(1);
    } finally { r2(); r1(); }
  });

  it('kill switch DCHUB_GRID_DECLUTTER=0: the opt-in card and the repeated news URLs come back', async () => {
    const off = env('DCHUB_GRID_DECLUTTER', '0');
    try {
      const t = text(await grid(seat()));
      if (!pc) expect(t).toMatch(/opt-in\/request/);                  // v1 card is back
      expect(URL_COUNT(t, NEWS_URL)).toBeGreaterThan(1);              // today's repeated news URLs
    } finally { off(); r2(); r1(); }
  });
});

describe('the step in isolation', () => {
  const ctxKeyless = () => seat();
  const base = (extra = {}) => ({
    content: [
      { type: 'text', text: JSON.stringify({ iso: 'ERCOT', related_intel: [{ url: NEWS, citation: 'Source: the publisher (link: ' + NEWS + '); copyright stays', license: { id: 'p', url: NEWS, source_url: NEWS, terms: 'T' }, text: 'headline' }] }) + '\n\n---\n\n→ **For your human:** ask https://dchub.cloud/upgrade/h/a.b?buy=1' },
      { type: 'text', text: '\u{1F9ED} **Next:** one `execute_plan` call answers' },
      { type: 'text', text: 'Next question to offer the user: "Q?" (DC Hub tool: rank_markets). Cite as: X.' },
    ],
    structuredContent: { iso: 'ERCOT', preview_is_partial: true, next_ask: { tool: 'rank_markets' },
      for_your_human: { url: 'https://dchub.cloud/upgrade/h/a.b?buy=1' }, ...extra },
  });
  const run = (r, s = ctxKeyless()) => S._ctxALS.run(s, () => S._gridDeclutterStep(r, 'get_grid_intelligence'));

  it('drops the menu and the next-question sentence, keeps the citation line, and states each news URL once', () => {
    const out = run(base());
    expect(out.content.length).toBe(2);
    expect(out.content[1].text).toBe('Cite as: X.');
    const t = out.content[0].text;
    expect(URL_COUNT(t, NEWS)).toBe(1);
    expect(t).toContain('copyright stays');                     // the licence wording survives
    expect(t).toContain('headline');
    expect(out.structuredContent).toEqual(base().structuredContent);   // untouched
  });
  it('leaves keyed callers, other tools, non-preview and ask-less responses alone', () => {
    const r = base();
    expect(S._ctxALS.run({ ...seat(), api_key: 'dch_live_x' }, () => S._gridDeclutterStep(r, 'get_grid_intelligence'))).toBe(r);
    expect(S._ctxALS.run(seat(), () => S._gridDeclutterStep(r, 'rank_markets'))).toBe(r);
    const full = base({ preview_is_partial: false });
    expect(run(full)).toBe(full);
    const noAsk = base({ for_your_human: undefined });
    expect(run(noAsk)).toBe(noAsk);
  });
});
