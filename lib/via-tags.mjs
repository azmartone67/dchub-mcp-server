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

// The value to forward as X-DCHub-Via for a via outside the closed social/wall set: the registered tag, else `other`.
// `via` is what viaFromRequest returned (already normalized or null). Pure; null when there is nothing to forward.
export function keyMintVia(via) {
  if (typeof via !== 'string' || !via.trim()) return null;
  return directoryViaTag(via) || OTHER_VIA;
}
