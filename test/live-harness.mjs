// =============================================================================
// Shared helpers for the live MCP test suites (mcp.test.mjs, regression.test.mjs)
// -----------------------------------------------------------------------------
// The live MCP is a single Railway replica behind Cloudflare. Under burst load
// (a suite opens a session then fires dozens of tool calls) — and especially
// during a redeploy — the edge can return an empty body, a "No session" error,
// a 429, or a 5xx for the initialize handshake or a tools/call. Those are
// transient, not real failures. These pure helpers classify/parse responses so
// the suites can retry the handshake (instead of hard-failing CI) and skip data
// assertions on a transient blip. Pure logic, no network — unit-tested in
// harness.test.mjs so it can hard-gate CI alongside gating.test.mjs.
// =============================================================================

/** True when a response looks like a transient edge/server blip we should retry. */
export function isTransient(status, text) {
  if (status === 429 || status >= 500) return true;
  const t = (text || '').trim();
  if (!t) return true; // empty body — edge dropped it
  if (/no session|too many requests|rate.?limit|error 10\d\d|service unavailable|bad gateway|gateway time-?out/i.test(t)) return true;
  return false;
}

/** Parse a JSON-RPC payload from a plain-JSON or SSE (data:) response body. */
export function parseRpc(text) {
  const raw = (text || '').trim();
  if (raw.startsWith('{')) { try { return JSON.parse(raw); } catch { /* fall through */ } }
  for (const ev of raw.split(/\r?\n\r?\n/)) {
    const dataLines = ev.split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.replace(/^data:\s?/, ''));
    if (!dataLines.length) continue;
    try {
      const candidate = JSON.parse(dataLines.join('\n'));
      if (candidate.result || candidate.error || candidate.jsonrpc) return candidate;
    } catch { /* try next */ }
  }
  return null;
}
