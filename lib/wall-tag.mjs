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
// C3 (2026-11-09, G10): every other wall the MCP server logs (lib/keyless-wall.mjs QUOTA_WALL_STATUSES)
// is tagged with its own status, so a click is counted for whichever wall handed the link out, not only
// the three above. The backend takes any well-formed wall (routes/via_funnel.normalize_wall).
// OFF until DCHUB_WALL_TAG_ALL=1: on, the analyze_site pro_wall / lp_wall relay gains the tag, which
// breaks two link contracts that predate it (test/pc-arm-tag-visible-link: the Grok and v2 relay ends
// ?pc=<arm>; test/wall-user-line F5: a failed mint ships the long link exactly as before). Those are
// reworked with their owners before this is turned on.
export const MORE_WALL_TYPES = Object.freeze({
  pro_wall: 'pro_wall', lp_wall: 'lp_wall', trial_cap_exceeded: 'trial_cap_exceeded',
  anon_hard_wall: 'anon_hard_wall', blocked_paid_only: 'blocked_paid_only',
  monthly_quota_blocked: 'monthly_quota_blocked', metered_enforced: 'metered_enforced',
  credits_depleted: 'credits_depleted',
});
export function wallTagAllOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_WALL_TAG_ALL) || '').trim());
}

export function wallTagOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_TAG) || '').trim());
}

// The wall type for a call status, or null (a status that is not one of the three is never tagged).
export function wallTypeFor(status, env = process.env) {
  const s = String(status || '');
  const w = WALL_TYPES[s] || (wallTagAllOn(env) && Object.prototype.hasOwnProperty.call(MORE_WALL_TYPES, s)
    ? MORE_WALL_TYPES[s] : undefined);
  return w && WALL_RE.test(w) ? w : null;
}

// The spent analyze_site answer is logged under another status (pro_wall), so it is recognised by its own
// block: structuredContent.free_monthly_runs.reason (server.mjs _withLpFreeRunsSpent).
export function wallTypeForResult(status, result, env = process.env) {
  // One of the original three statuses wins; then the spent-runs block (that answer is logged pro_wall,
  // which since C3 has a tag of its own, so the block must be read before it); then the other walls.
  const w3 = WALL_TYPES[String(status || '')];
  if (w3 && WALL_RE.test(w3)) return w3;
  const r = result && result.structuredContent && result.structuredContent.free_monthly_runs;
  if (r && r.reason === 'free_monthly_limit_reached') return WALL_TYPES.lp_free_spent;
  return wallTypeFor(status, env);
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
