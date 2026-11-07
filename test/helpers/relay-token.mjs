// relay-token.mjs — shared by the paid-field leak scans. Not a test file.
//
// The wall's signed /upgrade/h/<base64url>.<32 hex> link changes every call (session id,
// timestamp, HMAC). Read as text it can spell a paid fragment by chance:
//   - mcp#1303 smoke (2026-11-07) failed "leaked 0.37" on ...OTQ0.3757d53b...
//   - mcp#1308 smoke (2026-11-07) failed "41.5" in keyless-full-trial
// Both were a token, not a value. Blank the token before a substring scan.
export const RELAY_TOKEN = /\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/g;
export const scrubRelayTokens = (s) => s.replace(RELAY_TOKEN, '/upgrade/h/<token>');
