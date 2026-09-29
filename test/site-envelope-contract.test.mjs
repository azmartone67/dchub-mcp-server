// site-envelope-contract.test.mjs — the site-scoring flow stays inside the MCP
// contract (xAI agent eval, 2026-09-28: "#1 structural gap").
//
// MEASURED live on https://dchub.cloud/mcp before this change (unkeyed seat):
//   get_composite_site_score  _entity "get_composite_site_score" — the tool
//                             NAME, not a value of the DCHubEnvelope enum
//   analyze_site / get_water_risk / get_composite_site_score  no `ok` at all
// and in this harness, before the change: an upstream 404 (unknown candidate)
// left analyze_site stamped `_entity: "site"`, and a 404 body's REST `path` /
// `suggestions` ("/api/v1/water/stress") reached the agent as raw REST hops.
//
// These run the REAL registered handlers (the whole decorator chain) under a
// real caller seat, with only the backend stubbed — the same harness as
// test/lp-pro-only.test.mjs.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { restHintToToolCall, rewriteRestHints, SITE_ENVELOPE_TOOLS } from '../lib/site-envelope.mjs';

const BASE = 'https://backend.site-envelope.test';
let S, TOOLS, realFetch;
let routes = {};

const SITE_SCORE = {
  success: true, location: { lat: 39.04, lon: -77.48, state: 'VA' },
  capacity_requested_mw: 100, overall_score: 83.7,
  scores: { power_infrastructure: 88.1, gas_pipeline_access: 71.3, fiber_connectivity: 95.4,
            market_conditions: 60.6, risk_resilience: 72.2 },
  interpretation: 'Excellent site', source: 'DC Hub Site Intelligence',
  // The shape the complaint names: a next hop that is the raw REST route.
  next_step: 'GET https://dchub.cloud/api/site-score?lat=39.1&lon=-77.5&capacity_mw=200',
  see_also: ['/api/v1/site-planner/composite-score?lat=39.04&lng=-77.48&state=VA'],
};
const COMPOSITE = {
  success: true, _entity: 'site', composite_score: 81.2, verdict: 'BUILD', confidence: 'conditional',
  coverage: { power_grid: 'validated', fiber: 'validated', water: 'validated',
              risk_resilience: 'validated', market_dcpi: 'unavailable' },
  coverage_ratio: '4/5',
};
const WATER = {
  success: true, state: 'AZ', dominant_severity: 'Severe (D2)', source: 'US Drought Monitor',
  weekly_history: [{ date: '2026-09-22' }],
};
// The catch-all 404 body shape the backend really serves (measured 2026-09-28
// on GET /api/v1/water/risk): its path and suggestions are REST routes.
const NOT_FOUND_BODY = { error: '404 Not Found', success: false, path: '/api/v1/water/drought',
  suggestions: ['/api/v1/water/stress', '/api/v1/water/summary'] };

const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let prevInternal;
beforeAll(async () => {
  prevInternal = process.env.DCHUB_INTERNAL_KEY;
  process.env.DCHUB_INTERNAL_KEY = 'site-envelope-test-internal-key';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    let p = ''; try { p = new URL(url).pathname; } catch { /* not a URL */ }
    if (routes[p]) return routes[p]();
    if (p.startsWith('/api/v1/mcp/credits/balance')) return res(200, { credits: 0, had_pack: false });
    if (p === '/api/v1/keys/validate') {
      return res(200, { valid: true, tier: 'pro', email: 'caller@example.com',
        tier_detail: { mcp_dev_keys: 'pro', users_plan: 'pro', effective: 'pro' } });
    }
    return res(200, {});
  };
  const prev = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = BASE;
  S = await import('../server.mjs');
  if (prev === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prev;
  TOOLS = S.createServer()._registeredTools;
}, 60_000);
afterAll(() => {
  globalThis.fetch = realFetch;
  if (prevInternal === undefined) delete process.env.DCHUB_INTERNAL_KEY;
  else process.env.DCHUB_INTERNAL_KEY = prevInternal;
});
beforeEach(() => {
  routes = {
    '/api/site-score': () => res(200, SITE_SCORE),
    '/api/v1/site-planner/composite-score': () => res(200, COMPOSITE),
    '/api/v1/water/drought': () => res(200, WATER),
  };
  S.keyCache.clear();
});

let seatN = 0;
const seat = (tier, key) => ({
  ...(key ? { api_key: key } : {}), tier, platform: 'claude', client_name_raw: 'claude-ai',
  client_ip: '203.0.113.' + (10 + (seatN % 200)), session_id: 'sess-site-envelope-' + (++seatN),
});
async function call(name, args, s) {
  const T = TOOLS[name];
  const parsed = await T.inputSchema.safeParseAsync(args);
  if (!parsed.success) throw new Error(`zod rejected ${name}: ${JSON.stringify(parsed.error.issues)}`);
  return S._ctxALS.run(s, () => T.handler(parsed.data, { signal: new AbortController().signal }));
}
function contentObj(r) {
  try { const p = JSON.parse((r.content || [])[0]?.text || ''); return (p && typeof p === 'object') ? p : null; }
  catch { return null; }
}
// Every string anywhere in the result that is, by itself, a site-scoring REST call.
function restHops(r) {
  const found = [];
  const walk = (v) => {
    if (typeof v === 'string') { if (restHintToToolCall(v)) found.push(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(r.structuredContent);
  walk(contentObj(r));
  return found;
}
// DCHubEnvelope _entity enum (backend ai_discovery_routes.py components.schemas).
const ENVELOPE_ENTITIES = new Set(['facility', 'market', 'grid', 'fiber', 'gas', 'deal', 'site', 'news',
  'energy', 'incentives', 'risk', 'index', 'pipeline', 'infrastructure', 'export', 'changes', 'alert',
  'meta', 'semantic_search', 'error', 'record']);

const LOC = { lat: 39.04, lon: -77.48, state: 'VA' };
const SEATS = {
  unkeyed: () => seat('anonymous', null),
  free: () => seat('free', 'dch_live_site_env_free'),
  pro: () => seat('pro', 'dch_live_site_env_pro'),
};

describe.each(Object.keys(SITE_ENVELOPE_TOOLS))('%s answers inside the DCHubEnvelope', (tool) => {
  const want = SITE_ENVELOPE_TOOLS[tool];
  it.each(Object.keys(SEATS))('%s seat: _entity is the envelope class and ok is true', async (s) => {
    const r = await call(tool, LOC, SEATS[s]());
    const sc = r.structuredContent || {};
    expect(sc._entity).toBe(want);
    expect(ENVELOPE_ENTITIES.has(sc._entity)).toBe(true);
    expect(sc.ok).toBe(true);
    const c = contentObj(r);
    if (c) { expect(c._entity).toBe(want); expect(c.ok).toBe(true); }
  });
});

describe('failures carry ok:false + _entity "error"', () => {
  it('analyze_site on an unknown candidate (backend 404)', async () => {
    routes['/api/site-score'] = () => res(404, { success: false, _entity: 'error', error: 'unknown_candidate',
      candidate_id: 'cand_nope' });
    const r = await call('analyze_site', { candidate_id: 'cand_nope' }, SEATS.pro());
    expect(r.isError).toBe(true);
    expect(r.structuredContent._entity).toBe('error');
    expect(r.structuredContent.ok).toBe(false);
    // _flagUpstreamError still reads the same error keys
    expect(r.structuredContent.error).toBe('API 404');
  });

  it('get_composite_site_score with no coordinates (handler refusal)', async () => {
    const r = await call('get_composite_site_score', {}, SEATS.pro());
    expect(r.isError).toBe(true);
    expect(r.structuredContent._entity).toBe('error');
    expect(r.structuredContent.ok).toBe(false);
  });

  it('get_water_risk on an upstream 503', async () => {
    routes['/api/v1/water/drought'] = () => res(503, { error: 'upstream down' });
    const r = await call('get_water_risk', LOC, SEATS.pro());
    expect(r.structuredContent._entity).toBe('error');
    expect(r.structuredContent.ok).toBe(false);
  });
});

describe('next hops are MCP tool calls, never a raw site-scoring REST route', () => {
  it('analyze_site: a REST next_step becomes the analyze_site call with its args', async () => {
    const r = await call('analyze_site', LOC, SEATS.pro());
    expect(restHops(r)).toEqual([]);
    const sc = r.structuredContent;
    expect(sc.next_step).toEqual({ tool: 'analyze_site', args: { lat: 39.1, lon: -77.5, capacity_mw: 200 } });
    expect(sc.see_also).toEqual([{ tool: 'get_composite_site_score', args: { lat: 39.04, lon: -77.48, state: 'VA' } }]);
  });

  it('get_water_risk: a 404 body\'s REST path/suggestions become MCP calls', async () => {
    routes['/api/v1/water/drought'] = () => res(404, NOT_FOUND_BODY);
    const r = await call('get_water_risk', LOC, SEATS.pro());
    expect(restHops(r)).toEqual([]);
    const sc = r.structuredContent;
    expect(sc.path).toEqual({ tool: 'get_water_risk', args: {} });
    expect(sc.suggestions[0]).toEqual({ tool: 'get_water_risk', args: {} });
    // A REST route with no MCP twin in this family is left as it was.
    expect(sc.suggestions[1]).toBe('/api/v1/water/summary');
  });
});

describe('restHintToToolCall — only a whole REST value is rewritten', () => {
  it('maps the site-scoring routes on the whole path', () => {
    expect(restHintToToolCall('/api/site-score?lat=1&lon=2')).toEqual({ tool: 'analyze_site', args: { lat: 1, lon: 2 } });
    expect(restHintToToolCall('/api/site-score/compare')).toEqual({ tool: 'compare_sites', args: {} });
    expect(restHintToToolCall('POST https://dchub.cloud/api/v1/site-planner/composite-score?lng=3'))
      .toEqual({ tool: 'get_composite_site_score', args: { lon: 3 } });
    expect(restHintToToolCall('/api/site-score?lat={lat}&lon={lon}')).toEqual({ tool: 'analyze_site', args: {} });
    expect(restHintToToolCall('/api/site-score?capacity_mw=100&capacity=50').args.capacity_mw).toBe(100);
  });
  it('leaves prose, other routes and other hosts alone', () => {
    expect(restHintToToolCall('call /api/site-score for the full read')).toBeNull();
    expect(restHintToToolCall('https://dchub.cloud/api/v1/keys/claim')).toBeNull();
    expect(restHintToToolCall('https://dchub.cloud/api/v1/gating-matrix')).toBeNull();
    expect(restHintToToolCall('https://example.com/api/site-score')).toBeNull();
    expect(restHintToToolCall('/api/site-scores')).toBeNull();
  });
  it('rewriteRestHints never mutates its input', () => {
    const o = { a: ['/api/site-score'] };
    const [out, n] = rewriteRestHints(o);
    expect(n).toBe(1);
    expect(o.a[0]).toBe('/api/site-score');
    expect(out.a[0]).toEqual({ tool: 'analyze_site', args: {} });
  });
});
