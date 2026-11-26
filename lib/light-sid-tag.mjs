// light-sid-tag.mjs: the light-list decision survives a request landing on another replica (2026-11-25).
//
// WHY. /mcp picks the light list from the client's name (clientInfo.name on initialize, e.g. "cursor-vscode"). Later
// requests carry no clientInfo, so the server recalls the name from the session (sessionMeta, _PLATFORM_RECALL). Both
// live in ONE process's memory. Railway runs 3 replicas with no sticky routing, and DCHUB_STALE_SESSION_SERVE answers
// a request for a session this process does not hold. A tools/list that lands on another replica therefore saw no name
// and served the full catalog: 4 of 10 list-only cursor-vscode probes on 2026-11-25 21:07-21:12Z got 98 tools
// (~223 KB) instead of the light list (~29 KB).
//
// WHAT. The one thing every replica sees on every request is the Mcp-Session-Id the server minted. For a client the
// light rules name, the server mints a UUID whose last 8 hex digits are a hash of the rest plus a 2-bit class (CLI or
// IDE host, starter order or not). Any replica can recompute it. A plain random UUID matches by chance 1 time in
// 2^32 x 4 classes. The id is still a valid v4 UUID, so nothing that stores or validates it changes.
//
// No secret: forging the tag only gets a caller the light list, which /mcp/light serves to anyone. The tag is read
// only to fill an ABSENT client name for the light-list decision; it never overrides a name and is not used for
// telemetry or attribution. Kill switch: DCHUB_LIGHT_SID_TAG=0 (on unless 0/false/no/off) stops minting tagged ids
// and stops reading them.

import { createHash, randomUUID } from 'node:crypto';
import { isLightCliIdentity, isLightHostIdentity } from './light-profile.mjs';
import { isCliStarterIdentity } from './cli-starter.mjs';

const SALT = 'dchub-light-sid-v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Class codes. Each maps to a representative identity that gives the same answers from the light rules
// (lib/light-profile.mjs) and the starter rule (lib/cli-starter.mjs) as the real client did at initialize.
export const SID_CLASSES = Object.freeze({
  1: { cli: true, starter: true, clientName: 'codex-mcp-client' },
  2: { cli: true, starter: false, clientName: 'claude-code' },
  3: { host: true, starter: true, clientName: 'cursor-vscode' },
  4: { host: true, starter: false, clientName: 'Visual Studio Code' },
});

export function lightSidTagOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_LIGHT_SID_TAG) || '').trim());
}

function tagFor(head, code) {
  return createHash('sha256').update(`${SALT}|${head.toLowerCase()}|${code}`).digest('hex').slice(0, 8);
}

// The class code for an identity, or 0 when the light rules do not name it.
export function classOf(identity = {}) {
  const cli = isLightCliIdentity(identity);
  const host = isLightHostIdentity(identity);
  if (!cli && !host) return 0;
  const starter = isCliStarterIdentity(identity);
  if (cli) return starter ? 1 : 2;
  return starter ? 3 : 4;
}

// A session id for this identity: tagged when the light rules name it (and the switch is on), else a plain UUID.
export function mintSessionId(identity = {}, env = process.env, rand = randomUUID) {
  const id = rand();
  try {
    if (!lightSidTagOn(env) || !UUID_RE.test(id)) return id;
    const code = classOf(identity);
    if (!code) return id;
    const head = id.slice(0, 28);   // everything before the last 8 hex digits
    return head + tagFor(head, code);
  } catch (_) { return id; }
}

// The class a tagged session id carries, or null (untagged, malformed, or the switch is off).
export function sidLightClass(sid, env = process.env) {
  try {
    if (!lightSidTagOn(env) || typeof sid !== 'string' || !UUID_RE.test(sid)) return null;
    const head = sid.slice(0, 28);
    const tail = sid.slice(28).toLowerCase();
    for (const code of [1, 2, 3, 4]) {
      if (tagFor(head, code) === tail) return SID_CLASSES[code];
    }
    return null;
  } catch (_) { return null; }
}
