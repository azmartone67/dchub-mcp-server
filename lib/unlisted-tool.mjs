// lib/unlisted-tool.mjs — what a restricted endpoint answers for a tool it does not serve (stability P3, 2026-11-27).
//
// /mcp accepts any DC Hub tool by name. The restricted endpoints (/mcp/chatgpt, /mcp/chatgpt/oauth, /mcp/claude,
// /mcp/muse, /mcp/core) list and serve only their own tools. A call there for a REAL DC Hub tool the endpoint does
// not serve (analyze_site on /mcp/chatgpt) used to answer "Unknown tool", as if the tool did not exist; it now says
// where the tool is served. It stays a JSON-RPC error with the same -32602 code, so no client branches differently.
//
// "Unknown tool: <name>" is kept for:
//   • a name that is not a DC Hub tool at all;
//   • key, identity and commerce tools: the directory endpoints carry no commerce, so they are never pointed at.
//
// The message does not repeat the tool's name: the directory profiles' response scrub drops any sentence that names
// a tool they do not list (lib/chatgpt-directory.mjs), and the caller already knows what it asked for.

export const FULL_ENDPOINT_URL = 'https://dchub.cloud/mcp';

export const NEVER_POINTED_AT_TOOLS = Object.freeze(['claim_free_key', 'recover_my_key', 'bind_email',
  'unlock_more_data', 'why_dchub', 'get_api_key', 'dchub_services', 'get_dchub_recommendation', 'get_agent_registry']);
const _NEVER = new Set(NEVER_POINTED_AT_TOOLS);

export function unlistedToolMessage(endpoint) {
  return `This DC Hub tool is not available on this endpoint (${endpoint}). It is available at ${FULL_ENDPOINT_URL}.`;
}

// isDchubTool(name) -> boolean: whether /mcp serves that name.
export function unlistedToolError(name, endpoint, isDchubTool) {
  const n = String(name || '').slice(0, 80);
  let real = false;
  try { real = typeof isDchubTool === 'function' && !!isDchubTool(n); } catch (_) { real = false; }
  if (!real || _NEVER.has(n)) return { code: -32602, message: `Unknown tool: ${n}` };
  return { code: -32602, message: unlistedToolMessage(endpoint) };
}
