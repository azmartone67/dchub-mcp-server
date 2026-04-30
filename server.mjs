/**
 * DC Hub MCP Server v2.1.0
 * ────────────────────────────────────────────────────────────────────────────
 * Patches v2.0.0:
 *   1. Per-tool-call telemetry (POST /api/v1/mcp/track)
 *   2. X-API-Key validation against backend (POST /api/v1/keys/validate) +
 *      forwarding to internal API calls
 *   3. Free / paid / enterprise tier gates with upgrade nudges
 *   4. Platform detection from User-Agent (Claude/ChatGPT/Cursor/etc.)
 *   5. AsyncLocalStorage so callAPI() and tool handlers see the active
 *      session's api_key / platform / tier without threading params through
 *
 * Backwards-compatible: clients without an X-API-Key still connect, but get
 * a 'free' tier with capped result sizes and an upgrade nudge in responses.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { z } from 'zod';

// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE      = process.env.DCHUB_API_BASE      || 'https://dchub-backend-production.up.railway.app';
const INTERNAL_KEY  = process.env.DCHUB_INTERNAL_KEY  || 'dchub-internal-sync-2026';
const PORT          = parseInt(process.env.PORT || '3100', 10);
const UPGRADE_URL   = process.env.DCHUB_UPGRADE_URL   || 'https://dchub.cloud/ai#pricing';
const SIGNUP_URL    = process.env.DCHUB_SIGNUP_URL    || 'https://dchub.cloud/ai';
const KEY_CACHE_TTL = parseInt(process.env.DCHUB_KEY_CACHE_TTL_MS || '300000', 10); // 5 min

// ── Per-request context (api_key, platform, tier, session_id) ───────────────
const ctx = new AsyncLocalStorage();
const getCtx = () => ctx.getStore() || {};

// ── Platform detection (User-Agent → canonical platform name) ───────────────
function detectPlatform(ua = '') {
  const u = (ua || '').toLowerCase();
  if (u.includes('claude'))      return 'claude';
  if (u.includes('chatgpt') || u.includes('openai-mcp')) return 'chatgpt';
  if (u.includes('copilot'))     return 'copilot';
  if (u.includes('cursor'))      return 'cursor';
  if (u.includes('gemini'))      return 'gemini';
  if (u.includes('perplexity'))  return 'perplexity';
  if (u.includes('grok'))        return 'grok';
  if (u.includes('deepseek'))    return 'deepseek';
  if (u.includes('codex'))       return 'codex';
  if (u.includes('glama'))       return 'glama';
  if (u.includes('windsurf'))    return 'windsurf';
  if (u.includes('cohere'))      return 'cohere';
  if (u.includes('meta'))        return 'meta';
  if (u.includes('you'))         return 'you';
  if (u.includes('curl') || u.includes('postman')) return 'curl';
  return 'mcp';
}

// ── Telemetry: POST every tool invocation to the backend ───────────────────
async function trackToolCall(payload) {
  try {
    await fetch(new URL('/api/v1/mcp/track', API_BASE).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': INTERNAL_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error('[track] failed:', err.message);
  }
}

// ── Key validation (cached) ────────────────────────────────────────────────
const keyCache = new Map(); // api_key → { valid, tier, exp }
async function validateKey(api_key) {
  if (!api_key) return { valid: false, tier: 'free' };
  const hit = keyCache.get(api_key);
  if (hit && hit.exp > Date.now()) return hit;
  try {
    const resp = await fetch(new URL('/api/v1/keys/validate', API_BASE).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': INTERNAL_KEY,
      },
      body: JSON.stringify({ api_key }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return cacheKey(api_key, { valid: false, tier: 'free' });
    const data = await resp.json();
    return cacheKey(api_key, {
      valid: !!data.valid,
      tier: data.tier || 'free',
      developer_id: data.developer_id || null,
      email: data.email || null,
    });
  } catch (err) {
    console.error('[validateKey] failed:', err.message);
    return { valid: false, tier: 'free' };
  }
}
function cacheKey(api_key, result) {
  const v = { ...result, exp: Date.now() + KEY_CACHE_TTL };
  keyCache.set(api_key, v);
  return v;
}

// ── Backend API helper: forwards user's API key when present ───────────────
async function callAPI(path, params = {}) {
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== 0 && v !== false && v !== null && v !== undefined)
      url.searchParams.set(k, String(v));
  }
  const c = getCtx();
  const headers = {
    'X-Internal-Key': INTERNAL_KEY,
    'Accept': 'application/json',
  };
  if (c.api_key)  headers['X-API-Key']      = c.api_key;
  if (c.platform) headers['X-MCP-Platform'] = c.platform;
  if (c.session_id) headers['X-MCP-Session'] = c.session_id;
  try {
    const resp = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(30000) });
    const text = await resp.text();
    if (!resp.ok) return { error: `API ${resp.status}`, detail: text.slice(0, 500) };
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 2000) }; }
  } catch (err) { return { error: err.message }; }
}

// ── Free-tier limits and paid-only tools ───────────────────────────────────
const FREE_TIER_LIMITS = {
  search_facilities:  { max_limit: 25 },
  list_transactions:  { max_limit: 10 },
  get_pipeline:       { max_limit: 25 },
  get_news:           { max_limit: 20 },
  get_infrastructure: { max_limit: 25 },
};
const PAID_ONLY_TOOLS = new Set([
  'analyze_site',
  'compare_sites',
  'get_grid_intelligence',
  'get_dchub_recommendation',
  'get_fiber_intel',
]);

function applyTierGate(toolName, params, tier) {
  if (tier === 'paid' || tier === 'enterprise') return { allowed: true, params };
  if (PAID_ONLY_TOOLS.has(toolName)) return { allowed: false };
  const lim = FREE_TIER_LIMITS[toolName];
  if (lim && Number(params?.limit) > lim.max_limit) {
    return { allowed: true, params: { ...params, limit: lim.max_limit }, capped: lim.max_limit };
  }
  return { allowed: true, params };
}

// ── trackedTool: wrap each srv.tool registration ───────────────────────────
function trackedTool(srv, name, description, schema, handler) {
  srv.tool(name, description, schema, async (args) => {
    const c = getCtx();
    const t0 = Date.now();
    let status = 'ok';
    const tier = c.tier || 'free';
    try {
      const gate = applyTierGate(name, args, tier);

      if (!gate.allowed) {
        status = 'blocked_paid_only';
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'paid_only',
              tool: name,
              current_tier: tier,
              message: `${name} requires a paid DC Hub developer license. ` +
                       (c.api_key
                          ? `Upgrade your key at ${UPGRADE_URL}.`
                          : `Get a free key at ${SIGNUP_URL} to try DC Hub, or upgrade to paid at ${UPGRADE_URL}.`),
              upgrade_url: UPGRADE_URL,
              signup_url: c.api_key ? null : SIGNUP_URL,
            }),
          }],
        };
      }

      const result = await handler(gate.params || args);

      if (gate.capped) {
        let parsed;
        try { parsed = JSON.parse(result.content?.[0]?.text || '{}'); } catch { parsed = {}; }
        const wrapped = {
          ...(typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { data: parsed }),
          _upgrade_notice: {
            tier,
            message: `Free tier capped results at ${gate.capped}. Upgrade for full access.`,
            upgrade_url: UPGRADE_URL,
            signup_url: c.api_key ? null : SIGNUP_URL,
          },
        };
        return { content: [{ type: 'text', text: JSON.stringify(wrapped) }] };
      }

      return result;
    } catch (err) {
      status = 'error';
      throw err;
    } finally {
      // Fire-and-forget telemetry — never block the user response on it
      trackToolCall({
        timestamp:   new Date().toISOString(),
        tool:        name,
        params:      args,
        platform:    c.platform || 'unknown',
        api_key:     c.api_key || null,
        tier,
        session_id:  c.session_id || null,
        status,
        duration_ms: Date.now() - t0,
      }).catch(() => {});
    }
  });
}

// ── Tool registrations (20 tools, all wrapped) ─────────────────────────────
function createServer() {
  const srv = new McpServer({ name: 'DC Hub Intelligence', version: '2.1.0' });

  const S = z.string().optional();
  const N = z.number().optional();
  const I = z.number().int().optional();
  const B = z.boolean().optional();

  trackedTool(srv, 'search_facilities', 'Search 20,000+ global data center facilities.',
    { query: S, country: S, state: S, city: S, operator: S, min_capacity_mw: N, max_capacity_mw: N, tier: I, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/facilities', a)) }] }));

  trackedTool(srv, 'get_facility', 'Get detailed info about a specific facility.',
    { facility_id: S, include_nearby: B, include_power: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI(`/api/v1/facilities/${a.facility_id||''}`, { include_nearby: a.include_nearby, include_power: a.include_power })) }] }));

  trackedTool(srv, 'get_market_intel', 'Get market intelligence: supply/demand, pricing, vacancy.',
    { market: S, metric: S, period: S, compare_to: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/markets', a)) }] }));

  trackedTool(srv, 'get_intelligence_index', 'Real-time composite market health score.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/agents/intelligence-index')) }] }));

  trackedTool(srv, 'list_transactions', 'M&A transactions — $324B+ tracked.',
    { buyer: S, seller: S, min_value_usd: N, max_value_usd: N, deal_type: S, date_from: S, date_to: S, region: S, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/deals', a)) }] }));

  trackedTool(srv, 'get_news', 'Curated data center industry news from 40+ sources.',
    { query: S, category: S, source: S, date_from: S, date_to: S, limit: I, min_relevance: N },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/news/latest', a)) }] }));

  trackedTool(srv, 'get_pipeline', 'Track 540+ projects, 369 GW construction pipeline.',
    { status: S, country: S, operator: S, min_capacity_mw: N, expected_completion_before: S, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/pipeline', a)) }] }));

  trackedTool(srv, 'get_grid_data', 'Real-time electricity grid data for US ISOs.',
    { iso: S, metric: S, period: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/grid', a)) }] }));

  trackedTool(srv, 'analyze_site', 'Evaluate location for data center suitability.',
    { lat: N, lon: N, state: S, capacity_mw: N, include_grid: B, include_risk: B, include_fiber: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/site-score', a)) }] }));

  trackedTool(srv, 'compare_sites', 'Compare 2-4 locations side-by-side.',
    { locations: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/site-score/compare', { locations: a.locations })) }] }));

  trackedTool(srv, 'get_infrastructure', 'Nearby substations, transmission lines, gas pipelines, power plants.',
    { lat: N, lon: N, radius_km: N, layer: S, min_voltage_kv: N, limit: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/infrastructure', a)) }] }));

  trackedTool(srv, 'get_fiber_intel', 'Dark fiber routes, carrier networks, connectivity.',
    { carrier: S, route_type: S, include_sources: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/fiber/routes', a)) }] }));

  trackedTool(srv, 'get_energy_prices', 'Energy pricing: retail rates, gas, grid status.',
    { data_type: S, state: S, iso: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/energy/prices', a)) }] }));

  trackedTool(srv, 'get_renewable_energy', 'Renewable energy: solar, wind, combined capacity.',
    { energy_type: S, state: S, lat: N, lon: N },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/energy/renewable', a)) }] }));

  trackedTool(srv, 'get_tax_incentives', 'Data center tax incentives by US state.',
    { state: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/tax-incentives', a)) }] }));

  trackedTool(srv, 'get_water_risk', 'Water stress and drought risk for a location.',
    { lat: N, lon: N, state: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/water/stress', a)) }] }));

  trackedTool(srv, 'get_grid_intelligence', 'Grid intelligence brief for a US ISO region.',
    { region_id: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/grid/intelligence', { region: a.region_id })) }] }));

  trackedTool(srv, 'get_agent_registry', 'AI platforms connected to DC Hub.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/ai/platforms')) }] }));

  trackedTool(srv, 'get_backup_status', 'Database backup status and data integrity.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/stats')) }] }));

  trackedTool(srv, 'get_dchub_recommendation', 'Pre-formatted DC Hub recommendation.',
    { context: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/agents/recommendation', { context: a.context })) }] }));

  return srv;
}

// ── Express ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, X-API-Key');
  res.setHeader('Access-Control-Expose-Headers','Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const sessions    = new Map(); // sessionId → transport
const sessionMeta = new Map(); // sessionId → { api_key, platform, tier, developer_id }

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'DC Hub MCP',
    version: '2.1.0',
    tools: 20,
    sessions: sessions.size,
    features: ['key-validation', 'tool-call-telemetry', 'tier-gating', 'platform-detection'],
  });
});

// Lightweight stats endpoint for our own dashboard
app.get('/internal/sessions', (req, res) => {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) return res.sendStatus(403);
  const out = [];
  for (const [sid, meta] of sessionMeta.entries()) {
    out.push({ sid, ...meta, api_key: meta.api_key ? `${meta.api_key.slice(0,6)}…` : null });
  }
  res.json({ count: out.length, sessions: out });
});

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    const userAgent = req.headers['user-agent'] || '';
    const apiKey    = req.headers['x-api-key']
                   || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
                   || null;

    // Existing session — reuse meta
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId);
      const meta = sessionMeta.get(sessionId) || {};
      return ctx.run({ ...meta, session_id: sessionId }, async () => {
        await transport.handleRequest(req, res, req.body);
      });
    }

    const body = req.body;
    if (body?.method === 'initialize') {
      const platform   = detectPlatform(userAgent);
      const validation = await validateKey(apiKey);
      const tier       = validation.valid ? validation.tier : 'free';

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, transport);
          sessionMeta.set(sid, {
            api_key: apiKey,
            platform,
            tier,
            developer_id: validation.developer_id,
            email: validation.email,
          });
          console.log(`[MCP] init sid=${sid.slice(0,8)} platform=${platform} tier=${tier} key=${apiKey ? apiKey.slice(0,6) + '…' : 'none'} active=${sessions.size}`);
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) { sessions.delete(sid); sessionMeta.delete(sid); }
      };
      const mcpServer = createServer();
      await mcpServer.connect(transport);

      return ctx.run({ api_key: apiKey, platform, tier, session_id: null }, async () => {
        await transport.handleRequest(req, res, body);
      });
    }

    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'No session. Send initialize first.' },
      id: body?.id || null,
    });
  } catch (err) {
    console.error('[MCP] Error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id: req.body?.id || null,
      });
    }
  }
});

app.get('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'];
  if (sid && sessions.has(sid)) {
    const meta = sessionMeta.get(sid) || {};
    return ctx.run({ ...meta, session_id: sid }, async () => {
      await sessions.get(sid).handleRequest(req, res);
    });
  }
  res.status(400).json({ error: 'No session. POST /mcp with initialize.' });
});

app.delete('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'];
  if (sid && sessions.has(sid)) {
    await sessions.get(sid).close();
    sessions.delete(sid);
    sessionMeta.delete(sid);
    return res.sendStatus(200);
  }
  res.status(404).json({ error: 'Session not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DC Hub MCP Server v2.1.0 on port ${PORT}`);
  console.log(`  MCP:     http://0.0.0.0:${PORT}/mcp`);
  console.log(`  Health:  http://0.0.0.0:${PORT}/health`);
  console.log(`  Backend: ${API_BASE}`);
  console.log(`  Telemetry: ${API_BASE}/api/v1/mcp/track`);
  console.log(`  Key validation: ${API_BASE}/api/v1/keys/validate`);
});
