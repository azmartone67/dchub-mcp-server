// UTF-8 charset on every JSON / SSE response this server writes (2026-10-14).
//
// The Streamable HTTP SSE replies went out as a bare `Content-Type: text/event-stream`
// (measured live, QA headers: initialize and tools/list over /mcp). Our text is UTF-8
// and full of em dashes, so a client that falls back to Latin-1 / Windows-1252 when no
// charset is given renders an em dash (E2 80 94) as three mojibake characters. The header comes from two writers:
//   - the SDK transport: webStandardStreamableHttp.js builds a Response with
//     'Content-Type': 'text/event-stream' (and 'application/json' when JSON responses
//     are on), and @hono/node-server copies it onto the Node response with
//     res.writeHead(status, headers);
//   - our own cached writers in server.mjs (_writeRpcResult / _writeRpcError).
// Wrapping res.writeHead per request covers both, plus anything set earlier with
// res.setHeader (Node's implicit header write and flushHeaders also go through
// writeHead). Only text/event-stream and application/json without a charset are
// touched; a header that already names a charset is left exactly as it is.
const _TYPES = /^\s*(text\/event-stream|application\/json)\s*(;.*)?$/i;

export function withUtf8Charset(value) {
  if (typeof value !== 'string' || !_TYPES.test(value) || /charset\s*=/i.test(value)) return value;
  return value.trim().replace(/;?\s*$/, '') + '; charset=utf-8';
}

const _isCt = (k) => typeof k === 'string' && k.toLowerCase() === 'content-type';

// Returns [headers, found]: a copy with the content-type fixed, and whether one was present.
function _fixHeaders(h) {
  if (Array.isArray(h)) {
    if (Array.isArray(h[0])) {
      let found = false;
      const out = h.map((p) => (Array.isArray(p) && _isCt(p[0]) ? (found = true, [p[0], withUtf8Charset(p[1])]) : p));
      return [out, found];
    }
    const out = h.slice();
    let found = false;
    for (let i = 0; i + 1 < out.length; i += 2) {
      if (_isCt(out[i])) { out[i + 1] = withUtf8Charset(out[i + 1]); found = true; }
    }
    return [out, found];
  }
  if (h && typeof h === 'object') {
    let found = false;
    const out = { ...h };
    for (const k of Object.keys(out)) if (_isCt(k)) { out[k] = withUtf8Charset(out[k]); found = true; }
    return [out, found];
  }
  return [h, false];
}

export function utf8CharsetMiddleware(req, res, next) {
  const orig = res.writeHead;
  res.writeHead = function writeHeadUtf8(statusCode, ...rest) {
    try {
      // writeHead(status[, statusMessage][, headers])
      const i = typeof rest[0] === 'string' ? 1 : 0;
      const [fixed, found] = _fixHeaders(rest[i]);
      if (found) rest[i] = fixed;
      if (!found && typeof this.getHeader === 'function' && !this.headersSent) {
        const cur = this.getHeader('content-type');
        const fixedCt = withUtf8Charset(cur);
        if (fixedCt !== cur) this.setHeader('content-type', fixedCt);
      }
    } catch (_) { /* a charset is never worth a failed response */ }
    return orig.call(this, statusCode, ...rest);
  };
  next();
}
