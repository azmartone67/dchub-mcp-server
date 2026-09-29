// registry-remotes.mjs — which served paths the OFFICIAL MCP registry entry
// (server.json `remotes`) advertises. One allowlist; server.json is generated
// from it by scripts/sync-tools-manifest.mjs (--fix heals, check mode fails on
// drift), and test/registry-remotes.test.mjs proves every listed path is in
// MCP_PATHS and answers `initialize` on the real server.
//
// Schema (static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json,
// read 2026-09-28): `remotes` is an array of RemoteTransport with no maxItems;
// StreamableHttpTransport requires `type: "streamable-http"` and `url`
// (pattern ^https?://[^\s]+$). So several remotes are allowed.
//
// Registry rule that bounds this list (measured 2026-09-04, see server.mjs
// MCP_SOURCE_PATHS): a remote URL already used by ANOTHER server is refused
// with 400 "remote URL … is already used by server …", and deprecating the
// other entry does not release it. Every URL here must therefore be one only
// cloud.dchub/mcp-server uses. Checked 2026-09-28 against
// /v0/servers?search=dchub: the only entry holds /mcp and /mcp/registry.
//
// ORDER MATTERS: remotes[0] stays /mcp/registry. PulseMCP and Glama mirror
// remotes[0].url (REGISTRY-LISTINGS.md), and it is the shared cascade
// attribution tag test/analyst-path-selftag.test.mjs pins.
//
// NOT listed, on purpose:
//   /mcp/chatgpt — in OpenAI app-directory review; its catalog is frozen
//                  (project-chatgpt-toolset-freeze). Not advertised elsewhere
//                  until that review is done.
//   /mcp         — the canonical path is _meta.canonicalRemote; listing it as a
//                  remote would make registry arrivals indistinguishable from
//                  direct traffic again (r-cascade-path, 2026-09-04).
import { CLAUDE_PATH } from './claude-directory.mjs';
import { GROK_PATH } from './grok-profile.mjs';

export const REGISTRY_ORIGIN = 'https://dchub.cloud';

export const REGISTRY_REMOTE_PATHS = Object.freeze([
  '/mcp/registry',   // the cascade path (remotes[0]); must stay first
  CLAUDE_PATH,       // /mcp/claude — the Claude Connectors Directory profile
  GROK_PATH,         // /mcp/grok — the Grok-sized listing
]);

export const REGISTRY_REMOTE_EXCLUDED = Object.freeze({
  '/mcp/chatgpt': 'in OpenAI app-directory review; catalog frozen',
  '/mcp': 'canonical path lives in _meta.canonicalRemote, not in remotes',
});

export function registryRemotes(origin = REGISTRY_ORIGIN) {
  return REGISTRY_REMOTE_PATHS.map((p) => ({ type: 'streamable-http', url: `${origin}${p}` }));
}
