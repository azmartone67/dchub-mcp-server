// client-recognition.mjs — MCP clients the platform tagging did not name (2026-11-11).
//
// server.mjs tags every session with a platform from clientInfo.name (_KNOWN_PLATFORM_FROM_NAME)
// and, failing that, the User-Agent (detectPlatform). These rules run AFTER the existing ones in
// both, so no label that existed before changes (the funnel groups on them); they only name
// traffic that previously fell through to a raw clientInfo name ('visualstudiocode',
// 'mavis-local-runtime-mcp') or to the generic 'mcp' bucket.
//
// The strings each client really sends, read from public source on 2026-11-11:
//   Visual Studio Code (GitHub Copilot agent mode): clientInfo.name = productService.nameLong,
//     i.e. "Visual Studio Code" / "Visual Studio Code - Insiders", and User-Agent
//     "<nameLong>/<version>" on HTTP transports.
//     microsoft/vscode src/vs/workbench/contrib/mcp/common/mcpServerRequestHandler.ts and
//     src/vs/workbench/api/common/extHostMcp.ts (transportHeaders 'user-agent').
//     Already 'copilot' before this change: github-copilot-developer (Copilot CLI),
//     *-copilot-intellij, Xcode-copilot-xcode, and UA copilot-cli/<v>.
//   Windsurf: clientInfo.name "windsurf-client" or "Windsurf" (apify/mcp-client-capabilities
//     mcp-clients.json); both already 'windsurf'. Added: Codeium, its former product name.
//   MiniMax: MiniMax Code / MiniMax Agent's MCP runtime sends clientInfo.name
//     "mavis-local-runtime-mcp" (MiniMax-AI/minimax-code
//     packages/agent-modules/mcp/src/runtime/connection-pool.ts); its own HTTP calls send UA
//     "MiniMaxAgent" / "MiniMaxCode". Any name or UA containing "minimax" is MiniMax.
//   Gemini CLI: clientInfo.name "gemini-cli-mcp-client" (google-gemini/gemini-cli
//     packages/core/src/tools/mcp-client.ts). Already 'gemini' through the existing rule, and
//     it STAYS 'gemini' (that label predates this change); pinned by the tests.
//   Google ADK (Python): clientInfo.name "google-adk" (google/adk-python
//     src/google/adk/tools/mcp_tool/session_context.py) and User-Agent
//     "google-adk/<version> gl-python/<version>" on MCP HTTP connections
//     (mcp_session_manager.py merge_tracking_headers, utils/_client_labels_utils.py). The name
//     already landed as the raw label 'google-adk'; it is now a known platform with the SAME
//     label, so an X-MCP-Platform header can name it too and a stateless call is tagged by UA.
//     ADK for TypeScript sends clientInfo.name "MCPClient" (google/adk-js
//     core/src/tools/mcp/mcp_session_manager.ts), a generic name: not identifiable.

const NAME_RULES = [
  [/(^|[^a-z])visual[\s_-]*studio[\s_-]*code([^a-z]|$)/i, 'copilot'],
  [/codeium/i, 'windsurf'],
  [/minimax|^mavis-local-runtime/i, 'minimax'],
  [/(^|[^a-z])google[\s_-]*adk([^a-z]|$)/i, 'google-adk'],
];

const UA_RULES = [
  [/^visual studio code(\s*-\s*insiders)?\//i, 'copilot'],
  [/codeium/i, 'windsurf'],
  [/minimax/i, 'minimax'],
  [/(^|[\s(])google-adk\//i, 'google-adk'],
];

const _first = (rules, s) => {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  for (const [re, label] of rules) if (re.test(t)) return label;
  return '';
};

// A platform label for a clientInfo.name (or an explicit platform header), or ''.
export function recognizedClientFromName(name) { return _first(NAME_RULES, name); }

// A platform label for a User-Agent, or ''.
export function recognizedClientFromUa(ua) { return _first(UA_RULES, ua); }

export const RECOGNIZED_LABELS = Object.freeze(['copilot', 'windsurf', 'minimax', 'google-adk']);
