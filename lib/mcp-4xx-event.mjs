// mcp-4xx-event.mjs — daily /mcp 4xx counts per client, for the funnel page (2026-11-11).
//
// The `[mcp-4xx]` line (lib/mcp-request-shape.mjs) goes to Railway's log only, which the backend
// cannot read, so the funnel page had no daily 4xx-by-client series. This keeps an in-process
// count keyed by {day, client, status, reason} and flushes it once a minute as ONE POST to
// /api/v1/mcp/track:
//     { event: 'mcp_4xx', rows: [{ day: 'YYYY-MM-DD', client, status, reason, n }] }
// The body has no `tool` field on purpose, the same deploy-skew rule as `session_init` and
// `recipe_lifecycle`: a backend without an `mcp_4xx` dispatch drops it at its "missing tool"
// return instead of writing a phantom call row.
//
// Cheap by construction: no network on the request path, at most one POST a minute, a bounded
// map (MAX_KEYS distinct keys per flush window; past that a key is folded into reason
// 'overflow'), and nothing about the caller beyond the platform label and the reason code: no
// key, token, session id, IP, user agent or body. A failed POST is dropped, never retried
// (a count, not a ledger). Kill switch: DCHUB_MCP_4XX_EVENT=0.

export const FLUSH_MS = 60_000;
export const MAX_KEYS = 500;

export function mcp4xxEventOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_MCP_4XX_EVENT) || '').trim());
}

const _label = (v, n) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, n);

export function createMcp4xxCounter({ apiBase, internalKey, fetchImpl = globalThis.fetch,
                                      flushMs = FLUSH_MS, maxKeys = MAX_KEYS, env = process.env,
                                      now = () => new Date() } = {}) {
  const counts = new Map();   // "day|client|status|reason" -> n
  let timer = null;

  function note({ client, status, reason } = {}) {
    try {
      if (!mcp4xxEventOn(env)) return false;
      const st = Number(status);
      if (!Number.isInteger(st) || st < 400 || st > 499) return false;
      const day = now().toISOString().slice(0, 10);
      const c = _label(client, 40) || 'unknown';
      let r = _label(reason, 40) || 'other';
      let k = `${day}|${c}|${st}|${r}`;
      if (!counts.has(k) && counts.size >= maxKeys) { r = 'overflow'; k = `${day}|${c}|${st}|${r}`; }
      counts.set(k, (counts.get(k) || 0) + 1);
      if (!timer && flushMs > 0) {
        timer = setTimeout(() => { timer = null; flush(); }, flushMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
      }
      return true;
    } catch (_) { return false; }   // telemetry never touches a response
  }

  function rows() {
    return [...counts.entries()].map(([k, n]) => {
      const [day, client, status, reason] = k.split('|');
      return { day, client, status: Number(status), reason, n };
    });
  }

  // Returns the fetch promise (tests await it), or null when there was nothing to send.
  function flush() {
    try {
      if (!counts.size) return null;
      const body = { event: 'mcp_4xx', rows: rows() };
      counts.clear();
      if (!apiBase || !internalKey || typeof fetchImpl !== 'function' || !mcp4xxEventOn(env)) return null;
      return fetchImpl(new URL('/api/v1/mcp/track', apiBase).toString(), {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
      }).catch(() => null);
    } catch (_) { return null; }
  }

  return { note, flush, rows, size: () => counts.size };
}
