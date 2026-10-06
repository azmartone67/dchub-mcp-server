// Log hygiene for server.mjs: no session id, API key, bearer token or client IP reaches a log line.
//   logId(v)         one-way tag for an identifier (a session id, a bearer token): 'h-' + 8 hex of sha256.
//                    Stable, so lines about the same session still correlate; it reveals none of the
//                    input. To match a log line to a database row, hash the column the same way
//                    (left(encode(sha256(session_id::bytea), 'hex'), 8)).
//   keyKind(k)       the literal public prefix of an API key ('dch_live_…'), never a secret character.
//   scrubLogText(v)  free text (an error message or stack): keys, bearer tokens, JWTs, secret-looking
//                    query parameters, UUIDs and IPv4 addresses replaced before the text is written.
// Pure, no I/O.
import { createHash } from 'node:crypto';

export function logId(v) {
  const s = v === undefined || v === null ? '' : String(v);
  if (!s) return '-';
  return 'h-' + createHash('sha256').update(s).digest('hex').slice(0, 8);
}

const KEY_PREFIXES = ['dch_live_', 'dch_trial_', 'dchub_', 'dch_'];
export function keyKind(k) {
  const s = k === undefined || k === null ? '' : String(k);
  if (!s) return 'none';
  const p = KEY_PREFIXES.find((x) => s.startsWith(x));
  return p ? p + '…' : 'key';
}

const RULES = [
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g, '[jwt]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]'],
  [/\b(dch(?:ub)?_(?:live_|trial_)?)[A-Za-z0-9_-]{6,}/g, '$1[redacted]'],
  [/([?&](?:api_?key|access_token|token|key|code|session_?id|sid)=)[^&\s"'`)]+/gi, '$1[redacted]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]'],
  [/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, '[ip]'],
];
export function scrubLogText(v) {
  let s;
  try { s = typeof v === 'string' ? v : (v && v.stack) || (v && v.message) || String(v); } catch (_) { s = ''; }
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s;
}
