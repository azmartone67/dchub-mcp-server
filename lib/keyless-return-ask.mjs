// lib/keyless-return-ask.mjs — the continuity ask for a KEYLESS caller who comes back (owner-approved
// 2026-11-17, after the mcp_tool_calls (ip_address, created_at) index check).
//
// The keyed return ask (server.mjs _returnNudgeStep) asks a key with no email once a week, at the END of
// the answer. A caller with no key had no return ask at all. This is the same line (lib/continuity-ask.mjs
// continuityReturnLine + CONTINUITY_RETURN_AGENT, no new copy), for a keyless caller whose IP was already
// seen on an EARLIER UTC day in the last 7 days, once per IP per 7 days. bind_email on a keyless session
// mints a key with the email bound in one call, so the agent line works as written.
//
// THE REQUEST PATH NEVER WAITS. "Seen on an earlier UTC day" is one backend read (dchub-backend
// POST /api/v1/mcp/anon-returning, a LIMIT 1 on mcp_tool_calls). The answer is cached per IP (LRU, TTL,
// and keyed to the UTC day so midnight starts a fresh answer). On a miss the lookup starts in the
// background and this call skips the ask: a skipped ask costs nothing, a stalled answer does.
// An error or a slow backend reads as "not returning" (no ask), never as an exception.
//
// PRIVACY. Every cache and the once-a-week clock are keyed by a sha256 prefix of the IP, not
// the raw address, and nothing here logs. The raw IP leaves this process only in the lookup's POST body.
//
// Kill switch DCHUB_KEYLESS_RETURN_ASK=0 (off / false / no): default ON. Off, or with
// DCHUB_CONTINUITY_ASK=0 (the continuity wording is the only approved wording for this ask), the step
// returns the same result object and starts no lookup.
import { createHash } from 'node:crypto';
import { continuityAskOn, continuityReturnLine, CONTINUITY_RETURN_AGENT, appendTailLine,
         createOncePerWeek } from './continuity-ask.mjs';

export function keylessReturnAskOn(env = process.env) {
  return !/^(0|off|false|no)$/i.test(String((env && env.DCHUB_KEYLESS_RETURN_ASK) || '').trim());
}

export function ipKey(ip) {
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 24);
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Per-IP "returning?" cache. peek(ip) never awaits: true / false when known, null on a miss (the lookup is
// started in the background, once per IP while it is in flight).
export function createReturningCache({ lookup, ttlMs = 10 * 60_000, pendingMs = 30_000, cap = 20_000,
                                       now = () => Date.now() } = {}) {
  const m = new Map();   // ipKey -> { at, day, pending, returning }
  function put(k, e) {
    m.delete(k);
    m.set(k, e);
    while (m.size > cap) m.delete(m.keys().next().value);   // drop the least recently used
  }
  return {
    peek(ip) {
      if (!ip || typeof lookup !== 'function') return null;
      const k = ipKey(ip);
      const t = now();
      const day = utcDay(t);
      const e = m.get(k);
      if (e && e.day === day && (t - e.at) < (e.pending ? pendingMs : ttlMs)) {
        put(k, e);   // touch
        return e.pending ? null : e.returning;
      }
      const entry = { at: t, day, pending: true, returning: false };
      put(k, entry);
      const settle = (v) => { entry.pending = false; entry.returning = v === true; entry.at = now(); };
      try {
        Promise.resolve().then(() => lookup(ip)).then(settle, () => settle(false));
      } catch (_) { settle(false); }
      return null;
    },
    size() { return m.size; },
    clear() { m.clear(); },
  };
}

// The step. Synchronous on purpose: nothing on this path can wait on the network.
//   c         the request context (getCtx())
//   eligible  (c) -> bool: the caller filters server.mjs already applies to the keyed ask
//   isWall    (result, c) -> bool: walls carry their own email ask; this one rides full answers only
export function keylessReturnAsk(result, { c, env = process.env, cache, once, eligible = () => true,
                                           isWall = () => false } = {}) {
  try {
    if (!keylessReturnAskOn(env) || !continuityAskOn(env)) return result;
    if (!result || result.isError || !Array.isArray(result.content)) return result;
    if (!c || c.api_key || !c.client_ip || c.loopback_step) return result;
    if (!eligible(c) || isWall(result, c)) return result;
    if (!cache || cache.peek(c.client_ip) !== true) return result;   // miss / unknown / not returning
    if (!once || !once.take(ipKey(c.client_ip))) return result;      // asked this IP in the last 7 days
    return appendBeforeFooter(result, continuityReturnLine() + '\n' + CONTINUITY_RETURN_AGENT);
  } catch (_) { return result; }
}

// appendTailLine, but never onto a trailing "Source: DC Hub (" / "Cite as:" footer block: a later step
// (_sourceLineCb's _sourceLineStep) rewrites the Source block, and a line glued onto it is lost (measured
// on keyless get_market_intel). The line ends the last data block; the footers stay after it.
const FOOTER_RE = /^\s*(?:Source: DC Hub \(|Cite as:)/;
const isFooter = (b) => !!(b && b.type === 'text' && typeof b.text === 'string' && FOOTER_RE.test(b.text));
export function appendBeforeFooter(result, line) {
  if (!result || !Array.isArray(result.content) || !line) return result;
  let end = result.content.length;
  while (end > 0 && isFooter(result.content[end - 1])) end--;
  if (end === result.content.length) return appendTailLine(result, line);
  const head = appendTailLine({ ...result, content: result.content.slice(0, end) }, line);
  return { ...head, content: [...head.content, ...result.content.slice(end)] };
}

export { createOncePerWeek };
