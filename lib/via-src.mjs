// lib/via-src.mjs: which directory or partner sent an MCP session (Grok note N addendum, 2026-11-16).
//
// A listing link says where it came from: https://dchub.cloud/mcp?via=directory&src=glama (or ?via=partner&src=pipeworx).
// The `via` rides the existing per-request store (server.mjs getVia); this module adds the `src`:
//
//   * src counts only beside via=directory|partner, and only when it is a CLOSED slug: an id in canonical/directories.json
//     or a registered DIRECTORY_VIA_TAGS name (aliases folded: mcp-so -> mcpso). Any other src is dropped, never forwarded;
//   * read from the X-DCHub-Src header, else ?src= on the /mcp URL;
//   * remembered per MCP session (bounded), so a later call in the same session that lost the query still carries it;
//   * forwarded to the backend as X-DCHub-Via + X-DCHub-Src on the write calls (claim, bind) and as `src` on the
//     session_init event. dchub-backend routes/via_funnel.py restates the slug set (routes/via_src_slugs.json) and counts
//     src:<slug> visits, sessions, unlocks and keys.
//
// Counts only, never access. Everything here is pure except the session memo.

import { readFileSync } from 'node:fs';
import { DIRECTORY_VIA_TAGS, DIRECTORY_VIA_ALIASES } from './via-tags.mjs';

export const LISTING_VIA_CHANNELS = Object.freeze(['directory', 'partner']);
export const SRC_HEADER = 'X-DCHub-Src';
const _ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function _alias(v) {
  return Object.prototype.hasOwnProperty.call(DIRECTORY_VIA_ALIASES, v) ? DIRECTORY_VIA_ALIASES[v] : v;
}

// The closed slug set from a parsed directories.json document. Pure.
export function listingSrcSet(doc) {
  const rows = doc && Array.isArray(doc.directories) ? doc.directories : [];
  const ids = rows.map((r) => String((r && r.id) || '').trim().toLowerCase()).filter((i) => _ID_RE.test(i));
  return new Set([...ids.map(_alias), ...DIRECTORY_VIA_TAGS]);
}

export const DIRECTORIES_FILE = new URL('../canonical/directories.json', import.meta.url);

// The slug set read from a directories.json path. An unreadable file leaves the registered tags only: coarser, never open.
export function loadListingSrcs(file = DIRECTORIES_FILE) {
  try {
    return listingSrcSet(JSON.parse(readFileSync(file, 'utf8')));
  } catch (_) {
    return listingSrcSet(null);
  }
}
export const LISTING_SRCS = loadListingSrcs();

// A slug from LISTING_SRCS, or null. Pure.
export function normalizeListingSrc(raw, set = LISTING_SRCS) {
  if (raw === undefined || raw === null || typeof raw === 'object') return null;
  const v = _alias(String(raw).trim().toLowerCase());
  return set.has(v) ? v : null;
}

// {via, src} for a request whose (already normalized) via is directory|partner and whose src is a known slug; else null.
export function listingSrcFromRequest(req, via) {
  try {
    if (!LISTING_VIA_CHANNELS.includes(via)) return null;
    const h = req && req.headers ? req.headers[SRC_HEADER.toLowerCase()] : undefined;
    const q = req && req.query ? req.query.src : undefined;
    const src = normalizeListingSrc(Array.isArray(h) ? h[0] : h) || normalizeListingSrc(Array.isArray(q) ? q[0] : q);
    return src ? { via, src } : null;
  } catch (_) {
    return null;
  }
}

// ── per-session memo (bounded; oldest out first) ────────────────────────────────────────────────────────────────────
const MEMO_MAX = 5000;
const _memo = new Map();

export function rememberListingSrc(sessionId, pair) {
  if (!sessionId || !pair || !pair.via || !pair.src) return;
  const k = String(sessionId);
  _memo.delete(k);
  _memo.set(k, { via: pair.via, src: pair.src });
  while (_memo.size > MEMO_MAX) _memo.delete(_memo.keys().next().value);
}

export function recallListingSrc(sessionId) {
  return sessionId ? _memo.get(String(sessionId)) || null : null;
}

export function _resetListingSrcMemo() { _memo.clear(); }

// The pair to forward: this request's, else the session's, but never against a different via this request declared.
export function listingAttribution({ requestPair = null, requestVia = null, sessionId = null } = {}) {
  if (requestPair) return requestPair;
  const m = recallListingSrc(sessionId);
  if (!m) return null;
  return !requestVia || requestVia === m.via ? m : null;
}

// Set X-DCHub-Via / X-DCHub-Src on an outgoing backend request for a listing pair. Returns the headers.
export function applyListingSrcHeaders(headers, pair) {
  if (headers && pair && pair.via && pair.src) {
    headers['X-DCHub-Via'] = pair.via;
    headers[SRC_HEADER] = pair.src;
  }
  return headers;
}
