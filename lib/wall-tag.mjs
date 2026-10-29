// lib/wall-tag.mjs — the MCP wall's relay link says which wall it came from (Brain block 2026-10-28, items 5 and 6).
//
// A wall hands the human a relay link (https://dchub.cloud/upgrade/h/<token>, or the /u/<code> short link that
// 302s to it). This module appends `?via=mcp-wall&wall=<type>` to the LONG relay URL, before it is shortened, so
// the page that opens counts the click (dchub-backend routes/mcp_wall_click, be#8037) and keeps the channel
// through key issue and checkout (be#8035's per-channel funnel).
//
//   status (the call's logged status)   wall type
//   trial_used                          trial_used
//   anon_daily_cap                      anon_daily_cap
//   lp_free_spent                       analyze_site_spent   (the free monthly analyze_site runs are used; this call is
//                                                            logged pro_wall, so wallTypeForResult reads the result's own block)
//
// Pure: no ctx, no network. server.mjs decides who is tagged (never the directory / Claude / core profiles:
// /mcp/chatgpt is frozen for OpenAI's review) and when. Kill switch: DCHUB_WALL_TAG=0.

export const WALL_CHANNEL = 'mcp-wall';
export const WALL_TYPES = Object.freeze({
  trial_used: 'trial_used',
  anon_daily_cap: 'anon_daily_cap',
  lp_free_spent: 'analyze_site_spent',
});
const WALL_RE = /^[a-z][a-z0-9_]{1,31}$/;   // the backend's wall shape (routes/via_funnel.normalize_wall)

export function wallTagOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_TAG) || '').trim());
}

// The wall type for a call status, or null (a status that is not one of the three is never tagged).
export function wallTypeFor(status) {
  const w = WALL_TYPES[String(status || '')];
  return w && WALL_RE.test(w) ? w : null;
}

// The spent analyze_site answer is logged under another status (pro_wall), so it is recognised by its own
// block: structuredContent.free_monthly_runs.reason (server.mjs _withLpFreeRunsSpent).
export function wallTypeForResult(status, result) {
  const w = wallTypeFor(status);
  if (w) return w;
  const r = result && result.structuredContent && result.structuredContent.free_monthly_runs;
  return r && r.reason === 'free_monthly_limit_reached' ? WALL_TYPES.lp_free_spent : null;
}

// One long relay URL, tagged. Anything else (a /u/ short link, another host, no wall type) comes back
// unchanged; a URL that already carries a `via` is left alone (idempotent, and never overrides another channel).
const LONG_RELAY_RE = /^(https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32})(\?[^\s"'\\)\]}>]*)?$/;
export function tagRelayUrl(url, wall) {
  const w = String(wall || '');
  if (!WALL_RE.test(w)) return url;
  const m = LONG_RELAY_RE.exec(String(url || ''));
  if (!m) return url;
  const q = m[2] ? m[2].slice(1) : '';
  if (q.split('&').some((p) => /^via(=|$)/i.test(p))) return url;
  return m[1] + '?' + (q ? q + '&' : '') + 'via=' + WALL_CHANNEL + '&wall=' + w;
}

// Every long relay URL inside a result (text blocks and structuredContent), tagged. The /u/ links are not
// touched here (their tag rides in the long URL they were minted from).
const LONG_RELAY_IN_TEXT_RE = /https:\/\/dchub\.cloud\/upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32}(?:\?[^\s"'\\)\]}>]*)?/g;
function deepSwap(v, swap) {
  if (typeof v === 'string') return swap(v);
  if (Array.isArray(v)) return v.map((x) => deepSwap(x, swap));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = deepSwap(x, swap);
    return o;
  }
  return v;
}
export function tagResultLinks(result, wall) {
  try {
    if (!result || typeof result !== 'object' || !WALL_RE.test(String(wall || ''))) return result;
    const swap = (s) => (s.includes('/upgrade/h/') ? s.replace(LONG_RELAY_IN_TEXT_RE, (u) => tagRelayUrl(u, wall)) : s);
    const out = { ...result };
    if (Array.isArray(out.content)) {
      out.content = out.content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? { ...b, text: swap(b.text) } : b));
    }
    if (out.structuredContent && typeof out.structuredContent === 'object') out.structuredContent = deepSwap(out.structuredContent, swap);
    return out;
  } catch (_) { return result; }   // a tag is never worth failing a response over
}
