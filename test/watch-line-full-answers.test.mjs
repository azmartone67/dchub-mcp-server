// Watch line on full analyze_site / find_sites answers (Grok growth push item 3, owner 2026-10-13).
// A full answer carries one link-free "watch this site / market" line and structuredContent.watch_offer.
// Walls, tastes, failures, clean platforms and other tools do not; DCHUB_WATCH_LINE_V1=0 removes it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
// This file pins the copy the inner wall/retention steps build; the lean step (lib/lean-response.mjs,
// agent QA A 2026-10-20) trims it to one ask on /mcp. Off here so these guards keep testing the inner
// steps; test/lean-response.test.mjs guards the default.
process.env.DCHUB_LEAN_RESPONSES = '0';

const BASE = 'https://backend.watch-line.test';
let S, TOOLS, realFetch, prevInternal;
const SITE = { success: true, location: { lat: 39.04, lon: -77.48, state: 'VA' }, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, fiber_connectivity: 95.4, market_conditions: 60.6, risk_resilience: 72.2 },
  nearby: { facilities_100km: 685, substations_50km: 212 }, interpretation: 'Excellent site', source: 'DC Hub' };
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'watch-line-test-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const p = new URL(String(input && input.url ? input.url : input)).pathname;
    if (p === '/api/site-score') return json(SITE);
    if (p === '/api/v1/keys/validate') return json({ valid: true, tier: 'paid', email: null,
      tier_detail: { mcp_dev_keys: 'paid', users_plan: 'pro', api_key_tier: null, effective: 'paid' } });
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
  delete process.env.DCHUB_WATCH_LINE_V1;
});
beforeEach(() => { delete process.env.DCHUB_WATCH_LINE_V1; S.keyCache.clear(); });

let n = 0;
const seat = (tier, key, extra = {}) => ({ ...(key ? { api_key: key } : {}), tier, ...extra, platform: 'claude',
  client_name_raw: 'claude-ai', client_ip: '198.51.100.' + (40 + (n % 200)), session_id: 'sess-watch-line-' + (++n) });
async function call(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error('zod rejected ' + name);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
const text = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const LOC = { lat: 39.04, lon: -77.48 };

describe('_watchLineCopy', () => {
  it('site: bind_email, save_site, set_site_alert; market: bind_email, set_market_alert', () => {
    expect(S._watchLineCopy('analyze_site', false).steps).toEqual(['bind_email', 'save_site', 'set_site_alert']);
    expect(S._watchLineCopy('find_sites', false).steps).toEqual(['bind_email', 'set_market_alert']);
  });
  it('an email already bound drops bind_email; the copy has no link and no invented address', () => {
    const c = S._watchLineCopy('analyze_site', true);
    expect(c.steps).toEqual(['save_site', 'set_site_alert']);
    expect(c.text).not.toMatch(/https?:\/\//);
    expect(c.text).toContain('never guess one');
  });
});

describe('_watchLineStep', () => {
  const full = () => ({ content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true, overall_score: 80 } });
  it('only analyze_site and find_sites', () => {
    for (const t of ['get_facility', 'compare_sites', 'get_grid_data']) expect(S._watchLineStep(full(), t).structuredContent.watch_offer).toBeUndefined();
  });
  it('skips walls, tastes, errors', async () => {
    const run = (r) => S._ctxALS.run(seat('pro', 'k'), () => S._watchLineStep(r, 'analyze_site'));
    expect(run({ ...full(), structuredContent: { _wall: true, error: 'pro_required' } }).structuredContent.watch_offer).toBeUndefined();
    expect(run({ ...full(), structuredContent: { ok: true, site_teaser: { verdict: 'BUILD' } } }).structuredContent.watch_offer).toBeUndefined();
    expect(run({ ...full(), isError: true }).structuredContent.watch_offer).toBeUndefined();
  });
  it('adds the line once, never twice', () => {
    const r1 = S._ctxALS.run(seat('pro', 'k'), () => S._watchLineStep(full(), 'analyze_site'));
    expect(r1.structuredContent.watch_offer.alt).toBe('register_standing_intent');
    const r2 = S._ctxALS.run(seat('pro', 'k'), () => S._watchLineStep(r1, 'analyze_site'));
    expect(r2.content.length).toBe(r1.content.length);
  });
  it('clean platform (ChatGPT) and kill switch', () => {
    const gpt = S._ctxALS.run({ ...seat('pro', 'k'), platform: 'chatgpt' }, () => S._watchLineStep(full(), 'analyze_site'));
    expect(gpt.structuredContent.watch_offer).toBeUndefined();
    process.env.DCHUB_WATCH_LINE_V1 = '0';
    const off = S._ctxALS.run(seat('pro', 'k'), () => S._watchLineStep(full(), 'analyze_site'));
    expect(off.structuredContent.watch_offer).toBeUndefined();
  });
});

describe('wired into the real analyze_site handler', () => {
  it('a Pro full answer carries the watch line; the kill switch removes it', async () => {
    const r = await call('analyze_site', LOC, seat('pro', 'dch_live_watch_pro'));
    expect(r.structuredContent._gated).not.toBe(true);
    expect(r.structuredContent.watch_offer.steps).toContain('set_site_alert');
    expect(text(r)).toContain(S._WATCH_LINE_MARKER);
    process.env.DCHUB_WATCH_LINE_V1 = '0';
    const off = await call('analyze_site', LOC, seat('pro', 'dch_live_watch_pro2'));
    expect(off.structuredContent.watch_offer).toBeUndefined();
    expect(text(off)).not.toContain(S._WATCH_LINE_MARKER);
  });
  it('a keyless wall does not carry it', async () => {
    const r = await call('analyze_site', LOC, seat('anonymous', null));
    expect(r.structuredContent._wall).toBe(true);
    expect(r.structuredContent.watch_offer).toBeUndefined();
  });
});
