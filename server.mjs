/**
 * DC Hub MCP Server v2.0.0 — Standalone Streamable HTTP
 * Uses official @modelcontextprotocol/sdk + Zod schemas.
 * Wraps DC Hub REST API endpoints on Railway.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';

const API_BASE = process.env.DCHUB_API_BASE || 'https://dchub-backend-production.up.railway.app';
const INTERNAL_KEY = process.env.DCHUB_INTERNAL_KEY || 'dchub-internal-sync-2026';
const PORT = parseInt(process.env.PORT || '3100', 10);

async function callAPI(path, params = {}) {
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== 0 && v !== false && v !== null && v !== undefined)
      url.searchParams.set(k, String(v));
  }
  try {
    const resp = await fetch(url.toString(), {
      headers: { 'X-Internal-Key': INTERNAL_KEY, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    if (!resp.ok) return { error: `API ${resp.status}`, detail: text.slice(0, 500) };
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 2000) }; }
  } catch (err) { return { error: err.message }; }
}

function createServer() {
  const srv = new McpServer({ name: 'DC Hub Intelligence', version: '2.0.0' });

  const S = z.string().optional();
  const N = z.number().optional();
  const I = z.number().int().optional();
  const B = z.boolean().optional();

  srv.tool('search_facilities', 'Search 20,000+ global data center facilities.',
    { query: S, country: S, state: S, city: S, operator: S, min_capacity_mw: N, max_capacity_mw: N, tier: I, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/facilities', a)) }] }));

  srv.tool('get_facility', 'Get detailed info about a specific facility.',
    { facility_id: S, include_nearby: B, include_power: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI(`/api/v1/facilities/${a.facility_id||''}`, { include_nearby: a.include_nearby, include_power: a.include_power })) }] }));

  srv.tool('get_market_intel', 'Get market intelligence: supply/demand, pricing, vacancy.',
    { market: S, metric: S, period: S, compare_to: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/markets', a)) }] }));

  srv.tool('get_intelligence_index', 'Real-time composite market health score.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/agents/intelligence-index')) }] }));

  srv.tool('list_transactions', 'M&A transactions — $324B+ tracked.',
    { buyer: S, seller: S, min_value_usd: N, max_value_usd: N, deal_type: S, date_from: S, date_to: S, region: S, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/deals', a)) }] }));

  srv.tool('get_news', 'Curated data center industry news from 40+ sources.',
    { query: S, category: S, source: S, date_from: S, date_to: S, limit: I, min_relevance: N },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/news/latest', a)) }] }));

  srv.tool('get_pipeline', 'Track 540+ projects, 369 GW construction pipeline.',
    { status: S, country: S, operator: S, min_capacity_mw: N, expected_completion_before: S, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/pipeline', a)) }] }));

  srv.tool('get_grid_data', 'Real-time electricity grid data for US ISOs.',
    { iso: S, metric: S, period: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/grid', a)) }] }));

  srv.tool('analyze_site', 'Evaluate location for data center suitability.',
    { lat: N, lon: N, state: S, capacity_mw: N, include_grid: B, include_risk: B, include_fiber: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/site-score', a)) }] }));

  srv.tool('compare_sites', 'Compare 2-4 locations side-by-side.',
    { locations: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/site-score/compare', { locations: a.locations })) }] }));

  srv.tool('get_infrastructure', 'Nearby substations, transmission lines, gas pipelines, power plants.',
    { lat: N, lon: N, radius_km: N, layer: S, min_voltage_kv: N, limit: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/infrastructure', a)) }] }));

  srv.tool('get_fiber_intel', 'Dark fiber routes, carrier networks, connectivity.',
    { carrier: S, route_type: S, include_sources: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/fiber/routes', a)) }] }));

  srv.tool('get_energy_prices', 'Energy pricing: retail rates, gas, grid status.',
    { data_type: S, state: S, iso: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/energy/prices', a)) }] }));

  srv.tool('get_renewable_energy', 'Renewable energy: solar, wind, combined capacity.',
    { energy_type: S, state: S, lat: N, lon: N },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/energy/renewable', a)) }] }));

  srv.tool('get_tax_incentives', 'Data center tax incentives by US state.',
    { state: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/tax-incentives', a)) }] }));

  srv.tool('get_water_risk', 'Water stress and drought risk for a location.',
    { lat: N, lon: N, state: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/water/stress', a)) }] }));

  srv.tool('get_grid_intelligence', 'Grid intelligence brief for a US ISO region.',
    { region_id: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/grid/intelligence', { region: a.region_id })) }] }));

  srv.tool('get_agent_registry', 'AI platforms connected to DC Hub.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/ai/platforms')) }] }));

  srv.tool('get_backup_status', 'Database backup status and data integrity.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/stats')) }] }));

  srv.tool('get_dchub_recommendation', 'Pre-formatted DC Hub recommendation.',
    { context: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/agents/recommendation', { context: a.context })) }] }));

  return srv;
}

// ── Express App ─────────────────────────────────────────
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, X-API-Key');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const sessions = new Map();

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', server: 'DC Hub MCP', version: '2.0.0', tools: 20, sessions: sessions.size });
});

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    const body = req.body;
    if (body?.method === 'initialize') {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, transport);
          console.log(`[MCP] New session: ${sid} (${sessions.size} active)`);
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };
      const mcpServer = createServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No session. Send initialize first.' }, id: body?.id || null });
  } catch (err) {
    console.error('[MCP] Error:', err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: req.body?.id || null });
  }
});

app.get('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'];
  if (sid && sessions.has(sid)) { await sessions.get(sid).handleRequest(req, res); return; }
  res.status(400).json({ error: 'No session. POST /mcp with initialize.' });
});

app.delete('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'];
  if (sid && sessions.has(sid)) { await sessions.get(sid).close(); sessions.delete(sid); res.sendStatus(200); return; }
  res.status(404).json({ error: 'Session not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DC Hub MCP Server v2.0.0 on port ${PORT}`);
  console.log(`  MCP: http://0.0.0.0:${PORT}/mcp`);
  console.log(`  API: ${API_BASE}`);
});
