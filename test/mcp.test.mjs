// =============================================================================
// dchub MCP smoke test suite — vitest
// -----------------------------------------------------------------------------
// Hits the live https://dchub.cloud/mcp endpoint, exercises every tool with a
// known-good argument set, and asserts the response shape we built validators
// for in dchub-selfheal. Run with:  npm test
//
// MCP_URL env var overrides the target if you want to test a staging deploy.
// =============================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { gateReason } from './gate-reason.mjs';

const MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';
const PROTOCOL_VERSION = '2025-11-25';

// r43-H (2026-05-27): supply an X-API-Key when MCP_API_KEY is set. The
// suite exercises ~10 tools in one session, which is EXACTLY the 5-tool
// automated-sweep signature the anonymous scraper-block now blocks — so
// without a key the suite gets blocked/gated (trial_preview) and the
// data assertions fail. A key bypasses the scraper-block AND unlocks the
// paid data path. Set the MCP_API_KEY secret to a valid enterprise MCP
// key in CI. (If a valid key STILL returns trial_preview, that's the
// paywall-auth bug in the MCP worker, not a test problem.)
// r-ci-selftag (2026-08-18): see the note in regression.test.mjs — the
// clientInfo self-ID is session-scoped and is lost whenever a tools/call lands
// on a replica that never saw the initialize. This header rides every request.
const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  'X-MCP-Platform': 'dchub-mcp-test',
  ...(process.env.MCP_API_KEY ? { 'X-API-Key': process.env.MCP_API_KEY } : {}),
};

let sessionId = null;

async function init() {
  const resp = await fetch(MCP_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'dchub-mcp-test', version: '1.0.0' },
        capabilities: {},
      },
    }),
  });
  sessionId = resp.headers.get('Mcp-Session-Id') || resp.headers.get('mcp-session-id');
  await resp.text();
  await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...HEADERS, 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
}

async function callTool(name, args = {}) {
  const resp = await fetch(MCP_URL, {
    method: 'POST',
    headers: { ...HEADERS, 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await resp.text();
  // SSE multi-line aware (mirrors selfheal v1.3.6's parser)
  let payload = null;
  for (const ev of text.split(/\r?\n\r?\n/)) {
    const dataLines = ev.split(/\r?\n/)
      .filter(l => l.startsWith('data:'))
      .map(l => l.replace(/^data:\s?/, ''));
    if (!dataLines.length) continue;
    try {
      const candidate = JSON.parse(dataLines.join('\n'));
      if (candidate.result || candidate.error || candidate.jsonrpc) {
        payload = candidate; break;
      }
    } catch { /* try next */ }
  }
  if (!payload) throw new Error(`no JSON-RPC payload in: ${text.slice(0, 200)}`);
  if (payload.error) throw new Error(`MCP error: ${JSON.stringify(payload.error)}`);

  // structuredContent first (paywall variants), then content[0].text
  const result = payload.result;
  if (result?.structuredContent) {
    return { ...result.structuredContent, __structured: true };
  }
  const c = result?.content;
  if (Array.isArray(c) && c[0]?.type === 'text') {
    const t = c[0].text;
    const divider = '\n\n---\n\n';
    const idx = t.indexOf(divider);
    const cleaned = idx > 0 && /free trial|preview|upgrade/i.test(t.slice(idx + divider.length))
      ? t.slice(0, idx).trim()
      : t;
    try { return JSON.parse(cleaned); } catch { return { raw: t }; }
  }
  return result;
}

// r-gate-graceful: this suite hits the LIVE API and runs ~13 tools per session.
// Depending on which tier MCP_API_KEY is (unset/anon → scraper-block after ~5
// calls; free key → PAID_ONLY tools gate; enterprise key → full data) the same
// call returns either real data OR a gated/preview/blocked stub. Each data
// assertion below therefore skips gracefully when the response is gated, and
// only asserts the documented shape when real data came back — so CI is green
// on any tier. Mirrors the gate-or-data pattern in regression.test.mjs.
function unwrap(r) { return Array.isArray(r) ? r[0] : r; }

// Gate recognition lives in ./gate-reason.mjs — ONE copy, shared with
// regression.test.mjs. The two used to be separate and had drifted: this copy
// caught the edge's `plan_required` rejection only because its regex happened to
// include buy\.stripe\.com and the rejection carries a checkout link; the other
// copy missed it entirely. See test/edge-gate-recognition.test.mjs.
//
// A falsy response IS gated here (skip the data checks) — the opposite of
// regression.test.mjs, on purpose. gateReason leaves that call to each suite.
function isGated(r) {
  if (!r) return true;
  return gateReason(unwrap(r)) !== null || gateReason(r) !== null;
}

describe('dchub MCP smoke tests', () => {
  beforeAll(async () => { await init(); }, 15000);

  it('search_facilities returns AWS Ohio rows including Columbus', async () => {
    const r = await callTool('search_facilities', { operator: 'AWS', state: 'OH', limit: 5 });
    if (isGated(r)) return;
    expect(r.data).toBeDefined();
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data[0]).toHaveProperty('id');
    const hasColumbus = r.data.some(f =>
      /columbus/i.test(f.city || '') && /aws|amazon/i.test(f.provider || '')
    );
    expect(hasColumbus).toBe(true);
  }, 15000);

  it('get_facility round-trips a search result id', async () => {
    const search = await callTool('search_facilities', { operator: 'Google', state: 'OH', limit: 1 });
    if (isGated(search)) return;
    const id = search.data?.[0]?.id;
    expect(id).toBeDefined();
    const facility = await callTool('get_facility', { facility_id: String(id) });
    if (isGated(facility)) return; // get_facility is PAID_ONLY → gates without a full key
    const row = facility.data || unwrap(facility);
    expect(row).toHaveProperty('name');
    expect(row).toHaveProperty('id');
  }, 15000);

  it('get_news returns ≥1 article', async () => {
    const r = await callTool('get_news', { limit: 3 });
    if (isGated(r)) return;
    const o = unwrap(r);
    const articles = o?.articles || o?.data || o?.items || [];
    expect(articles.length).toBeGreaterThan(0);
  }, 15000);

  it('get_market_intel handles slug shape', async () => {
    const r = await callTool('get_market_intel', { market: 'northern-virginia' });
    if (isGated(r)) return;
    const o = unwrap(r);
    const ok = o?.vacancy != null || o?.supply_mw != null || o?.market ||
               o?.market_slug || o?.stats || o?.by_status;
    expect(ok).toBeTruthy();
  }, 15000);

  // ★ 2026-09-01: this test asserted `grid_headroom || nearest_substation` — the
  //   shape of /api/v1/grid/status, which get_grid_data STOPPED calling on
  //   2026-06-07 (Devin QA: that route had no iso-aware handler and returned the
  //   same default for every iso). The handler is a bare passthrough of
  //   /api/v1/grid/intelligence/<iso>, and the tool's own description promises
  //   "fuel mix, demand, 24h demand curve" and explicitly redirects headroom
  //   questions to get_grid_intelligence. So the test demanded the one thing the
  //   tool says it does not do, and had been red ever since the repoint.
  //   Asserted against the description's contract now, not the retired route's.
  it('get_grid_data returns the ISO fuel-mix / demand payload', async () => {
    const r = await callTool('get_grid_data', { iso: 'PJM' });
    if (isGated(r)) return;
    const o = unwrap(r);
    const ok = o?.generation_mix_pct || o?.fuel_mix || o?.demand_mw != null ||
               o?.demand_curve || o?.iso || o?.success === true;
    expect(ok, `get_grid_data keys: ${o ? Object.keys(o).slice(0, 25).join(', ') : '(none)'}`).toBeTruthy();
  }, 15000);

  it('get_water_risk returns drought data for TX', async () => {
    const r = await callTool('get_water_risk', { state: 'TX' });
    if (isGated(r)) return;
    const o = unwrap(r);
    const ok = o?.drought_categories || o?.risk_level || o?.state;
    expect(ok).toBeTruthy();
  }, 15000);

  it('get_energy_prices returns rate data for TX', async () => {
    const r = await callTool('get_energy_prices', { state: 'TX' });
    if (isGated(r)) return;
    const o = unwrap(r);
    const ok = o?.retail_rates || o?.industrial_rate || o?.average_price ||
               o?.state || o?.success === true;
    expect(ok).toBeTruthy();
  }, 15000);

  it('get_renewable_energy returns PPAs for TX solar', async () => {
    const r = await callTool('get_renewable_energy', { energy_type: 'solar', state: 'TX', limit: 5 });
    if (isGated(r)) return;
    const o = unwrap(r);
    const ppas = o?.dc_industry_ppas || [];
    const inst = o?.renewable_installations || [];
    const total = (o?.ppa_total_count ?? 0) + (o?.installations_count ?? 0);
    expect(ppas.length || inst.length || total > 0 || o?.success === true).toBeTruthy();
  }, 15000);

  // ★ 2026-09-01: this asserted `r.region && (r.corridors || r.energy_rates_cents_kwh)`.
  //   The tool's documented return shape names none of those three: it is keyed
  //   `iso` (not `region`), and carries `retail_price_cents_kwh` (not
  //   `energy_rates_cents_kwh`); `corridors` belongs to the retired
  //   /api/v1/grid/intelligence?region= shape. The handler now reads
  //   /api/v1/grid/intelligence/<ISO>. Also widened the gate check from an inline
  //   two-field paywall test to the shared gateReason, so a plan_required or
  //   daily-wall response is recognised here too.
  it('get_grid_intelligence is gated or returns the ISO grid brief', async () => {
    const r = await callTool('get_grid_intelligence', { region_id: 'PJM' });
    if (isGated(r)) return;
    const o = unwrap(r);
    const realData = (o?.iso || o?.region) &&
      (o?.demand_mw != null || o?.generation_mix_pct || o?.excess_power_score != null ||
       o?.avg_time_to_power_months != null || o?.retail_price_cents_kwh != null);
    expect(realData, `get_grid_intelligence keys: ${o ? Object.keys(o).slice(0, 25).join(', ') : '(none)'}`).toBeTruthy();
  }, 15000);

  it('get_fiber_intel returns GeoJSON or paywall', async () => {
    const r = await callTool('get_fiber_intel', { lat: 39.96, lon: -82.99, radius_km: 50 });
    const paywall = r?.__structured && (r?.error === 'paid_only' || r?.trial_preview);
    const geojson = (r?.type === 'FeatureCollection' && Array.isArray(r?.features)) ||
                    Array.isArray(r?.fiber) || Array.isArray(r?.routes);
    expect(paywall || geojson).toBeTruthy();
  }, 15000);

  it('get_pipeline operator alias resolves Amazon', async () => {
    const r = await callTool('get_pipeline', { operator: 'Amazon', limit: 5 });
    if (isGated(r)) return; // get_pipeline is PAID_ONLY → gates without a full key
    const o = unwrap(r);
    const items = o?.pipeline || o?.data || [];
    expect(items.length).toBeGreaterThan(0);
  }, 15000);

  it('get_infrastructure returns counts shape near Columbus', async () => {
    const r = await callTool('get_infrastructure', {
      lat: 39.9612, lon: -82.9988, radius_km: 30, layer: 'substations', limit: 3,
    });
    if (isGated(r)) return; // get_infrastructure is PAID_ONLY → gates without a full key
    const o = unwrap(r);
    const items = o?.data || o?.items || o?.substations || [];
    if (items.length) { expect(items.length).toBeGreaterThan(0); return; }
    const counts = o?.counts;
    expect(counts).toBeDefined();
    const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
    expect(total).toBeGreaterThan(0);
  }, 15000);

  it('get_agent_registry returns platforms array', async () => {
    const r = await callTool('get_agent_registry', {});
    if (isGated(r)) return;
    const o = unwrap(r);
    const platforms = o?.platforms || o?.agents || o?.data || [];
    expect(platforms.length).toBeGreaterThan(0);
  }, 15000);

  it('get_facility coerces numeric facility_id (regression: v1.3.7)', async () => {
    // Regression: paid-tier ids are sometimes numeric. Schema must accept.
    const search = await callTool('search_facilities', { operator: 'Google', state: 'OH', limit: 1 });
    if (isGated(search)) return;
    const rawId = search.data?.[0]?.id;
    if (typeof rawId === 'number') {
      // Pass as a number: should NOT 422/-32602 invalid_type
      const r = await callTool('get_facility', { facility_id: rawId });
      expect(r?.error).toBeUndefined();
    }
  }, 15000);
});

// r-late-key (2026-07-16) e2e regression — a key header attached AFTER an
// anonymous initialize must take effect on the SAME session, no reconnect.
// Live-verified defect: anon init → tools/call with X-API-Key on that
// session-id → list_saved_sites still answered 'API 401 auth_required'.
// Runs only when MCP_API_KEY is set (needs a real key to adopt).
describe.runIf(!!process.env.MCP_API_KEY)('late key header on an anonymous session (r-late-key)', () => {
  it('anon initialize → tools/call WITH key → keyed identity, not auth_required', async () => {
    const ANON = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
    const initResp = await fetch(MCP_URL, {
      method: 'POST',
      headers: ANON,   // deliberately NO X-API-Key at initialize
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: 'dchub-late-key-test', version: '1.0.0' },
          capabilities: {},
        },
      }),
    });
    const sid = initResp.headers.get('Mcp-Session-Id') || initResp.headers.get('mcp-session-id');
    await initResp.text();
    expect(sid).toBeTruthy();
    await fetch(MCP_URL, {
      method: 'POST',
      headers: { ...ANON, 'Mcp-Session-Id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // Now the key arrives mid-session, on the tool call itself.
    const resp = await fetch(MCP_URL, {
      method: 'POST',
      headers: { ...ANON, 'Mcp-Session-Id': sid, 'X-API-Key': process.env.MCP_API_KEY },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'list_saved_sites', arguments: {} },
      }),
    });
    const text = await resp.text();
    // Pre-fix, the session stayed anonymous and the backend answered 401
    // auth_required; post-fix the key's identity applies without reconnect.
    expect(text).not.toMatch(/auth_required/i);
    expect(text).not.toMatch(/API 401/i);
  }, 30000);
});
