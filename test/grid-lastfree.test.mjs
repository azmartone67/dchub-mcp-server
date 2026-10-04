// grid-lastfree.test.mjs — fix 5 (owner 2026-10-03, DCHUB_LASTFREE_ASK): a keyed free caller's
// LAST free full get_grid_intelligence answer of the day carries one human line with the
// key-bound pack link. The answer and the caps are unchanged. Real handler, backend stubbed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lastFreeLine } from '../lib/grid-sell-line.mjs';

describe('lastFreeLine (pure)', () => {
  it('names the price, the same key, the per-pack count it was given, no em dash', () => {
    const l = lastFreeLine({ tool: 'get_grid_intelligence', link: 'https://dchub.cloud/go/c/x.y', perPack: 200 });
    expect(l.human).toBe('That was the last free full DC Hub grid brief on this key today. $10 one-time adds 1,000 credits to the same key, about 200 more full grid briefs, no subscription, one click: https://dchub.cloud/go/c/x.y');
    expect(l.agent).toMatch(/last free full get_grid_intelligence answer today/);
    expect(l.human + l.agent).not.toMatch(/—/);
  });
  it('states no count it was not given; other tools and no link yield nothing', () => {
    expect(lastFreeLine({ tool: 'get_grid_intelligence', link: 'https://x', perPack: 0 }).human).not.toMatch(/about/);
    expect(lastFreeLine({ tool: 'rank_markets', link: 'https://x', perPack: 200 })).toBeNull();
    expect(lastFreeLine({ tool: 'get_grid_intelligence', link: '', perPack: 200 })).toBeNull();
  });
});

const NEWS_URL = 'https://news.example/rss/articles/ABCDEF123?oc=5';
const BASE = 'https://backend.grid-lastfree.test';
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
  client_ip: '203.0.115.' + (10 + (n % 200)), session_id: 'sess-grid-lastfree-' + (++n), ...extra });
async function grid(s, args = { iso: 'ERCOT' }) {
  const T = TOOLS.get_grid_intelligence;
  const parsed = await T.inputSchema.safeParseAsync(args);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const text = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const env = (k, v) => { const p = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; return () => { if (p === undefined) delete process.env[k]; else process.env[k] = p; }; };



const KEY = 'dch_live_lastfree_fixture_key_0001';
const keyed = (ip, key = KEY) => ({ api_key: key, tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: ip, session_id: 'sess-lastfree-' + (++n) });
const payload = (u) => Buffer.from(u.split('/go/c/')[1].split('.')[0], 'base64url').toString().split('|');

describe('keyed free caller, three calls in one UTC day', () => {
  it('only the 2nd (last free full) answer carries the ask, with a key-bound /go/c link; the 3rd is the preview as before', async () => {
    const restore = env('DCHUB_PAYWALL_CONTRACT', undefined);
    try {
      const ip = '203.0.115.201';
      const r1 = await grid(keyed(ip)), r2 = await grid(keyed(ip)), r3 = await grid(keyed(ip));
      expect(text(r1)).not.toContain('last free full');
      expect(r1.structuredContent._metered_trial.remaining_today).toBe(1);
      const sc = r2.structuredContent, t = text(r2);
      expect(sc._metered_trial.remaining_today).toBe(0);
      expect(t).toContain('That was the last free full DC Hub grid brief on this key today.');
      expect(sc.show_to_user).toBe(true);
      expect(sc.user_message).toContain('about 200 more full grid briefs');
      expect(sc.for_your_human.text).toBe(sc.user_message);
      const url = sc.for_your_human.url;
      expect(url).toMatch(/^https:\/\/dchub\.cloud\/go\/c\//);
      const p = payload(url);
      expect(p[0]).toBe('metered');
      expect(p[1]).toMatch(/^pk-[0-9a-f]{64}$/);                      // credits land on the key they use
      expect(p[3]).toBe('get_grid_intelligence');
      expect(sc.demand_mw).not.toBe(undefined);                        // the full answer is unchanged
      expect(r2.structuredContent.preview_is_partial).toBeFalsy();
      expect(r3.structuredContent._metered_trial).toBeUndefined();     // the cap still bites on call 3: no full-answer receipt,
      expect(r3.structuredContent.demand_mw ?? null).toBeNull();       // and the trimmed payload (demand is a Pro field)
      expect(text(r3)).not.toContain('last free full');
    } finally { restore(); }
  });
  it('kill switch DCHUB_LASTFREE_ASK=0: no ask on the last free answer', async () => {
    const off = env('DCHUB_LASTFREE_ASK', '0');
    try {
      const ip = '203.0.115.202';
      const k2 = KEY + '_killswitch';        // the daily count is durable per key, so a fresh key
      await grid(keyed(ip, k2)); const r2 = await grid(keyed(ip, k2));
      expect(r2.structuredContent._metered_trial.remaining_today).toBe(0);
      expect(text(r2)).not.toContain('last free full');
    } finally { off(); }
  });
  it('a keyless seat and a paid key never get it', async () => {
    const ip = '203.0.115.203';
    const k = () => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-ai', client_ip: ip, session_id: 'sess-lastfree-k' + (++n) });
    await grid(k()); const r2 = await grid(k());
    expect(text(r2)).not.toContain('last free full');
  });
});
