// Item 5 (Grok master task 2026-10-16, owner decision 2026-10-17): /mcp/oauth,
// the opt-in OAuth URL for the full /mcp profile.
//
// Bare /mcp answers a keyless initialize with 200 so anonymous agents keep
// working, which means a client that discovers OAuth from a 401 (the MCP
// 2025-06-18 authorization flow: Claude custom connectors, VS Code, Cursor,
// Copilot Studio) never starts a sign-in there. This URL serves the same tools
// and data as /mcp and answers an initialize or tools/call that carries NO
// credential with 401 + WWW-Authenticate, the pattern /mcp/grok/oauth (G5) and
// /mcp/chatgpt/oauth already run. tools/list stays open so a catalog renders
// before sign-in. Any credential skips the challenge: X-API-Key, ?api_key=, a
// DC Hub key sent as a Bearer, or an AuthKit token. A present-but-invalid
// bearer is answered by the shared r-invalid-bearer-401 gate, as on /mcp.
//
// resource stays https://dchub.cloud/mcp (owner, 2026-10-17): the challenge
// names /.well-known/oauth-protected-resource/mcp, whose resource is the
// audience resolveWorkosBearer enforces by default, so a token minted for it is
// accepted here with no new audience, no WorkOS resource indicator and no
// Cloudflare edit. Kill switch: DCHUB_MCP_OAUTH_DISABLE=1 (serves keyless).

export const MCP_OAUTH_PATH = '/mcp/oauth';
export const MCP_OAUTH_SOURCE = 'mcp-oauth';

export const MCP_OAUTH_CHALLENGE =
  'Bearer resource_metadata="https://dchub.cloud/.well-known/oauth-protected-resource/mcp", '
  + 'scope="openid profile email offline_access"';

export const MCP_OAUTH_MESSAGE =
  'Sign-in required: this DC Hub URL uses OAuth. Complete the sign-in advertised in '
  + 'WWW-Authenticate (RFC 9728 resource_metadata), or send a DC Hub key in the X-API-Key header. '
  + 'For keyless access use https://dchub.cloud/mcp.';

export function isMcpOauthRequest(req) {
  return (req?.path || '').replace(/\/+$/, '') === MCP_OAUTH_PATH;
}

// Pure decision: challenge only a credential-less initialize / tools/call on
// /mcp/oauth, only while WorkOS validation is on (without it a token could not
// be validated, so the URL serves keyless rather than lock the caller out), and
// never with the kill switch set.
export function mcpOauthChallengeEligible({ isOauthPath, hasCredential, method, workosEnabled, disableRaw }) {
  if (!isOauthPath) return false;
  if (hasCredential) return false;
  if (method !== 'initialize' && method !== 'tools/call') return false;
  if (!workosEnabled) return false;
  if (/^(1|true|yes|on)$/i.test(String(disableRaw || ''))) return false;
  return true;
}
