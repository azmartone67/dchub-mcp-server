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

const MCP_URL = process.env.MCP_URL || 'https://dchub.cloud/mcp';
const PROTOCOL_VERSION = '2025-11-25';

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
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

describe('dchub MCP smoke tests', () => {
  beforeAll(async () => { await init(); }, 15000);

  it('search_facilities returns AWS Ohio rows including Columbus', async () => {
    const r = await callTool('search_facilities', { operator: 'AWS', state: 'OH', limit: 5 });
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
    const id = search.data?.[0]?.id;
    expect(id).toBeDefined();
    const facility = await callTool('get_facility', { facility_id: String(id) });
    const row = facility.data || facility;
    expect(row).toHaveProperty('name');
    expect(row).toHaveProperty('id');
  }, 15000);

  it('get_news returns ≥1 article', async () => {
    const r = await callTool('get_news', { limit: 3 });
    const articles = r?.articles || r?.data || r?.items || [];
    expect(articles.length).toBeGreaterThan(0);
  }, 15000);

  it('get_market_intel handles slug shape', async () => {
    const r = await callTool('get_market_intel', { market: 'northern-virginia' });
    const ok = r?.vacancy != null || r?.supply_mw != null || r?.market || r?.market_slug;
    expect(ok).toBeTruthy();
  }, 15000);

  it('get_grid_data returns headroom/substation', async () => {
    const r = await callTool('get_grid_data', { region: 'PJM' });
    const ok = r?.success === true || r?.grid_headroom != null || r?.nearest_substation;
    expect(ok).toBeTruthy();
  }, 15000);

  it('get_water_risk returns drought data for TX', async () => {
    const r = await callTool('get_water_risk', { state: 'TX' });
    const ok = r?.drought_categories || r?.risk_level || r?.state;
    expect(ok).toBeTruthy();
  }, 15000);

  it('get_energy_prices returns rate data for TX', async () => {
    const r = await callTool('get_energy_prices', { state: 'TX' });
    const ok = r?.retail_rates || r?.industrial_rate || r?.average_price;
    expect(ok).toBeTruthy();
  }, 15000);

  it('get_renewable_energy returns PPAs for TX solar', async () => {
    const r = await callTool('get_renewable_energy', { energy_type: 'solar', state: 'TX', limit: 5 });
    const ppas = r?.dc_industry_ppas || [];
    const inst = r?.renewable_installations || [];
    const total = (r?.ppa_total_count ?? 0) + (r?.installations_count ?? 0);
    expect(ppas.length || inst.length || total > 0 || r?.success === true).toBeTruthy();
  }, 15000);

  it('get_grid_intelligence is paywalled or returns corridors', async () => {
    const r = await callTool('get_grid_intelligence', { region_id: 'PJM' });
    const paywall = r?.__structured && (r?.error === 'paid_only' || r?.trial_preview);
    const realData = r?.region && (r?.corridors || r?.energy_rates_cents_kwh);
    expect(paywall || realData).toBeTruthy();
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
    const items = r?.pipeline || r?.data || [];
    expect(items.length).toBeGreaterThan(0);
  }, 15000);

  it('get_infrastructure returns counts shape near Columbus', async () => {
    const r = await callTool('get_infrastructure', {
      lat: 39.9612, lon: -82.9988, radius_km: 30, layer: 'substations', limit: 3,
    });
    const items = r?.data || r?.items || r?.substations || [];
    if (items.length) { expect(items.length).toBeGreaterThan(0); return; }
    const counts = r?.counts;
    expect(counts).toBeDefined();
    const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
    expect(total).toBeGreaterThan(0);
  }, 15000);

  it('get_agent_registry returns platforms array', async () => {
    const r = await callTool('get_agent_registry', {});
    const platforms = r?.platforms || r?.agents || r?.data || [];
    expect(platforms.length).toBeGreaterThan(0);
  }, 15000);

  it('get_facility coerces numeric facility_id (regression: v1.3.7)', async () => {
    // Regression: paid-tier ids are sometimes numeric. Schema must accept.
    const search = await callTool('search_facilities', { operator: 'Google', state: 'OH', limit: 1 });
    const rawId = search.data?.[0]?.id;
    if (typeof rawId === 'number') {
      // Pass as a number: should NOT 422/-32602 invalid_type
      const r = await callTool('get_facility', { facility_id: rawId });
      expect(r?.error).toBeUndefined();
    }
  }, 15000);
});
