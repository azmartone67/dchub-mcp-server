// session-client-tag.mjs: the client name a session was initialized with, carried INSIDE its session id, so every
// replica can read it (2026-11-25, Grok "Cursor tool-list fixes" item 1).
//
// WHY. dchub-mcp-server runs 3 replicas (us-west2:2 + us-east4:1) with no sticky routing, and each process keeps the
// initialize's clientInfo.name only in its own memory (sessionMeta, _PLATFORM_RECALL). A tools/list that lands on
// another replica is served statelessly with no client name, so the light-list rules (lib/light-profile.mjs) see only
// the User-Agent. Cursor names itself in clientInfo ("cursor-vscode"), not in its UA, so it got the full 98-tool catalog
// (~222 KB) instead of the 11-tool light list: measured live 2026-11-25, 5 of 10 list-only sessions from one client
// (Grok saw 4 of 10). The same gap tagged every stale-sid request platform=mcp in the logs.
//
// HOW. The session id stays a v4 UUID (36 chars, accepted everywhere a session id is read). For a client name in
// KNOWN_CLIENT_NAMES, the last 8 hex digits are replaced by <index:2 hex><mac:6 hex>, where
// mac = HMAC-SHA256(secret, first 24 hex digits + ':' + index), first 6 hex (the version and variant digits are in the
// first 24, so the id stays a v4 UUID). The secret is DCHUB_INTERNAL_KEY, which
// every replica of the service shares. Any replica can then recover the name: decode, check the mac, look up the index.
// A random UUID passes the check by chance once in 16.7 million; the worst outcome of that is a list scope, never an
// entitlement (tools/call accepts every tool on every list, and no gate reads this).
//
// WHAT IT NEVER DOES: carry a key, an IP or any raw client string (only an index into the fixed table below), override a
// name the process already holds (it fills an absent one only), or mint anything but a v4 UUID. No secret: plain UUIDs.
// Kill switch DCHUB_SID_CLIENT_TAG=0 (on unless set to 0/false/no/off): minting AND reading stop.
import { createHmac, randomUUID } from 'node:crypto';

// APPEND ONLY: an id minted with index i must decode to the same name after any deploy (test pins the order).
// The light-list clients (lib/light-profile.mjs LIGHT_CLI_NAME, LIGHT_HOST_NAME) plus the other names
// lib/cli-starter.mjs reads, as their clients send them in clientInfo.name.
export const KNOWN_CLIENT_NAMES = Object.freeze([
  'cursor-vscode', 'cursor', 'Visual Studio Code', 'Visual Studio Code - Insiders', 'windsurf-client', 'Windsurf',
  'codeium', 'cline-vscode', 'Cline', 'codex-mcp-client', 'codex-cli', 'github-copilot-developer', 'copilot-cli',
  'opencode', 'workbuddy', 'clono', 'claude-code', 'gemini-cli-mcp-client', 'gemini-cli',
  // 2026-11-28: the four light-list clients added by mcp#1824 (lib/light-profile.mjs LIGHT_AGENT_NAME). Their rule is a
  // pattern, not an exact name, so a name with no exact entry is carried as its class token (CLASS_TOKENS below). The
  // token itself matches LIGHT_AGENT_NAME, so a replica that recovers it serves the same light list.
  'google-adk', 'perplexity', 'mistral', 'devin',
]);
const _INDEX = new Map(KNOWN_CLIENT_NAMES.map((n, i) => [n.toLowerCase(), i]));

// A client name with no exact entry that matches one of these patterns is tagged with the class token. Same patterns
// as LIGHT_AGENT_NAME (test/sid-client-tag-cursor-light-1125.test.mjs pins that each token passes it). First match wins.
export const CLASS_TOKENS = Object.freeze([
  [/(^|[^a-z])(google[- _]?)?adk([^a-z]|$)/i, 'google-adk'],
  [/perplexity/i, 'perplexity'],
  [/mistral|le ?chat/i, 'mistral'],
  [/(^|[^a-z])(devin|cascade)([^a-z]|$)/i, 'devin'],
]);
function _indexFor(clientName) {
  const n = String(clientName || '').trim();
  const exact = _INDEX.get(n.toLowerCase());
  if (exact !== undefined) return exact;
  for (const [re, token] of CLASS_TOKENS) if (re.test(n)) return _INDEX.get(token);
  return undefined;
}

export function sidClientTagOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_SID_CLIENT_TAG) || '').trim());
}

function _secret(env) { return String((env && env.DCHUB_INTERNAL_KEY) || ''); }
function _mac(secret, head24, idx2) {
  return createHmac('sha256', secret).update(`${head24}:${idx2}`).digest('hex').slice(0, 6);
}

// A session id for a client named `clientName`: a tagged UUID when the name is known, the flag is on and a secret is
// set; a plain randomUUID() otherwise. `uuid` is injectable for tests.
export function mintSessionId(clientName, { env = process.env, uuid = randomUUID } = {}) {
  const id = uuid();
  try {
    if (!sidClientTagOn(env)) return id;
    const secret = _secret(env);
    const i = _indexFor(clientName);
    if (!secret || i === undefined) return id;
    const hex = id.replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/i.test(hex)) return id;
    const head = hex.slice(0, 24).toLowerCase();
    const idx2 = i.toString(16).padStart(2, '0');
    const full = head + idx2 + _mac(secret, head, idx2);
    return `${full.slice(0, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}-${full.slice(16, 20)}-${full.slice(20)}`;
  } catch (_) { return id; }
}

// The known client name a tagged session id carries, or null (untagged, forged, flag off, no secret).
export function clientNameFromSid(sid, { env = process.env } = {}) {
  try {
    if (!sid || !sidClientTagOn(env)) return null;
    const secret = _secret(env);
    if (!secret) return null;
    const s = String(sid).trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return null;
    const hex = s.replace(/-/g, '').toLowerCase();
    const head = hex.slice(0, 24);
    const idx2 = hex.slice(24, 26);
    if (hex.slice(26) !== _mac(secret, head, idx2)) return null;
    const i = parseInt(idx2, 16);
    return KNOWN_CLIENT_NAMES[i] || null;
  } catch (_) { return null; }
}
