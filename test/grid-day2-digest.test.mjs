// grid-day2-digest.test.mjs — day-2 lever (owner 2026-10-04, DCHUB_DAY2_DIGEST_ASK): a keyed free caller's
// FIRST full grid answer of the day offers the free weekly digest. Real handler, backend stubbed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { day2DigestLine } from '../lib/grid-sell-line.mjs';

describe('day2DigestLine (pure)', () => {
  it('names what was asked, asks for consent, points at subscribe_digest with a source, no link, no em dash', () => {
    const l = day2DigestLine({ tool: 'get_grid_intelligence', what: 'ERCOT' });
    expect(l.human).toBe('Want a weekly email on what moves in ERCOT? Give your agent your email and DC Hub sends one confirm link, no spam, one-click unsubscribe.');
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
    if (p.includes('/fiber/')) return json({ metro: 'ashburn', routes: [{ id: 'r1', carrier: 'X', miles: 10 }], total: 1 });
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
const payload = (u) => Buffer.from(u.split('/go/c/')[1].split('.')[0], 'base64url').toString().split('|');


const keyedSeat = (ip, key) => ({ api_key: key, tier: 'free', platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: ip, session_id: 'sess-day2-' + (++n) });

async function fiber(s, args = { metro: 'ashburn' }) {
  const T = TOOLS.get_fiber_intel;
  const parsed = await T.inputSchema.safeParseAsync(args);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}

// ★ Owner 2026-11-23 (lib/paid-full-only.mjs): get_grid_intelligence is paid-full-only, so a free key's grid call is a
// preview and never the "first full answer of the day" this ask rides on. The ask still fires on get_fiber_intel, the
// other tool the day-2 lever covers, so the mechanics are pinned there; grid is pinned as never carrying it.
describe('keyed free caller, grid is a preview and never carries the day-2 ask', () => {
  it('two grid calls: both previews, neither carries the day2_grid ask nor the last-free pack ask', async () => {
    const ip = '203.0.115.204', key = 'dch_live_day2_fixture_key_0004';
    const r1 = await grid(keyedSeat(ip, key)), r2 = await grid(keyedSeat(ip, key));
    for (const r of [r1, r2]) {
      expect(r.structuredContent.preview_is_partial).toBe(true);
      expect(r.structuredContent._metered_trial).toBeUndefined();
      expect(text(r)).not.toContain('day2_grid');
      expect(text(r)).not.toContain('last included full');
      expect(r.structuredContent.user_message).not.toBe(day2DigestLine({ tool: 'get_grid_intelligence', what: 'ERCOT' }).human);
    }
  });
});

describe('keyed free caller, fiber calls in one UTC day', () => {
  it('call 1 carries the digest ask; call 2 (the last included full answer) does not', async () => {
    const ip = '203.0.115.202', key = 'dch_live_day2_fixture_key_0001';
    const r1 = await fiber(keyedSeat(ip, key)), r2 = await fiber(keyedSeat(ip, key));
    expect(r1.structuredContent._metered_trial.call).toBe(1);
    expect(r1.structuredContent.user_message).toBe(day2DigestLine({ tool: 'get_fiber_intel', what: 'ashburn' }).human);
    expect(r1.structuredContent.for_your_human).toEqual({ text: r1.structuredContent.user_message });
    expect(text(r1)).toContain('subscribe_digest');
    expect(text(r1)).toContain('day2_fiber');
    expect(text(r2)).not.toContain('day2_fiber');
  });
  it('the kill switch removes it and leaves the answer untouched', async () => {
    const restore = env('DCHUB_DAY2_DIGEST_ASK', '0');
    try {
      const r = await fiber(keyedSeat('203.0.115.203', 'dch_live_day2_fixture_key_0002'));
      expect(r.structuredContent._metered_trial.call).toBe(1);
      expect(text(r)).not.toContain('subscribe_digest');
      expect(r.structuredContent.user_message).toBeUndefined();
    } finally { restore(); }
  });
  it('a keyless caller never gets it (grid or fiber)', async () => {
    expect(text(await grid(seat()))).not.toContain('day2_grid');
    expect(text(await fiber(seat()))).not.toContain('day2_fiber');
  });
});
