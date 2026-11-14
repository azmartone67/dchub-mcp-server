// lib/via-tags.mjs: directory and partner `via` tags for the key-mint channel (owner 2026-11-12, 3:18 PM Phoenix).
//
// A connector URL, a listing or a partner's embed can say where it came from (?via=<name> or X-DCHub-Via). The
// per-call counter (dchub-backend routes/via_attribution.py) already counts any well-formed name. The KEY-MINT
// channel was closed to six social/wall names (VIA_FUNNEL_CHANNELS in server.mjs), so a key minted by an agent
// that arrived through Glama, Smithery, Pipeworx and the like read "(no via)". This module widens that to a REGISTERED, BOUNDED set and folds every other well-formed name into
// `other`, so a free-text value can never grow the key-level report.
//
//   * a registered directory or partner tag, or one of its aliases ("mcp.so" -> mcpso): forwarded as the tag;
//   * any other name normalizeVia accepted (lowercase, [a-z0-9._-], 1-40 chars, not our own dchub/qa/test/probe
//     prefix): forwarded as `other`;
//   * anything normalizeVia rejected never reaches here (it is null).
//
// The list is restated in dchub-backend routes/via_funnel.py (DIRECTORY_TAGS); the backend folds anything it does not
// know into `other` too, so the two lists can differ by a name without a wrong count, only a coarser one. Counts only,
// never access. Pure.

export const DIRECTORY_VIA_TAGS = Object.freeze([
  'glama', 'smithery', 'pulsemcp', 'mcpso', 'mcpmarket', 'context7', 'docker', 'arcade', 'muse', 'registry',
  'pipeworx', 'anythingmcp', 'airbyte', 'filament', 'octo-mcp', 'arcobi', 'honua', 'inframap', 'lobehub',
]);
export const OTHER_VIA = 'other';

// Spellings a listing or a partner is likely to use for a registered tag.
export const DIRECTORY_VIA_ALIASES = Object.freeze({
  'mcp.so': 'mcpso', 'mcp-so': 'mcpso',
  'mcp-market': 'mcpmarket', 'mcp.market': 'mcpmarket', 'mcpmarket.com': 'mcpmarket',
  'pulse': 'pulsemcp', 'pulse-mcp': 'pulsemcp',
  'official-registry': 'registry', 'mcp-registry': 'registry', 'official_registry': 'registry',
  'docker-mcp': 'docker', 'docker-hub': 'docker',
  'glama.ai': 'glama', 'smithery.ai': 'smithery',
  'any-mcp': 'anythingmcp', 'anything-mcp': 'anythingmcp',
  'octo': 'octo-mcp', 'octopus': 'octo-mcp',
  'muse-meta': 'muse',
});

const _SET = new Set(DIRECTORY_VIA_TAGS);

// The registered tag for a via the gateway already normalized, or null. Pure.
export function directoryViaTag(via) {
  if (typeof via !== 'string') return null;
  const v = via.trim().toLowerCase();
  if (!v) return null;
  if (_SET.has(v)) return v;
  const a = DIRECTORY_VIA_ALIASES[v];
  return a && _SET.has(a) ? a : null;
}

// Client tags (owner E6, 2026-11-14): the MCP clients an install page (dchub.cloud/connect/<client>) or a README
// one-line setup names in ?via=. Forwarded as the canonical tag instead of `other`, one spelling per client:
//   * Windsurf: devin, cascade (Windsurf's agent) and codeium are windsurf;
//   * GitHub Copilot is two clients, never folded together: the Copilot CLI is `copilot-cli` (its MCP client says
//     github-copilot-developer) and Copilot in VS Code is `github_copilot` (vscode, github-copilot, bare copilot).
// Restated in dchub-backend routes/via_attribution.py (CLIENT_TAGS / CLIENT_ALIASES), which normalizes the per-call
// counter, the key stamp and the paid row the same way. Counts only, never access. Pure.
export const CLIENT_VIA_TAGS = Object.freeze([
  'cursor', 'windsurf', 'github_copilot', 'copilot-cli', 'claude', 'claude-code', 'claude-desktop', 'chatgpt', 'codex',
  'gemini', 'gemini-cli', 'cline', 'continue', 'zed', 'perplexity', 'grok', 'opencode', 'antigravity',
]);
export const CLIENT_VIA_ALIASES = Object.freeze({
  devin: 'windsurf', cascade: 'windsurf', codeium: 'windsurf', 'windsurf-client': 'windsurf',
  copilot_cli: 'copilot-cli', copilotcli: 'copilot-cli', 'github-copilot-cli': 'copilot-cli',
  'gh-copilot': 'copilot-cli', 'github-copilot-developer': 'copilot-cli',
  copilot: 'github_copilot', 'github-copilot': 'github_copilot', githubcopilot: 'github_copilot',
  vscode: 'github_copilot', 'vs-code': 'github_copilot', 'visual-studio-code': 'github_copilot',
  'vscode-copilot': 'github_copilot',
  'claude-ai': 'claude', 'claude.ai': 'claude', openai: 'chatgpt',
  'codex-cli': 'codex', 'codex-mcp-client': 'codex', gemini_cli: 'gemini-cli',
  'cursor-vscode': 'cursor', claude_code: 'claude-code', claude_desktop: 'claude-desktop',
});
const _CLIENT_SET = new Set(CLIENT_VIA_TAGS);

// The canonical client tag for a via, or null. Pure.
export function clientViaTag(via) {
  if (typeof via !== 'string') return null;
  const v = via.trim().toLowerCase();
  if (!v) return null;
  const t = Object.prototype.hasOwnProperty.call(CLIENT_VIA_ALIASES, v) ? CLIENT_VIA_ALIASES[v] : v;
  return _CLIENT_SET.has(t) ? t : null;
}

// The value to forward as X-DCHub-Via for a via outside the closed social/wall set: the registered directory/partner
// tag, else the client tag, else `other`.
// `via` is what viaFromRequest returned (already normalized or null). Pure; null when there is nothing to forward.
export function keyMintVia(via) {
  if (typeof via !== 'string' || !via.trim()) return null;
  return directoryViaTag(via) || clientViaTag(via) || OTHER_VIA;
}
