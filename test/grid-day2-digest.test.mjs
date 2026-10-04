// grid-day2-digest.test.mjs — day-2 lever (owner 2026-10-04, DCHUB_DAY2_DIGEST_ASK): a keyed free caller's
// FIRST full grid answer of the day offers the free weekly digest. Real handler, backend stubbed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { day2DigestLine } from '../lib/grid-sell-line.mjs';

describe('day2DigestLine (pure)', () => {
  it('names what was asked, asks for consent, points at subscribe_digest with a source, no link, no em dash', () => {
    const l = day2DigestLine({ tool: 'get_grid_intelligence', what: 'ERCOT' });
    expect(l.human).toBe('Want a free weekly email on what moves in ERCOT? Give your agent your email and DC Hub sends one confirm link, no spam, one-click unsubscribe.');
    expect(l.agent).toContain('subscribe_digest');
    expect(l.agent).toContain('source=day2_grid');
    expect(l.agent).toMatch(/consent/);
    expect(l.human + l.agent).not.toMatch(/—|https?:/);
    expect(day2DigestLine({ tool: 'get_fiber_intel', what: 'Ashburn' }).source).toBe('day2_fiber');
  });
  it('an unsafe or missing topic degrades to generic wording; other tools yield nothing', () => {
    expect(day2DigestLine({ tool: 'get_grid_intelligence', what: 'x<script>' }).human).toContain('the markets you just looked at');
    expect(day2DigestLine({ tool: 'get_grid_intelligence' }).human).toContain('the markets you just looked at');
    expect(day2DigestLine({ tool: 'rank_markets', what: 'ERCOT' })).toBeNull();
  });
});

const NEWS_URL = 'https://news.example/rss/articles/ABCDEF123?oc=5';
const BASE = 'https://backend.grid-day2.test';
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


const keyedSeat = (ip, key) => ({ api_key: key, tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: ip, session_id: 'sess-day2-' + (++n) });

describe('keyed free caller, grid calls in one UTC day', () => {
  it('call 1 carries the digest ask; call 2 (last free) carries the pack ask instead, never both', async () => {
    const restore = env('DCHUB_PAYWALL_CONTRACT', undefined);
    try {
      const ip = '203.0.115.202', key = 'dch_live_day2_fixture_key_0001';
      const r1 = await grid(keyedSeat(ip, key)), r2 = await grid(keyedSeat(ip, key));
      expect(r1.structuredContent.user_message).toBe(day2DigestLine({ tool: 'get_grid_intelligence', what: 'ERCOT' }).human);
      expect(r1.structuredContent.for_your_human).toEqual({ text: r1.structuredContent.user_message });
      expect(text(r1)).toContain('subscribe_digest');
      expect(text(r2)).not.toContain('subscribe_digest');
      expect(text(r2)).toContain('last free full');
    } finally { restore(); }
  });
  it('the kill switch removes it and leaves the answer untouched', async () => {
    const restore = env('DCHUB_DAY2_DIGEST_ASK', '0');
    try {
      const r = await grid(keyedSeat('203.0.115.203', 'dch_live_day2_fixture_key_0002'));
      expect(text(r)).not.toContain('subscribe_digest');
      expect(r.structuredContent.user_message).toBeUndefined();
    } finally { restore(); }
  });
  it('a keyless caller never gets it', async () => {
    const r = await grid(seat());
    expect(text(r)).not.toContain('subscribe_digest');
  });
});
