// lib/wall-device-match.mjs — recognise a returning KEYLESS caller whose key was minted at a wall (owner relay
// 2026-11-20, item 3 "Recognize returning keyless callers"). Ships INERT: the owner says yes before it is on.
//
// WHY. A key minted at a wall (get_api_key, registered as claim_free_key) usually dies with the chat: a hosted
// agent cannot write it into its client config, so the next chat is keyless again and starts from zero.
//
// WHAT.
//   record  when claim_free_key mints a key for a caller that was walled (its transport session was handed a wall
//           link, or the same pair was handed a wall in the last WALL_PAIR_TTL_MS: hosted clients that open a
//           fresh session per call), the pair (clientInfo.name as this server saw it, client IP cut to /24 for
//           IPv4 or /48 for IPv6) is sent to the backend against that key. The backend hashes the prefix with
//           its IP-hashing secret and stores hash + client name + a key reference for 30 days.
//   match   a KEYLESS call from that exact pair within 30 days is served as that key (the free-key allowance:
//           the backend meters the call against the key), its return is logged (method device_match), and the
//           answer carries ONE line: WELCOME_BACK_LINE. The key never reaches the response (scrubKeys).
//
// FLAGS (both default OFF, read per call): DCHUB_WALL_IDENTITY_V2 (lib/wall-identity-v2.mjs) AND
// DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH. Recording runs only when BOTH are on, like matching. Recording alone is
// cheap, but it is the part that stores new personal data (a hashed IP prefix and a client name), and the
// privacy page must say so before it starts; V2 alone turns on the other wall-identity work and stores nothing
// new here. The cost: pairs are recorded only from the day the second flag goes on.
//
// THE REQUEST PATH NEVER WAITS. peek() is a Map read; a miss starts one background lookup and the call is served
// keyless as today (same pattern as lib/keyless-return-ask.mjs). A lookup error or a slow backend reads as "no
// match". Exact pair only; an ambiguous pair (more than one live key) is "no match" in the backend.
//
// IGNORED PAIRS: an empty client name, a generic HTTP library name (curl, python-requests, node, Go-http-client,
// undici, ...), and QA / probe markers (server.mjs passes its own _isQaCaller / isBotOrInternalCtx as isBot).
//
// PRIVACY. Caches are keyed by a sha256 of the pair, not the raw values. Nothing here logs. The raw IP never
// leaves this process for this feature: only the /24 or /48 prefix is sent, in a POST body, to the backend.
// Pure apart from its own Maps: no ctx, no network (the caller passes lookup / record / logReturn).
import { createHash } from 'node:crypto';
import { wallIdentityV2On } from './wall-identity-v2.mjs';
import { appendBeforeFooter } from './keyless-return-ask.mjs';

export const WELCOME_BACK_LINE = 'Welcome back. Add DCHUB_API_KEY to keep this permanent.';
export const PAIR_TTL_DAYS = 30;
export const WALL_PAIR_TTL_MS = 30 * 60_000;
export const METHOD = 'device_match';
// The identity tools stay keyless: a caller asking for a key gets today's claim / bind / recover path.
export const SKIP_TOOLS = new Set(['claim_free_key', 'get_api_key', 'bind_email', 'recover_my_key']);

export function deviceMatchOn(env = process.env) {
  return wallIdentityV2On(env)
    && /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_WALL_IDENTITY_V2_DEVICE_MATCH) || '').trim());
}
// Documented choice: recording needs both flags too (see FLAGS above).
export const recordOn = deviceMatchOn;

// ── the pair ─────────────────────────────────────────────────────────────────────────────────────────────
// IPv4 -> a.b.c.0/24; IPv6 -> first three hextets ::/48; IPv4-mapped IPv6 is IPv4. Anything else -> null.
export function ipPrefix(ip) {
  let s = String(ip == null ? '' : ip).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('[')) s = s.replace(/^\[|\](?::\d+)?$/g, '');
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) s = mapped[1];
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    // loopback, private, CGNAT and link-local: a proxy hop shared by unrelated callers, never an identity
    if (o[0] === 0 || o[0] === 10 || o[0] === 127 || (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
        || (o[0] === 169 && o[1] === 254) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168)) return null;
    return `${o[0]}.${o[1]}.${o[2]}.0/24`;
  }
  if (!s.includes(':') || !/^[0-9a-f:]+$/.test(s)) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...head, ...tail].some((h) => !h || h.length > 4)) return null;
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const full = [...head, ...Array(fill).fill('0'), ...tail].map((h) => parseInt(h, 16).toString(16));
  // unspecified / loopback (::, ::1), link-local fe80::/10 and unique-local fc00::/7: not a public caller
  const h0 = parseInt(full[0], 16);
  if (full.slice(0, 7).every((h) => h === '0') || (h0 & 0xffc0) === 0xfe80 || (h0 & 0xfe00) === 0xfc00) return null;
  return `${full[0]}:${full[1]}:${full[2]}::/48`;
}

// The name exactly as clientInfo carried it (trimmed, 200 chars, as server.mjs stores client_name_raw).
export function clientNameOf(raw) {
  return String(raw == null ? '' : raw).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 200);
}
// Generic HTTP stacks and placeholders: one name for many unrelated callers, so never an identity.
// A version may follow ("curl/8.4", "node 20", "undici@6"); a hyphenated product name is NOT generic.
const GENERIC_RE = /^(?:curl|wget|httpie|python|python-requests|python-httpx|httpx|aiohttp|requests|node|node-fetch|nodejs|undici|axios|got|go-http-client|okhttp|java|libwww-perl|mcp|mcp-client|mcp-agent|client|unknown|test|null|undefined)(?:[\s/:@].*)?$/i;
const QA_RE = /dchub-qa-readonly|- exclude\)/i;
export function pairNameEligible(name) {
  const n = clientNameOf(name);
  if (!n) return false;
  if (GENERIC_RE.test(n) || QA_RE.test(n)) return false;
  return true;
}
// The caller's pair from a request context, or null when it is not one to record or match.
//   c.client_name_raw  clientInfo.name at initialize; c.client_ip  the real caller IP
export function pairOf(c, { isBot = () => false } = {}) {
  try {
    if (!c) return null;
    const name = clientNameOf(c.client_name_raw);
    if (!pairNameEligible(name)) return null;
    if (isBot(c)) return null;
    const prefix = ipPrefix(c.client_ip);
    if (!prefix) return null;
    return { client_name: name, ip_prefix: prefix, k: createHash('sha256').update(prefix + '|' + name).digest('hex').slice(0, 32) };
  } catch (_) { return null; }
}

// ── the match cache ──────────────────────────────────────────────────────────────────────────────────────
// peek(pair) never awaits: { key } on a known match, false on a known miss, null when unknown (a background
// lookup is started, once per pair while in flight). lookup(pair) resolves to a key string or anything falsy.
export function createMatchCache({ lookup, ttlMs = 10 * 60_000, pendingMs = 30_000, cap = 20_000,
                                   now = () => Date.now() } = {}) {
  const m = new Map();   // pair.k -> { at, pending, key }
  function put(k, e) {
    m.delete(k);
    m.set(k, e);
    while (m.size > cap) m.delete(m.keys().next().value);
  }
  return {
    peek(pair) {
      if (!pair || !pair.k || typeof lookup !== 'function') return null;
      const t = now();
      const e = m.get(pair.k);
      if (e && (t - e.at) < (e.pending ? pendingMs : ttlMs)) {
        put(pair.k, e);
        if (e.pending) return null;
        return e.key ? { key: e.key } : false;
      }
      const entry = { at: t, pending: true, key: null };
      put(pair.k, entry);
      const settle = (v) => {
        entry.pending = false;
        entry.key = (typeof v === 'string' && /^dch_live_[A-Za-z0-9_-]{8,}$/.test(v)) ? v : null;
        entry.at = now();
      };
      try {
        Promise.resolve().then(() => lookup(pair)).then(settle, () => settle(null));
      } catch (_) { settle(null); }
      return null;
    },
    forget(pair) { if (pair && pair.k) m.delete(pair.k); },
    size() { return m.size; },
    clear() { m.clear(); },
  };
}

// A short memo of pairs that were handed a wall: a hosted client that opens a new transport session for every
// call has no session to remember the wall by, so its claim is matched to the wall by the pair instead.
export function createWallPairMemo({ ttlMs = WALL_PAIR_TTL_MS, cap = 20_000, now = () => Date.now() } = {}) {
  const m = new Map();
  return {
    note(pair) {
      if (!pair || !pair.k) return false;
      if (m.size >= cap && !m.has(pair.k)) m.delete(m.keys().next().value);
      m.delete(pair.k);
      m.set(pair.k, now());
      return true;
    },
    recent(pair) {
      if (!pair || !pair.k) return false;
      const at = m.get(pair.k);
      return at !== undefined && now() - at < ttlMs;
    },
    clear() { m.clear(); },
  };
}

// Once per key per period (the welcome line once per session; the return event once per pair per UTC day).
export function createOnce({ ttlMs = 24 * 3600_000, cap = 50_000, now = () => Date.now() } = {}) {
  const m = new Map();
  return {
    take(k) {
      if (!k) return false;
      const t = now();
      const at = m.get(k);
      if (at !== undefined && t - at < ttlMs) return false;
      if (m.size >= cap) m.clear();
      m.set(k, t);
      return true;
    },
    clear() { m.clear(); },
  };
}

// ── the decision on the hot path ─────────────────────────────────────────────────────────────────────────
// Synchronous. Returns { key, pair } when this KEYLESS call should be served as the matched key, else null.
//   c          the request context; never touched here (server.mjs applies the result)
//   excluded   (c) -> bool: the surfaces that get none of this (ChatGPT / directory profile, clean platforms,
//              loopback steps): server.mjs decides
export function matchFor(c, name, { env = process.env, cache, isBot = () => false, excluded = () => false } = {}) {
  try {
    if (!deviceMatchOn(env)) return null;
    if (!c || c.api_key || SKIP_TOOLS.has(name)) return null;
    if (excluded(c)) return null;
    const pair = pairOf(c, { isBot });
    if (!pair || !cache) return null;
    const hit = cache.peek(pair);
    return hit && hit.key ? { key: hit.key, pair } : null;
  } catch (_) { return null; }
}

// Should a fresh mint be recorded against this pair? walledSession: the transport session saw a wall link.
export function recordFor(c, key, { env = process.env, walledSession = false, wallPairs, isBot = () => false,
                                    excluded = () => false } = {}) {
  try {
    if (!recordOn(env) || !key || !/^dch_live_/.test(String(key))) return null;
    if (!c || excluded(c)) return null;
    const pair = pairOf(c, { isBot });
    if (!pair) return null;
    if (!walledSession && !(wallPairs && wallPairs.recent(pair))) return null;
    return pair;
  } catch (_) { return null; }
}

// ── the answer ───────────────────────────────────────────────────────────────────────────────────────────
// Every DC Hub key form (and any prefix of one 4+ characters past its kind) becomes a placeholder, in every
// string of the result. The matched key is replaced even if it is not in a known form.
const KEY_RE = /\bdch(?:ub)?_(?:live_|trial_)?[A-Za-z0-9_-]{4,}/g;
export const KEY_PLACEHOLDER = '[your saved DC Hub key]';
export function scrubKeys(v, key, depth = 0) {
  if (typeof v === 'string') {
    let s = v;
    if (key && s.includes(key)) s = s.split(key).join(KEY_PLACEHOLDER);
    return s.replace(KEY_RE, KEY_PLACEHOLDER);
  }
  if (!v || typeof v !== 'object' || depth > 12) return v;
  if (Array.isArray(v)) return v.map((x) => scrubKeys(x, key, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = scrubKeys(x, key, depth + 1);
  return out;
}

// The served answer: keys scrubbed; the welcome line once (showLine), before any Source / Cite footer.
export function finishMatchedAnswer(result, key, { showLine = true } = {}) {
  try {
    if (!result || typeof result !== 'object') return result;
    let out = scrubKeys(result, key);
    if (showLine && Array.isArray(out.content) && !out.isError
        && !out.content.some((b) => b && typeof b.text === 'string' && b.text.includes(WELCOME_BACK_LINE))) {
      out = appendBeforeFooter(out, WELCOME_BACK_LINE);
    }
    return out;
  } catch (_) {
    // Never hand back an unscrubbed result: on any error, drop to a scrub-only pass of the text blocks.
    try { return { ...result, content: (result.content || []).map((b) => scrubKeys(b, key)), structuredContent: scrubKeys(result.structuredContent, key) }; }
    catch (_e) { return { content: [{ type: 'text', text: 'DC Hub: answer unavailable, please retry.' }], isError: true }; }
  }
}
