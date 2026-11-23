// lib/email-nudge-once.mjs -- the get_api_key email nudge, once per MCP session (#1594; QA 2026-11-23, Des Moines IA).
//
// WHY. With DCHUB_WALL_IDENTITY_V2 on, the wall's email ask reads "Share an email with get_api_key to keep this answer
// and get a daily change note..." (lib/wall-identity-v2.mjs EMAIL_ASK_LEAD). It rides a keyless answer as the
// structured email_ask's `copy`, an execute_plan next_tools entry's `say`, the floor line and the JSON block that
// mirrors structuredContent. Each step that places it keeps its own once-per-(session, tool) memo, so one session that
// called analyze_site, execute_plan and find_sites read the same sentence three times.
//
// WHAT. COPY AND DEDUPE ONLY. The first answer in a session that carries the sentence keeps it; every later answer in
// that session has the sentence taken out of its text blocks and structured strings. A `copy` or `say` field the
// sentence was the whole of is dropped; the structured call itself ({tool: get_api_key, arguments}) stays, so the next
// step an agent can take is unchanged. Nothing about gating, quotas or which answer is served changes.
// Identity: the MCP session id; with none, the client name plus the caller's IP /24 (or /48), for 30 minutes.
// The caller (server.mjs _emailNudgeOnceStep) skips /mcp/chatgpt, a ChatGPT client and a loopback plan step.
// Kill switch DCHUB_EMAIL_NUDGE_ONCE=0 (every answer keeps the sentence, as before).
import { createHash } from 'node:crypto';
import { EMAIL_ASK_LEAD } from './wall-identity-v2.mjs';

export const EMAIL_NUDGE_ONCE_FLAG = 'DCHUB_EMAIL_NUDGE_ONCE';
export function emailNudgeOnceOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[EMAIL_NUDGE_ONCE_FLAG]) || '').trim());
}

const _esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The sentence in every form wall-identity-v2 builds (emailAskLine, with or without a market), plus one leading space.
export const NUDGE_RE = new RegExp(' ?' + _esc(EMAIL_ASK_LEAD) + '[^.\\n"\\\\]*\\.', 'g');
const _has = (s) => typeof s === 'string' && s.includes(EMAIL_ASK_LEAD);

export const SESSION_TTL_MS = 12 * 60 * 60_000;
export const PAIR_TTL_MS = 30 * 60_000;

// 'sid:<session>' for a real session; else 'pair:<sha256(prefix|name)>' when the caller's IP has a public prefix; ''.
// ipPrefix / clientNameOf: lib/wall-device-match.mjs (passed in, so this module stays pure).
export function nudgeIdentity(c, { ipPrefix, clientNameOf, realSession } = {}) {
  try {
    if (!c) return '';
    const sid = realSession ? realSession(c.session_id) : String(c.session_id || '');
    if (sid) return 'sid:' + sid;
    const prefix = ipPrefix ? ipPrefix(c.client_ip) : null;
    if (!prefix) return '';
    const name = clientNameOf ? clientNameOf(c.client_name_raw || c.platform || '') : String(c.client_name_raw || '');
    return 'pair:' + createHash('sha256').update(prefix + '|' + name).digest('hex').slice(0, 32);
  } catch (_) { return ''; }
}

// In-process memo: identity -> first-shown time. A restart, or a second replica, can show the sentence once more.
export function createNudgeMemo({ cap = 20_000, now = () => Date.now() } = {}) {
  const m = new Map();
  const ttl = (id) => (id.startsWith('pair:') ? PAIR_TTL_MS : SESSION_TTL_MS);
  return {
    // true = this identity already got the sentence (within its window); otherwise records it and returns false.
    seen(id) {
      if (!id) return false;
      const t = now();
      const at = m.get(id);
      if (at !== undefined && (t - at) < ttl(id)) return true;
      m.delete(id);
      m.set(id, t);
      while (m.size > cap) m.delete(m.keys().next().value);
      return false;
    },
    clear() { m.clear(); },
    get size() { return m.size; },
  };
}

function _stripStr(s) {
  return s.replace(NUDGE_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}
const _DROP_WHEN_EMPTY = new Set(['copy', 'say']);
function _stripDeep(v, depth = 0) {
  if (depth > 12) return v;
  if (typeof v === 'string') return _has(v) ? _stripStr(v) : v;
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => { const y = _stripDeep(x, depth + 1); if (y !== x) changed = true; return y; });
    return changed ? out : v;
  }
  if (v && typeof v === 'object') {
    let changed = false;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const y = _stripDeep(x, depth + 1);
      if (y !== x) changed = true;
      if (y === '' && x !== '' && _DROP_WHEN_EMPTY.has(k)) continue;
      out[k] = y;
    }
    return changed ? out : v;
  }
  return v;
}

export function carriesNudge(result) {
  try {
    if (!result || typeof result !== 'object') return false;
    if (Array.isArray(result.content) && result.content.some((b) => b && b.type === 'text' && _has(b.text))) return true;
    return result.structuredContent !== undefined && _has(JSON.stringify(result.structuredContent));
  } catch (_) { return false; }
}

// The result with every copy of the sentence taken out (see WHAT above). Unchanged when it carries none.
export function stripNudge(result) {
  try {
    if (!carriesNudge(result)) return result;
    const content = Array.isArray(result.content) ? result.content.map((b) => {
      if (!b || b.type !== 'text' || !_has(b.text)) return b;
      const t = b.text;
      if (/^\s*[{[]/.test(t)) {
        try {
          const j = JSON.parse(t);
          const pretty = /^\s*[{[]\s*\n/.test(t);
          return { ...b, text: JSON.stringify(_stripDeep(j), null, pretty ? 2 : undefined) };
        } catch (_) { /* JSON followed by prose: treated as prose */ }
      }
      const s = t.replace(NUDGE_RE, '').replace(/[ \t]{2,}/g, ' ');
      return { ...b, text: s.trim() ? s : '' };
    }).filter((b) => !(b && b.type === 'text' && b.text === '')) : result.content;
    const out = { ...result, content };
    if (result.structuredContent !== undefined) out.structuredContent = _stripDeep(result.structuredContent);
    return out;
  } catch (_) { return result; }
}

// The step: the first answer per identity that carries the sentence keeps it; later ones lose it.
export function nudgeOnce(result, identity, memo, env = process.env) {
  try {
    if (!emailNudgeOnceOn(env) || !identity || !memo || !carriesNudge(result)) return result;
    return memo.seen(identity) ? stripNudge(result) : result;
  } catch (_) { return result; }
}
