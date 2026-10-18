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

// RFC 9728 §3.3 / §5.1 (D1, owner 2026-10-18): the URL the client connects to should name its
// OWN metadata, whose `resource` is that URL. Default OFF, as DCHUB_CHATGPT_OAUTH_OWN_RESOURCE
// is for /mcp/chatgpt/oauth. Three things must already be true before turning it on, and none
// is in this repo: (1) the dchub-oauth-meta zone worker answers
// GET /.well-known/oauth-protected-resource/mcp/oauth with resource
// https://dchub.cloud/mcp/oauth (today it names /mcp for every suffix), (2) WorkOS/AuthKit will
// issue a token whose aud is that resource (resource indicator registered), and then
// (3) set DCHUB_MCP_OAUTH_OWN_RESOURCE=1 on BOTH Railway services. The server already accepts
// tokens minted for either resource on this path, so flipping the flag never strands a client.
export const MCP_OAUTH_RESOURCE = 'https://dchub.cloud/mcp/oauth';
export const MCP_OAUTH_PRM_URL = 'https://dchub.cloud/.well-known/oauth-protected-resource/mcp/oauth';
export const MCP_OAUTH_CHALLENGE_OWN =
  `Bearer resource_metadata="${MCP_OAUTH_PRM_URL}", scope="openid profile email offline_access"`;
export function mcpOauthChallenge(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.DCHUB_MCP_OAUTH_OWN_RESOURCE || ''))
    ? MCP_OAUTH_CHALLENGE_OWN : MCP_OAUTH_CHALLENGE;
}
// The document the origin serves at MCP_OAUTH_PRM_URL's path, for the worker to mirror or pass
// through. Same shape as CLAUDE_PRM; only `resource` differs from the /mcp document.
export const MCP_OAUTH_PRM = Object.freeze({
  resource: MCP_OAUTH_RESOURCE,
  resource_name: 'DC Hub Intelligence MCP Server',
  resource_documentation: 'https://dchub.cloud/integrations/mcp',
  authorization_servers: ['https://beloved-stream-52.authkit.app'],
  bearer_methods_supported: ['header'],
  scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  mcp_protocol_version: '2025-06-18',
});

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
