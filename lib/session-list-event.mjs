// session-list-event.mjs — one telemetry event per MCP session's FIRST tools/list (2026-11-27, Grok -> Brain
// "light tools/list ... connect-to-call telemetry", Change 4).
//
// /api/v1/mcp/retention counts connects (initialize, mcp_sessions.first_seen) and tool-call sessions
// (mcp_call_log), but nothing in between, so "connected and never called" could not be split into "never
// listed the tools" vs "listed them and never called one". This sends, once per session id, the time the
// session's first tools/list response finished and how many bytes it wrote, to /api/v1/mcp/track as
//     { event: 'session_list', session_id, initialized_at, listed_at, list_bytes, status }
// initialized_at is when this process answered the session's initialize (null when another replica did): the
// backend's mcp_sessions.first_seen is its own buffered write time, up to ~30 s late, so it cannot time init->list.
// The backend (routes/mcp_client_class.record_session_list) stamps mcp_sessions.listed_at / list_bytes, and
// routes/connect_to_call.py publishes the split per named client. The first tools/call time is read from
// mcp_call_log on the backend, so nothing here touches tools/call.
//
// The body has no `tool` field on purpose (the deploy-skew rule of session_init and mcp_4xx): a backend
// without a `session_list` dispatch drops it at its "missing tool" return instead of writing a call row.
//
// What is sent: the session id the caller already presented (Mcp-Session-Id), a timestamp, a byte count and
// the HTTP status. Never a key, IP, user agent or body. A tools/list with no session id (stateless callers,
// the directory profiles) cannot be joined to a session row and sends nothing. Our own QA / self-test
// callers send nothing (the caller passes `own: true`). list_bytes is what the response wrote, SSE framing
// included when the reply was an event stream.
//
// Telemetry only: changes no response, no list, no session state. Fire and forget; at most one event per
// session id per process (a bounded set; another replica may send one more, and the backend keeps the
// first). Kill switch: DCHUB_SESSION_LIST_EVENT=0.

export const SEEN_MAX = 50_000;

export function sessionListEventOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_SESSION_LIST_EVENT) || '').trim());
}

const _s = (v, n) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, n);

const _iso = (v) => {
  try { if (v === null || v === undefined || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); } catch (_) { return null; }
};

// True when `body` is a single JSON-RPC tools/list request (a batch or notification is not). Pure.
export function isToolsListRequest(body) {
  return !!(body && !Array.isArray(body) && typeof body === 'object' && body.method === 'tools/list'
    && body.id !== undefined && body.id !== null);
}

// Bytes in one res.write / res.end chunk. Pure; never throws.
export function chunkBytes(chunk, encoding) {
  try {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return 0;
    if (typeof chunk === 'string') return Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    if (typeof chunk.byteLength === 'number') return chunk.byteLength;
    return 0;
  } catch (_) { return 0; }
}

// The event body, or null (switched off / no session / our own / not a 2xx). Pure.
export function sessionListEventBody({ sessionId = null, listBytes = 0, status = 200, own = false,
                                       initializedAt = null, now = () => new Date() } = {}, env = process.env) {
  try {
    if (!sessionListEventOn(env) || own === true) return null;
    const sid = _s(sessionId, 200);
    if (!sid) return null;
    const st = Number(status);
    if (!Number.isInteger(st) || st < 200 || st > 299) return null;
    const n = Number(listBytes);
    return {
      event: 'session_list',
      session_id: sid,
      initialized_at: _iso(initializedAt),
      listed_at: now().toISOString(),
      list_bytes: Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 2_000_000_000) : null,
      status: st,
    };
  } catch (_) {
    return null;
  }
}

// When this process answered each session's initialize: remember(sid, at) / get(sid). Bounded like the gate.
export function createInitTimes({ max = SEEN_MAX } = {}) {
  const at = new Map();
  return {
    remember(sid, when = new Date()) {
      const k = _s(sid, 200);
      if (!k) return;
      if (at.size >= max && !at.has(k)) at.clear();
      at.set(k, when);
    },
    get: (sid) => at.get(_s(sid, 200)) || null,
    size: () => at.size,
  };
}

// Once-per-session gate. note(sid) is true the first time a sid is seen in this process, false after.
// Bounded: past `max` ids the set is cleared (a repeat event after that is harmless: the backend keeps
// the first listed_at).
export function createListOnce({ max = SEEN_MAX } = {}) {
  const seen = new Set();
  return {
    note(sid) {
      const k = _s(sid, 200);
      if (!k || seen.has(k)) return false;
      if (seen.size >= max) seen.clear();
      seen.add(k);
      return true;
    },
    size: () => seen.size,
  };
}
