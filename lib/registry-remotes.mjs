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
// Listed LAST, on purpose (owner decision 2026-10-27, Grok finding: every other
// directory hands out the plain https://dchub.cloud/mcp and the registry entry
// did not): /mcp. It sits after /mcp/registry so remotes[0] stays the cascade tag.
// Cost, accepted: a client that picks the bare /mcp from this list is
// indistinguishable from direct traffic (the r-cascade-path concern, 2026-09-04).
// Checked 2026-10-27 against /v0/servers?search=dchub&version=latest: no other
// entry holds /mcp (io.github.pipeworx-io/dchub points at gateway.pipeworx.io),
// so the registry's one-server-per-remote rule does not refuse it.
// Listed SECOND-TO-LAST (owner move 2, 2026-11-09): /mcp/core, the ten-tool core
// profile (lib/core-profile.mjs, docs/core-profile.md), for hosts that load DC Hub
// beside other MCP servers. Measured 2026-11-09: tools/list is 16.6 KB on /mcp/core
// against 210.7 KB on /mcp. It sits before /mcp so the bare canonical path stays
// last and remotes[0] stays the cascade tag; it is an ALTERNATE, not the default
// (_meta canonicalRemote stays /mcp). A remote carries only type + url, so its
// label rides in _meta publisher-provided `remoteProfiles` (REMOTE_PROFILE_LABELS).
// CORE_PATH and the tool count are restated here, not imported: lib/core-profile.mjs
// imports zod, and scripts/sync-tools-manifest.mjs (which imports this file) runs in
// test/helpers/repo-sandbox.mjs copies that have no node_modules. The restatement is
// pinned equal to lib/core-profile.mjs (CORE_PATH, CORE_TOOL_NAMES.length) by
// test/registry-remotes.test.mjs, so it cannot drift silently.
// Checked 2026-11-09 against /v0/servers?search=dchub&version=latest: no other
// entry holds /mcp/core.
import { CLAUDE_PATH } from './claude-directory.mjs';
import { GROK_PATH } from './grok-profile.mjs';
import { MCP_OAUTH_PATH } from './mcp-oauth-path.mjs';

export const REGISTRY_ORIGIN = 'https://dchub.cloud';

export const CORE_REMOTE_PATH = '/mcp/core';
export const CORE_REMOTE_TOOL_COUNT = 10;

export const REGISTRY_REMOTE_PATHS = Object.freeze([
  '/mcp/registry',   // the cascade path (remotes[0]); must stay first
  CLAUDE_PATH,       // /mcp/claude — the Claude Connectors Directory profile
  GROK_PATH,         // /mcp/grok — the Grok-sized listing
  MCP_OAUTH_PATH,    // /mcp/oauth — opt-in OAuth door, same catalog (owner 2026-10-17, P1-8)
  CORE_REMOTE_PATH,  // /mcp/core — the ten-tool core profile, an alternate for multi-server hosts
  '/mcp',            // the plain canonical path, listed last so remotes[0] stays the cascade tag
]);

export const REGISTRY_REMOTE_EXCLUDED = Object.freeze({
  '/mcp/chatgpt': 'in OpenAI app-directory review; catalog frozen',
});

// The label each ALTERNATE remote carries in server.json _meta publisher-provided
// `remoteProfiles` (keyed by full URL). The count is CORE_REMOTE_TOOL_COUNT, pinned to
// CORE_TOOL_NAMES.length by test/registry-remotes.test.mjs.
export const REMOTE_PROFILE_LABELS = Object.freeze({
  [CORE_REMOTE_PATH]: `core profile: ${CORE_REMOTE_TOOL_COUNT} tools for multi-server hosts`,
});

export function remoteProfiles(origin = REGISTRY_ORIGIN) {
  return Object.fromEntries(Object.entries(REMOTE_PROFILE_LABELS).map(([p, label]) => [`${origin}${p}`, label]));
}

export function registryRemotes(origin = REGISTRY_ORIGIN) {
  return REGISTRY_REMOTE_PATHS.map((p) => ({ type: 'streamable-http', url: `${origin}${p}` }));
}
