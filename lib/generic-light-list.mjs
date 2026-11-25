// generic-light-list.mjs: the ten-tool light list for UNNAMED clients on bare /mcp, as a 50/50 test with a holdout
// (Grok spec "MCP growth, stability first", item 8; owner approved it as a test behind a holdout, 2026-11-24).
// Flag DCHUB_GENERIC_LIGHT_LIST, default OFF: only 1/true/yes/on turns it on. Off, nothing here runs.
//
// WHY. Callers that name no client ("mcp-generic-client" in the funnel: 1,809 calls from 170 IPs in the 30 days to
// 2026-11-24, /api/v1/mcp/funnel calls_by_platform_30d) get the full catalog on /mcp (98 tools, ~231 KB of schema
// measured 2026-11-24), while named coding clients and IDE hosts get the light list, execute_plan first
// (lib/light-profile.mjs, mcp#1437). This test asks whether the light list lifts tool use for the unnamed callers too.
//
// WHO IS IN THE TEST: a request on bare /mcp (never /mcp/claude, /mcp/chatgpt, /mcp/light, a pack or a client arrival
// path) whose client the existing rules do not name: lib/light-profile.mjs lightForRequest is false AND the server's
// platform classifier (server.mjs detectPlatformFromInit) answers 'mcp-generic-client' (a generic clientInfo.name and a
// User-Agent that names nothing) or 'mcp' (no clientInfo.name and a User-Agent that names nothing). A caller who asks
// for the full catalog (?catalog=full, X-DCHUB-Catalog: full) or the core list (?tools=core) is not in the test.
//
// ARM: the shared assignment of lib/monetization-experiments.mjs, bucket = sha256(identity + 'generic_light_list') % 100,
// 0-49 treatment, 50-99 holdout. identity = pk-<sha256(api key)> with a key, else ip-<sha256(caller ip)>. No identity,
// no arm: the full list. A session keeps the arm it was given at initialize.
//   treatment: the light list (LIGHT_TOOLS, execute_plan first, ten tools) and the light-list handshake, whose
//              "Tools:" line names only listed tools.
//   holdout:   the full catalog and today's handshake, unchanged.
// A LISTING SCOPE ONLY: tools/call accepts every tool by name in both arms, and every gate (quota, keyless, key) runs
// exactly as on /mcp. Nothing here reads or writes a key, a trial, a quota or a wall.
import { GENERIC_LIGHT_LIST, armFor } from './monetization-experiments.mjs';

export const GENERIC_LIGHT_FLAG = 'DCHUB_GENERIC_LIGHT_LIST';
export const GENERIC_LIGHT_TEST = GENERIC_LIGHT_LIST;
// The classifier's answers for a caller that names no client (server.mjs detectPlatformFromInit).
export const GENERIC_PLATFORMS = Object.freeze(new Set(['mcp-generic-client', 'mcp']));

export function genericLightOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[GENERIC_LIGHT_FLAG]) || '').trim());
}

export function isGenericPlatform(platform) {
  return GENERIC_PLATFORMS.has(String(platform || '').trim().toLowerCase());
}

// 'treatment' | 'holdout' for an identity, or null when there is nothing stable to key on.
export function genericLightArm(identity) {
  if (!identity || typeof identity !== 'string') return null;
  return armFor(identity, GENERIC_LIGHT_LIST);
}
