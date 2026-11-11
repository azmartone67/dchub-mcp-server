// mcp-request-shape.mjs — what a POST /mcp body is, and why a request was refused (2026-11-10).
//
// Cloudflare, week to 11-10: ~1,552 HTTP 400s on POST /mcp from Claude (727 two weeks earlier),
// 108 Claude 405s, 217 Grok 405s on GET /mcp. Railway's HTTP log records no body or header,
// so the reason was not in any log. Reproduced live on 11-10, every one a 400:
//   1. `initialize` re-sent WITH the Mcp-Session-Id of a session we still hold. It was routed
//      into that session's transport, and the SDK answers "Server already initialized". The
//      client then retries without the header and gets 200, so a test that never re-initializes
//      never sees it. Railway logs: Claude-User 400 (~1 s, the bearer lookup), then 200
//      initialize on the next request.
//   2. A notification (no `id`) with no session id.
//   3. Any other request with no session id that is not initialize / tools/list / ping /
//      tools/call (resources/list, prompts/list, ...): "No session. Send initialize first."
//   4. A JSON-RPC batch (array) with no session id: same 400.
// Pure functions only; server.mjs routes on them and logs the `[mcp-4xx]` line from them.

import { SUPPORTED_PROTOCOL_VERSIONS, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

const _isMsg = (m) => !!m && typeof m === 'object' && !Array.isArray(m);

// { kind: 'object' | 'batch' | 'empty' | 'invalid', n, methods, hasInit, requests, notifications }
// requests = messages with an id and a method; notifications = messages with no id (a
// notification, or a JSON-RPC response the client sends back).
export function rpcShape(body) {
  if (body === undefined || body === null || (typeof body === 'object' && !Array.isArray(body) && !Object.keys(body).length)) {
    return { kind: 'empty', n: 0, methods: [], hasInit: false, requests: 0, notifications: 0 };
  }
  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  if (!msgs.length || !msgs.every(_isMsg)) {
    return { kind: 'invalid', n: msgs.length, methods: [], hasInit: false, requests: 0, notifications: 0 };
  }
  const methods = msgs.map((m) => (typeof m.method === 'string' ? m.method : (m.id !== undefined ? '(response)' : '(none)')));
  return {
    kind: batch ? 'batch' : 'object',
    n: msgs.length,
    methods,
    hasInit: msgs.some((m) => m.method === 'initialize'),
    requests: msgs.filter((m) => m.id !== undefined && typeof m.method === 'string').length,
    notifications: msgs.filter((m) => m.id === undefined).length,
  };
}

// An initialize that carries an Mcp-Session-Id. The spec makes initialize the start of a new
// session, so the header is stale by definition: serve a fresh session instead of handing the
// message to the old transport (which can only say "already initialized").
export function isReinitWithSession(body, sessionId) {
  return !!sessionId && _isMsg(body) && body.method === 'initialize';
}

// Nothing in it needs an answer: every message is a notification or a response. The SDK
// answers these 202 inside a session; with no session there is nothing to deliver them to,
// and 202 is still the true answer (accepted, no response body).
export function isNotificationsOnly(shape) {
  return (shape.kind === 'object' || shape.kind === 'batch') && shape.n > 0 && shape.requests === 0;
}

// A request with no session id we can answer from a one-shot stateless transport: at least one
// request, no initialize (that one mints a session). The SDK answers an unknown method with an
// in-band -32601, so no method list is kept here.
export function isStatelessServable(shape) {
  return (shape.kind === 'object' || shape.kind === 'batch') && shape.requests > 0 && !shape.hasInit;
}

// MCP-Protocol-Version header. 'ok' (absent or supported), 'newer' (a well-formed version
// later than the newest this SDK speaks: drop the header so the request is served at the
// version initialize negotiated, which is the negotiate-down the spec describes), or
// 'unsupported' (left for the SDK's own 400, which names the supported versions).
export function protocolHeaderVerdict(value, supported = SUPPORTED_PROTOCOL_VERSIONS, latest = LATEST_PROTOCOL_VERSION) {
  const v = String(value == null ? '' : value).trim();
  if (!v || supported.includes(v)) return 'ok';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v > latest) return 'newer';
  return 'unsupported';
}

// Remove a request header where the SDK will look for it. The SDK's node transport builds its
// Request from req.rawHeaders (@hono/node-server), so deleting req.headers[name] alone changes
// nothing it reads.
export function dropRequestHeader(req, name) {
  const n = String(name).toLowerCase();
  if (req.headers) delete req.headers[n];
  const raw = req.rawHeaders;
  if (Array.isArray(raw)) {
    for (let i = raw.length - 2; i >= 0; i -= 2) {
      if (String(raw[i]).toLowerCase() === n) raw.splice(i, 2);
    }
  }
}

// 'none' | 'x-api-key' | 'bearer-key' | 'bearer-oauth' | 'query-key'. Never the value.
export function authKind(headers = {}, query = {}) {
  const auth = String(headers.authorization || '');
  if (/^bearer\s+dch_/i.test(auth)) return 'bearer-key';
  if (/^bearer\s+\S/i.test(auth)) return 'bearer-oauth';
  if (headers['x-api-key']) return 'x-api-key';
  if (query && (query.api_key || query.key)) return 'query-key';
  return 'none';
}

// The masked facts a 4xx is diagnosed from. No key, token, session id, email or IP.
export function describeRequest(req, { sessionKnown = false, path = null } = {}) {
  const h = req.headers || {};
  const accept = String(h.accept || '');
  const shape = rpcShape(req.body);
  const init = _isMsg(req.body) && req.body.method === 'initialize' ? req.body.params || {} : null;
  return {
    http: req.method,
    path: String(path == null ? (req.path || '') : path).slice(0, 60),
    ua: String(h['user-agent'] || '').slice(0, 60),
    rpc: shape.kind,
    n: shape.n,
    methods: shape.methods.slice(0, 5).map((m) => String(m).slice(0, 40)),
    session: h['mcp-session-id'] ? (sessionKnown ? 'known' : 'unknown') : 'none',
    accept_json: /application\/json|\*\/\*/i.test(accept),
    accept_sse: /text\/event-stream|\*\/\*/i.test(accept),
    proto_hdr: String(h['mcp-protocol-version'] || '').slice(0, 20) || null,
    init_proto: init && typeof init.protocolVersion === 'string' ? init.protocolVersion.slice(0, 20) : null,
    auth: authKind(h, req.query),
    ctype: String(h['content-type'] || '').slice(0, 40) || null,
    bytes: Number(h['content-length']) || null,
  };
}

// One reason code per refused request, so the 7-day count can be split without a body capture.
export function failureReason(status, rec, errMessage = '') {
  const m = String(errMessage || '');
  if (status === 405) return rec && rec.http === 'DELETE' ? 'delete_not_allowed' : 'get_no_sse';
  if (status === 409) return 'sse_stream_open';
  if (status === 404) return 'session_unknown';
  if (status === 406) return 'accept_header';
  if (status === 415) return 'content_type';
  if (status === 413) return 'body_too_large';
  if (/already initialized/i.test(m)) return 'reinit_live_session';
  if (/Only one initialization|initialize on its own/i.test(m)) return 'batch_with_initialize';
  if (/protocol version/i.test(m)) return 'protocol_version';
  if (/Parse error/i.test(m)) return 'parse_error';
  if (/Mcp-Session-Id header is required|No session/i.test(m)) {
    if (rec.rpc === 'batch') return 'batch_no_session';
    if (rec.methods.every((x) => x === '(none)' || x.startsWith('notifications/') || x === '(response)')) return 'notification_no_session';
    return 'request_no_session';
  }
  if (rec.rpc === 'empty' || rec.rpc === 'invalid') return 'invalid_body';
  if (rec.init_proto !== null) return 'initialize_invalid';
  return 'other';
}

// ── GET / HEAD on an MCP path (2026-11-11) ──────────────────────────────────────────────────────
// Cloudflare, week to 11-10: 217 Grok and 108 Claude 405s on GET /mcp (the zone worker's answer to
// `Accept: text/event-stream`), and the origin's own [mcp-4xx] log for 11-10 23:13Z to 11-11 07:50Z
// shows 115 HEAD 405s (UA `node` 104). Streamable HTTP lets GET open the optional server-to-client
// stream or answer 405; the owner rule is that a known AI client never gets a 405. So:
//   'sse'      GET, Accept names text/event-stream, a live session with no open GET stream:
//              the SDK's own standalone stream (stateful transport; keep-alive every 15 s).
//   'describe' HEAD, or an Accept without text/event-stream (a browser, a crawler, a probe):
//              200 JSON saying what this endpoint is and how to connect.
//   'decline'  GET asking for the stream with no session, an unknown session, or a session whose
//              GET stream is already open: 200 text/event-stream carrying one `retry:` field, then
//              closed. Why not 404/405/409 here, read from @modelcontextprotocol/sdk 1.32.2
//              client/streamableHttp.js: _startOrAuthSse returns quietly ONLY on 405; any other
//              non-2xx throws into onerror and the reconnect path retries it. A 200 stream that
//              ends is a "graceful server-side disconnect": the client schedules ONE reconnect
//              after the server's `retry` (the eventsource-parser onRetry hook sets
//              _serverRetryMs), with no error. The Python SDK (mcp 1.26 handle_get_stream) does
//              the same: a stream that ends normally resets its attempt counter and sleeps the
//              server's retry. So a declined client asks again once every SSE_DECLINE_RETRY_MS,
//              never in a loop, and nothing is raised.
export const SSE_DECLINE_RETRY_MS = 300000;

export function acceptsEventStream(accept) {
  return /text\/event-stream/i.test(String(accept || ''));
}

export function getVerdict({ method = 'GET', accept = '', sessionId = '', sessionKnown = false, streamOpen = false, stateless = false } = {}) {
  if (String(method).toUpperCase() !== 'GET') return 'describe';
  if (!acceptsEventStream(accept)) return 'describe';
  if (stateless || !sessionId || !sessionKnown) return 'decline';
  if (streamOpen) return 'decline';
  return 'sse';
}

// Public discovery documents that exist today (each answered 200 on 2026-11-11).
export const MCP_DISCOVERY_LINKS = Object.freeze({
  server_card: 'https://dchub.cloud/.well-known/mcp/server-card.json',
  manifest: 'https://dchub.cloud/.well-known/mcp.json',
  registry_server_json: 'https://dchub.cloud/server.json',
  oauth_protected_resource: 'https://dchub.cloud/.well-known/oauth-protected-resource/mcp',
  docs: 'https://dchub.cloud/integrations/mcp',
});

export function mcpEndpointUrl(path) {
  const p = String(path || '').replace(/\/+$/, '');
  return 'https://dchub.cloud' + (/^\/mcp(\/[A-Za-z0-9._-]+)*$/.test(p) ? p : '/mcp');
}

// The 200 JSON body for a 'describe' answer.
export function mcpGetDescription({ path = '/mcp', version = null } = {}) {
  const endpoint = mcpEndpointUrl(path);
  return {
    server: 'DC Hub MCP Server',
    ...(version ? { version } : {}),
    transport: 'streamable-http',
    endpoint,
    how_to_connect: `POST JSON-RPC 2.0 to ${endpoint} with Accept: application/json, text/event-stream. Send initialize first, then repeat the Mcp-Session-Id header it returns on every later request.`,
    get_stream: 'GET with Accept: text/event-stream and a live Mcp-Session-Id opens the optional server-to-client stream. Without a live session the stream closes at once with a retry hint; MCP clients carry on over POST.',
    links: { ...MCP_DISCOVERY_LINKS },
  };
}

// The body of a 'decline' answer: one SSE comment (ignored by every parser) and one retry field.
export function sseDeclineFrame({ path = '/mcp', retryMs = SSE_DECLINE_RETRY_MS } = {}) {
  return `: DC Hub: no server-to-client stream for this request (no live MCP session). POST JSON-RPC to ${mcpEndpointUrl(path)}; send initialize first.\nretry: ${Math.max(1000, Math.floor(Number(retryMs) || SSE_DECLINE_RETRY_MS))}\n\n`;
}

// A response chunk as text: Buffer, Uint8Array (what @hono/node-server writes) or string. The
// [mcp-4xx] logger used String(chunk), which turned a Uint8Array into "123,34,106,..." and left
// the reason 'other' (8 rokmcp-collector protocol-version 400s on 11-11 read that way).
export function chunkText(chunk) {
  if (chunk == null || typeof chunk === 'function') return '';
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('utf8');
  return String(chunk);
}
