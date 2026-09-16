// ── Capacity Source distribution layer: dormant until listings exist ─────────
//
// Production has no listings, and GET /api/v1/listings/summary is not deployed
// yet (it 404s). Everything this layer builds must say NOTHING until that
// summary reports live listings, and must turn itself on when it does:
//   1. the summary client: states, TTL, stale-while-revalidate, the 2 s
//      timeout, and that a tool result never waits on it (fake timers);
//   2. pointers on tool results: dormant says nothing, live points only where
//      the call matches, and the placement survives each tool's outputSchema;
//   3. the session instructions: byte-identical unless live;
//   4. planner routing for buy/lease intents;
//   5. the find_capacity prompt;
//   6. the ecosystem-sync paste line;
//   7. the kill switch, across all of the above.
// Every network answer below is a fixture; nothing leaves loopback.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as L from '../lib/capacity-source-summary.mjs';
import { pasteLine, attachCapacity } from '../scripts/ecosystem-sync.mjs';
import { CAPACITY_BLURB } from '../lib/capacity-source-summary.mjs';

const BASE = 'http://127.0.0.1:1';
const SUMMARY = '/api/v1/listings/summary';
const KILL = 'DCHUB_CAPACITY_POINTERS';

// ── fixtures in the summary contract's shape ─────────────────────────────────
const market = (name, state, count, mw, types = ['powered_shell']) =>
  ({ market: name, state, country: 'US', count, mw, delivery_types: types });
const LIVE = {
  ok: true, program_status: 'live', live_count: 3, total_mw: 120,
  latest_updated_at: '2026-09-20T14:00:00+00:00', generated_at: '2026-09-21T00:00:00+00:00',
  markets: [market('Dallas', 'TX', 2, 80, ['powered_shell', 'turnkey']), market('Phoenix', 'AZ', 1, 40, ['land'])],
  delivery_types: { powered_shell: 1, turnkey: 1, land: 1 },
};
const ZERO = {
  ok: true, program_status: 'upcoming', live_count: 0, total_mw: 0, latest_updated_at: null,
  generated_at: '2026-09-21T00:00:00+00:00', markets: [], delivery_types: {},
};
// Inconsistent ON PURPOSE: markets are listed while live_count says 0. The
// dormancy guard must hold on live_count itself, not on an empty markets array
// that would make "nothing matched" true for an unrelated reason.
const ZERO_WITH_MARKETS = { ...LIVE, program_status: 'upcoming', live_count: 0 };
const CLAUSE = '3 live listings, 120 MW across Dallas and Phoenix, updated 2026-09-20';

const rankRow = (rank, slug, state, mw) => ({
  rank, market: slug, metro_slug: slug.replace(/-[a-z]{2}$/, ''), city: slug, state, country: 'US',
  total_mw: mw, facility_count: 10, operator_count: 5, value: `10 fac / ${mw} MW / 5 ops`,
});
const RANK_MATCH = { criteria: 'best_overall', region: 'us', result_count: 3,
  results: [rankRow(1, 'dallas-tx', 'TX', 1268), rankRow(2, 'phoenix-az', 'AZ', 807), rankRow(3, 'chicago-il', 'IL', 923)] };
const RANK_NO_MATCH = { criteria: 'best_overall', region: 'us', result_count: 2,
  results: [rankRow(1, 'chicago-il', 'IL', 923), rankRow(2, 'reno-nv', 'NV', 402)] };

// The calls a live Dallas + Phoenix inventory must point from, and what each
// pointer must say.
const MATCHING = [
  ['find_sites', { state: 'TX' }, { live_listings: 2, mw: 80, args: { market: 'Dallas', state: 'TX' } }],
  ['site_selection_canvas', { capacity_mw: 100, region: 'AZ' }, { live_listings: 1, mw: 40, args: { market: 'Phoenix', state: 'AZ', min_mw: 100 } }],
  ['rank_markets', {}, { live_listings: 3, mw: 120, args: {} }],
  ['get_market_intel', { market: 'dallas' }, { live_listings: 2, mw: 80, args: { market: 'Dallas', state: 'TX' } }],
  ['analyze_site', { lat: 32.78, lon: -96.8, state: 'TX', capacity_mw: 50 }, { live_listings: 2, mw: 80, args: { market: 'Dallas', state: 'TX', min_mw: 50 } }],
  ['get_market_context', { market: 'phoenix' }, { live_listings: 1, mw: 40, args: { market: 'Phoenix', state: 'AZ' } }],
];
// The same tools about places with no live listing.
const NOT_MATCHING = [
  ['find_sites', { state: 'OH' }],
  ['site_selection_canvas', { capacity_mw: 100, region: 'ERCOT' }],
  ['rank_markets', {}, RANK_NO_MATCH],
  ['get_market_intel', { market: 'northern-virginia' }],
  ['analyze_site', { lat: 39.04, lon: -77.48, state: 'VA' }],
  ['get_market_context', { market: 'dallas-fort-worth' }],
];

// ── a stubbed network that records every call ────────────────────────────────
let S, TOOLS, realFetch;
let calls = [];
let summaryAnswer = null;         // null -> 404, which is production today
let rankPayload = RANK_MATCH;
let sitesStatus = 200;            // find_sites' backend status
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

beforeAll(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let pathname = '';
    try { pathname = new URL(url).pathname; } catch { /* not a URL */ }
    calls.push({ url, pathname, headers: init.headers || {} });
    if (pathname === SUMMARY) return summaryAnswer ? summaryAnswer() : json(404, { ok: false, error: 'not_found' });
    if (pathname === '/api/v1/mcp/tools/rank_markets') return json(200, rankPayload);
    if (pathname === '/api/v1/sites/find' && sitesStatus !== 200) {
      return json(sitesStatus, { ok: false, detail: 'upstream fixture failure' });
    }
    return json(200, { ok: true, success: true });   // tool backends, telemetry, heartbeats
  };
  // server.mjs captures API_BASE at module evaluation; restore right after.
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE;
  else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);

afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => {
  calls = []; summaryAnswer = null; rankPayload = RANK_MATCH; sitesStatus = 200;
  delete process.env[KILL];
  S._capacitySummary.reset();
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env[KILL];
  S._capacitySummary.reset();
});

const SEAT = {
  api_key: 'dch_live_capacity_pointer_test', tier: 'pro', platform: 'claude',
  client_name_raw: 'claude-ai', session_id: 'sess-capacity-pointer', client_ip: '203.0.113.9',
};
async function call(name, args, seat = SEAT) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(seat, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
async function connect(srv) {
  const client = new Client({ name: 'capacity-pointer-test', version: '0' });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([srv.connect(serverT), client.connect(clientT)]);
  return client;
}
const pointerOf = (r) => (r && r.structuredContent && r.structuredContent.capacity_source)
  || (r && r._meta && r._meta['cloud.dchub/capacity_source']) || null;
const pointerLines = (r) => (r.content || [])
  .filter((c) => typeof c.text === 'string' && c.text.startsWith('Capacity Source:'));
const summaryCalls = () => calls.filter((c) => c.pathname === SUMMARY);
// The summary arrives the way production reads it: through callAPI.
async function withSummary(body, status = 200) {
  summaryAnswer = () => json(status, body);
  S._capacitySummary.arm();
  await S._capacitySummary.refresh();
  S._capacitySummary.disarm();
}
const DORMANT = [
  ['summary 404 (route not deployed)', () => withSummary({ ok: false, error: 'not_found' }, 404)],
  ['live_count 0, no markets', () => withSummary(ZERO)],
  ['live_count 0 while markets are listed', () => withSummary(ZERO_WITH_MARKETS)],
  ['a 200 whose body is off-contract', () => withSummary({ ok: true, live_count: '3', markets: LIVE.markets })],
  ['nothing cached yet', async () => {}],
];
// A schema that accepts everything the envelope does EXCEPT the pointer key.
const refusing = () => S._OUTPUT_ENVELOPE.superRefine((v, ctx) => {
  if (v && Object.prototype.hasOwnProperty.call(v, 'capacity_source')) {
    ctx.addIssue({ code: 'custom', message: 'capacity_source is not a key this schema declares' });
  }
});

// ── 1. the summary client ────────────────────────────────────────────────────
describe('summary client', () => {
  it('validates the body; anything off-contract is unknown', () => {
    expect(L.normalizeCapacitySummary(LIVE)).toMatchObject({ live_count: 3, total_mw: 120 });
    for (const bad of [null, [], { ...LIVE, ok: false }, { ...LIVE, ok: 'true' }, { ...LIVE, live_count: '3' },
      { ...LIVE, live_count: -1 }, { ...LIVE, live_count: 2.5 }]) {
      expect(L.normalizeCapacitySummary(bad), JSON.stringify(bad)).toBeNull();
    }
    const n = L.normalizeCapacitySummary({ ...LIVE, markets: [...LIVE.markets, null, { market: '', count: 1 }, { market: 'X', count: '2' }] });
    expect(n.markets.map((m) => m.market)).toEqual(['Dallas', 'Phoenix']);
  });

  it('reads the listings summary through callAPI, outside the caller\'s context', async () => {
    summaryAnswer = () => json(200, LIVE);
    S._capacitySummary.arm();
    await S._ctxALS.run(SEAT, async () => { S._capacitySummary.peek(); await S._capacitySummary.refresh(); });
    const sc = summaryCalls();
    expect(sc).toHaveLength(1);
    expect(sc[0].url.startsWith(`${BASE}${SUMMARY}`)).toBe(true);
    expect(sc[0].headers['X-API-Key']).toBeUndefined();
    expect(sc[0].headers['X-MCP-Session']).toBeUndefined();
    expect(L.isCapacityLive(S._capacitySummary.peek())).toBe(true);
    // Control: a tool call in the same seat DOES forward the key, so the
    // absence above is the context exit, not a stub that drops headers.
    calls = [];
    S._capacitySummary.disarm();
    await call('find_sites', { state: 'TX' });
    const own = calls.find((c) => c.pathname === '/api/v1/sites/find');
    expect(own && own.headers['X-API-Key']).toBe(SEAT.api_key);
  });

  it('an unarmed cache (a module import, a test) never fetches', async () => {
    expect(S._capacitySummary.peek()).toBeNull();
    await call('find_sites', { state: 'TX' });
    expect(S.createServer().server._instructions).toBe(S._INSTRUCTIONS);
    expect(summaryCalls()).toHaveLength(0);
  });

  it('5 min TTL, stale-while-revalidate, single-flight, and a stale bound', async () => {
    let t = 1_000_000;
    let n = 0;
    let body = LIVE;
    const c = L.createCapacitySummaryCache({
      fetchSummary: async () => { n += 1; return { http_status: 200, body }; },
      now: () => t, enabled: () => true,
    });
    c.arm();
    expect(c.peek()).toBeNull();                    // cold: nothing, one read started
    expect(n).toBe(1);
    await c.refresh();                              // joins the read in flight
    expect(n).toBe(1);
    expect(c.peek().live_count).toBe(3);
    t += L.CAPACITY_SUMMARY_TTL_MS - 1;
    expect(c.peek().live_count).toBe(3);            // fresh: no read
    expect(n).toBe(1);
    t += 1;
    body = ZERO;
    expect(c.peek().live_count).toBe(3);            // stale is served...
    expect(n).toBe(2);                              // ...while one refresh runs
    expect(c.peek().live_count).toBe(3);
    expect(n).toBe(2);                              // single-flight
    await c.refresh();
    expect(c.peek().live_count).toBe(0);
    c.disarm();
    t += L.CAPACITY_SUMMARY_MAX_STALE_MS + 1;
    expect(c.peek()).toBeNull();                    // too old to speak for
  });

  it('any non-200, a thrown read or a bad body replaces a good value with unknown', async () => {
    let res;
    const c = L.createCapacitySummaryCache({ fetchSummary: async () => {
      if (res instanceof Error) throw res;
      return res;
    }, enabled: () => true });
    for (const bad of [{ http_status: 404, body: { ok: false } }, { http_status: 500, body: LIVE },
      { http_status: 0, body: null }, new Error('boom'), { http_status: 200, body: { ok: true } }]) {
      res = { http_status: 200, body: LIVE };
      await c.refresh();
      expect(L.isCapacityLive(c.peek())).toBe(true);
      res = bad;
      await c.refresh();
      expect(c.peek(), String(bad && (bad.http_status ?? bad.message))).toBeNull();
      expect(c.state().status).toBe('unknown');
    }
  });

  it('a cold cache never makes a result wait: the call returns while the read is pending', async () => {
    summaryAnswer = () => new Promise(() => {});    // never answers
    S._capacitySummary.arm();
    const r = await call('find_sites', { state: 'TX' });
    expect(r.isError).toBeFalsy();
    expect(pointerOf(r)).toBeNull();
    expect(summaryCalls()).toHaveLength(1);
    expect(S._capacitySummary.state().inflight).toBe(true);
  });

  it('fake timers: a slow summary never delays a result, and the read gives up at 2 s', async () => {
    vi.useFakeTimers();
    let release;
    summaryAnswer = () => new Promise((resolve) => { release = resolve; });
    S._capacitySummary.arm();
    const base = { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true } };
    // Synchronous: the result is back before any timer or microtask can run,
    // while the summary read it started is still pending.
    const out = S._withCapacityPointer(base, 'find_sites', { state: 'TX' }, S._OUTPUT_ENVELOPE);
    expect(out).toBe(base);
    expect(out && typeof out.then).toBe('undefined');
    expect(summaryCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(L.CAPACITY_SUMMARY_TIMEOUT_MS - 1);
    expect(S._capacitySummary.state().inflight).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(S._capacitySummary.state()).toMatchObject({ status: 'unknown', inflight: false });
    release(json(200, LIVE));                      // a late answer does not revive it
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(S._capacitySummary.state().status).toBe('unknown');
    expect(S._capacitySummary.peek()).toBeNull();
  });
});

// ── 2. pointers on tool results ──────────────────────────────────────────────
describe('pointers on tool results', () => {
  it('the pointer set is exactly the six tools, all registered', () => {
    expect([...S._CAPACITY_POINTER_TOOLS].sort()).toEqual(
      ['analyze_site', 'find_sites', 'get_market_context', 'get_market_intel', 'rank_markets', 'site_selection_canvas']);
    for (const n of S._CAPACITY_POINTER_TOOLS) expect(TOOLS[n], `${n} is not registered`).toBeTruthy();
  });

  for (const [label, arrange] of DORMANT) {
    it(`dormant, ${label}: no block and no line on any matching call`, async () => {
      await arrange();
      for (const [name, args] of MATCHING) {
        rankPayload = RANK_MATCH;
        const r = await call(name, args);
        expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
        expect(pointerOf(r), name).toBeNull();
        expect(pointerLines(r), name).toEqual([]);
      }
    });
  }

  it('live: every matching call carries the block in structuredContent plus one text line', async () => {
    await withSummary(LIVE);
    for (const [name, args, want] of MATCHING) {
      rankPayload = RANK_MATCH;
      const r = await call(name, args);
      expect(r.isError, `${name}: ${JSON.stringify(r.content).slice(0, 300)}`).toBeFalsy();
      const b = r.structuredContent && r.structuredContent.capacity_source;
      expect(b, `${name}: no capacity_source in structuredContent`).toBeTruthy();
      expect(b.live_listings, name).toBe(want.live_listings);
      expect(b.mw, name).toBe(want.mw);
      expect(b.markets.length, name).toBeGreaterThan(0);
      expect(b.next_step, name).toEqual({ tool: 'source_capacity', args: want.args });
      expect(b.note, name).toBe(L.CAPACITY_POINTER_NOTE);
      expect(pointerLines(r), name).toHaveLength(1);
      expect(pointerLines(r)[0].text, name).toContain('`source_capacity');
    }
  });

  it('live: calls about other places get nothing', async () => {
    await withSummary(LIVE);
    for (const [name, args, payload] of NOT_MATCHING) {
      rankPayload = payload || RANK_MATCH;
      const r = await call(name, args);
      expect(r.isError, name).toBeFalsy();
      expect(pointerOf(r), `${name} ${JSON.stringify(args)}`).toBeNull();
      expect(pointerLines(r), name).toEqual([]);
    }
  });

  it('live: a tool outside the set, an error, or a lean platform never carries it', async () => {
    await withSummary(LIVE);
    const ok = { content: [{ type: 'text', text: '{}' }], structuredContent: { _entity: 'response' } };
    // control: the same object DOES get a pointer on a pointer tool
    expect(pointerOf(await S._withCapacityPointer(ok, 'find_sites', { state: 'TX' }, S._OUTPUT_ENVELOPE))).toBeTruthy();
    expect(await S._withCapacityPointer(ok, 'search_facilities', { state: 'TX' }, S._OUTPUT_ENVELOPE)).toBe(ok);
    const err = { ...ok, isError: true };
    expect(await S._withCapacityPointer(err, 'find_sites', { state: 'TX' }, S._OUTPUT_ENVELOPE)).toBe(err);
    const lean = await S._ctxALS.run({ ...SEAT, platform: 'chatgpt' },
      () => S._withCapacityPointer(ok, 'find_sites', { state: 'TX' }, S._OUTPUT_ENVELOPE));
    expect(lean).toBe(ok);
  });

  it('live: an upstream failure is flagged isError and never carries a pointer', async () => {
    await withSummary(LIVE);
    // Control: the same shape without the error markers DOES get a pointer.
    const ok = { content: [{ type: 'text', text: '{}' }], structuredContent: { _entity: 'response' } };
    expect(pointerOf(await S._withCapacityPointer(ok, 'find_sites', { state: 'TX' }, S._OUTPUT_ENVELOPE))).toBeTruthy();
    // Not yet flagged: _flagUpstreamError runs after the pointer step.
    const upstream = { content: [{ type: 'text', text: '{}' },],
      structuredContent: { error: 'API 503', _error_mitigation: { error_code: 'upstream_unavailable' } } };
    expect(await S._withCapacityPointer(upstream, 'find_sites', { state: 'TX' }, S._OUTPUT_ENVELOPE)).toBe(upstream);
    // Through the real dispatch chain: the backend fails, the result is flagged, no pointer.
    sitesStatus = 503;
    const r = await call('find_sites', { state: 'TX' });
    expect(r.isError, JSON.stringify(r.structuredContent).slice(0, 300)).toBe(true);
    expect(pointerOf(r)).toBeNull();
    expect(pointerLines(r)).toEqual([]);
  });

  it('the note is one sentence: a deal registration, contact exchanged only if the provider accepts', () => {
    const n = L.CAPACITY_POINTER_NOTE;
    expect(n.match(/[.!?](\s|$)/g)).toHaveLength(1);
    expect(n.endsWith('.')).toBe(true);
    expect(n).toContain('DC Hub deal registration');
    expect(n).toContain("the provider sees only your human's company name and requirement");
    expect(n).toContain('exchanged only if the provider accepts');
    // The 2026-09-14 flow is gone: DC Hub no longer introduces anyone up front.
    expect(n).not.toMatch(/makes the introduction|never shared/);
  });

  it('markets match exactly, never by prefix, and a row whose state disagrees is rejected', () => {
    const s = L.normalizeCapacitySummary(LIVE);
    const names = (q) => L.matchCapacityMarkets(s, q).map((m) => m.market);
    for (const id of ['Dallas', 'dallas', 'dallas-tx', 'Dallas, TX']) expect(names({ markets: [id] }), id).toEqual(['Dallas']);
    for (const id of ['dallas-fort-worth', 'dal', 'north-dallas', 'dallas-az']) expect(names({ markets: [id] }), id).toEqual([]);
    expect(names({ states: ['tx'] })).toEqual(['Dallas']);
    expect(names({ marketRows: [{ ids: ['phoenix'], state: 'TX' }] })).toEqual([]);
    expect(names({ marketRows: [{ ids: ['phoenix-az'], state: 'AZ' }] })).toEqual(['Phoenix']);
    const empty = L.normalizeCapacitySummary({ ...LIVE, markets: [market('Dallas', 'TX', 0, 0)] });
    expect(L.matchCapacityMarkets(empty, { states: ['TX'] })).toEqual([]);
  });
});

// ── outputSchema: a pointer must never kill a tool ────────────────────────────
describe('outputSchema', () => {
  it('control: the SDK really answers -32602 when structuredContent has a key its schema refuses', async () => {
    const srv = new McpServer({ name: 'probe', version: '0' });
    srv.registerTool('probe', { description: 'probe', inputSchema: {}, outputSchema: refusing() },
      async () => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { capacity_source: { live_listings: 1 } } }));
    const client = await connect(srv);
    const out = await client.callTool({ name: 'probe', arguments: {} }).then((r) => ({ r }), (e) => ({ e }));
    const msg = out.e ? String(out.e.message) : (out.r.isError ? JSON.stringify(out.r.content) : '');
    expect(msg).toMatch(/-32602|Output validation error/);
  });

  it('served outputSchemas of the six tools do not forbid extra keys', async () => {
    const { tools } = await (await connect(S.createServer())).listTools();
    for (const n of S._CAPACITY_POINTER_TOOLS) {
      const t = tools.find((x) => x.name === n);
      expect(t, n).toBeTruthy();
      expect(t.outputSchema && t.outputSchema.type, n).toBe('object');
      expect(t.outputSchema.additionalProperties, n).not.toBe(false);
    }
  });

  it('every touched tool: the live result, pointer included, passes its registered outputSchema over the SDK', async () => {
    await withSummary(LIVE);
    const client = await connect(S.createServer());
    for (const [name, args] of MATCHING) {
      rankPayload = RANK_MATCH;
      const out = await S._ctxALS.run(SEAT, () => client.callTool({ name, arguments: args }))
        .then((r) => ({ r }), (e) => ({ e }));
      expect(out.e, `${name}: ${out.e}`).toBeUndefined();
      expect(out.r.isError, `${name}: ${JSON.stringify(out.r.content).slice(0, 300)}`).toBeFalsy();
      expect(out.r.structuredContent.capacity_source, name).toBeTruthy();
      const v = await TOOLS[name].outputSchema.safeParseAsync(out.r.structuredContent);
      expect(v.success, `${name}: ${JSON.stringify(v.error && v.error.issues)}`).toBe(true);
    }
  });

  it('a tool whose schema refuses the key still answers, with the pointer in _meta', async () => {
    await withSummary(LIVE);
    const had = Object.prototype.hasOwnProperty.call(S._TOOL_OUTPUT_SCHEMAS, 'find_sites');
    const saved = S._TOOL_OUTPUT_SCHEMAS.find_sites;
    S._TOOL_OUTPUT_SCHEMAS.find_sites = refusing();
    try {
      const client = await connect(S.createServer());
      const out = await S._ctxALS.run(SEAT, () => client.callTool({ name: 'find_sites', arguments: { state: 'TX' } }))
        .then((r) => ({ r }), (e) => ({ e }));
      expect(out.e, String(out.e)).toBeUndefined();
      expect(out.r.isError, JSON.stringify(out.r.content).slice(0, 400)).toBeFalsy();
      expect(out.r.structuredContent.capacity_source).toBeUndefined();
      expect(out.r._meta['cloud.dchub/capacity_source'].live_listings).toBe(2);
      expect(pointerLines(out.r)).toHaveLength(1);
    } finally {
      if (had) S._TOOL_OUTPUT_SCHEMAS.find_sites = saved;
      else delete S._TOOL_OUTPUT_SCHEMAS.find_sites;
    }
  });
});

// ── 3. session instructions ──────────────────────────────────────────────────
describe('session instructions', () => {
  it('the anchor sits exactly once, inside the CAPACITY SOURCE sentence', () => {
    const i = S._INSTRUCTIONS.indexOf('CAPACITY SOURCE:');
    const j = S._INSTRUCTIONS.indexOf(L.CAPACITY_INSTR_ANCHOR);
    expect(i).toBeGreaterThan(-1);
    expect(S._INSTRUCTIONS.split(L.CAPACITY_INSTR_ANCHOR).length - 1).toBe(1);
    expect(j).toBeGreaterThan(i);
    expect(S._INSTRUCTIONS.slice(i, j)).not.toMatch(/[.!?]\s/);
  });

  for (const [label, arrange] of DORMANT) {
    it(`dormant, ${label}: initialize carries the instructions byte for byte`, async () => {
      await arrange();
      expect(S.createServer().server._instructions).toBe(S._INSTRUCTIONS);
      const client = await connect(S.createServer(null, ' TAIL'));
      expect(client.getInstructions()).toBe(`${S._INSTRUCTIONS} TAIL`);
    });
  }

  it('live: the sentence gains the clause, and removing it restores the original exactly', async () => {
    await withSummary(LIVE);
    const client = await connect(S.createServer(null, ' TAIL'));
    const ins = client.getInstructions();
    expect(ins).toContain(`each listing stamped with when it was last updated (live now: ${CLAUSE}).`);
    expect(ins.replace(` (live now: ${CLAUSE})`, '')).toBe(`${S._INSTRUCTIONS} TAIL`);
    const countTokens = (s) => (s.match(/\d[\d,+]*\s*[-_ ]?\s*tools\b/gi) || []).length;
    expect(countTokens(ins)).toBe(countTokens(S._INSTRUCTIONS));
  });

  it('the clause reads as one number set, pluralised and capped', () => {
    expect(L.capacityLiveClause(L.normalizeCapacitySummary(LIVE))).toBe(CLAUSE);
    const one = { ...LIVE, live_count: 1, total_mw: 1250.5, markets: [market('Ashburn', 'VA', 1, 1250.5)] };
    expect(L.capacityLiveClause(L.normalizeCapacitySummary(one))).toBe('1 live listing, 1,250.5 MW across Ashburn, updated 2026-09-20');
    const many = { ...LIVE, live_count: 9, markets: ['A', 'B', 'C', 'D', 'E'].map((m, i) => market(m, 'TX', 1, 10 * (5 - i))) };
    expect(L.capacityLiveClause(L.normalizeCapacitySummary(many)))
      .toBe('9 live listings, 120 MW across A, B, C and 2 more markets, updated 2026-09-20');
    expect(L.capacityLiveClause(L.normalizeCapacitySummary(ZERO_WITH_MARKETS))).toBeNull();
  });
});

// ── 4. planner routing ───────────────────────────────────────────────────────
describe('planner routing', () => {
  // [intent, class, lead, the class's own sequence before this change, source_capacity args]
  const ROUTED = [
    ['lease 40 MW powered shell in Texas', 'capacity_search', 'get_retirement_headroom',
      ['get_retirement_headroom', 'get_refined_queue', 'get_market_dcpi_rank'], { state: 'TX', min_mw: 40 }],
    ['available data center capacity to buy in Dallas by 2027', 'power_timeline', 'get_power_availability_timeline',
      ['get_power_availability_timeline', 'get_grid_intelligence', 'get_refined_queue'], { state: 'TX' }],
    ['turnkey colocation space 5 MW Phoenix', 'facility_search', 'search_facilities',
      ['search_facilities', 'get_facility'], { state: 'AZ', min_mw: 5 }],
  ];
  const CONTROLS = [
    'find 100 MW of buildable capacity near Dallas',
    'rank markets for a 200 MW AI campus',
    'who is buying data centers in Dallas',
    'lease rates for data centers in Northern Virginia',
    'how much available capacity does ERCOT have',
    'buy 100 MW of renewable power in Texas through a PPA',
    'hyperscaler leasing activity in Phoenix data centers',
    'compare Phoenix vs Columbus',
    'power availability in ERCOT for a 100 MW data center',
  ];
  const planOff = (intent, ctx = {}) => {
    process.env[KILL] = 'off';
    try { return S._planQuery(intent, ctx); } finally { delete process.env[KILL]; }
  };

  for (const [intent, cls, lead, before, args] of ROUTED) {
    it(`"${intent}" includes source_capacity; class, lead and the class's steps are unchanged`, async () => {
      const p = S._planQuery(intent, {});
      expect(p.intent_class).toBe(cls);
      expect(p.best_tool).toBe(lead);
      expect(p.recommended_sequence.map((s) => s.tool)).toEqual([...before, 'source_capacity']);
      const step = p.recommended_sequence.find((s) => s.tool === 'source_capacity');
      expect(step.args_hint).toEqual(args);
      expect(step.depends_on).toEqual([]);
      expect(p.execution_waves[0]).toContain(step.step);
      expect(p.estimated_calls).toBe(p.recommended_sequence.reduce((n, s) => n + s.estimated_calls, 0));
      const v = await TOOLS.plan_query.outputSchema.safeParseAsync(p);
      expect(v.success, JSON.stringify(v.error && v.error.issues)).toBe(true);
      // with the layer off, the plan is the one this intent got before the change
      const off = planOff(intent);
      expect(off.recommended_sequence.map((s) => s.tool)).toEqual(before);
      expect(off.best_tool).toBe(lead);
    });
  }

  it('controls: every other question plans identically with the layer on and off', () => {
    for (const intent of CONTROLS) {
      const on = S._planQuery(intent, {});
      expect(on.recommended_sequence.map((s) => s.tool), intent).not.toContain('source_capacity');
      expect(on, intent).toEqual(planOff(intent));
    }
  });

  it('an intent no class claims still gets the step, and the estimate counts it', () => {
    const p = S._planQuery('sublease a data hall', {});
    const tools = p.recommended_sequence.map((s) => s.tool);
    expect(tools).toContain('source_capacity');
    expect(p.estimated_calls).toBe(p.recommended_sequence.reduce((n, s) => n + s.estimated_calls, 0));
    expect(planOff('sublease a data hall').recommended_sequence.map((s) => s.tool)).not.toContain('source_capacity');
  });

  it('typed context wins: a typed market and state go through as typed', () => {
    const p = S._planQuery('lease a powered shell', { market: 'Dallas-Fort Worth', state: 'tx', capacity_mw: 20 });
    const step = p.recommended_sequence.find((s) => s.tool === 'source_capacity');
    expect(step.args_hint).toEqual({ state: 'TX', market: 'Dallas-Fort Worth', min_mw: 20 });
  });

  it('detection: buy/lease intents yes; grid, energy, M&A and pricing questions no', () => {
    for (const t of ['lease 40 MW powered shell in Texas', 'available data center capacity to buy in Dallas by 2027',
      'turnkey colocation space 5 MW Phoenix', 'we need to rent 10 MW in Ashburn', 'colo space for lease in Chicago',
      'purchase a turnkey data center in Atlanta', 'sublease a data hall']) {
      expect(L.capacityProcurementIntent(t), t).toBe(true);
    }
    for (const t of CONTROLS) expect(L.capacityProcurementIntent(t), t).toBe(false);
  });

  it('plan_query and execute_plan share the router this step lives in', () => {
    expect(TOOLS.plan_query.handler.toString()).toBeTruthy();
    const src = S._planQuery.toString();
    expect(src).toContain('_capacityProcurementStep(text, d,');
  });
});

// ── 5. the find_capacity prompt ──────────────────────────────────────────────
describe('find_capacity prompt', () => {
  it('prompts/list carries it: requirement required, state and min_mw optional', async () => {
    const client = await connect(S.createServer());
    const { prompts } = await client.listPrompts();
    const p = prompts.find((x) => x.name === 'find_capacity');
    expect(p, prompts.map((x) => x.name).join(',')).toBeTruthy();
    expect(Object.fromEntries((p.arguments || []).map((a) => [a.name, !!a.required])))
      .toEqual({ requirement: true, state: false, min_mw: false });
    const got = await client.getPrompt({ name: 'find_capacity',
      arguments: { requirement: '40 MW powered shell, energized by Q2 2027', state: 'Texas', min_mw: '40' } });
    const text = got.messages[0].content.text;
    expect(text).toContain('40 MW powered shell, energized by Q2 2027');
    expect(text).toContain('Call source_capacity state="TX" min_mw=40');
    expect(text).toContain('min_kw');
    expect(text).toContain("DC Hub sends the provider only your human's company name and the requirement");
    expect(text).toContain("only on acceptance are the provider's identity, site and contact shared with your human");
    expect(text).not.toContain('operator contact is never shared');
    const bare = await client.getPrompt({ name: 'find_capacity', arguments: { requirement: 'turnkey capacity' } });
    expect(bare.messages[0].content.text).toContain('1. Call source_capacity — ');
  });

  it('the kill switch removes it and nothing else', async () => {
    const on = (await (await connect(S.createServer())).listPrompts()).prompts.map((x) => x.name);
    process.env[KILL] = 'off';
    let off;
    try { off = (await (await connect(S.createServer())).listPrompts()).prompts.map((x) => x.name); }
    finally { delete process.env[KILL]; }
    expect(on).toContain('find_capacity');
    expect(on.filter((n) => n !== 'find_capacity')).toEqual(off);
  });
});

// ── 6. ecosystem-sync paste line ─────────────────────────────────────────────
describe('ecosystem-sync paste line', () => {
  const SSOT = { tools: 91, facilities: '21,800+', deals: '2,200+', markets: '300+', version: '2.12.15', packs: ['grid'] };
  const BASE_LINE = 'DC Hub: live data-center, power-grid, fiber and gas infrastructure data for AI agents. '
    + '91 MCP tools, 21,800+ facilities, 300+ markets, 2,200+ tracked deals. Remote MCP: https://dchub.cloud/mcp';

  it('control: the line exactly as it is composed without a capacity read', () => {
    expect(pasteLine({ ...SSOT })).toBe(BASE_LINE);
  });

  for (const [label, res] of [
    ['404', { ok: false, status: 404, text: '{"ok":false,"error":"not_found"}' }],
    ['transport error', { ok: false, status: 0, text: '', error: 'timeout' }],
    ['live_count 0', { ok: true, status: 200, text: JSON.stringify(ZERO) }],
    ['live_count 0 while markets are listed', { ok: true, status: 200, text: JSON.stringify(ZERO_WITH_MARKETS) }],
    ['a 200 that is not JSON', { ok: true, status: 200, text: '<html>' }],
    ['a 203 carrying a live body', { ok: true, status: 203, text: JSON.stringify(LIVE) }],
    ['no read at all', null],
  ]) {
    it(`dormant, ${label}: the source gains nothing and the line is byte-identical`, () => {
      const ssot = attachCapacity({ ...SSOT }, res);
      expect('capacity' in ssot).toBe(false);
      expect(pasteLine(ssot)).toBe(BASE_LINE);
    });
  }

  it('live: the line names the capability, the tool, the page and the listings', () => {
    const ssot = attachCapacity({ ...SSOT }, { ok: true, status: 200, text: JSON.stringify(LIVE) });
    expect(pasteLine(ssot)).toBe(
      BASE_LINE.replace(' Remote MCP:', ` ${CAPACITY_BLURB} Live now: ${CLAUSE}. Remote MCP:`));
  });

  // ★2026-09-16. The clause alone read "Capacity Source: 2 live listings,
  // 41.2 MW across Dallas-Fort Worth, updated 2026-09-16." — an inventory, and
  // nothing a reader could act on. A directory listing has to carry the way IN:
  // the tool for an agent, the page for a human.
  it('live: the reader is given a way in, not only a count', () => {
    const line = pasteLine(attachCapacity({ ...SSOT }, { ok: true, status: 200, text: JSON.stringify(LIVE) }));
    expect(line).toContain('source_capacity');
    expect(line).toContain('dchub.cloud/listings');
  });

  // The backend builds the same copy for the white-glove lane from its own
  // literal (routes/mcp_presence_crawler.py CAPACITY_SOURCE_BLURB). Two repos
  // cannot share a constant, so each pins the other's text. If you change one,
  // this fails until you change both.
  it('the blurb is byte-identical to the backend literal, and count-free', () => {
    expect(CAPACITY_BLURB).toBe(
      'Capacity Source: powered land/shell/turnkey incl. off-market listings '
      + 'via source_capacity; browse dchub.cloud/listings.');
    expect(CAPACITY_BLURB).not.toMatch(/\d/);
  });
});

// ── 7. kill switch ───────────────────────────────────────────────────────────
describe('kill switch: DCHUB_CAPACITY_POINTERS=off', () => {
  it('silences pointers, the clause, the paste line and the read itself, even while live', async () => {
    await withSummary(LIVE);
    process.env[KILL] = 'off';
    for (const [name, args] of MATCHING) {
      rankPayload = RANK_MATCH;
      const r = await call(name, args);
      expect(pointerOf(r), name).toBeNull();
      expect(pointerLines(r), name).toEqual([]);
    }
    expect(S.createServer().server._instructions).toBe(S._INSTRUCTIONS);
    expect(pasteLine(attachCapacity({ tools: 91 }, { ok: true, status: 200, text: JSON.stringify(LIVE) })))
      .not.toContain('Capacity Source');
    calls = [];
    S._capacitySummary.arm();
    expect(S._capacitySummary.peek()).toBeNull();
    await S._capacitySummary.refresh();
    expect(summaryCalls()).toHaveLength(0);
    // control: switched back on, the same cached state speaks again
    delete process.env[KILL];
    S._capacitySummary.disarm();
    expect(pointerOf(await call('find_sites', { state: 'TX' }))).toBeTruthy();
    expect(S.createServer().server._instructions).toContain('(live now: ');
  });

  it('reads the usual spellings of off, and anything else as on', () => {
    for (const v of ['off', 'OFF', ' off ', '0', 'false', 'no', 'disabled']) {
      expect(L.capacityPointersEnabled({ [KILL]: v }), v).toBe(false);
    }
    for (const v of [undefined, '', 'on', '1', 'true']) {
      expect(L.capacityPointersEnabled({ [KILL]: v }), String(v)).toBe(true);
    }
  });
});
