// Wall-to-paid P3a (owner 2026-10-23, ~/dchub-progress/wall-to-paid-1023.md): every wall call's
// telemetry row names the link the caller was handed (mcp_call_log.wall_link_th).
//
// Since 2026-10-11 only analyze_site's pro_wall / lp_wall rows carried wall_link_th: the hash was
// taken inside the handler, where only those two walls had their final result. Every other wall
// (trial_used, anon_daily_cap, depth_teased, ...) returns early, and its human_url is built by the
// outer step chain AFTER the handler's `finally` has already sent the row. So a get_grid_intelligence
// wall could not be joined to the relay page open or the /go/c click it led to.
//
// The fix: a wall row that has no link yet is parked on the request ctx instead of sent; the
// outermost callback wrapper (server.mjs _sourceLineCb) hashes the FINAL result's link and sends it.
// A parked row is never lost: a timer sends it without a hash if the wrapper never flushes it
// (a throw in the chain, a caller that bypasses the wrapper). Kill switch DCHUB_WALL_LINK_DEFER=0
// sends every row immediately, exactly as before.

// The mcp_call_log statuses a gated call is logged under (measured 30d to 2026-10-23).
export const WALL_LINK_STATUSES = Object.freeze(new Set([
  'trial_used', 'anon_hard_wall', 'anon_daily_cap', 'mpp_offer_undercap', 'mpp_offer_prewall',
  'pro_wall', 'lp_wall', 'lp_preview', 'trial_taste_inline', 'trial_taste_bounded',
  'trial_cap_exceeded', 'depth_teased', 'top_metro_free', 'siting_noemail_preview',
  'blocked_paid_only',
]));

export const WALL_LINK_FLUSH_FALLBACK_MS = 5000;

export function wallLinkDeferOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_LINK_DEFER) || '').trim());
}

// Park `payload` on ctx when it is a wall row with no link hash yet; returns true when parked.
// `send(payload)` is what an unflushed row falls back to after `fallbackMs`.
export function parkWallTrack(c, payload, send, { fallbackMs = WALL_LINK_FLUSH_FALLBACK_MS, env } = {}) {
  try {
    if (!c || typeof c !== 'object' || !payload || typeof send !== 'function') return false;
    if (!wallLinkDeferOn(env)) return false;
    if (!WALL_LINK_STATUSES.has(payload.status) || payload.wall_link_th) return false;
    const entry = { payload, sent: false, timer: null };
    entry.timer = setTimeout(() => { _sendOnce(entry, send, null); }, fallbackMs);
    if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
    if (!Array.isArray(c._pendingWallTracks)) c._pendingWallTracks = [];
    c._pendingWallTracks.push(entry);
    return true;
  } catch (_) { return false; }
}

// Send every row parked for `tool` on ctx, stamped with hashFn(result) when it names a link.
// Returns the number of rows sent.
export function flushWallTracks(c, tool, result, hashFn, send) {
  let n = 0;
  try {
    const list = c && Array.isArray(c._pendingWallTracks) ? c._pendingWallTracks : null;
    if (!list || !list.length) return 0;
    let th = null;
    try { th = typeof hashFn === 'function' ? hashFn(result) : null; } catch (_) { th = null; }
    const keep = [];
    for (const e of list) {
      if (e && e.payload && e.payload.tool === tool && !e.sent) { if (_sendOnce(e, send, th)) n += 1; }
      else if (e && !e.sent) keep.push(e);
    }
    c._pendingWallTracks = keep;
  } catch (_) { /* telemetry never touches a response */ }
  return n;
}

function _sendOnce(entry, send, th) {
  if (!entry || entry.sent) return false;
  entry.sent = true;
  if (entry.timer) { try { clearTimeout(entry.timer); } catch (_) {} }
  const payload = th ? { ...entry.payload, wall_link_th: th } : entry.payload;
  try { const p = send(payload); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (_) {}
  return true;
}
