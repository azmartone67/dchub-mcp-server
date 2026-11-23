// grid-lastfree.test.mjs — fix 5 (owner 2026-10-03, DCHUB_LASTFREE_ASK): a keyed free caller's
// LAST free full get_grid_intelligence answer of the day carries one human line with the
// key-bound pack link. The answer and the caps are unchanged. Real handler, backend stubbed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lastFreeLine } from '../lib/grid-sell-line.mjs';

describe('lastFreeLine (pure)', () => {
  it('names the price, the same key, the per-pack count it was given, no em dash', () => {
    const l = lastFreeLine({ tool: 'get_grid_intelligence', link: 'https://dchub.cloud/go/c/x.y', perPack: 200 });
    expect(l.human).toBe('That was the last included full DC Hub grid brief on this key today. More full grid briefs on the same key, no subscription, one click: https://dchub.cloud/go/c/x.y');
    expect(l.agent).toMatch(/last included full get_grid_intelligence answer today/);
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
    // Owner 2026-10-31: the DCPI per-ISO aggregates (avg_constraint / avg_excess / time to power) are
    // Pro and above, so a free brief that carries them is partial and this ask does not fire on it
    // (test/dcpi-iso-aggregates-free.test.mjs). This file pins the ask on a full answer: the stub
    // returns the counts only.
    if (p === '/api/v1/dcpi/iso-comparison') {
      return json({ isos: [{ iso: 'ERCOT', market_count: 5, build_count: 3 }] });
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

describe('keyed free caller, three calls in one UTC day', () => {
  // ★ Owner 2026-11-23 (lib/paid-full-only.mjs): get_grid_intelligence is paid-full-only, so a free key gets no full
  // grid brief at all and the "last included full brief" ask (server.mjs r-lastfree-ask, grid only) has no answer to
  // ride. The old "2nd call carries the ask" case and its DCHUB_LASTFREE_ASK=0 kill-switch case pinned that path; this
  // case pins what a free key sees now: three previews, no receipt, no ask, no pack link.
  it('three grid calls on a free key: all previews, no metered receipt, no last-free ask, no /go/c pack link', async () => {
    const restore = env('DCHUB_PAYWALL_CONTRACT', undefined);
    try {
      const ip = '203.0.115.201';
      const rs = [await grid(keyed(ip)), await grid(keyed(ip)), await grid(keyed(ip))];
      for (const r of rs) {
        const sc = r.structuredContent, t = text(r);
        expect(sc.preview_is_partial).toBe(true);
        expect(sc._metered_trial).toBeUndefined();
        expect(sc.demand_mw ?? null).toBeNull();
        expect(t).not.toContain('last included full DC Hub grid brief');
        expect(t).not.toContain('last free full');
        expect(String(sc.user_message || '')).not.toContain('More full grid briefs on the same key');
        expect(JSON.stringify(sc)).not.toContain('dchub.cloud/go/c/');
      }
    } finally { restore(); }
  });
  it('a keyless seat and a paid key never get it', async () => {
    const ip = '203.0.115.203';
    const k = () => ({ tier: 'free', platform: 'claude', client_name_raw: 'claude-ai', client_ip: ip, session_id: 'sess-lastfree-k' + (++n) });
    await grid(k()); const r2 = await grid(k());
    expect(text(r2)).not.toContain('last free full');
  });
});
