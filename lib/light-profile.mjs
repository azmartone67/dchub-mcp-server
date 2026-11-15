// light-profile.mjs: the light, front-door-first tool list served at /mcp/light (owner 2026-11-12, 3:18 PM Phoenix).
//
// WHY THIS EXISTS. The default tools/list carries the whole catalogue (95 tools, hundreds of KB) and execute_plan, the
// front door for a question that spans several topics, is one entry among them. A client that loads everything then picks
// a specialist tool or nothing. This path lists ten tools: execute_plan FIRST, described as the front door, then
// discover_tools and the specialists agents most often need.
//
// WHAT THIS PATH DOES, and nothing else (same contract as lib/grok-profile.mjs):
//   . tools/list lists LIGHT_TOOLS only, in that order, each description <= 450 characters, no outputSchema
//     (structuredContent is still returned). inputSchema, annotations and _meta pass through unchanged, so the access
//     and maturity markers stay what /mcp says.
//   . A LISTING SCOPE, NOT AN ENTITLEMENT SCOPE: tools/call on /mcp/light still accepts any DC Hub tool by name and
//     every gate runs on the caller's key exactly as on /mcp, so all 95 tools stay reachable (discover_tools names
//     them). Nothing here reads or writes a key, a trial or a paywall line.
//   . /mcp is NOT changed by this file except through lightForRequest(). DCHUB_LIGHT_FOR_CLI is ON by default
//     (owner 2026-11-12, 10:26 PM Phoenix): a coding-CLI client (GitHub Copilot CLI, Codex CLI, opencode, Clono,
//     WorkBuddy, Claude Code, Gemini CLI) gets this list on bare /mcp. Set DCHUB_LIGHT_FOR_CLI=0 to turn that off.
//     /mcp/light always serves this list. Since 2026-11-14 (owner item D2) multi-server IDE hosts (Cursor, VS Code,
//     Windsurf, Cline) get it on bare /mcp as well (DCHUB_LIGHT_FOR_HOSTS, default on), and any caller can ask for the
//     full catalog with ?catalog=full or X-DCHUB-Catalog: full.
//
// No price, no plan name, no count in the descriptions; "Data Center Power Index (DCPI)" is spelled out.

import { PLAN_SUFFIX, stripPlanSuffix } from './dchub-identity.mjs';
import { compactDescription } from './grok-profile.mjs';

export const LIGHT_PATH = '/mcp/light';
export const LIGHT_PACK_NAME = 'light';
export const LIGHT_DESCRIPTION_MAX = 450;
// Pinned by test/light-profile.test.mjs against the real handler.
export const LIGHT_TOOLS_LIST_MAX_BYTES = 30000;

// execute_plan first, then the discovery exit, then the specialists with the most measured use. Every other tool is
// reachable by name and listed by discover_tools.
export const LIGHT_TOOLS = Object.freeze([
  'execute_plan', 'discover_tools',
  'get_market_dcpi_rank', 'get_grid_intelligence', 'get_interconnection_queue', 'search_facilities',
  'find_sites', 'analyze_site', 'source_capacity', 'get_changes',
]);

export const LIGHT_DESCRIPTIONS = Object.freeze({
  execute_plan: 'FRONT DOOR. Use this first for any data center or energy question: pass the user\'s question '
    + 'unchanged as intent. A rule-based planner (no AI model) picks the lookups, runs them and returns one dated, '
    + 'cited answer with a replay of how it was built. It covers power and grid headroom, interconnection queues, '
    + 'Data Center Power Index (DCPI) market verdicts, fiber and gas access, risk, site selection and data center '
    + 'capacity to buy or lease. The other tools here are specialists for a single lookup; discover_tools lists every '
    + 'DC Hub tool, and each one can be called by name.',
  discover_tools: 'Use this when you are unsure which DC Hub tool fits: the full catalogue by family (facility, market, '
    + 'grid and power, gas, site, fiber, deals and news, saved work, account), optionally filtered by query. Every DC '
    + 'Hub tool can be called by name from here. The full list is at https://dchub.cloud/mcp?catalog=full.',
});

// Coding-CLI identities (User-Agent and/or clientInfo.name):
//   GitHub Copilot CLI: UA copilot-cli/<v>, clientInfo github-copilot-developer
//   Codex CLI:          UA / clientInfo codex-mcp-client/<v>
//   opencode:           UA opencode/<v>/cli
//   Clono:              UA "Clono (+https://clono.sh)"
//   WorkBuddy:          UA WorkBuddy/<v>
//   Claude Code:        UA claude-code/<v> or "Claude-User (claude-code/<v>; ...)", clientInfo claude-code
//   Gemini CLI:         clientInfo gemini-cli-mcp-client (UA is often generic `node`)
export const LIGHT_CLI_UA = /(?:^|[\s(/])(copilot-cli\/|codex-mcp-client\/|opencode\/|workbuddy\/|clono(?:\s|\/|$)|claude-code(?:\/|[\s;]|$)|gemini-cli(?:-mcp-client)?(?:\/|[\s-]|$))/i;
export const LIGHT_CLI_NAME = /^(copilot-cli|github-copilot-developer|codex-mcp-client|codex-cli|opencode|workbuddy|clono|claude-code|gemini-cli-mcp-client|gemini-cli)([\s_/.-]|$)/i;

export function isLightCliIdentity({ userAgent, clientName } = {}) {
  return LIGHT_CLI_UA.test(String(userAgent || '').trim()) || LIGHT_CLI_NAME.test(String(clientName || '').trim());
}

// ON unless explicitly set to 0/false/no/off (same shape as wallOauthLeadOn).
export function lightForCliOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_LIGHT_FOR_CLI) || '').trim());
}

// ── Multi-server IDE hosts (owner item D2, 2026-11-14) ──────────────────────────────────────────────────────────
// The full /mcp tools/list measured 220,410 bytes on 2026-11-14 (96 tools) against 16,617 on /mcp/core and 24,965 on
// /mcp/light. An IDE agent loads every connected server's list into one context and caps the total tool count (Cursor
// warns past 40 tools across all servers, VS Code agent mode caps at 128, Windsurf at 100), so the full catalog crowds
// out the user's other servers. These hosts now get the light list on bare /mcp too, exactly like the coding CLIs.
// The strings each host sends (read from public source, see lib/client-recognition.mjs and server.mjs
// _KNOWN_PLATFORM_FROM_NAME):
//   Cursor:              clientInfo "cursor-vscode"
//   VS Code (Copilot):   clientInfo "Visual Studio Code" / "Visual Studio Code - Insiders", UA "<that>/<version>"
//   Windsurf:            clientInfo "windsurf-client" or "Windsurf" (Codeium, its former name)
//   Cline:               clientInfo "cline-vscode" or "Cline"
// Directory crawlers and unidentified callers still get the full catalog (their tool counts are what the listings
// publish). Kill switch: DCHUB_LIGHT_FOR_HOSTS=0 (on unless set to 0/false/no/off), separate from the CLI switch.
export const LIGHT_HOST_UA = /^visual studio code(\s*-\s*insiders)?\//i;
export const LIGHT_HOST_NAME = /^(cursor-vscode|cursor|visual[\s_-]*studio[\s_-]*code(\s*-\s*insiders)?|windsurf-client|windsurf|codeium|cline-vscode|cline)([\s_/.-]|$)/i;

export function isLightHostIdentity({ userAgent, clientName } = {}) {
  return LIGHT_HOST_UA.test(String(userAgent || '').trim()) || LIGHT_HOST_NAME.test(String(clientName || '').trim());
}

export function lightForHostsOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_LIGHT_FOR_HOSTS) || '').trim());
}

// ── Asking for the full catalog (owner item D2) ─────────────────────────────────────────────────────────────────
// A host that wants every tool listed adds ?catalog=full to the URL (https://dchub.cloud/mcp?catalog=full; it rides
// every request, so a later tools/list keeps it) or sends the header X-DCHUB-Catalog: full. Either one turns the
// client-aware light list off for that request; nothing else changes.
export const FULL_CATALOG_URL = 'https://dchub.cloud/mcp?catalog=full';
export function wantsFullCatalog(req) {
  try {
    const q = req && req.query && req.query.catalog;
    const h = req && req.headers && req.headers['x-dchub-catalog'];
    return [q, h].some((v) => /^full$/i.test(String(Array.isArray(v) ? v[0] : (v || '')).trim()));
  } catch (_) { return false; }
}

// True when this request should get the light list on the bare /mcp path: exact /mcp, no full-catalog ask, and a
// coding-CLI identity (DCHUB_LIGHT_FOR_CLI) or a multi-server IDE host (DCHUB_LIGHT_FOR_HOSTS).
export function lightForRequest({ path, userAgent, clientName, fullCatalog = false, env = process.env } = {}) {
  try {
    if (path !== '/mcp' || fullCatalog) return false;
    return (lightForCliOn(env) && isLightCliIdentity({ userAgent, clientName }))
      || (lightForHostsOn(env) && isLightHostIdentity({ userAgent, clientName }));
  } catch (_) { return false; }
}

// Project a finished canonical ListToolsResult onto the light list. Tool objects are copied: only description and
// outputSchema change.
export function lightToolsList(result, descriptions = LIGHT_DESCRIPTIONS) {
  const have = new Map((result?.tools || []).map((t) => [t.name, t]));
  const tools = [];
  const missing = [];
  for (const n of LIGHT_TOOLS) {
    const t = have.get(n);
    if (!t) { missing.push(n); continue; }
    const out = { ...t };
    delete out.outputSchema;
    const own = descriptions[n];
    if (n === 'execute_plan') {
      out.description = compactDescription(own || stripPlanSuffix(t.description), LIGHT_DESCRIPTION_MAX + 150);
    } else {
      const suffix = ' ' + PLAN_SUFFIX;
      out.description = compactDescription(stripPlanSuffix(own || t.description), LIGHT_DESCRIPTION_MAX - suffix.length) + suffix;
    }
    tools.push(out);
  }
  if (missing.length) {
    console.error(`[light] LIGHT_TOOLS names ${missing.length} tool(s) absent from the catalog, serving short: ${missing.join(', ')}`);
  }
  return result?._meta ? { tools, _meta: result._meta } : { tools };
}
