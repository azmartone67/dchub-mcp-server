// capacity-pointer-size-vs-ask.test.mjs — G-1016-03 (Grok, 2026-10-16).
//
// MEASURED: analyze_site at 33.44,-112.36 with capacity_mw=50 carried the Capacity
// Source pointer "1 live listing, 2 MW, in Phoenix (AZ) match this request". The live
// summary (GET /api/v1/listings/summary, read 2026-10-16 18:48Z) holds exactly that:
// markets [{market: Phoenix, state: AZ, count: 1, mw: 2}]. buildCapacityPointer
// (lib/capacity-source-summary.mjs) matched on place only and passed the 50 MW ask
// through as next_step.args.min_mw without comparing it to anything.
//
// RULE: a market is offered against a sized ask only when its listed MW is at least
// 25% of the ask (POINTER_MIN_SHARE_OF_ASK). Unsized markets stay, named as unsized.
//
// Through the registered analyze_site handler (Pro seat, so the served answer is
// the full one and the pointer step is the only variable), every network answer a
// fixture.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as L from '../lib/capacity-source-summary.mjs';

const BASE = 'http://127.0.0.1:1';
const SUMMARY = '/api/v1/listings/summary';
const market = (name, state, count, mw, types = ['colocation']) =>
  ({ market: name, state, country: 'US', count, mw, delivery_types: types });
// The live shape on 2026-10-16.
const LIVE_PHOENIX_2MW = {
  ok: true, program_status: 'live', live_count: 1, total_mw: 2,
  latest_updated_at: '2026-10-11T20:53:05+00:00', generated_at: '2026-10-16T18:48:26+00:00',
  markets: [market('Phoenix', 'AZ', 1, 2)], delivery_types: { colocation: 1 },
};
const SITE = { lat: 33.44, lon: -112.36, state: 'AZ' };

let S, TOOLS, realFetch;
let summaryBody = LIVE_PHOENIX_2MW;
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let pathname = '';
    try { pathname = new URL(url).pathname; } catch { /* not a URL */ }
    if (!url.startsWith(BASE)) throw new Error(`network refused by test: ${url}`);
    if (pathname === SUMMARY) return json(200, summaryBody);
    if (pathname === '/api/v1/keys/validate') return json(200, { valid: true, tier: 'paid', developer_id: 'dev_size_ask', email: null, tier_detail: { users_plan: 'pro' } });
    return json(200, { ok: true, success: true });
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);

afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => { summaryBody = LIVE_PHOENIX_2MW; delete process.env.DCHUB_CAPACITY_POINTERS; S._capacitySummary.reset(); });
afterEach(() => { S._capacitySummary.reset(); });

const SEAT = {
  api_key: 'dch_live_size_vs_ask_test', tier: 'pro', platform: 'claude',
  client_name_raw: 'claude-ai', session_id: 'sess-size-vs-ask', client_ip: '203.0.113.77',
};
async function call(name, args) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(SEAT, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
async function loadSummary() {
  S._capacitySummary.arm();
  await S._capacitySummary.refresh();
  S._capacitySummary.disarm();
  expect(L.isCapacityLive(S._capacitySummary.peek())).toBe(true);
}
const pointerOf = (r) => (r && r.structuredContent && r.structuredContent.capacity_source)
  || (r && r._meta && r._meta['cloud.dchub/capacity_source']) || null;
const pointerLines = (r) => (r.content || [])
  .filter((c) => typeof c.text === 'string' && c.text.startsWith('Capacity Source:'));

describe('G-1016-03: the capacity pointer is checked against the size asked for', () => {
  it('analyze_site 33.44,-112.36 at 50 MW: the 2 MW Phoenix listing is NOT offered', async () => {
    await loadSummary();
    const r = await call('analyze_site', { ...SITE, capacity_mw: 50 });
    expect(pointerOf(r)).toBeNull();
    expect(pointerLines(r)).toHaveLength(0);
    expect(JSON.stringify(r)).not.toMatch(/2 MW,? in Phoenix/);
  });

  it('control: the same site at 5 MW (2 MW is 40% of the ask) still gets the pointer', async () => {
    await loadSummary();
    const r = await call('analyze_site', { ...SITE, capacity_mw: 5 });
    const p = pointerOf(r);
    expect(p).toMatchObject({ live_listings: 1, mw: 2, next_step: { args: { market: 'Phoenix', state: 'AZ', min_mw: 5 } } });
    expect(p.size_check).toMatchObject({ ask_mw: 5, min_share_of_ask: 0.25, markets_dropped_undersized: 0, unsized_markets: [] });
    expect(pointerLines(r)).toHaveLength(1);
  });

  it('control: no size asked, the pointer is unchanged (no size_check)', async () => {
    await loadSummary();
    const r = await call('analyze_site', { ...SITE });
    const p = pointerOf(r);
    expect(p).toMatchObject({ live_listings: 1, mw: 2 });
    expect(p.size_check).toBeUndefined();
  });

  it('the floor is 25% of the ask, inclusive; unsized markets stay and are named', () => {
    const m = (name, mw) => ({ market: name, state: 'TX', country: 'US', count: 1, mw, delivery_types: [] });
    expect(L.buildCapacityPointer([m('A', 12.4)], { minMw: 50 })).toBeNull();
    expect(L.buildCapacityPointer([m('A', 12.5)], { minMw: 50 })).not.toBeNull();
    const b = L.buildCapacityPointer([m('Small', 2), m('Big', 40), m('Unsized', null)], { minMw: 50 });
    expect(b.markets.map((x) => x.market).sort()).toEqual(['Big', 'Unsized']);
    expect(b.live_listings).toBe(2);
    expect(b.mw).toBe(40);
    expect(b.size_check).toMatchObject({ markets_dropped_undersized: 1, unsized_markets: ['Unsized'] });
  });
});
