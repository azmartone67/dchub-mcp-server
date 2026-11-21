// lib/wall-identity-v2.mjs — the sign-in line on every keyless / trial-key wall (Brain read 2026-11-21).
//
// WHY. OAuth identities come back (7 of 13 OAuth identities in 30 days called on 3 or more distinct days); free keys
// almost never do. Yet the funnel (/api/v1/mcp/funnel quota_wall_hits.by_tool_email_ask_7d, hits_with_oauth_signin
// vs hits) showed the sign-in on 37/144 get_grid_intelligence walls, 32/93 get_interconnection_queue and 13/79
// execute_plan. The reasons, from the code, are listed in the PR that added this file; in short: one route per wall
// (lib/wall-offers.mjs oneRoute) drops the sign-in whenever the free email / digest floor is eligible, which on /mcp is
// every wall; execute_plan's lead-only branch reads a list one-route already emptied; and execute_plan's neutral CTA
// step (lib/neutral-cta.mjs CTA_URL) rewrites the /mcp/oauth URL to /connect, so offers_shown never saw it.
//
// WHAT (behind DCHUB_WALL_IDENTITY_V2, default OFF; on only for 1 / true / yes / on):
//   * SIGNIN_LINE, one text block, on a walled answer for a caller that is not signed in (auth_oauth) and has no email
//     on file, placed by server.mjs _wallIdentityV2Step AFTER every rewrite of the result, so no later step can drop
//     or rewrite the URL and the wall row's offers_shown (read from the final result) names 'oauth_signin';
//   * the free email ask a wall already makes reads emailAskLine(market): get_api_key keeps this answer and follows
//     the market the walled call was about, and the wall's structured email_ask names get_api_key with that market,
//     so the agent's one call mints the key, binds the email and follows the market (lib/daily-habit.mjs).
// Never: /mcp/chatgpt or any ChatGPT surface (frozen until the store resubmission), Grok (its G3 copy already carries
// its own sign-in block), an execute_plan step (the plan answer carries ONE line), the key / account tools.
// No price, no plan name, no allowance figure. Pure: no ctx, no network.
import { normMarketSlug, marketDisplayName, EMAIL_PLACEHOLDER } from './daily-habit.mjs';

export const WALL_IDENTITY_V2_FLAG = 'DCHUB_WALL_IDENTITY_V2';

export function wallIdentityV2On(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[WALL_IDENTITY_V2_FLAG]) || '').trim());
}

export const SIGNIN_URL = 'https://dchub.cloud/mcp/oauth';
export const SIGNIN_LINE = 'Reconnect with ' + SIGNIN_URL + ' to keep your history and get fuller answers. One sign-in, no key to copy.';
export const KEY_TOOL = 'get_api_key';
export const EMAIL_ASK_LEAD = 'Share an email with ' + KEY_TOOL + ' to keep this answer';

// The market the walled call was about: args.market, args.metro, args.slug, args.market_slug, else the planner's
// resolved market. '' when none is a valid market slug.
export function wallMarketFrom(args, resolved = '') {
  const a = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
  for (const k of ['market', 'metro', 'slug', 'market_slug']) {
    const m = normMarketSlug(typeof a[k] === 'string' ? a[k] : '');
    if (m) return m;
  }
  const list = Array.isArray(resolved) ? resolved : [resolved];
  for (const r of list) { const m = normMarketSlug(typeof r === 'string' ? r : ''); if (m) return m; }
  return '';
}

export function emailAskLine(market = '') {
  const m = normMarketSlug(market);
  return EMAIL_ASK_LEAD + ' and get a daily change note' + (m ? ' for ' + marketDisplayName(m) : '') + '.';
}

// The wall's structured next step: ONE get_api_key call with the human's email and the market.
export function emailAskCall(market = '') {
  const m = normMarketSlug(market);
  return { tool: KEY_TOOL, arguments: { email: EMAIL_PLACEHOLDER, ...(m ? { market: m } : {}) }, copy: emailAskLine(m) };
}

// Who gets the sign-in line. walled: the answer is a wall / tier-masked preview (for execute_plan: a step walled).
export function signInEligible({ walled = false, workosEnabled = false, signedIn = false, bound = false, chatgpt = false,
  grok = false, planStep = false, keyTool = false } = {}) {
  if (!walled || !workosEnabled) return false;
  if (chatgpt || grok || planStep || keyTool) return false;
  return !signedIn && !bound;
}

const isText = (b) => b && b.type === 'text' && typeof b.text === 'string';
const isJsonText = (b) => isText(b) && /^\s*[{[]/.test(b.text);

// The sign-in line as its own text block, right after the answer's JSON block (block 0 on a direct tool; block 1 once
// execute_plan's lead text sits in block 0), else after block 0. Never twice.
export function withSignInLine(result, line = SIGNIN_LINE) {
  if (!line || !result || typeof result !== 'object' || !Array.isArray(result.content) || !result.content.length) return result;
  if (result.content.some((b) => isText(b) && b.text.includes(line))) return result;
  const j = result.content.findIndex(isJsonText);
  const at = j >= 0 ? j + 1 : 1;
  const blocks = result.content.slice();
  blocks.splice(Math.min(at, blocks.length), 0, { type: 'text', text: line });
  return { ...result, content: blocks };
}

// The existing one-call identity sentence (lib/daily-habit.mjs dailyEmailAsk, both forms) a cap wall carries.
export const DAILY_ASK_RE = /Give your email to keep this answer and get daily changes(?: for [^.\n"]+)?\./g;

// The email ask copy, in place: the daily-habit sentence becomes emailAskLine(market) in every text block and in a
// structured email_ask's copy; a structured email_ask (structuredContent and a top-level JSON block) names get_api_key
// with the market. `asked`: the result carries an email ask (the caller's own read), so a structured call is added
// when none is there. Returns the result unchanged when nothing applies.
export function withEmailAsk(result, market = '', { asked = false } = {}) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const line = emailAskLine(market);
  const call = emailAskCall(market);
  let changed = false;
  const fixObj = (o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    const ea = o.email_ask;
    if (ea && typeof ea === 'object' && !Array.isArray(ea)) {
      changed = true;
      return { ...o, email_ask: { ...ea, tool: KEY_TOOL, arguments: { ...(ea.arguments || {}), ...call.arguments }, copy: line } };
    }
    if (asked && ea === undefined) { changed = true; return { ...o, email_ask: call }; }
    return o;
  };
  const content = result.content.map((b, i) => {
    if (!isText(b)) return b;
    if (i === result.content.findIndex(isJsonText) && /^\s*\{/.test(b.text)) {
      try {
        const o = JSON.parse(b.text);
        const n = fixObj(o);
        if (n !== o) {
          const txt = JSON.stringify(n).replace(DAILY_ASK_RE, line);
          return { ...b, text: txt };
        }
      } catch (_) { /* JSON + prose: handled as prose below */ }
    }
    const t = b.text.replace(DAILY_ASK_RE, line);
    if (t !== b.text) { changed = true; return { ...b, text: t }; }
    return b;
  });
  let sc = result.structuredContent;
  if (sc && typeof sc === 'object' && !Array.isArray(sc)) {
    const n = fixObj(sc);
    if (n !== sc) sc = n;
  }
  if (!changed) return result;
  return { ...result, content, ...(sc !== undefined ? { structuredContent: sc } : {}) };
}
