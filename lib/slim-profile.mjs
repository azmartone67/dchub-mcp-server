// slim-profile.mjs: the opt-in core tool list on bare /mcp, https://dchub.cloud/mcp?tools=core (Brain upgrade-funnel
// item 7, "activation for connect-only clients", flag DCHUB_SLIM_PROFILE_TEST, default OFF).
//
// WHY. R named_clients, sessions with a tool call in the 7 days to 2026-11-21: Claude 38 of 2,319, GitHub Copilot CLI
// 3 of 717, Clono 0 of 388, opencode 0 of 123. Most sessions connect and never call. This tests whether a short list,
// execute_plan first, gets more first calls than the full catalog or the ten-tool light list.
//
// WHAT IT IS. Seven tools, in this order: execute_plan, then the other four core energy tools (the same set as
// KEYLESS_FIRST_FULL_TOOLS, so a keyless caller's first call each UTC day to each of them is a full answer), then the
// key tool and dchub_services. The key tool is projected under its registered name (claim_free_key) and listed as
// get_api_key by lib/key-tool-name.mjs downstream, exactly like every other canonical list.
//
// WHAT IT DOES, and nothing else:
//   . Opt-in only: the caller asks with ?tools=core on /mcp (it rides every request, so a later tools/list keeps it) or
//     the header X-DCHUB-Tools: core. Nobody is moved onto it.
//   . Flag off: ?tools=core is ignored and /mcp answers exactly as before (full catalog, or the light list for a
//     coding CLI / IDE host).
//   . A LISTING SCOPE, NOT AN ENTITLEMENT SCOPE (same contract as lib/light-profile.mjs): tools/call still accepts any
//     DC Hub tool by name and every gate runs on the caller's key exactly as on /mcp.
//   . The session_init event records which list the session was served (tool_list: slim, light, full or the pack
//     name), so the backend can compare tool-call rates by list.
//
// No price, no plan name in the descriptions; "Data Center Power Index (DCPI)" is spelled out. The endpoint stays
// https://dchub.cloud/mcp: this is a query on the same endpoint, not a second connector URL.

import { PLAN_SUFFIX, stripPlanSuffix } from './dchub-identity.mjs';
import { compactDescription } from './grok-profile.mjs';
import { KEYLESS_FIRST_FULL_TOOLS } from './keyless-first-full.mjs';
import { KEY_TOOL_REGISTERED } from './key-tool-name.mjs';

export const SLIM_FLAG = 'DCHUB_SLIM_PROFILE_TEST';
export const SLIM_PACK_NAME = 'slim';
export const SLIM_QUERY_VALUE = 'core';
export const SLIM_URL = 'https://dchub.cloud/mcp?tools=core';
export const SLIM_DESCRIPTION_MAX = 450;

export const SLIM_TOOLS = Object.freeze([
  'execute_plan',
  ...KEYLESS_FIRST_FULL_TOOLS.filter((n) => n !== 'execute_plan'),
  KEY_TOOL_REGISTERED, 'dchub_services',
]);

export const SLIM_DESCRIPTIONS = Object.freeze({
  execute_plan: 'FRONT DOOR. Use this first for any data center or energy question: pass the user\'s question '
    + 'unchanged as intent. A rule-based planner (no AI model) picks the lookups, runs them and returns one dated, '
    + 'cited answer with a replay of how it was built. It covers power and grid headroom, interconnection queues, '
    + 'Data Center Power Index (DCPI) market verdicts, fiber and gas access, risk, site selection and data center '
    + 'capacity to buy or lease. The other tools here are single lookups; every DC Hub tool can be called by name, '
    + 'and the full list is at https://dchub.cloud/mcp?catalog=full.',
});

// ON only when set to 1/true/yes/on.
export function slimProfileOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[SLIM_FLAG]) || '').trim());
}

// True when the request asks for the core list: ?tools=core or X-DCHUB-Tools: core.
export function wantsSlimList(req) {
  try {
    const q = req && req.query && req.query.tools;
    const h = req && req.headers && req.headers['x-dchub-tools'];
    return [q, h].some((v) => String(Array.isArray(v) ? v[0] : (v || '')).trim().toLowerCase() === SLIM_QUERY_VALUE);
  } catch (_) { return false; }
}

// True when this request is served the slim list: exact /mcp, the flag on, and the caller asked for it.
export function slimForRequest({ path, req, env = process.env } = {}) {
  try {
    return path === '/mcp' && slimProfileOn(env) && wantsSlimList(req);
  } catch (_) { return false; }
}

// Project a finished canonical ListToolsResult onto the slim list. Tool objects are copied: only description and
// outputSchema change (structuredContent is still returned).
export function slimProfileToolsList(result, descriptions = SLIM_DESCRIPTIONS) {
  const have = new Map((result?.tools || []).map((t) => [t.name, t]));
  const tools = [];
  const missing = [];
  for (const n of SLIM_TOOLS) {
    const t = have.get(n);
    if (!t) { missing.push(n); continue; }
    const out = { ...t };
    delete out.outputSchema;
    const own = descriptions[n];
    if (n === 'execute_plan') {
      out.description = compactDescription(own || stripPlanSuffix(t.description), SLIM_DESCRIPTION_MAX + 150);
    } else {
      const suffix = ' ' + PLAN_SUFFIX;
      out.description = compactDescription(stripPlanSuffix(own || t.description), SLIM_DESCRIPTION_MAX - suffix.length) + suffix;
    }
    tools.push(out);
  }
  if (missing.length) {
    console.error(`[slim] SLIM_TOOLS names ${missing.length} tool(s) absent from the catalog, serving short: ${missing.join(', ')}`);
  }
  return result?._meta ? { tools, _meta: result._meta } : { tools };
}

// The instructions tail for a slim session: the listing-scope rules, no count, no second connector URL.
// Owner 2026-11-22 ("trim it"): the slim handshake measured 2,063 characters live, over the 2,048 clients keep. The
// tail drops "start with execute_plan" (the canon sentence that opens the text already says it, as the light v2 tail
// does) and says "is a listing scope" as /mcp/light does. test/initialize-instructions-length counts this path.
export function slimInstructionsTail(fullCatalogUrl = 'https://dchub.cloud/mcp?catalog=full') {
  return '\n\nENDPOINT SCOPE: this /mcp list (tools=core) is a listing scope, not a permission scope: tools/call '
    + `accepts any DC Hub tool by name; dchub_services lists DC Hub's services; the full list is at ${fullCatalogUrl}.`;
}

// Which tool list a session was served, for the session_init event: 'slim', 'light', 'grok', a pack name, 'full'
// (bare /mcp, full catalog) or null (any other path: the directory and core profiles have their own lists).
export function toolListLabel(pack, path) {
  try {
    if (pack) {
      if (pack.slim) return SLIM_PACK_NAME;
      if (pack.light) return 'light';
      if (pack.compact) return 'grok';
      return String(pack.pack || '').slice(0, 24) || null;
    }
    return path === '/mcp' ? 'full' : null;
  } catch (_) { return null; }
}
