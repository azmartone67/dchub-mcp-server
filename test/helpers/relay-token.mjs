// relay-token.mjs — shared by the paid-field leak scans. Not a test file.
//
// The wall's signed /upgrade/h/<base64url>.<32 hex> link changes every call (session id,
// timestamp, HMAC). Read as text it can spell a paid fragment by chance:
//   - mcp#1303 smoke (2026-11-07) failed "leaked 0.37" on ...OTQ0.3757d53b...
//   - mcp#1308 smoke (2026-11-07) failed "41.5" in keyless-full-trial
// Both were a token, not a value. Blank the token before a substring scan.
//
// The clock does the same: every answer carries retrieved_at / generated_at stamps.
//   - main smoke 2026-11-12 19:15Z failed "anonymous state=NM: leaked 46.4" on
//     "retrieved_at":"2026-11-12T19:15:46.458Z" with every paid field withheld.
// Blank ISO-8601 date-times too (date-only values such as data_as_of are kept).
export const RELAY_TOKEN = /\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}/g;
export const ISO_DATETIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
export const scrubRelayTokens = (s) => s.replace(RELAY_TOKEN, '/upgrade/h/<token>').replace(ISO_DATETIME, '<ts>');
