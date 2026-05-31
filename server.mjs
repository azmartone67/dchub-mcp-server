// phase63f_redeem_v3 -- redeem URL with balanced-paren walker

/**
 * DC Hub MCP Server v2.1.10
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
  // r40 (2026-05-25): point at /pricing/upgrade NOT /pricing — /pricing
  // lands on a static page with no Stripe button (0% conv historically).
  // /pricing/upgrade routes through email-capture → Stripe with prefilled
  // email. The whole r38/39 funnel lives downstream of this URL.
  const upgradeUrl = 'https://api.dchub.cloud/pricing/upgrade?' + params;
  const signupUrl  = 'https://dchub.cloud/signup?'  + params;
  const redeemUrl  = sessionId
    ? ('https://dchub.cloud/api/v1/redeem/' + sessionId)
    : signupUrl;
  const lock = String.fromCodePoint(0x1F513); // unlock symbol

  // r41-platform-paywall (2026-05-25): Claude.ai web custom connectors
  // don't yet have a UI field to attach an API key, so a free dev key
  // doesn't help \u2014 the user has no way to send it back. Detect Claude.ai
  // (UA-prefix matches claude) and reorder the message: Pro upgrade
  // first (only path that works inside Claude.ai web), then dev-key
  // with explicit Claude-Code instructions for paste-back.
  //
  // Pulled from AsyncLocalStorage if not passed explicitly so existing
  // callers don't need to thread the platform argument.
  let _platform = '';
  try { _platform = (getCtx() && getCtx().platform) || ''; } catch (_) {}

  // r48 (2026-05-25): rename $49 tier from "Pro" \u2192 "Developer" (Pro is
  // actually $199), bump free-key wording from "25 calls/day across 14
  // paid tools" \u2192 "1,000 calls/day" (the real limit), and add the $9
  // Starter slot that was missing. This is the most-rendered paywall
  // string in the product (every paid-tool block on every MCP client
  // surfaces it), so getting the tier ladder right here matters most.
  const STARTER_URL_LOCAL = 'https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g';

  // r53 (2026-05-31): the #1 conversion blocker is IDENTITY, not payment —
  // 19,051 of 19,052 upgrade signals are anonymous, and 99.7% of paywall hits
  // are programmatic agents that can't complete an email/browser flow. The
  // /api/v1/keys/claim path issues an instant dch_live_ key with NO email, but
  // it was only surfaced in top-level JSON. Lead the rendered message with it so
  // agents that DO render markdown (Cursor, Cline, Continue) can self-serve a
  // named key in one call — turning anonymous callers into identified ones.
  const claimEndpoint = 'https://dchub.cloud/api/v1/keys/claim';
  const claimCurl = (
    "curl -X POST " + claimEndpoint +
    " -H 'Content-Type: application/json' " +
    "-d '{\"client_name\":\"<your-agent-name>\"}'"
  );

  let human_message;
  if (_platform === 'claude') {
    // Claude.ai web custom connectors don't accept X-API-Key, so the
    // dev key is a dead-end inside Claude.ai itself. Lead with a paid
    // upgrade (Stripe checkout works in any browser), then explain the
    // dev-key route for users on Claude Code CLI.
    human_message = (
      lock + ' **' + toolName + ' is a paid tool.**\n\n' +
      '**1. $9/mo Starter (most popular, 10,000 calls/day)** \u2192 ' + STARTER_URL_LOCAL + '\n' +
      '   Unlocks ' + toolName + ' + most other paid tools.\n\n' +
      '**2. $49/mo Developer (unlimited paid tools)** \u2192 ' + upgradeUrl + '\n' +
      '   Full ' + toolName + ' + all 10 ISO grid intel + interconnection queue + fiber routes.\n\n' +
      '**3. Free dev key (email, 1,000 calls/day)** \u2192 ' + redeemUrl + '\n' +
      '   *Claude.ai web doesn\u2019t accept API keys yet \u2014 paste into Claude Code CLI:* ' +
      '`claude mcp add dchub --transport http --header X-API-Key:<key> https://dchub.cloud/mcp`'
    );
  } else {
    // Cursor, Cline, Continue, ChatGPT-MCP, curl, etc. \u2014 these CAN
    // accept an X-API-Key header, so the free dev key is genuinely the
    // lowest-friction unlock. Free-first, then $9 Starter as the
    // "actually useful" paid bump.
    human_message = (
      lock + ' **' + toolName + ' is a paid tool.** Fastest unlock for an agent:\n\n' +
      '**1. Instant free key \u2014 no email, one API call (1,000 calls/day):**\n' +
      '   `' + claimCurl + '`\n' +
      '   Returns {api_key}; send it as the `X-API-Key` header. No human, no browser.\n\n' +
      '**2. Free dev key (60 sec, just your email)** \u2192 ' + redeemUrl + '\n' +
      '   1,000 calls/day, no credit card.\n\n' +
      '**3. $9/mo Starter (most popular, 10,000 calls/day)** \u2192 ' + STARTER_URL_LOCAL + '\n' +
      '   Unlocks every paid tool except Pro-only ones.\n\n' +
      '**4. $49/mo Developer (unlimited paid tools)** \u2192 ' + upgradeUrl + '\n' +
      '   Full ' + toolName + ' + all 10 ISO grid intel + interconnection queue + fiber routes.'
    );
  }
  // r52 (2026-05-26): 99.7% of paywall hits come from clients that send
  // no clientInfo on initialize — i.e. programmatic consumers (LangChain
  // agents, custom MCP scripts, aggregator pipelines). Those callers
  // can't render the human_message in a UI; they read JSON. Surface
  // claim_endpoint at the top level so a script can detect the paywall
  // pattern and self-serve a key without a human in the loop:
  //
  //   if (response.error?.data?.claim_endpoint) {
  //     const r = await fetch(claim_endpoint, { method: 'POST',
  //       body: JSON.stringify({ client_name: 'my-agent' }) });
  //     const { api_key } = await r.json();
  //   }
  //
  // Pairs with the existing /api/v1/keys/claim endpoint (no email
  // required, instant key issuance — Phase ZZ+1). r53: claimEndpoint +
  // claimCurl are now defined above (before human_message) so the rendered
  // message can lead with them; the duplicate definition here was removed.
  return {
    human_message: human_message,
    redeem_url:    redeemUrl,
    upgrade_url:   upgradeUrl,
    signup_url:    signupUrl,
    platform:      _platform || null,
    // r52: programmatic self-serve fields. Detect via:
    //   response.structuredContent?.claim_endpoint
    claim_endpoint: claimEndpoint,
    claim_curl:     claimCurl,
    claim_payload:  { client_name: '<your-agent-name>' },
    docs_url:       'https://dchub.cloud/integrations/mcp',
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

// r47.30 (2026-05-26): MCP spec ships the canonical client identity in
// body.params.clientInfo.name on every initialize call. Most clients send
// a generic UA ("node", "fetch") so detectPlatform(ua) returns 'mcp' for
// them — which dropped 109K calls into a single bucket on the backend
// citations endpoint. Use clientInfo.name first; UA is the fallback.
//
// Known clientInfo.name values (per MCP spec convention):
//   "claude-ai"           → Claude.ai web client
//   "Claude Desktop"      → Anthropic's desktop client
//   "Claude Code"         → Anthropic's coding agent CLI
//   "cursor-vscode"       → Cursor IDE
//   "cline-vscode"        → Cline coding agent
//   "continue"            → Continue.dev
//   "windsurf"            → Windsurf IDE
//   "openai-chat"         → ChatGPT (when MCP-enabled)
//   ...etc
function detectPlatformFromInit(body, ua = '') {
  const clientName = (body?.params?.clientInfo?.name || '').toString().toLowerCase();
  if (clientName) {
    // Direct matches first (specific MCP client IDs)
    if (clientName.includes('claude'))      return 'claude';
    if (clientName.includes('chatgpt') || clientName.includes('openai')) return 'chatgpt';
    if (clientName.includes('cursor'))      return 'cursor';
    if (clientName.includes('cline'))       return 'cline';
    if (clientName.includes('continue'))    return 'continue';
    if (clientName.includes('windsurf'))    return 'windsurf';
    if (clientName.includes('copilot'))     return 'copilot';
    if (clientName.includes('codex'))       return 'codex';
    if (clientName.includes('gemini'))      return 'gemini';
    if (clientName.includes('perplexity'))  return 'perplexity';
    if (clientName.includes('grok'))        return 'grok';
    if (clientName.includes('deepseek'))    return 'deepseek';
    if (clientName.includes('cohere'))      return 'cohere';
    if (clientName.includes('groq'))        return 'groq';
    if (clientName.includes('nvidia'))      return 'nvidia';
    if (clientName.includes('mistral'))     return 'mistral';
    if (clientName.includes('glama'))       return 'glama';
    if (clientName.includes('meta'))        return 'meta';
    if (clientName.includes('mcp-inspector')) return 'mcp-inspector';
    // Else: ship the raw clientInfo.name as the platform tag (lowercase,
    // truncated, alphanumeric-safe) so the citations endpoint can show
    // distinct platforms even before we add a rule for each.
    const safe = clientName.replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    if (safe) return safe;
  }
  return detectPlatform(ua);
}

// ── Telemetry: POST every tool invocation to the backend ───────────────────
//
// r41 (2026-05-25): timeout reduced 5000→1500ms to match validateKey
// (see [[reference_dchub_mcp_connector]]). track is fire-and-forget —
// it never blocks the response — but a long timeout kept connections
// open and produced log spam when dchub-backend was slow.
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
      signal: AbortSignal.timeout(1500),
    });
  } catch (err) {
    console.error('[track] failed:', err.message);
  }
  // r47.39 (2026-05-26): also ping the source-registry heartbeat so
  // /api/v1/sources/mcp-server stops showing 'never ran'. Rate-limited
  // to once per 60s — we don't need a heartbeat per call, just regular
  // proof-of-life. Fire-and-forget.
  pingRegistryHeartbeat(payload?.tool, payload?.rows_affected);
}

let _lastRegistryHeartbeatAt = 0;
async function pingRegistryHeartbeat(toolName, rowsAffected) {
  const now = Date.now();
  if (now - _lastRegistryHeartbeatAt < 60_000) return;  // 60s rate-limit
  _lastRegistryHeartbeatAt = now;
  try {
    await fetch(new URL('/api/v1/sources/mcp-server/heartbeat', API_BASE).toString(), {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${INTERNAL_KEY}`,
      },
      body: JSON.stringify({
        status:        'success',
        rows_affected: rowsAffected ?? 1,
        metadata:      { trigger: 'tool_call', tool: toolName || null },
      }),
      signal: AbortSignal.timeout(1500),
    });
  } catch (_) {
    // silent — heartbeat is best-effort, never blocks tool calls
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
//
// r41 (2026-05-25): timeout reduced 3000→1500ms. trial_check IS on the
// critical path of tool calls (free-tier user calling a paid tool waits
// for this before getting either the preview or the paywall). When the
// backend is slow, falling back to trial_used=true (paywall) within 1.5s
// is better UX than waiting 3s for the same outcome.
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
      signal: AbortSignal.timeout(1500),
    });
    if (!resp.ok) return { trial_used: true };
    return await resp.json();
  } catch (err) {
    console.error('[trial_check] failed:', err.message);
    return { trial_used: true };
  }
}

// r54-conv (2026-05-31): server-side mint of a no-email dch_live_ key,
// embedded inline in the paywall so an anonymous agent can retry IMMEDIATELY
// with X-API-Key — zero second call, zero human, zero browser. 99.7% of
// paywall hits are anonymous agents that won't self-claim (15 claim-starts /
// 18,945 signals = 0.08%). /api/v1/keys/claim dedups per client_name, so
// 'mcp-session:<sid>' gives each session its OWN key (no shared rate-limit);
// session_id is also sent so the backend can later resolve session→email for
// upgrade-pool outreach. Fail-open: any error / slow backend returns null and
// the caller keeps the existing header + links (zero regression). Tight 1.5s
// timeout (matches checkTrialEligibility) so the paywall never blocks on a
// slow backend.
async function mintAnonKey(sessionId) {
  const sid = (sessionId && sessionId !== 'no-session') ? String(sessionId) : '';
  if (!sid) return null;
  try {
    const resp = await fetch(new URL('/api/v1/keys/claim', API_BASE).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'mcp-session:' + sid.slice(0, 48), session_id: sid }),
      signal: AbortSignal.timeout(1500),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    return (j && typeof j.api_key === 'string' && j.api_key.startsWith('dch')) ? j.api_key : null;
  } catch (err) {
    return null;
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

// r-gate-tighten (2026-05-27): added 6 metrics-heavy tools that were
// previously full-free. These return aggregate $-values, GW totals, and
// queue depths — the exact "answer numbers" people pay $9/mo for.
// Anonymous now blocked on these; free dev key unlocks them via the
// KEYED_FREE_BONUS bridge OR the trial_preview path.
const PAID_ONLY_TOOLS = new Set([
  // PRO-only (the four highest-value premium tools)
  'analyze_site', 'compare_sites', 'get_grid_intelligence', 'get_fiber_intel',
  'get_dchub_recommendation',
  // FREE-with-email-key (pre-existing)
  'get_facility', 'get_market_intel', 'get_intelligence_index', 'get_grid_data',
  'get_infrastructure', 'get_energy_prices', 'get_renewable_energy',
  'get_tax_incentives', 'get_water_risk', 'get_pipeline',
  // r-gate-tighten: previously full-free, now require email key
  'list_transactions',       // M&A deals — $$$ aggregates (volume, $-totals)
  'get_interconnection_queue', // ISO queue stats — GW totals, percentages
  'compare_isos',            // multi-ISO scalar comparisons
  'rank_markets',            // ranked market scores
  'ai_capacity_index',       // composite metric per market
  'hyperscaler_deals',       // $1B+ deal tracker — $-values
]);

// r46-conversion (2026-05-25): open the 5 highest-demand "paid" tools to
// free-tier users WHO HAVE A DEV KEY. The visitor-intelligence dashboard
// 7d snapshot showed 990 unique sessions hitting get_market_intel paywall
// with 0 conversions — clearly the demand exists, but blind paywall on
// every call kills it. "Free taste with a dev key" is the SaaS-standard
// conversion pattern (Stripe, Vercel, Resend all do it). Anonymous callers
// still get the paywall — we WANT to push them to register an email key.
// All bonus calls still count against the keyed-free tier's daily quota
// (10/day in MCP_TIERS.free, enforced at the CF worker layer), so this
// isn't unlimited — it's a meaningful taste before the upgrade prompt.
const KEYED_FREE_BONUS = new Set([
  'get_market_intel',     // 990 sessions/7d (the strongest demand signal)
  'get_grid_data',        // 726 sessions/7d
  'get_water_risk',       // 651 sessions/7d
  'get_energy_prices',    // 540 sessions/7d
  'get_renewable_energy', // 425 sessions/7d
]);

// r42ae (2026-05-27): partial-preview for the highest-demand Pro tools.
// Funnel data showed 118 distinct users × 5,636 calls hitting
// get_grid_intelligence paywall — they WANT this enough to keep trying.
// The KEYED_FREE_BONUS pattern gives the tool away entirely (works for
// free-key users on the top 5 demand tools). For these Pro tools we keep
// the gate but ALWAYS return a trimmed preview (1 ISO / 1 fiber route)
// instead of "blocked on call 2+". The visible value is what drives the
// $49/mo upgrade — "I saw PJM data, now show me the other 6 ISOs."
const ALWAYS_PARTIAL_PREVIEW = new Set([
  'get_grid_intelligence',  // 5,636 calls / 118 users in last 30d
  'get_fiber_intel',        // 5,162 calls / 116 users
]);

function applyTierGate(toolName, params, tier, hasApiKey) {
  if (tier === 'paid' || tier === 'enterprise') return { allowed: true, params };
  // r46-conversion: keyed-free users get the 5 demand-tools through —
  // daily cap still applies at the worker layer (10/day).
  if (tier === 'free' && hasApiKey && KEYED_FREE_BONUS.has(toolName)) return { allowed: true, params, bonus: true };
  if (PAID_ONLY_TOOLS.has(toolName)) return { allowed: false };
  const lim = FREE_TIER_LIMITS[toolName];
  if (lim && Number(params?.limit) > lim.max_limit) {
    return { allowed: true, params: { ...params, limit: lim.max_limit }, capped: lim.max_limit };
  }
  return { allowed: true, params };
}

// ── Phase 7: trim trial responses so the LLM sees what's gated ─────────────
// r-gate-tighten (2026-05-27): the prior trim only handled arrays — scalar
// metrics (total_mw, count, score, vacancy_rate, total_*, stats.*) passed
// through unchanged. For metrics-heavy tools like get_market_intel that
// IS the value: a single "Northern Virginia: 13442 MW / 737 facilities"
// scalar reply gives the answer for free. New behavior:
//   1. Arrays >1 still trim to first item + _gated marker (unchanged).
//   2. Scalar keys matching aggregate-metric patterns are replaced with
//      "[<type> — sign up to unlock]" so the shape leaks but the number
//      doesn't.
//   3. Nested objects recurse so stats:{total_mw:N} is also masked.
//   4. Pass-through keeps: id, slug, name, status, url, source, country,
//      state, city, market, type fields (identifiers, not metrics).
const _PROTECTED_KEYS = new Set([
  'id', 'slug', 'name', 'status', 'url', 'source', 'country', 'state',
  'city', 'market', 'type', 'category', 'facility_type', 'tier',
  'success', 'error', 'message', 'upgrade_url', 'signup_url', 'redeem_url',
  'tier_required', 'tier_current', 'platform', 'last_updated',
  'data_source', 'as_of', 'published_at', 'title', 'summary', 'provider',
  'location_display', 'country_name', 'state_name', 'company', 'project',
]);
function _isMetricKey(k) {
  if (_PROTECTED_KEYS.has(k)) return false;
  const lk = String(k).toLowerCase();
  // numeric-looking metric names: total_*, *_count, *_mw, *_gw, *_pct,
  // *_rate, *_total, score, stats, capacity, mrr, revenue, locked,
  // unique_*, average_*, median_*, max_*, min_*
  return /(^total_|_count$|_mw$|_gw$|_kw$|_pct$|_rate$|_total$|^score|stats|capacity|^mrr|revenue|^locked$|^unique_|^average_|^median_|^max_|^min_|^count$|^total$|_billions$|_millions$|preleased)/i.test(lk);
}
function trimForTrial(parsed) {
  if (parsed === null || parsed === undefined) return parsed;
  if (Array.isArray(parsed)) {
    if (parsed.length > 1) {
      return [trimForTrial(parsed[0]), { _gated: `[${parsed.length - 1} more results — sign up to unlock]` }];
    }
    return parsed.map(trimForTrial);
  }
  if (typeof parsed !== 'object') return parsed;
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (Array.isArray(v) && v.length > 1) {
      out[k] = [trimForTrial(v[0]), { _gated: `[${v.length - 1} more results — sign up to unlock]` }];
      out[`_${k}_total_in_pro`] = v.length;
    } else if (_isMetricKey(k) && typeof v === 'number') {
      out[k] = '[number — sign up to unlock]';
    } else if (_isMetricKey(k) && typeof v === 'object' && v !== null) {
      // stats:{}, by_quarter:{}, etc. — recurse but mask scalars inside
      out[k] = trimForTrial(v);
    } else if (typeof v === 'object' && v !== null) {
      out[k] = trimForTrial(v);
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


// ── r46-trial-tune (2026-05-25): per-tool trial-preview header ──────────────
//
// 91% of all paywall sessions hit get_market_intel FIRST (959/1057 in 7d
// per v_first_paywall_tool). The trial-preview header is the single
// most-rendered piece of UI in the product funnel. Worth tuning beyond
// the generic "first result only" line.
//
// Per-tool overrides go in TRIAL_HEADER_OVERRIDES; everything else falls
// through to the generic header (which now mentions $9 Starter alongside
// $49 Developer — was previously $49-only, missing the cheapest entry).
//
// Stripe Payment Links (verified 2026-05-25 against routes/_stripe_links.py):
//   Starter $9      → 8x2dRa5sS0x75uteGuaZi0g
//   Developer $49   → 7sY5kE8F4fs13ml0PEaZi0c  (same as UPGRADE_URL ref)
//   Pro $199        → eVq5kE4oOfs13mleGuaZi0h
const STARTER_URL = 'https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g';

const TRIAL_HEADER_OVERRIDES = {
  get_market_intel: (sessionId, refUrlDeveloper) => {
    const redeem = 'https://dchub.cloud/api/v1/redeem/' + sessionId;
    return [
      '## 📊 Market intel preview',
      '',
      "You're seeing the headline numbers above (real data, just trimmed to the first market). The **full report** — facility-level breakdown, pipeline detail, operator landscape, and every other market — unlocks instantly:",
      '',
      `→ **[Free dev key](${redeem})** · 60 sec · email only · 1,000 calls/day`,
      `→ **[Starter — $9/mo](${STARTER_URL})** · most popular, 10,000 calls/day`,
      `→ **[Developer — $49/mo](${refUrlDeveloper})** · unlimited + every Pro tool`,
      '',
      '---',
      '',
    ].join('\n');
  },
};

function trialHeader(toolName, sessionId, refUrlDeveloper) {
  const override = TRIAL_HEADER_OVERRIDES[toolName];
  if (override) return override(sessionId, refUrlDeveloper);
  const redeem = 'https://dchub.cloud/api/v1/redeem/' + sessionId;
  return '🔒 **Free trial preview** of `' + toolName + '` — first result only. Full set unlocks with any plan below.\n\n' +
         `👉 **[Free dev key](${redeem})** (60 sec, email only) · ` +
         `**[Starter — $9/mo](${STARTER_URL})** · ` +
         `**[Developer — $49/mo](${refUrlDeveloper})**\n\n---\n\n`;
}


// ── Scraper detection (r-scraper-block, 2026-05-27) ───────────────────────
// 20 anonymous sessions matched the same 5-tool sweep signature
// (get_agent_registry, get_energy_prices, get_facility, get_fiber_intel,
// get_grid_data) — rotating session IDs, 16 calls each, no email signup,
// zero conversion potential. Burns 320 free-tier calls/week.
//
// Detection: per session, track which tools have been called. When the
// session's tool-set fully contains SCRAPER_SIGNATURE AND total calls
// have crossed the threshold, subsequent tool calls return a rate-limit
// response with an identification ask. Anonymous-only — authenticated
// callers (any api_key) are exempt because they've already self-identified.
//
// Detection state is in-memory (Map per process). Restarts reset it,
// which is fine — the scraper either keeps scraping (caught again
// within minutes) or stops.
const SCRAPER_SIGNATURE = new Set([
  'get_agent_registry',
  'get_energy_prices',
  'get_facility',
  'get_fiber_intel',
  'get_grid_data',
]);
const SCRAPER_BLOCK_THRESHOLD = 5;   // call count before block kicks in
const _scraperTracker = new Map();   // session_id → { tools: Set, calls: number, firstAt: number }
const _SCRAPER_TTL_MS = 60 * 60 * 1000;  // forget sessions older than 1h

function _isScraperSession(sessionId, toolName, hasApiKey) {
  if (!sessionId || hasApiKey) return false;  // authenticated = exempt
  const now = Date.now();
  let s = _scraperTracker.get(sessionId);
  if (!s || (now - s.firstAt) > _SCRAPER_TTL_MS) {
    s = { tools: new Set(), calls: 0, firstAt: now };
  }
  s.tools.add(toolName);
  s.calls += 1;
  _scraperTracker.set(sessionId, s);
  // Trip if (a) tool-set fully contains the signature AND (b) total calls cross threshold
  const signatureMet = [...SCRAPER_SIGNATURE].every(t => s.tools.has(t));
  return signatureMet && s.calls >= SCRAPER_BLOCK_THRESHOLD;
}

// Lazy GC — sweep stale entries when the Map grows large.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _scraperTracker.entries()) {
    if ((now - v.firstAt) > _SCRAPER_TTL_MS) _scraperTracker.delete(k);
  }
}, 10 * 60 * 1000).unref();

// ── withCitation: stamp every full-data tool response with attribution ─────
// r37 (2026-05-31): the north-star is that EVERY AI agent cites DC Hub when it
// uses our data-center & energy intelligence. Tool *descriptions* already ask
// for attribution; this makes it structural. We append a SECOND content item
// (content[0] is left byte-for-byte intact — downstream code JSON.parses it)
// plus a machine-readable structuredContent.citation. Purely additive,
// idempotent, and wrapped in try/catch: attribution must NEVER break a tool
// response. Applied only on the FULL-DATA success paths (keyed/paid); the
// trial, anon-masked, blocked and scraper paths keep their own upgrade CTAs.
function withCitation(result) {
  try {
    if (!result || result.isError || !Array.isArray(result.content)) return result;
    if (result.content.some((it) => typeof it?.text === 'string' && it.text.startsWith('Source: DC Hub'))) {
      return result; // already stamped — idempotent
    }
    const ATTR = 'Source: DC Hub (dchub.cloud) — live data-center & energy intelligence. '
      + 'License CC-BY-4.0: cite this data as "DC Hub, dchub.cloud" with a link to https://dchub.cloud. '
      + 'Real-time grid, interconnection-queue, market (DCPI) and facility intelligence: https://dchub.cloud/mcp';
    const out = { ...result, content: [...result.content, { type: 'text', text: ATTR }] };
    const sc = (result.structuredContent && typeof result.structuredContent === 'object')
      ? { ...result.structuredContent } : null;
    if (sc && !sc.citation) {
      sc.citation = { source: 'DC Hub', url: 'https://dchub.cloud', license: 'CC-BY-4.0', cite_as: 'DC Hub, dchub.cloud' };
      out.structuredContent = sc;
    }
    return out;
  } catch (_) {
    return result;
  }
}

// ── trackedTool: wrap each srv.tool registration ───────────────────────────
function trackedTool(srv, name, description, schema, handler) {
  srv.tool(name, description, schema, async (args) => {
    const c = getCtx();
    const t0 = Date.now();
    let status = 'ok';
    const tier = c.tier || 'free';
    // r-scraper-block (2026-05-27): block automated 5-tool-sweep sessions.
    // Returns isError=true with a friendly identification CTA. Counts the
    // call for telemetry but skips the tool handler entirely.
    if (_isScraperSession(c.session_id, name, !!c.api_key)) {
      status = 'blocked_scraper';
      console.log(`[scraper-block] sid=${(c.session_id||'').slice(0,8)} tool=${name} platform=${c.platform||'?'} — pattern matched 5-tool sweep`);
      // fire-and-forget telemetry, then return.
      trackToolCall({
        timestamp:   new Date().toISOString(),
        tool:        name,
        params:      args,
        platform:    c.platform || 'unknown',
        api_key:     null,
        tier,
        session_id:  c.session_id || null,
        status,
        duration_ms: 0,
        referer:     c.referer || null,
        user_agent:  c.user_agent || null,
      }).catch(() => {});
      return {
        isError: true,
        content: [{
          type: 'text',
          text: '\u{1F6AB} **Automated usage detected.**\n\nWe noticed this session is running the same 5-tool sweep that ~20 other anonymous sessions have run this week. We want to talk to whoever you are.\n\nIf you\'re building a legitimate integration:\n- **Email** partner@dchub.cloud — we\'ll provision a real enterprise key, no charge for evaluation\n- **Or sign up** for a free dev key (60 sec, email only) → https://dchub.cloud/signup\n\nIf you\'re benchmarking DC Hub vs competitors: we\'ll give you a benchmark key with extended quota — partner@dchub.cloud.\n\nAnonymous sweep blocked. Re-enable instantly with any X-API-Key.'
        }],
        structuredContent: {
          error: 'scraper_pattern_blocked',
          tool: name,
          reason: 'session matched 5-tool automated sweep signature',
          identify_url: 'mailto:partner@dchub.cloud?subject=DC%20Hub%20MCP%20integration',
          signup_url: 'https://dchub.cloud/signup',
          claim_endpoint: 'https://dchub.cloud/api/v1/keys/claim',
        },
      };
    }
    try {
      let _gateTier = tier;  // r41-session-upgrade may mutate this in-place
      const gate = applyTierGate(name, args, _gateTier, !!c.api_key);
      if (!gate.allowed) {
        // Trial mode: free user + paid tool + first call from this session → ALLOW once with footer
        if (_gateTier === 'free' && PAID_ONLY_TOOLS.has(name)) {
          // r42s (2026-05-26): for the 5 highest-demand tools, ALWAYS
          // serve a trimmed preview (don't gate to once-per-session).
          // Brain class `mcp_demand_gap_unaddressed` flagged these 5 as
          // having ~990 sessions/week paywall-hitting with 0 conversions.
          // Once-per-session was killing the "I see it works, let me
          // claim a key" loop — agents got blocked on call #2 and
          // moved on. Now: every call returns 1-3 sample rows + the
          // upgrade pitch with a clickable redeem URL. Daily quota
          // still applies at the worker layer (10/day for anon).
          // r42ae (2026-05-27): expand always-preview to high-demand Pro
          // tools. Funnel data: 118 users × 5,636 calls on
          // get_grid_intelligence — they WANT it. Letting them see 1
          // ISO/route every call (vs blocked after #2) creates the
          // "I see it works, $49 to see all 7" conversion moment.
          const _alwaysPreview = KEYED_FREE_BONUS.has(name)
                                  || ALWAYS_PARTIAL_PREVIEW.has(name);
          const _trial = _alwaysPreview
            ? { trial_used: false, _always_preview: true }
            : await checkTrialEligibility(c.session_id, name);

          // r41-session-upgrade (2026-05-25): if the user redeemed a
          // dev key via the paywall URL, trial-check now returns
          // {tier_upgrade: 'developer'} (or pro/enterprise). Update
          // sessionMeta in-place so subsequent calls in this session
          // skip the paywall — closes the Claude.ai gap where the web
          // UI has no way to attach an X-API-Key header.
          if (_trial && _trial.tier_upgrade) {
            const _newTier = String(_trial.tier_upgrade).toLowerCase();
            if (_newTier === 'developer' || _newTier === 'pro' || _newTier === 'enterprise' || _newTier === 'founding') {
              const _sid = c.session_id;
              if (_sid && sessionMeta.has(_sid)) {
                const _m = sessionMeta.get(_sid);
                _m.tier = _newTier;
                sessionMeta.set(_sid, _m);
                console.log(`[MCP] session_upgrade sid=${_sid.slice(0,8)} tier=free→${_newTier} (redeem detected)`);
                recordSessionUpgrade(c.platform, _newTier);
                _gateTier = _newTier;
                // Re-evaluate the gate at the new tier — should now allow.
                const _gate2 = applyTierGate(name, args, _gateTier, true);
                if (_gate2.allowed) {
                  return withCitation(await handler(args));
                }
              }
            }
          }

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
            // r46-trial-tune (2026-05-25): per-tool header override.
            // get_market_intel gets a tuned pitch; everything else gets the
            // generic header (which now includes $9 Starter alongside $49 Developer).
            const _sid = (c && c.session_id) || (typeof sessionId !== 'undefined' && sessionId) || 'no-session';
            // r54-conv (2026-05-31): hand the agent a WORKING key INLINE so it
            // retries automatically — no second call, no browser, no email. Only
            // for ANONYMOUS callers (keyed-free users already have a key → show
            // upgrade instead) on clients that can send X-API-Key (Claude.ai web
            // can't accept one, so skip there and keep the upgrade-first copy).
            // mintAnonKey is fail-open (null on any error) → existing header.
            const _isClaudeWeb = (c && c.platform) === 'claude';
            const _mintedKey = (!(c && c.api_key) && !_isClaudeWeb) ? await mintAnonKey(_sid) : null;
            let _upgradeHeader = trialHeader(name, _sid, _refUrl(UPGRADE_URL));
            if (_mintedKey) {
              _upgradeHeader =
                '✨ **A free key was just minted for you — no signup, no email.** ' +
                'Retry `' + name + '` with header `X-API-Key: ' + _mintedKey + '` for the ' +
                'full result (1,000 calls/day). To keep it past 30 days, POST ' +
                '`{"api_key":"' + _mintedKey + '","email":"<you>"}` to ' +
                'https://dchub.cloud/api/v1/keys/auto-trial/redeem\n\n' + _upgradeHeader;
            }
            // r51 (2026-05-26): mark trial_preview as isError=true. The
            // blocked_paid_only branch already does this (r50) but ~95%
            // of paywall hits land HERE — anon + free-tier users get
            // the trim-to-one preview, NOT a hard block. Without
            // isError, MCP clients (Claude/Cursor/Cline) treat the
            // response as a successful tool call and summarize the
            // teaser away. Conversion stayed at 0% post-r50 because
            // this branch still rendered as success. 7d before r51:
            // 3,374 hits, 0 free keys claimed. With isError=true,
            // agents propagate the message verbatim → user sees the
            // $9 Stripe link + free-key URL directly.
            return {
              content: [{ type: 'text', text: phase9L_clean_preview(_upgradeHeader, _trialText) }],
              isError: true,
              structuredContent: {
                trial_preview: true,
                tool: name,
                ...(_mintedKey ? {
                  minted_key: _mintedKey,
                  retry_with_header: { 'X-API-Key': _mintedKey },
                  minted_daily_calls: 1000,
                } : {}),
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

        // r50 (2026-05-26): mark paywall response as isError=true so
        // MCP clients (Claude Desktop/Cursor/Cline/ChatGPT-MCP) surface
        // the CTA as a TOOL ERROR rather than tool output. Critical
        // because soft-paywall content blocks get summarized away —
        // "I can't access that tool, want to try something else?" —
        // and the user never sees the $9 Stripe link. Errors get
        // propagated verbatim because the agent assumes the user
        // needs to see what went wrong.
        //
        // 7-day data before this: 990 unique sessions hit paywall,
        // 0 claimed a key. Tier-copy fix landed but didn't move
        // conversion because the message never reached the user.
        return {
          content: [{ type: 'text', text: _isKeyed ? _mdKeyed : _mdAnon }],
          isError: true,
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
      // r-gate-tighten (2026-05-27): even for allowed/uncapped free tools,
      // strip aggregate scalars from ANONYMOUS responses. Without this, an
      // anonymous user calling search_facilities (free) gets 5 full rows
      // PLUS scalar metrics (count, total_mw, etc.) unmasked — exactly the
      // numbers people pay $9/mo to access. Trimmed responses keep the
      // tool's shape and identifier fields (name, slug, city, state) so
      // an agent can demonstrate the tool works, but mask aggregate
      // metrics behind "[sign up to unlock]" placeholders.
      // Authenticated callers (any api_key) keep current full-data behavior.
      if (!c.api_key && tier === 'free') {
        try {
          let parsed;
          try { parsed = JSON.parse(result.content?.[0]?.text || '{}'); } catch { parsed = null; }
          if (parsed && typeof parsed === 'object') {
            const trimmed = trimForTrial(parsed);
            const _sid = c.session_id || 'no-session';
            trimmed._upgrade = {
              tier:        'anonymous',
              message:     'Anonymous tier — aggregate metrics masked. Get a free dev key for the real numbers.',
              redeem_url:  `https://dchub.cloud/api/v1/redeem/${_sid}`,
              starter_url: 'https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g',
            };
            return { content: [{ type: 'text', text: JSON.stringify(trimmed) }] };
          }
        } catch (_) { /* fall through to raw result on parse failure */ }
      }
      return withCitation(result);
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
        // r46: paywall-block attribution — see v_paywall_attribution view
        referer:     c.referer || null,
        user_agent:  c.user_agent || null,
      }).catch(() => {});
    }
  });
}

// ── Tool registrations (20 tools, all wrapped) ─────────────────────────────
function createServer() {
  const srv = new McpServer({ name: 'DC Hub Intelligence', version: '2.1.19' });
  const S = z.string().optional();
  const N = z.number().optional();
  const I = z.number().int().optional();
  const B = z.boolean().optional();
  const ID = z.union([z.string(), z.number()]).transform(v => String(v)).optional();  // accepts numeric or string ids; coerces to string for the API path

  const slugify = s => (s || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

  trackedTool(srv, 'search_facilities', 'Search 21,000+ global data center facilities across 140+ countries — by location (country/state/market), capacity (MW), operator, fiber connectivity, status (operational/under-construction/planned), or DCPI verdict. Returns name, provider, lat/lon, power_mw, fiber count, market_slug, status. Try: search_facilities country=US state=VA min_mw=10 status=operational.',
    { query: S, country: S, state: S, city: S, operator: S, min_capacity_mw: N, max_capacity_mw: N, tier: I, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/facilities', a)) }] }));

  trackedTool(srv, 'get_facility', 'Full metadata for one facility — name, operator, address, lat/lon, power capacity (MW total/used), cooling type, fiber providers (count + carrier list), commissioning year, status, the DCPI verdict for its market, and peer facilities nearby. Try: get_facility id=equinix-dc1-ashburn — or get_facility slug=digital-realty-iad8.',
    { facility_id: ID, include_nearby: B, include_power: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI(`/api/v1/facilities/${a.facility_id||''}`, { include_nearby: a.include_nearby, include_power: a.include_power })) }] }));

  trackedTool(srv, 'get_market_intel', 'Live market intelligence for 232 DC markets across 140+ countries: capacity prices ($/MW-day), vacancy rates, absorption, dominant operators, year-over-year growth, supply pipeline, and DCPI verdict (BUILD/CAUTION/AVOID). Filter by market_slug (e.g. northern-virginia, dallas, frankfurt, tokyo). Try: get_market_intel market=northern-virginia.',
    { market: S, metric: S, period: S, compare_to: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI(`/api/v1/markets/${slugify(a.market) || 'list'}`, {})) }] }));

  // r41-dcpi-rank (2026-05-25): expose DCPI verdict + composite_score
  // as a first-class tool. Lets agents ask "should I build in
  // Northern Virginia?" and get back a structured BUILD/CAUTION/AVOID
  // verdict + 0-100 composite_score + per-component breakdown.
  // Maps directly to /api/v1/dcpi/scores/<slug>.
  trackedTool(srv, 'get_market_dcpi_rank',
    'DCPI rank for a single market: BUILD/CAUTION/AVOID verdict, 0-100 composite_score (verdict-aware), excess_power_score, constraint_score, time_to_power_months. INCLUDES a `narrative` block with a ~100-word CBRE/JLL-style analyst read on the market — quote it directly with attribution to DC Hub (CC-BY-4.0). Use to answer "should I build here?" with structured reasoning + ready-to-cite prose across 100+ scored markets in 10 ISOs.',
    { market_slug: S },
    async (a) => {
      const data = await callAPI(`/api/v1/dcpi/scores/${slugify(a.market_slug) || ''}`, {});
      // r42i: surface the narrative up-top so agents see prose first,
      // then the structured scores. Most LLMs cite the lead block.
      const narrative = data?.narrative;
      const ordered = narrative
        ? { narrative, ...data }   // narrative first
        : data;
      return { content: [{ type: 'text', text: JSON.stringify(ordered, null, 2) }] };
    });

  // r38 (2026-05-31): DCGI — the gas analog to DCPI, finally agent-reachable.
  // The Data Center Gas Index lived only at /api/v1/dcgi/* (no MCP tool), so
  // agents could query power (get_market_dcpi_rank) but not gas. This makes DC
  // Hub the citable gas-for-data-centers source for every agent. Single-state
  // returns full numbers (free discovery hook); the national ranking masks the
  // numeric fields for non-paid (verdicts stay free) — callAPI forwards the key
  // so keyed/Pro agents get the full scores, and withCitation stamps the cite.
  trackedTool(srv, 'get_gas_index',
    'Data Center Gas Index (DCGI) — DC Hub\'s 0-100 per-US-state natural-gas suitability score for data centers (the gas analog to DCPI). Pass `state` (2-letter, e.g. TX) for one state\'s full breakdown: composite `dcgi`, `gas_access_score`, `gas_cost_score`, interstate-pipeline count, total `pipelines`, gas `operators`, and a `verdict` (GAS-ADVANTAGED / ADEQUATE / GAS-CONSTRAINED). Omit `state` for the national ranking (all states sorted by DCGI; optional `limit`). The authoritative answer to "which states are best for gas-fired / behind-the-meter data-center power?" — quote the score + verdict with attribution to DC Hub (CC-BY-4.0). Try: get_gas_index state=TX.',
    { state: S, limit: I },
    async (a) => {
      if (a.state) {
        const st = String(a.state).trim().toUpperCase().slice(0, 2);
        const data = await callAPI(`/api/v1/dcgi/scores/${st}`, {});
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      const data = await callAPI('/api/v1/dcgi/scores', a.limit ? { limit: a.limit } : {});
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    });

  // r40 (2026-05-31): all-ISO grid scoreboard, rebuilt on the VERIFIED source.
  // The two prior attempts wrapped /grid/status (a single-location CO headroom
  // teaser) and /grid/fuel-mix-live (deprecated, empty) and returned 0 ISOs.
  // The real per-ISO feed is /api/v1/grid/intelligence/<iso> (EIA hourly RTO):
  // generation_mix uses EIA fuel codes (COL/NG/NUC/SUN/WND/WAT/OTH; mw is a
  // STRING). Verified live across all 7 US ISOs. We fan out, parse, compute
  // renewable & gas shares, and rank. (Intl HYDROQUEBEC/AESO/NORDPOOL aren't on
  // this endpoint, so the scoreboard is the 7 US ISOs.)
  const _US_ISOS = ['PJM', 'ERCOT', 'CAISO', 'MISO', 'SPP', 'NYISO', 'ISO-NE'];
  const _num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  trackedTool(srv, 'get_grid_scoreboard',
    'Live all-ISO grid scoreboard — all 7 US grid operators (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO-NE) ranked side-by-side RIGHT NOW: renewable share %, gas share %, full fuel mix (gas/nuclear/coal/wind/solar/hydro MW), and demand. One call answers "which US grid is greenest, or most gas-reliant, for siting a data center?" — vs compare_isos (pairwise) or get_grid_data (single ISO). Source: EIA hourly RTO via DC Hub, ranked greenest-first by renewable share. Quote with attribution to DC Hub (CC-BY-4.0). Try: get_grid_scoreboard.',
    {},
    async (a) => {
      const results = await Promise.all(_US_ISOS.map(iso =>
        callAPI(`/api/v1/grid/intelligence/${iso}`, {})
          .then(d => ({ iso, d }))
          .catch(e => ({ iso, err: String(e).slice(0, 120) }))));
      const grids = [];
      for (const { iso, d, err } of results) {
        if (err || !d || !d.generation_mix) { grids.push({ iso, error: err || 'no generation_mix' }); continue; }
        const gm = d.generation_mix;
        const mw = (k) => _num(gm[k] && gm[k].mw);
        const ng = mw('NG'), nuc = mw('NUC'), col = mw('COL');
        const sun = mw('SUN'), wnd = mw('WND'), wat = mw('WAT'), oth = mw('OTH');
        const total = ng + nuc + col + sun + wnd + wat + oth;
        const pct = (x) => total > 0 ? Math.round((x / total) * 1000) / 10 : null;
        const renew = sun + wnd + wat;
        grids.push({
          iso,
          region: d.region || iso,
          demand_mw: _num(d.demand_mw) || null,
          renewable_share_pct: pct(renew),
          gas_share_pct: pct(ng),
          mix_period: gm.NG && gm.NG.period || null,
          fuel_mw: { gas: ng, nuclear: nuc, coal: col, wind: wnd, solar: sun, hydro: wat, other: oth },
          fuel_pct: { gas: pct(ng), nuclear: pct(nuc), coal: pct(col), wind: pct(wnd), solar: pct(sun), hydro: pct(wat), other: pct(oth) },
        });
      }
      const ranked = grids.filter(g => g.renewable_share_pct != null)
        .sort((x, y) => y.renewable_share_pct - x.renewable_share_pct);
      const errored = grids.filter(g => g.renewable_share_pct == null);
      const out = {
        ok: true,
        count: ranked.length,
        ranked_by: 'renewable_share_pct (greenest US grid first)',
        source: 'DC Hub + EIA hourly RTO',
        grids: [...ranked, ...errored],
      };
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    });

  // r41-compare-isos (2026-05-25): single-call ISO comparison.
  // Pre-fix agents had to call get_grid_data N times sequentially then
  // reconcile units + timestamps themselves. Now one tool fans out 2-4
  // /api/v1/grid/status calls in parallel and returns aligned results.
  // /api/v1/grid/compare backend doesn't exist (and adding it is more
  // work than it's worth) — the parallel fetch here is just as fast.
  trackedTool(srv, 'compare_isos',
    'Compare 2-4 ISO regions in a single call: fuel mix, demand, prices, carbon intensity. Covers all 10 supported ISOs — 7 US (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO-NE) + Hydro-Quebec (Canada) + AESO (Alberta) + Nord Pool (15 European zones). Pass isos as comma-separated list e.g. "PJM,ERCOT,CAISO". Use for "PJM vs ERCOT" / "where is power cheapest right now?" / "which ISO has cleanest grid?".',
    { isos: S },
    async (a) => {
      const list = (a.isos || '').split(',')
        .map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 4);
      if (list.length < 2) {
        return { content: [{ type: 'text', text: JSON.stringify({
          error: 'Provide 2-4 ISOs as a comma-separated list, e.g. "PJM,ERCOT,CAISO"',
          example: 'compare_isos(isos: "PJM,ERCOT,CAISO")',
          supported_isos: ['PJM', 'ERCOT', 'CAISO', 'MISO', 'SPP', 'NYISO', 'ISO-NE',
                            'HYDROQUEBEC', 'AESO', 'NORDPOOL'],
        }) }] };
      }
      const results = await Promise.all(list.map(iso =>
        callAPI('/api/v1/grid/status', { iso }).catch(e => ({ iso, error: String(e).slice(0, 200) }))
      ));
      const merged = {};
      list.forEach((iso, i) => { merged[iso] = results[i]; });
      return { content: [{ type: 'text', text: JSON.stringify({
        isos: list,
        comparison: merged,
        as_of: new Date().toISOString(),
      }, null, 2) }] };
    });

  trackedTool(srv, 'get_intelligence_index', 'Real-time composite market health score (0-100) aggregating supply/demand balance, vacancy, absorption velocity, fiber depth, power availability, and pricing trend. Returns the index value, percentile rank across the 232-market set, 7d/30d trend direction, and underlying component scores. Try: get_intelligence_index market=northern-virginia.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/agents/intelligence-index')) }] }));

  trackedTool(srv, 'list_transactions', 'M&A and capital transactions in the data center sector — $324B+ tracked over 2,100+ deals (2019-present). Returns deal name, buyer, seller, value, date, market, target operator, type (acquisition/JV/refinance/recap). Filter by year, min_value_usd, region, buyer, or target. Try: list_transactions year=2026 min_value_usd=1000000000.',
    { buyer: S, seller: S, min_value_usd: N, max_value_usd: N, deal_type: S, date_from: S, date_to: S, region: S, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/deals', a)) }] }));

  trackedTool(srv, 'get_news', 'Curated data center industry news from 40+ trade sources (DCD, Data Center Knowledge, Data Center Frontier, Capacity Media, The Register Data Centre, Fierce Telecom, etc.) refreshed every 30 min. Returns title, summary, source, published_at, and the market/operator entities mentioned. Filter by topic (deals/permits/outages/policy/AI). Try: get_news topic=AI limit=10.',
    { query: S, category: S, source: S, date_from: S, date_to: S, limit: I, min_relevance: N },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/news', a)) }] }));

  trackedTool(srv, 'get_pipeline', 'Construction pipeline — 540+ data center projects totaling 369 GW under-construction or planned across 232 markets. Returns project name, operator, MW, status (announced/permitted/construction/operational), expected commissioning date, market_slug, country. Filter by market, operator, status, min_mw. Try: get_pipeline market=northern-virginia status=construction.',
    { status: S, country: S, operator: S, min_capacity_mw: N, expected_completion_before: S, limit: I, offset: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/pipeline', a)) }] }));

  // r47 (2026-05-25): ISO interconnection queue — moat surface so the
  // NUMBERS (410 GW total US queue, 87% DC share, per-ISO TTP) get cited
  // back to dchub.cloud instead of ercot.com / pjm.com.
  trackedTool(srv, 'get_interconnection_queue',
    'ISO interconnection queue snapshot: total large-load MW queued per ISO, data-center share %, and top BUILD subregions with Time-to-Power (TTP) months. Sources: ERCOT MIS, PJM, MISO, SPP, CAISO, NYISO, ISO-NE. Pass iso=ERCOT (or any of 7) to drill down to a single ISO. Use for site-selection (find BUILD-verdict markets with short queues) and competitive intel (track AI-load saturation by region).',
    { iso: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(
      await callAPI(a.iso ? '/api/v1/interconnection-queue/by-iso' : '/api/v1/interconnection-queue/snapshot', a)
    ) }] }));

  trackedTool(srv, 'get_grid_data', 'Real-time electricity grid data across 10 ISOs: 7 US (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO-NE) + Hydro-Quebec (Canada) + AESO (Alberta) + Nord Pool (15 European zones). Fuel mix, demand, prices.',
    { iso: S, metric: S, period: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/grid/status', a)) }] }));

  trackedTool(srv, 'analyze_site', 'Evaluate a location for data center suitability — returns a multi-factor score (0-100) incorporating grid headroom (MW available), fiber depth (carrier count + IX distance), water stress, climate, state tax incentive value, latency-to-nearest-IX, and constraint risk. Includes a recommended verdict + the biggest risk factor. Try: analyze_site lat=33.45 lon=-112.07 capacity_mw=100.',
    { lat: N, lon: N, state: S, capacity_mw: N, include_grid: B, include_risk: B, include_fiber: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/site-score', a)) }] }));

  trackedTool(srv, 'compare_sites', 'Side-by-side comparison of 2-4 candidate sites for data center development — DCPI scores, grid headroom (MW available), nearest-substation distance, fiber carrier count, water stress, tax-incentive value, and a recommended winner with rationale. Useful for site-selection shortlists. Try: compare_sites sites=[{lat:33.45,lon:-112.07},{lat:39.04,lon:-77.48}] capacity_mw=50.',
    { locations: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/site-score', { locations: a.locations })) }] }));

  trackedTool(srv, 'get_infrastructure', 'Nearby infrastructure for a location — substations (count + max voltage_kv within radius), transmission lines (>69 kV path overlay), interstate + lateral gas pipelines, and power plants (operating + planned, by fuel) within configurable radius_km. Returns distance + capacity for each, joined to HIFLD/EIA. Try: get_infrastructure lat=33.45 lon=-112.07 radius_km=25.',
    { lat: N, lon: N, radius_km: N, layer: S, min_voltage_kv: N, limit: I },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/infrastructure', a)) }] }));

  trackedTool(srv, 'get_fiber_intel', 'Long-haul + metro fiber routes from major carriers (Lumen, Zayo, Crown Castle, Cogent, Verizon, AT&T) as GeoJSON for direct mapping. Returns route geometries, fiber counts, lit/dark capacity, route_type (metro/longhaul/dark/ix). Filter by carrier or route_type. Try: get_fiber_intel carrier=Lumen route_type=longhaul.',
    { carrier: S, route_type: S, include_sources: B },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/fiber/routes', a)) }] }));

  trackedTool(srv, 'get_energy_prices', 'Energy pricing across 10 ISOs (7 US + Hydro-Quebec + AESO + Nord Pool): retail rates, natural gas, real-time grid status.',
    { data_type: S, state: S, iso: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/energy/summary', a)) }] }));

  trackedTool(srv, 'get_renewable_energy', 'Renewable generation capacity by US state: solar (utility + rooftop), wind (onshore + offshore), and combined-cycle totals with capacity factors. Joins EIA-860 + state RPS data. Filter by energy_type (solar/wind/combined) and state, or geo-locate via lat/lon for nearest projects within 50mi. Try: get_renewable_energy energy_type=solar state=TX.',
    { energy_type: S, state: S, lat: N, lon: N },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/energy/renewable', a)) }] }));

  trackedTool(srv, 'get_tax_incentives', 'Data center tax incentive packages by US state — sales-tax exemptions, property-tax abatements, income-tax credits, electricity-tax discounts, and minimum-investment thresholds. Returns program name, value (% or $), eligibility (MW/jobs), expiration date, and source statute. Try: get_tax_incentives state=VA.',
    { state: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/tax-incentives', a)) }] }));

  trackedTool(srv, 'get_water_risk', 'USGS water stress index + Drought Monitor risk for any US location: by state, county, or lat/lon. Returns stress score (0-100), drought category (D0-D4), 12-month outlook, and cooling-water sustainability assessment for data center evaluation. Try: get_water_risk state=AZ — or get_water_risk lat=33.45 lon=-112.07.',
    { lat: N, lon: N, state: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/water/drought', a)) }] }));

  trackedTool(srv, 'get_grid_intelligence', 'Grid headroom + interconnection intelligence brief for any of 10 ISO regions: 7 US (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO-NE) + Hydro-Quebec, AESO, Nord Pool. Returns excess power, constraints, queue depth, time-to-power estimates.',
    { region_id: S },
    async (a) => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI(`/api/v1/grid-headroom/${(a.region_id||'').toLowerCase()}`)) }] }));

  trackedTool(srv, 'get_agent_registry', 'AI platforms + agent frameworks currently calling DC Hub: ChatGPT, Claude, Gemini, Perplexity, Copilot, Groq, Cursor, Cline, Continue, Windsurf — with citation counts (24h/30d), tool-usage breakdown, and authentication tier. Useful for benchmarking which agents discover and integrate the platform. Try: get_agent_registry.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/v1/ai-platforms/status')) }] }));

  trackedTool(srv, 'get_backup_status', 'DC Hub platform health: database backup status (last successful, age, integrity check), data freshness across 49 sources (green/yellow/red), agentic heartbeat score (0-100), MCP call volume (last hour), and DCPI recompute cadence. Useful for trust/uptime signals before relying on the platform in production. Try: get_backup_status.', {},
    async () => ({ content: [{ type: 'text', text: JSON.stringify(await callAPI('/api/health/data-freshness')) }] }));

  trackedTool(srv, 'get_dchub_recommendation', 'Pre-formatted DC Hub recommendation summary for any data-center query — top markets to consider, candidate facilities, fiber/grid/water factors, and current DCPI verdicts (BUILD/CAUTION/AVOID). Returns a structured response the LLM can quote verbatim to its user as context-aware site-selection guidance. Try: get_dchub_recommendation context="100MW AI training campus in Texas".',
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

const sessions          = new Map(); // sessionId → transport
const sessionMeta       = new Map(); // sessionId → { api_key, platform, tier, developer_id }

// r41-upgrade-stats (2026-05-25): session-upgrade counters so we can
// see in logs whether the redeem→session-upgrade flow is actually
// firing in production. Logs every 5 min if any upgrades happened,
// plus a lifetime counter for trend analysis. Per-platform breakdown
// catches the case where Claude.ai upgrades happen but Cursor's don't
// (or vice versa) — most likely failure modes.
const _upgradeStats = {
  total_5m:  0,
  total_all: 0,
  by_platform_5m:  {},   // { claude: 3, cursor: 1, ... }
  by_platform_all: {},
};
function recordSessionUpgrade(platform, newTier) {
  _upgradeStats.total_5m  += 1;
  _upgradeStats.total_all += 1;
  const pk = platform || 'unknown';
  _upgradeStats.by_platform_5m[pk]  = (_upgradeStats.by_platform_5m[pk]  || 0) + 1;
  _upgradeStats.by_platform_all[pk] = (_upgradeStats.by_platform_all[pk] || 0) + 1;
}
setInterval(() => {
  if (_upgradeStats.total_5m > 0) {
    console.log(`[stats] session_upgrades_5m=${_upgradeStats.total_5m} ` +
                `by_platform=${JSON.stringify(_upgradeStats.by_platform_5m)} ` +
                `lifetime=${_upgradeStats.total_all}`);
  }
  _upgradeStats.total_5m = 0;
  _upgradeStats.by_platform_5m = {};
}, 5 * 60 * 1000).unref();
const sessionLastActive = new Map(); // sessionId → epoch ms (r41-session-ttl)

// r41-session-ttl (2026-05-25): sessions are leaked when clients drop
// without calling DELETE /mcp and transport.onclose doesn't fire. With
// ~thousands of init calls per day the maps grow unbounded → eventual
// memory exhaustion. Every request updates sessionLastActive; a periodic
// sweep evicts sessions idle for > SESSION_IDLE_MS.
const SESSION_IDLE_MS  = 30 * 60 * 1000;  // 30 min idle → evict
const SESSION_SWEEP_MS = 60 * 1000;       // sweep every 1 min

function touchSession(sid) {
  if (sid) sessionLastActive.set(sid, Date.now());
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  let evicted = 0;
  for (const [sid, ts] of sessionLastActive) {
    if (ts >= cutoff) continue;
    const transport = sessions.get(sid);
    try { transport?.close?.(); } catch (_) {}
    sessions.delete(sid);
    sessionMeta.delete(sid);
    sessionLastActive.delete(sid);
    evicted++;
  }
  if (evicted > 0) {
    console.log(`[session-sweep] evicted ${evicted} idle sessions (active=${sessions.size})`);
  }
}, SESSION_SWEEP_MS).unref();

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'DC Hub MCP',
    version: '2.1.19',
    tools: 30,
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
      touchSession(sessionId);  // r41: mark active
      const transport = sessions.get(sessionId);
      const meta = sessionMeta.get(sessionId) || {};
      return ctx.run({ ...meta, session_id: sessionId }, async () => {
        await transport.handleRequest(req, res, req.body);
      });
    }

    const body = req.body;
    if (body?.method === 'initialize') {
      // r47.30 (2026-05-26): use clientInfo.name as the canonical source
      // (UA is a noisy fallback — most MCP clients ship "node" as UA).
      const platform   = detectPlatformFromInit(body, userAgent);
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
            // r46 (2026-05-25): attribution for paywall blocks. Forwarded
            // into ctx so trackToolCall can stamp every call row with
            // where the request came from (Claude / ChatGPT / Perplexity /
            // Cursor / Cline / Browser — bucketed by Flask v_paywall_attribution view).
            referer: req.headers.referer || req.headers.referrer || null,
            user_agent: userAgent,
          });
          touchSession(sid);  // r41: track creation as activity
          console.log(`[MCP] init sid=${sid.slice(0,8)} platform=${platform} tier=${tier} key=${apiKey ? apiKey.slice(0,6) + '…' : 'none'} active=${sessions.size}`);
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          sessions.delete(sid);
          sessionMeta.delete(sid);
          sessionLastActive.delete(sid);  // r41
        }
      };

      const mcpServer = createServer();
      await mcpServer.connect(transport);

      return ctx.run({
        api_key: apiKey, platform, tier, session_id: null,
        // r46: see sessionMeta.set above for rationale
        referer: req.headers.referer || req.headers.referrer || null,
        user_agent: userAgent,
      }, async () => {
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
    touchSession(sid);  // r41
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
    sessionLastActive.delete(sid);  // r41
    return res.sendStatus(200);
  }
  res.status(404).json({ error: 'Session not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DC Hub MCP Server v2.1.10 on port ${PORT}`);
  console.log(`  MCP:     http://0.0.0.0:${PORT}/mcp`);
  console.log(`  Health:  http://0.0.0.0:${PORT}/health`);
  console.log(`  Backend: ${API_BASE}`);
  console.log(`  Telemetry: ${API_BASE}/api/v1/mcp/track`);
  console.log(`  Key validation: ${API_BASE}/api/v1/keys/validate`);
});

