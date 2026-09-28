// grok-ident-log.mjs — G4 of the 2026-09-27 Grok path audit: find out whether
// Grok sends anything stable enough to count a Grok user by.
//
// WHY. DC Hub's agent identity is md5(first public client IP) and Grok opens a
// new MCP session per tool call (DC Hub's own funnel note); the audit reports
// it also rotates egress IP. So 34 Grok calls can read as up to 34 "agents",
// and nothing today says whether xAI sends a per-connector or per-user signal
// we could key on instead. This logs, for Grok requests only, for seven days:
//   · header NAMES (never values — any of them could carry a credential),
//   · user-agent, clientInfo name/version and protocol version,
//   · whether a session id was sent, whether this process knows it, how many
//     earlier requests carried it, and a keyed hash of it,
//   · a keyed hash of the caller IP, to see whether one session/connector
//     arrives from many addresses.
// The hashes are HMAC-SHA256 under a per-process random key unless
// DCHUB_INTERNAL_KEY is set (then stable across restarts), truncated to 12 hex
// characters: enough to see repeats, not reversible to the input.
//
// TIME-BOXED. GROK_IDENT_LOG_UNTIL turns it off by itself; nothing needs to be
// reverted for it to stop. Kill switch before then: DCHUB_GROK_IDENT_LOG=0.

import { createHmac, randomBytes } from 'node:crypto';

export const GROK_IDENT_LOG_UNTIL = '2026-10-05T00:00:00Z';
const _UNTIL_MS = Date.parse(GROK_IDENT_LOG_UNTIL);
const _HASH_KEY = process.env.DCHUB_INTERNAL_KEY || randomBytes(32).toString('hex');

export function grokIdentLogActive(now = Date.now(), env = process.env) {
  if (/^(0|false|no|off)$/i.test(String(env.DCHUB_GROK_IDENT_LOG || ''))) return false;
  return Number.isFinite(_UNTIL_MS) && now < _UNTIL_MS;
}

function _h(v) {
  if (v === undefined || v === null || v === '') return null;
  return createHmac('sha256', _HASH_KEY).update(String(v)).digest('hex').slice(0, 12);
}

function _via(req) {
  try { return new URL(req.url || '', 'http://_').searchParams.get('via') || ''; } catch (_) { return ''; }
}

// A Grok request: the /mcp/grok paths, a ?via=grok connector URL, Grok's
// connector user-agent (grok-connectors-manager), a clientInfo name naming
// Grok, or the explicit platform header. Any one is enough to log; the record
// says which ones matched, so a false positive is visible in the data.
export function grokSignals(req, recalledClientName = '') {
  const path = (req?.path || '').replace(/\/+$/, '');
  const ua = String(req?.headers?.['user-agent'] || '');
  const ci = String(req?.body?.params?.clientInfo?.name || recalledClientName || '');
  const hdr = String(req?.headers?.['x-mcp-platform'] || req?.headers?.['x-client-source'] || '');
  const out = [];
  if (path === '/mcp/grok' || path.startsWith('/mcp/grok/')) out.push('path');
  if (/^grok$/i.test(_via(req))) out.push('via');
  if (/grok/i.test(ua)) out.push('ua');
  if (/grok/i.test(ci)) out.push('client_info');
  if (/grok/i.test(hdr)) out.push('platform_header');
  return out;
}

// How many requests have carried each session id, bounded so a flood of
// fresh ids cannot grow it without limit (oldest dropped first).
const _SEEN = new Map();
const _SEEN_MAX = 5000;
function _bumpSeen(sid) {
  if (!sid) return 0;
  const prior = _SEEN.get(sid) || 0;
  _SEEN.delete(sid);
  _SEEN.set(sid, prior + 1);
  if (_SEEN.size > _SEEN_MAX) _SEEN.delete(_SEEN.keys().next().value);
  return prior;
}

export function grokIdentRecord(req, { sessionKnown = false, recalledClientName = '', clientIp = '', signals } = {}) {
  const h = req?.headers || {};
  const b = req?.body || {};
  const sid = h['mcp-session-id'] ? String(h['mcp-session-id']) : '';
  const ci = (b.params && b.params.clientInfo) || {};
  return {
    until: GROK_IDENT_LOG_UNTIL,
    signals: signals || grokSignals(req, recalledClientName),
    path: (req?.path || '').slice(0, 60),
    method: typeof b.method === 'string' ? b.method.slice(0, 60) : null,
    tool: (b.method === 'tools/call' && b.params && typeof b.params.name === 'string') ? b.params.name.slice(0, 80) : null,
    ua: String(h['user-agent'] || '').slice(0, 200) || null,
    client_name: (typeof ci.name === 'string' ? ci.name : recalledClientName || '').slice(0, 120) || null,
    client_version: typeof ci.version === 'string' ? ci.version.slice(0, 60) : null,
    protocol_version: (b.params && typeof b.params.protocolVersion === 'string') ? b.params.protocolVersion.slice(0, 20)
      : (typeof h['mcp-protocol-version'] === 'string' ? h['mcp-protocol-version'].slice(0, 20) : null),
    header_names: Object.keys(h).map((k) => k.toLowerCase()).sort(),
    session: { sent: !!sid, known: !!sessionKnown, prior_requests: _bumpSeen(sid), id_h: _h(sid) },
    ip_h: _h(clientIp),
  };
}
