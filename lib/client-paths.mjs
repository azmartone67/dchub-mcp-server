// client-paths.mjs — /mcp/gemini, /mcp/copilot, /mcp/perplexity, /mcp/cursor,
// /mcp/mistral (2026-11-18).
//
// WHY. These five URLs were already being tried by clients, and they looked
// healthy without working: the zone worker answers GET /mcp/<anything> with the
// 200 JSON description, while POST initialize reached this server and got
// `404 Cannot POST /mcp/gemini`, because none of them was in MCP_PATHS. That is
// the failure the /mcp/docker comment in server.mjs (MCP_SOURCE_PATHS) records:
// a GET-healthy path whose every install fails at initialize. Measured live
// 2026-11-18 with a keyless POST initialize: /mcp, /mcp/claude, /mcp/chatgpt,
// /mcp/core and /mcp/grok answered 200; all five paths here answered 404.
//
// WHAT EACH PATH SERVES. The full /mcp: every tool, keyless, same handlers, same
// list rules as bare /mcp. It is NOT a copy of the /mcp/claude profile. That one
// is the Claude Connectors Directory profile (lib/claude-directory.mjs): a
// 69-tool owner-approved subset with directory-policy descriptions, a response
// scrub and its traffic kept out of the relay readout. None of that review
// applies to these clients.
//
// ATTRIBUTION. Each path carries an arrival `source` tag (MCP_SOURCE_PATHS, the
// r-source-path axis), never a `platform`: platform stays "which client" and is
// read from clientInfo / User-Agent exactly as on /mcp, so no published
// per-platform number moves. Like every source path, the tag is
// caller-assertable evidence, not proof.
//
// OAUTH. Optional, as on /mcp, and on the same resource: a bearer must carry
// aud https://dchub.cloud/mcp, and the protected-resource metadata for these
// paths already names that resource (the dchub-oauth-meta zone worker answers
// /.well-known/oauth-protected-resource/mcp/<client>, the dchub-backend zone
// worker answers /mcp/<client>/.well-known/oauth-protected-resource; both say
// https://dchub.cloud/mcp, measured 2026-11-18). A per-path resource is NOT
// done here on purpose: AuthKit refuses a resource indicator it has not
// registered (invalid_target, measured 2026-10-20 for /mcp/claude and
// /mcp/oauth; only /mcp was registered), and the RFC 9728 path on dchub.cloud
// is served by dchub-oauth-meta, which is not in any repo. Naming
// https://dchub.cloud/mcp/gemini before both owner steps would break sign-in on
// the path instead of fixing it.

export const CLIENT_PATHS = Object.freeze(new Map([
  ['/mcp/gemini',     'gemini-path'],
  ['/mcp/copilot',    'copilot-path'],
  ['/mcp/perplexity', 'perplexity-path'],
  ['/mcp/cursor',     'cursor-path'],
  ['/mcp/mistral',    'mistral-path'],
]));
