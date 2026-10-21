// session-init-event.mjs — one telemetry event per MCP `initialize` (2026-10-21).
//
// `initialize` is the only request that carries clientInfo, and until now it
// reached the backend only folded into later tool-call rows. This sends the
// facts the caller presented at the handshake, once, to /api/v1/mcp/track as
// { event: 'session_init', ... }; the backend classifies the session (a person's
// client, a gateway, a script, our own probes) and records it against the
// session id. An older backend ignores the event (no `tool` field).
//
// What is sent: clientInfo name and version, the user agent, a declared via,
// the QA marker, whether the path is first-party, the arrival source, the
// platform tag already computed for the session, and md5 of the caller IP (the
// same agent grain the call log uses). Never the IP itself, never a key.
//
// Telemetry only: changes no response, no tier, no session state. Fire and
// forget. Kill switch: DCHUB_SESSION_INIT_EVENT=0.

import { createHash } from 'node:crypto';

export function sessionInitEventOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_SESSION_INIT_EVENT) || '').trim());
}

const _s = (v, n) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, n);

// The event body for one initialize, or null (switched off / not an initialize). Pure.
export function sessionInitEventBody({ body, sessionId = null, userAgent = '', clientIp = '',
                                       via = null, qaMarker = false, selfPath = false,
                                       platform = '', path = '', source = '' } = {}, env = process.env) {
  try {
    if (!sessionInitEventOn(env)) return null;
    if (!body || body.method !== 'initialize') return null;
    const ci = (body.params && body.params.clientInfo) || {};
    const ip = _s(clientIp, 100);
    return {
      event: 'session_init',
      session_id: _s(sessionId, 200) || null,
      client_name: _s(ci.name, 200) || null,
      client_version: _s(ci.version, 80) || null,
      protocol_version: _s(body.params && body.params.protocolVersion, 40) || null,
      user_agent: _s(userAgent, 300) || null,
      via: _s(via, 40) || null,
      qa_marker: qaMarker === true,
      self_path: selfPath === true,
      platform: _s(platform, 80) || null,
      path: _s(path, 80) || null,
      source: _s(source, 60) || null,
      agent_hash: ip ? createHash('md5').update(ip).digest('hex') : null,
    };
  } catch (_) {
    return null;   // telemetry never touches a handshake
  }
}

// POST the event. Returns the fetch promise (tests await it); callers do not.
export function postSessionInitEvent(eventBody, { apiBase, internalKey, fetchImpl = globalThis.fetch } = {}) {
  try {
    if (!eventBody || !apiBase || !internalKey || typeof fetchImpl !== 'function') return null;
    return fetchImpl(new URL('/api/v1/mcp/track', apiBase).toString(), {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
      body: JSON.stringify(eventBody), signal: AbortSignal.timeout(10000),
    }).catch(() => null);
  } catch (_) {
    return null;
  }
}
