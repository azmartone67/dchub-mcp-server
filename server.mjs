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
      lock + ' **' + toolName + ' is a paid tool.** Three ways to unlock:\n\n' +
      '**1. Free dev key (60 sec, just your email)** \u2192 ' + redeemUrl + '\n' +
      '   1,000 calls/day, no credit card.\n\n' +
      '**2. $9/mo Starter (most popular, 10,000 calls/day)** \u2192 ' + STARTER_URL_LOCAL + '\n' +
      '   Unlocks every paid tool except Pro-only ones.\n\n' +
      '**3. $49/mo Developer (unlimited paid tools)** \u2192 ' + upgradeUrl + '\n' +
      '   Full ' + toolName + ' + all 10 ISO grid intel + interconnection queue + fiber routes.'
    );
  }
  return {
    human_message: human_message,
    redeem_url:    redeemUrl,
    upgrade_url:   upgradeUrl,
    signup_url:    signupUrl,
    platform:      _platform || null,
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


// ── trackedTool: wrap each srv.tool registration ───────────────────────────
function trackedTool(srv, name, description, schema, handler) {
  srv.tool(name, description, schema, async (args) => {
    const c = getCtx();
    const t0 = Date.now();
    let status = 'ok';
    const tier = c.tier || 'free';
    try {
      let _gateTier = tier;  // r41-session-upgrade may mutate this in-place
      const gate = applyTierGate(name, args, _gateTier, !!c.api_key);
      if (!gate.allowed) {
        // Trial mode: free user + paid tool + first call from this session → ALLOW once with footer
        if (_gateTier === 'free' && PAID_ONLY_TOOLS.has(name)) {
          const _trial = await checkTrialEligibility(c.session_id, name);

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
                  return await handler(args);
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
            const _upgradeHeader = trialHeader(name, _sid, _refUrl(UPGRADE_URL));
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
        // r46: paywall-block attribution — see v_paywall_attribution view
        referer:     c.referer || null,
        user_agent:  c.user_agent || null,
      }).catch(() => {});
    }
  });
}

// ── Tool registrations (20 tools, all wrapped) ─────────────────────────────
function createServer() {
  const srv = new McpServer({ name: 'DC Hub Intelligence', version: '2.1.11' });
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

  trackedTool(srv, 'get_energy_prices', 'Energy pricing across 10 ISOs (7 US + Hydro-Quebec + AESO + Nord Pool): retail rates, natural gas, real-time grid status.',
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

  trackedTool(srv, 'get_grid_intelligence', 'Grid headroom + interconnection intelligence brief for any of 10 ISO regions: 7 US (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO-NE) + Hydro-Quebec, AESO, Nord Pool. Returns excess power, constraints, queue depth, time-to-power estimates.',
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
    version: '2.1.11',
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
      touchSession(sessionId);  // r41: mark active
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

