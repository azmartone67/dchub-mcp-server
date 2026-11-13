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
//   . /mcp is NOT changed by this file. The one place the bare /mcp list can change is lightForRequest(), and it is OFF
//     unless DCHUB_LIGHT_FOR_CLI=1 is set on both Railway services: then a coding-CLI user agent (Copilot CLI, Codex CLI,
//     opencode, WorkBuddy, Clono) gets this list on /mcp. That is a decision about what a client sees by default; the
//     flag ships off.
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
    + 'Hub tool can be called by name from here.',
});

// Coding-CLI user agents the edge saw (Cloudflare /mcp*, 30 days): copilot-cli/1.0.x, codex-mcp-client/0.16x,
// opencode/latest/2.2.x/cli, WorkBuddy/5.9.x, "Clono (+https://clono.sh)".
export const LIGHT_CLI_UA = /^(copilot-cli\/|codex-mcp-client\/|opencode\/|workbuddy\/|clono(\s|\/|$))/i;

export function lightForCliOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_LIGHT_FOR_CLI) || '').trim());
}

// True when this request should get the light list on the bare /mcp path: flag on, exact /mcp, a coding-CLI user agent.
export function lightForRequest({ path, userAgent, env = process.env } = {}) {
  try {
    return lightForCliOn(env) && path === '/mcp' && LIGHT_CLI_UA.test(String(userAgent || '').trim());
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
