// lib/retention.mjs — growth plan §3 "Retention: get the human's email, offer a
// watch" (BRAIN-GROWTH-PLAN 2026-09-28).
//
// WHY. Next-week key return is 5.8% (40/691 in the 7 days to 2026-09-27). The
// claim_free_key and bind_email responses are the two moments a human is most
// likely to be reading along, and neither asked for the one thing that keeps a
// key alive across chats (an email the human typed) or offered the one thing
// that brings them back (a watch that emails them when something moves).
//
// WHAT THIS MODULE OWNS (pure: no I/O, no process state except what callers
// hand in):
//   * the exact `Tell the user:` + `(agent: …)` lines for claim_free_key and
//     bind_email success responses;
//   * maskEmail — first character, •••, @domain;
//   * the returning-key nudge decision (flag DCHUB_RETURN_NUDGE, default OFF).
//
// ONE `Tell the user:` LINE PER RESPONSE. The paywall contract
// (lib/paywall-contract.mjs, mcp#607) and older paywall copy ("**Tell the
// user:**") already lead some responses with one. The nudge never adds a
// second: hasTellLine() is checked first and a response that already speaks to
// the human is left exactly as it was.

// Our own traffic and known bots. isBotOrInternalCtx in server.mjs covers most
// of these by token ("dchub", crawler/version shapes), but not
// claude-code-mpp-check and not a version-less hub-grok-bot, so the list the
// growth plan names is spelled out here too.
export const SELF_TRAFFIC_RE = /dchub-growth-audit|hub-grok-bot|dchub-internal|claude-code-mpp-check/i;

export const TELL_LINE_RE = /(^|\n)\s*(\*\*)?Tell the user:/;
export function hasTellLine(result) {
  try {
    const blocks = (result && Array.isArray(result.content)) ? result.content : [];
    return blocks.some((b) => b && typeof b.text === 'string' && TELL_LINE_RE.test(b.text));
  } catch (_) { return false; }
}
export function countTellLines(text) {
  return (String(text || '').match(/(^|\n)\s*(\*\*)?Tell the user:/g) || []).length;
}

// j•••@firm.com. Anything that is not one local part + one domain masks whole.
export function maskEmail(email) {
  const s = String(email || '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1 || at === s.length - 1) return '•••';
  return s[0] + '•••' + s.slice(at);
}

// ── claim_free_key ──────────────────────────────────────────────────────────
export const CLAIM_TELL_TEXT =
  'I set up a free DC Hub key. If you want it to work in future chats, tell me an email to tie it to. '
  + "It's used only for key recovery and receipts unless you also ask for alerts.";
export const CLAIM_AGENT_TEXT =
  'pass an email only if the user typed it here, then call bind_email. '
  + 'Hosted clients: give the user connect_url to paste as the connector URL.';
export function claimLead() {
  return 'Tell the user: "' + CLAIM_TELL_TEXT + '"\n(agent: ' + CLAIM_AGENT_TEXT + ')\n\n';
}

// ── bind_email ──────────────────────────────────────────────────────────────
// market: { slug, name } when the key's most-queried market is known, else
// null → the neutral sentence. Nothing on the backend reports that market
// today (see the PR), so callers pass null.
export function bindTellText(email, market) {
  const name = market && typeof market.name === 'string' && market.name.trim() ? market.name.trim() : '';
  const watch = name
    ? 'when ' + name + "'s power score moves"
    : "when a market's power score moves";
  return 'Done. Your DC Hub key is tied to ' + maskEmail(email) + ' and can be recovered. '
    + 'Want me to watch anything? I can email you ' + watch + ', when a site you saved changes, '
    + 'or weekly with what changed in the markets you asked about.';
}
// Tool and parameter names are the real ones on /mcp: set_market_alert
// {market, channel}, save_site → set_site_alert {saved_site_id, notify_email},
// subscribe_digest {email}. test/retention-email-ask.test.mjs checks them
// against tools/list so a rename cannot leave this line pointing at nothing.
export function bindAgentText(email, market) {
  const slug = market && typeof market.slug === 'string' && market.slug.trim() ? market.slug.trim() : '<slug>';
  const e = String(email || '').trim() || '<bound>';
  return 'set_market_alert market=' + slug + ' channel=email · save_site then set_site_alert '
    + 'saved_site_id=<id> notify_email=' + e + ' · subscribe_digest email=' + e
    + ' (confirm link). Only after an explicit yes.';
}
export function bindLead(email, market) {
  return 'Tell the user: "' + bindTellText(email, market) + '"\n(agent: ' + bindAgentText(email, market) + ')\n\n';
}

// ── returning-key nudge ─────────────────────────────────────────────────────
export function returnNudgeEnabled(env = process.env) {
  return /^(1|on|true|yes)$/i.test(String((env && env.DCHUB_RETURN_NUDGE) || '').trim());
}

// ISO-8601 week, e.g. "2026-W40". UTC.
export function isoWeek(ms) {
  const d = new Date(ms);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = new Date(t).getUTCDay() || 7;
  const thu = new Date(t + (4 - day) * 86400000);
  const y = thu.getUTCFullYear();
  const wk = Math.ceil(((thu - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return y + '-W' + String(wk).padStart(2, '0');
}

// Who may ever see a nudge. Everything here is known without a network hop.
export function nudgeEligibleCaller(c, { directoryProfiles = [], isBot = () => false } = {}) {
  if (!c || !c.api_key) return false;                                  // anonymous
  if (c.profile && directoryProfiles.includes(c.profile)) return false; // /mcp/chatgpt, /mcp/claude, /mcp/core
  if (isBot(c)) return false;
  const who = [c.platform, c.client_name_raw, c.client_ua, c.user_agent].filter(Boolean).join(' ');
  if (SELF_TRAFFIC_RE.test(who)) return false;
  return true;
}

// The decision, from what the backend reported. Every field it needs and does
// not get is a reason to stay quiet, never a guess:
//   standing.found / age_days       key age (≥7 days)
//   standing.has_alert              false exactly — absent means unknown → skip
//   standing.last_seen_at           the key's previous call before this one
//   standing.top_market {slug,name} the market this key queries most
//   movers                          get_changes' dcpi_movers rows
// Returns { kind, line } or { kind: null, reason }.
export function nudgeDecision({ standing, email, movers, now = Date.now() }) {
  const s = standing || {};
  if (s.found !== true) return { kind: null, reason: 'key_not_found' };
  if (!(Number(s.age_days) >= 7)) return { kind: null, reason: 'key_younger_than_7d' };
  if (s.has_alert !== false) return { kind: null, reason: s.has_alert === true ? 'has_alert' : 'alert_state_unknown' };
  let lastMs = NaN;
  if (s.last_seen_at) {
    lastMs = Date.parse(s.last_seen_at);
    if (Number.isFinite(lastMs) && isoWeek(lastMs) === isoWeek(now)) {
      return { kind: null, reason: 'not_first_call_this_week' };
    }
  }
  const market = (s.top_market && typeof s.top_market === 'object') ? s.top_market : null;
  const mName = market && typeof market.name === 'string' && market.name.trim() ? market.name.trim() : '';
  if (email) {
    // "Since your last check {n} days ago … moved {±x}": the feed's delta is a
    // 7-day delta, so it is only a move SINCE the last check when the last
    // check is at least 7 days back. Anything shorter would credit movement
    // from before the check.
    if (!Number.isFinite(lastMs)) return { kind: null, reason: 'last_seen_unknown' };
    const n = Math.floor((now - lastMs) / 86400000);
    if (n < 7) return { kind: null, reason: 'last_check_under_7d' };
    if (!market || !market.slug || !mName) return { kind: null, reason: 'top_market_unknown' };
    const row = (Array.isArray(movers) ? movers : []).find((m) => m && m.market_slug === market.slug);
    const d = row && Number(row.delta_7d);
    if (!Number.isFinite(d) || Math.abs(d) < 1) return { kind: null, reason: 'no_real_move' };
    const x = (d > 0 ? '+' : '−') + String(Math.abs(Math.round(d * 10) / 10));
    return { kind: 'moved',
      line: 'Tell the user: "Welcome back. Since your last check ' + n + ' days ago, ' + mName
        + "'s DCPI score moved " + x + ' points. Want an email next time it moves?"' };
  }
  return { kind: 'no_email',
    line: 'Tell the user: "Welcome back. Give me an email and I\'ll keep this key recoverable and tell you when '
      + (mName || 'the markets you ask about') + ' change' + (mName ? 's' : '') + '."' };
}

// Prepend the line to content[0].text. Never replaces anything.
export function prependTellLine(result, line) {
  if (!result || !Array.isArray(result.content) || !line) return result;
  const content = result.content.slice();
  const i = content.findIndex((b) => b && b.type === 'text' && typeof b.text === 'string');
  if (i === 0) content[0] = { ...content[0], text: line + '\n\n' + content[0].text };
  else content.unshift({ type: 'text', text: line });
  return { ...result, content };
}
