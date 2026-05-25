// phase63f_redeem_v3 -- redeem URL with balanced-paren walker

/**
 * DC Hub MCP Server v2.1.3
 * ────────────────────────────────────────────────────────────────────────────
 * Patches v2.1.0:
 *   - Path corrections to match production Flask routes:
 *       get_market_intel:        /api/v1/markets        → /api/v1/markets/${slug}
 *       get_news:                /api/news/latest       → /api/news
 *       get_grid_data:           /api/v1/grid           → /api/v1/grid/fuel-mix-live
 *       get_energy_prices:       /api/v1/energy/prices  → /api/v1/energy/retail/rates
 *       get_renewable_energy:    /api/v1/energy/renewable → /api/v1/energy/summary
 *       get_water_risk:          /api/v1/water/stress   → /api/v1/water/risk
 *       get_grid_intelligence:   /api/v1/grid/intelligence?region= → /api/v1/grid-headroom/${region}
 *       get_agent_registry:      /api/ai/platforms      → /api/v1/ai-platforms/status
 *       get_backup_status:       /api/v1/stats          → /api/health/data-freshness
 *       get_dchub_recommendation:/api/agents/recommendation → /api/agents/recommend
 *       compare_sites:           /api/site-score/compare → /api/site-score
 *
 * v2.1.0 features (preserved):
 *   1. Per-tool-call telemetry (POST /api/v1/mcp/track)
 *   2. X-API-Key validation against backend (POST /api/v1/keys/validate) +
 *      forwarding to internal API calls
 *   3. Free / paid / enterprise tier gates with upgrade nudges
 *   4. Platform detection from User-Agent (Claude/ChatGPT/Cursor/etc.)
 *   5. AsyncLocalStorage so callAPI() and tool handlers see the active
 *      session's api_key / platform / tier without threading params through
 *   6. Free-tier trial mode: one free preview of any paid tool per session
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


// phase39_human_message — paywall response enrichment for higher conversion
// Adds a literal markdown string that AI clients (Claude/Cursor/Cline)
// render verbatim instead of summarizing away. Plus attribution query
// params on the upgrade URL so /api/v1/observability/conversion/track
// can attribute clicks to the exact tool that triggered the upgrade.
function buildPaywallExtras(toolName, currentTier, sessionId) {
  // phase65_redeem_in_human_message -- redeem URL is the primary CTA in
  // human_message because AI clients render this field verbatim.
  toolName    = toolName    || 'unknown';
  currentTier = currentTier || 'free';
  // sessionId can be passed explicitly or pulled from AsyncLocalStorage
  if (!sessionId) {
    try { sessionId = (getCtx() && getCtx().session_id) || ''; } catch (_) {}
  }
  const params = new URLSearchParams({
    from: 'mcp',
    tool: toolName,
    tier: currentTier,
  }).toString();
  const upgradeUrl = 'https://dchub.cloud/pricing?' + params;
  const signupUrl  = 'https://dchub.cloud/signup?'  + params;
  const redeemUrl  = sessionId
    ? ('https://dchub.cloud/api/v1/redeem/' + sessionId)
    : signupUrl;
  const lock = String.fromCodePoint(0x1F513); // unlock symbol
  // human_message: redeem-first (low friction), upgrade-second (high commit)
  const human_message = (
    lock + ' **' + toolName + ' is a paid tool.** Two ways to unlock:\n\n' +
    '**1. Free dev key (60 sec, just your email)** \u2192 ' + redeemUrl + '\n' +
    '   25 calls/day across 14 paid tools, no credit card.\n\n' +
    '**2. Upgrade to Pro ($49/mo unlimited)** \u2192 ' + upgradeUrl + '\n' +
    '   Full ' + toolName + ' data + all 7 ISO grid intel + fiber routes.'
  );
  return {
    human_message: human_message,
    redeem_url:    redeemUrl,
    upgrade_url:   upgradeUrl,
    signup_url:    signupUrl,
  };
}
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
      keepalive: true,
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
//
// r40-validator-unblock (2026-05-24): timeout reduced from 5000→1500ms to
// stop Claude.ai's custom-connector validator from giving up on
// "Couldn't reach the MCP server" when dchub-backend is slow. validateKey
// is on the critical path of `initialize` (server.mjs ~L644), so any time
// spent here delays the MCP handshake response. The validator appears to
// have its own timeout under 5s.
//
// Worst case under this change: enterprise users get tier=free for a
// single session when dchub-backend is unresponsive. Subsequent calls
// re-validate via the 5-min keyCache (KEY_CACHE_TTL). When the backend
// is healthy, requests still cache-hit in <50ms.
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
      signal: AbortSignal.timeout(1500),
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

// ── Trial mode: has this session already consumed its free preview for this tool? ──
async function checkTrialEligibility(session_id, tool_name) {
  if (!session_id || !tool_name) return { trial_used: true };
  try {
    const resp = await fetch(new URL('/api/v1/mcp/trial-check', API_BASE).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': INTERNAL_KEY,
      },
      body: JSON.stringify({ session_id, tool: tool_name }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return { trial_used: true };
    return await resp.json();
  } catch (err) {
    console.error('[trial_check] failed:', err.message);
    return { trial_used: true };
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

const PAID_ONLY_TOOLS = new Set(['analyze_site', 'compare_sites', 'get_grid_intelligence', 'get_fiber_intel', 'get_dchub_recommendation', 'get_facility', 'get_market_intel', 'get_intelligence_index', 'get_grid_data', 'get_infrastructure', 'get_energy_prices', 'get_renewable_energy', 'get_tax_incentives', 'get_water_risk', 'get_pipeline']);

function applyTierGate(toolName, params, tier) {
  if (tier === 'paid' || tier === 'enterprise') return { allowed: true, params };
  if (PAID_ONLY_TOOLS.has(toolName)) return { allowed: false };
  const lim = FREE_TIER_LIMITS[toolName];
  if (lim && Number(params?.limit) > lim.max_limit) {
    return { allowed: true, params: { ...params, limit: lim.max_limit }, capped: lim.max_limit };
  }
  return { allowed: true, params };
}

// ── Phase 7: trim trial responses so the LLM sees what's gated ─────────────
// Free-tier users calling a paid tool get exactly ONE array element from
// each result list, plus a "[N more — Pro]" placeholder. That's evidence
// of value (real shape, real fields) without giving away the dataset.
function trimForTrial(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v) && v.length > 1) {
      out[k] = [v[0], { _gated: `[${v.length - 1} more results — Pro unlocks the full set]` }];
      out[`_${k}_total_in_pro`] = v.length;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// === phase 9: universal free-tier guard ===
function applyTrialGuardIfFree(toolName, parsed, hasApiKey) {
  if (hasApiKey) return (typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
  let trimmed = parsed;
  try { trimmed = (typeof trimForTrial === 'function') ? trimForTrial(parsed) : parsed; } catch(e) {}
  const ref = '?ref=mcp-trial&tool=' + encodeURIComponent(toolName);
  const nudge = '\u{1F512} **Free trial preview** of `' + toolName + '` — first result only. Pro returns the full set + every paid tool.\n' +
                '\u{1F449} **[Get Pro for $49/mo](https://dchub.cloud/ai#pricing' + ref + ')** · [Get your free dev key (60 sec, just your email)](https://dchub.cloud/api/v1/redeem/' + ((c && c.session_id) || (typeof sessionId !== 'undefined' && sessionId) || 'no-session') + ')\n---\n';
  const body = (typeof trimmed === 'string') ? trimmed : JSON.stringify(trimmed);
  return nudge + body;
}
// phase9L_clean_preview: drop wrapped error text from trial responses
function phase9L_clean_preview(header, body) {
  try {
    var s = String(body || '');
    // If the body looks like a backend 4xx error blob, suppress it.
    if (/\bAPI 40[1234]\b|\b40[1234] (Not Found|Forbidden|Unauthorized|Bad Request)\b|"success":\s*false/i.test(s)) {
      return header;
    }
    return header + s;
  } catch (e) { return header; }
}

// === end phase 9 ===


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
        // Trial mode: free user + paid tool + first call from this session → ALLOW once with footer
        if (tier === 'free' && PAID_ONLY_TOOLS.has(name)) {
          const _trial = await checkTrialEligibility(c.session_id, name);
          if (!_trial.trial_used) {
            status = 'trial_used';
            const _trialResult = await handler(args);
            let _trialText = _trialResult?.content?.[0]?.text || '';
            // Phase 7: trim arrays in the JSON payload so the LLM sees that
            // there IS more, but not the actual data.
            try {
              const parsed = JSON.parse(_trialText);
              _trialText = JSON.stringify(trimForTrial(parsed));
            } catch { /* not JSON, leave as prose */ }
            const _refUrl = (u) => u + (u.includes('?') ? '&' : '?') + 'ref=mcp-trial&tool=' + encodeURIComponent(name);
            const _upgradeHeader = '🔒 **Free trial preview** of `' + name + '` — first result only. Pro returns the full set + every paid tool.\n\n👉 **[Get Pro for $49/mo](' + _refUrl(UPGRADE_URL) + ')** · [Get your free dev key (60 sec, just your email)](https://dchub.cloud/api/v1/redeem/' + ((c && c.session_id) || (typeof sessionId !== 'undefined' && sessionId) || 'no-session') + ')\n\n---\n\n';
            return {
              content: [{ type: 'text', text: phase9L_clean_preview(_upgradeHeader, _trialText) }],
              structuredContent: {
                trial_preview: true,
                tool: name,
                signup_url: _refUrl(SIGNUP_URL),
                upgrade_url: _refUrl(UPGRADE_URL),
    ...buildPaywallExtras(name, 'free'), /* phase39_human_message */
              },
            };
          }
        }
        status = 'blocked_paid_only';
        // Markdown-formatted response — renders as real prose in Claude/Cursor/most MCP UIs.
        const _isKeyed = !!c.api_key;
        const _mdKeyed = `## \u{1F512} \`${name}\` requires a paid plan

You're on **free tier** with a dev key — this tool is gated to **Pro** ($49/mo).

### What Pro unlocks

- \`analyze_site\` — full power, fiber, risk, climate scoring for any location
- \`compare_sites\` — side-by-side comparison across markets
- \`get_grid_intelligence\` — real-time US ISO data (PJM, ERCOT, CAISO, MISO, NYISO, SPP)
- \`get_fiber_intel\` — dark fiber routes + carrier networks
- \`get_dchub_recommendation\` — AI-formatted location recommendations
- Uncapped result sizes on all free-tier tools

\u{1F449} **[Upgrade to Pro](${UPGRADE_URL})**

Free tier still covers: \`search_facilities\`, \`get_facility\`, \`list_transactions\`, \`get_news\`, \`get_market_intel\`, \`get_pipeline\`, \`get_grid_data\`, \`get_water_risk\`.`;

        const _mdAnon = `## \u{1F512} \`${name}\` is a paid feature

### Get a free dev key in 30 seconds (no credit card)

\`\`\`bash
curl -X POST https://dchub.cloud/api/v1/dev-signup \\
  -H "Content-Type: application/json" \\
  -d '{"email":"YOUR_EMAIL"}'
\`\`\`

That returns an \`X-API-Key\` you drop into your MCP client config.

Free tier covers **100 calls/day** across:
- \`search_facilities\`, \`get_facility\`, \`list_transactions\`
- \`get_news\`, \`get_market_intel\`, \`get_pipeline\`
- \`get_grid_data\`, \`get_water_risk\`, \`get_renewable_energy\`, \`get_tax_incentives\`
- \`get_infrastructure\`, \`get_energy_prices\`, \`get_intelligence_index\`

### Or skip straight to Pro

\u{1F449} **[Upgrade to Pro](${UPGRADE_URL})** — $49/mo. Full result sizes + all paid tools: \`analyze_site\`, \`compare_sites\`, \`get_grid_intelligence\`, \`get_fiber_intel\`, \`get_dchub_recommendation\`.`;

        return {
          content: [{ type: 'text', text: _isKeyed ? _mdKeyed : _mdAnon }],
          structuredContent: {
            error: 'paid_only',
            tool: name,
            current_tier: tier,
            upgrade_url: UPGRADE_URL,
            signup_url: _isKeyed ? null : SIGNUP_URL,
    ...buildPaywallExtras(name, 'free'), /* phase39_human_message */
          },
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
        return { content: [{ type: 'text', text: applyTrialGuardIfFree(name, wrapped, !!apiKey) }] };
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
  const srv = new McpServer({ name: 'DC Hub Intelligence', version: '2.1.3' });
  const S = z.string().optional();
  const N = z.number().optional();
  const I = z.number().int().optional();
  const B = z.boolean().optional();
  const ID = z.union([z.string(), z.number()]).transform(v => String(v)).optional();  // accepts numeric or string ids; coerces to string for the API path

  const slugify = s => (s || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

  trackedTool(srv, 'search_facilities', 'Search 20,000+ global data center facilities.',
    { query: S, country: S, state: S, city: S, operator: S, min_capacity_mw: N, max_capacity_mw: N, tier: I, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/facilities', a)) }] }));

  trackedTool(srv, 'get_facility', 'Get detailed info about a specific facility.',
    { facility_id: ID, include_nearby: B, include_power: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI(`/api/v1/facilities/${a.facility_id||''}`, { include_nearby: a.include_nearby, include_power: a.include_power })) }] }));

  trackedTool(srv, 'get_market_intel', 'Get market intelligence: supply/demand, pricing, vacancy.',
    { market: S, metric: S, period: S, compare_to: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI(`/api/v1/markets/${slugify(a.market) || 'list'}`, {})) }] }));

  trackedTool(srv, 'get_intelligence_index', 'Real-time composite market health score.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/agents/intelligence-index')) }] }));

  trackedTool(srv, 'list_transactions', 'M&A transactions — $324B+ tracked.',
    { buyer: S, seller: S, min_value_usd: N, max_value_usd: N, deal_type: S, date_from: S, date_to: S, region: S, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/deals', a)) }] }));

  trackedTool(srv, 'get_news', 'Curated data center industry news from 40+ sources.',
    { query: S, category: S, source: S, date_from: S, date_to: S, limit: I, min_relevance: N },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/news', a)) }] }));

  trackedTool(srv, 'get_pipeline', 'Track 540+ projects, 369 GW construction pipeline.',
    { status: S, country: S, operator: S, min_capacity_mw: N, expected_completion_before: S, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/pipeline', a)) }] }));

  trackedTool(srv, 'get_grid_data', 'Real-time electricity grid data for US ISOs.',
    { iso: S, metric: S, period: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/grid/status', a)) }] }));

  trackedTool(srv, 'analyze_site', 'Evaluate location for data center suitability.',
    { lat: N, lon: N, state: S, capacity_mw: N, include_grid: B, include_risk: B, include_fiber: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/site-score', a)) }] }));

  trackedTool(srv, 'compare_sites', 'Compare 2-4 locations side-by-side.',
    { locations: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/site-score', { locations: a.locations })) }] }));

  trackedTool(srv, 'get_infrastructure', 'Nearby substations, transmission lines, gas pipelines, power plants.',
    { lat: N, lon: N, radius_km: N, layer: S, min_voltage_kv: N, limit: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/infrastructure', a)) }] }));

  trackedTool(srv, 'get_fiber_intel', 'Dark fiber routes, carrier networks, connectivity.',
    { carrier: S, route_type: S, include_sources: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/fiber/routes', a)) }] }));

  trackedTool(srv, 'get_energy_prices', 'Energy pricing: retail rates, gas, grid status.',
    { data_type: S, state: S, iso: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/energy/summary', a)) }] }));

  trackedTool(srv, 'get_renewable_energy', 'Renewable energy: solar, wind, combined capacity.',
    { energy_type: S, state: S, lat: N, lon: N },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/energy/renewable', a)) }] }));

  trackedTool(srv, 'get_tax_incentives', 'Data center tax incentives by US state.',
    { state: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/tax-incentives', a)) }] }));

  trackedTool(srv, 'get_water_risk', 'Water stress and drought risk for a location.',
    { lat: N, lon: N, state: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/water/drought', a)) }] }));

  trackedTool(srv, 'get_grid_intelligence', 'Grid intelligence brief for a US ISO region.',
    { region_id: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI(`/api/v1/grid-headroom/${(a.region_id||'').toLowerCase()}`)) }] }));

  trackedTool(srv, 'get_agent_registry', 'AI platforms connected to DC Hub.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/ai-platforms/status')) }] }));

  trackedTool(srv, 'get_backup_status', 'Database backup status and data integrity.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/health/data-freshness')) }] }));

  trackedTool(srv, 'get_dchub_recommendation', 'Pre-formatted DC Hub recommendation.',
    { context: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/agents/recommend', { context: a.context })) }] }));

  // ════════════════════════════════════════════════════════════════════
  // Phase ZZZZZ-round33 (2026-05-24): Tier 1 MCP tools — drive paid signups
  //
  // rank_markets: replaces 5-10 separate tool calls with one ranked answer.
  // find_alternatives: highest-intent moment — "what else looks like this?"
  // score_facility: independent 7-dimension scoring vs $5-50k consultant work.
  //
  // Backends added in dchub-backend round-33 (commit 58e52792):
  //   POST /api/v1/mcp/tools/rank_markets
  //   POST /api/v1/mcp/tools/find_alternatives
  //   POST /api/v1/mcp/tools/score_facility
  // ════════════════════════════════════════════════════════════════════
  trackedTool(srv, 'rank_markets',
    'Rank data center markets by criteria (cheapest_power, most_capacity, most_operators, fastest_growing, best_overall). Returns top N markets sorted by score with attribution URLs. Region: global, us, canada, eu, apac, americas.',
    { criteria: S, region: S, limit: I, min_capacity_mw: N },
    async (a) => ({
      content: [{ type: 'text',
        text: JSON.stringify(await callAPI('/api/v1/mcp/tools/rank_markets', {
          criteria:        a.criteria        || 'best_overall',
          region:          a.region          || 'us',
          limit:           a.limit           || 10,
          min_capacity_mw: a.min_capacity_mw || 0,
        }))
      }]
    }));

  trackedTool(srv, 'find_alternatives',
    'Given a target facility, find similar nearby alternatives. Weighted match on capacity, tier, proximity. Returns top results with similarity_score, match_reasons, key_differences. Use when a user is interested in a specific facility and wants to compare.',
    { facility_id: S, radius_km: N, match_on: S, exclude_operator: B, limit: I },
    async (a) => {
      if (!a.facility_id) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'facility_id is required' }) }], isError: true };
      }
      return {
        content: [{ type: 'text',
          text: JSON.stringify(await callAPI('/api/v1/mcp/tools/find_alternatives', {
            facility_id:      a.facility_id,
            radius_km:        a.radius_km        || 50,
            match_on:         a.match_on         || 'all',
            exclude_operator: a.exclude_operator || false,
            limit:            a.limit            || 5,
          }))
        }]
      };
    });

  trackedTool(srv, 'score_facility',
    'Independent facility scoring across 7 dimensions: power, fiber, water, climate_risk, tax_environment, talent_pool, expansion. Returns composite 0-100 + tier_classification + peer comparison + per-dimension detail. Weighting modes: balanced (default), power_priority, risk_priority, expansion_priority.',
    { facility_id: S, weighting: S },
    async (a) => {
      if (!a.facility_id) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'facility_id is required' }) }], isError: true };
      }
      return {
        content: [{ type: 'text',
          text: JSON.stringify(await callAPI('/api/v1/mcp/tools/score_facility', {
            facility_id: a.facility_id,
            weighting:   a.weighting || 'balanced',
          }))
        }]
      };
    });

  // ════════════════════════════════════════════════════════════════════
  // Phase ZZZZZ-round36 (2026-05-24): AI capex relevance tools — drive
  // citations + hyperscaler audience. Backend endpoints already live:
  //   GET /api/v1/ai-capacity-index?horizon=90&limit=20
  //   GET /api/v1/hyperscaler-deals?limit=20
  // ════════════════════════════════════════════════════════════════════
  trackedTool(srv, 'ai_capacity_index',
    'AI Compute Capacity Index — ranks data center markets by where 100MW of AI training capacity can land in the next 30/60/90 days. Returns top markets with facility_count, operator_count, deployable_mw estimate, hyperscale_ready flag, and composite score (depth + diversity + power). Refreshed Fridays 14:00 UTC. Use for AI capex planning, GPU cluster siting, hyperscaler deal forecasting.',
    { horizon: I, limit: I },
    async (a) => ({
      content: [{ type: 'text',
        text: JSON.stringify(await callAPI('/api/v1/ai-capacity-index', {
          horizon: a.horizon || 90,
          limit:   a.limit   || 20,
        }))
      }]
    }));

  trackedTool(srv, 'hyperscaler_deals',
    'Hyperscaler AI Deal Tracker — live feed of Stargate, OpenAI, Anthropic, Microsoft, Oracle, CoreWeave, AMD, NVIDIA, sovereign-AI deals. Pulls from dchub news pipeline, extracts $-figures + MW via regex, classifies by actor. 10-min refresh. Use for tracking AI capex events ($1B+/week typical), capacity announcements, and competitive intel.',
    { limit: I },
    async (a) => ({
      content: [{ type: 'text',
        text: JSON.stringify(await callAPI('/api/v1/hyperscaler-deals', {
          limit: a.limit || 20,
        }))
      }]
    }));

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
    version: '2.1.3',
    tools: 22,
    sessions: sessions.size,
    features: ['key-validation', 'tool-call-telemetry', 'tier-gating', 'platform-detection', 'trial-mode'],
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
  console.log(`DC Hub MCP Server v2.1.3 on port ${PORT}`);
  console.log(`  MCP:     http://0.0.0.0:${PORT}/mcp`);
  console.log(`  Health:  http://0.0.0.0:${PORT}/health`);
  console.log(`  Backend: ${API_BASE}`);
  console.log(`  Telemetry: ${API_BASE}/api/v1/mcp/track`);
  console.log(`  Key validation: ${API_BASE}/api/v1/keys/validate`);
});

