// lib/wall-offers.mjs — ONE entitlement-driven wall-offer builder (owner 2026-11-14, item E3).
//
// Before this, the offers a wall closes with were decided in three places, each reading the call's ctx on its own:
// the floor line (lib/wall-offer-floor.mjs: email ask, or digest + free key), the sign-in lead
// (lib/wall-oauth-lead.mjs) and the depth trial line (lib/wall-depth-trial.mjs). Each read `c.api_key` /
// `c.email` / `c.tier`, which describe how THIS call is served, not what the caller holds. They differ on the
// daily-quota path (server.mjs r-daily-quota): an email-bound key (identified, 50 calls/day) or a Developer key
// (500/day) past its day is served as an anonymous call, with api_key, email and tier blanked for that call. So,
// measured on main 2026-11-14 with the real /mcp handler, an identified key over its day hitting rank_markets or
// get_interconnection_queue was told "Share your email and DC Hub opens more of this answer" and
// "with no key, `bind_email` returns an email-bound key": it already has both, and that bind_email lands on
// claim_free_key's email_has_key refusal. A Developer key past its day was offered the free key and the trial.
//
// Now:
//   wallEntitlements(c)  what the caller HOLDS: keyed, bound (an email on file), signedIn (OAuth), paid, and
//                        `held` when this call is served below what it holds (today: 'daily_quota');
//   wallOffers(ent, f)   the offers that caller is eligible for on this wall, in placement order, each with
//                        its offers_shown kind(s) and the email-ask tag the call is marked with.
// The decisions and the copy are the existing ones (floorOfferKind / floorOfferLine, wallOauthLeadEligible /
// wallOauthLeadLine, depthTrialEligible / depthTrialLine), so where entitlements equal the served identity
// the wall is byte-identical (test/wall-offers.test.mjs pins it over the full input matrix).
//
// Rules every offer here keeps (test/wall-offers.test.mjs):
//   * links: a line may name only the wall's own server-minted human link (humanLinkOf: the /u/ short link or the
//     signed /upgrade/h/ page), the fixed connector URLs or the /mcp/connect sign-in page. A line naming any other URL is dropped (mintedOnly).
//   * limits: a line that states a calls / full-answers figure must state canon's (canonical/tier_limits.json via
//     lib/tier-canon.mjs); today none of these lines states one.
//   * every email ask carries its tag (`ask`: 'line' for the email unlock, 'digest_line' for the digest), which the
//     caller marks on the call (server.mjs _markEmailAsk), so the wall row and a later email_entered are credited.
//   * kinds are lib/offers-shown.mjs OFFER_KINDS, the vocabulary the wall row's offers_shown is recorded in.
// No plan names and no prices: these are the free paths (owner 2026-10-10). Pure: no ctx writes, no network.
//
// ONE ROUTE PER WALL (Grok note K item 8, 2026-11-15). A wall used to stack its offers: the OAuth sign-in lead, the
// free email / digest floor and the depth trial, beside the answer's own human link, claim_free_key and checkout
// copy, about six ways on from one wall. Now wallOffers returns at most ONE offer, the single best next action:
//   * the answer already carries a free offer (freeOfferShown): that offer IS the route, nothing is added (except
//     note N item 1: on a digest-only wall for a caller with no email, the free-key line joins that digest offer,
//     ahead of it in the same block, so the route is still one offer);
//   * else the free email / digest floor (it says in one sentence what the email gets: more of this answer, or a
//     weekly summary where an email opens nothing); test/every-wall-carries-an-offer pins that every wall row
//     names one of those two;
//   * else (no floor eligible) the sign-in, else the depth trial.
// Grok's fixed G3 copy is unchanged: its one added block is the sign-in. Kill switch DCHUB_WALL_ONE_ROUTE=0 brings
// back the stacked offers.
import { floorOfferKind, floorOfferLine } from './wall-offer-floor.mjs';
import { wallOauthLeadEligible, wallOauthLeadLine, OAUTH_SIGNIN_URL, CONNECT_PAGE_URL, GROK_OAUTH_SIGNIN_URL } from './wall-oauth-lead.mjs';
import { depthTrialEligible, depthTrialLine } from './wall-depth-trial.mjs';
import { OFFER_KINDS } from './offers-shown.mjs';
import { TIER_CANON } from './tier-canon.mjs';
import { keyLine, keyLineEligible, KEY_LINE_ASK, KEY_LINE_KIND } from './wall-key-line.mjs';

// The daily-quota rungs (dchub-backend flask_mcp_endpoints.daily_quota_tier_from): 'identified' = an email bound to
// the key; 'developer' = a paid plan (its key carries the buyer's email). Nothing else is metered per day.
export const HELD_DAILY_QUOTA = Object.freeze({
  identified: Object.freeze({ bound: true, paid: false }),
  developer: Object.freeze({ bound: true, paid: true }),
});

// What the caller holds. `paidTier(tier)`: server.mjs's own rank test (tier >= starter), injected so this file keeps
// no copy of the ladder.
export function wallEntitlements(c, { paidTier = () => false } = {}) {
  const x = (c && typeof c === 'object') ? c : {};
  const dq = x.daily_quota && typeof x.daily_quota === 'object' ? x.daily_quota : null;
  const held = dq ? HELD_DAILY_QUOTA[String(dq.tier || '').toLowerCase()] || null : null;
  let paid = false;
  try { paid = !!paidTier(String(x.tier || '')); } catch (_) { paid = false; }
  return Object.freeze({
    keyed: !!x.api_key || !!held,
    bound: !!x.email || !!(held && held.bound),
    signedIn: x.auth_oauth === true,
    paid: paid || !!(held && held.paid),
    held: held ? 'daily_quota' : '',
  });
}

// Every https URL in a line.
const URL_RE = /https:\/\/[^\s)"'`\]]+/g;
// Keep only offers whose every URL is one the server minted for this wall (`link`) or a fixed connector URL.
export function mintedOnly(offers, link = '') {
  const allowed = new Set([OAUTH_SIGNIN_URL, GROK_OAUTH_SIGNIN_URL, CONNECT_PAGE_URL]);  // + the human sign-in page (2026-11-21)
  if (typeof link === 'string' && link) allowed.add(link);
  return (Array.isArray(offers) ? offers : []).filter((o) => {
    const urls = String((o && o.line) || '').match(URL_RE) || [];
    return urls.every((u) => allowed.has(u.replace(/[.,;:]+$/, '')));
  });
}

// The calls / full-answers figures canon publishes; a line may state these and no others.
const CANON_FIGURES = (() => {
  const s = new Set();
  const add = (n) => { if (Number.isFinite(n) && n > 0) s.add(String(n)); };
  try {
    for (const v of Object.values(TIER_CANON.calls_per_day || {})) add(v);
    for (const a of Object.values(TIER_CANON.allowance || {})) {
      if (a && typeof a === 'object') { add(a.calls); add(a.full_answers_per_tool_per_day); }
    }
  } catch (_) { /* an empty set: any stated figure fails the check */ }
  return s;
})();
// "50 MCP calls/day" (canon's own form, the free-key line) counts as a stated figure too (note N item 1).
const FIGURE_RE = /(\d[\d,]*)\s+(?:MCP\s+)?(?:calls?|full answers?)\b/gi;
export function statesOnlyCanonLimits(line) {
  for (const m of String(line || '').matchAll(FIGURE_RE)) {
    if (!CANON_FIGURES.has(m[1].replace(/,/g, ''))) return false;
  }
  return true;
}

// The offers one walled answer is eligible for, in placement order:
//   place 'lead'        right after block 0, ahead of everything (the sign-in);
//   place 'floor'       right after block 0 (the free email / digest offer), only when the answer has no free
//                       offer yet (`freeOfferShown`);
//   place 'below_link'  right below the block that hands out `link` (the trial).
// Facts (all from server.mjs, read once):
//   tool, walled         the tool, and whether this answer is a wall / tier-masked preview;
//   depth                an email opens nothing on this wall (raw: before proOnly);
//   proOnly              the tool opens on a paid plan only;
//   link                 the server-minted human link the answer carries ('' = none);
//   workosEnabled        sign-in exists to offer;
//   grok                 Grok's fixed G3 copy: only the sign-in block is added, nothing else;
//   freeOfferShown       the answer already carries a free offer (email unlock or digest);
//   shownOffers          the offers_shown kinds that answer already carries (note N item 1: digest without an unlock);
//   keyAsked             the answer already asks for the email in prose to mint a key (the claim hand-off line,
//                        lib/offers-shown.mjs askedForEmailInProse): no second email-for-key line.
export function wallOffers(ent, { tool = '', walled = false, depth = false, proOnly = false, link = '',
  workosEnabled = false, grok = false, freeOfferShown = false, shownOffers = null, keyAsked = false, env = process.env } = {}) {
  const e = ent || wallEntitlements(null);
  const deep = !!(proOnly || depth);
  const offers = [];
  if (!walled) return offers;
  if (wallOauthLeadEligible({ walled, workosEnabled, signedIn: e.signedIn, bound: e.bound, env })) {
    offers.push({ kind: 'oauth_signin', kinds: ['oauth_signin'], place: 'lead', ask: null,
      line: wallOauthLeadLine({ grok: !!grok, depth: deep }) });
  }
  if (grok) return mintedOnly(offers, link).filter((o) => statesOnlyCanonLimits(o.line));
  const one = wallOneRouteOn(env);
  const k = floorOfferKind({ proOnly, depth, bound: e.bound });
  // Note N item 1 (lib/wall-key-line.mjs): on a digest-only wall, a caller with no email on file reads the free-key
  // line first and the digest offer second, as ONE offer. The answer already carrying the digest offer (and no email
  // unlock ask) gets the line in that digest block (place 'ahead_of_digest'); otherwise the floor line carries both.
  const shown = Array.isArray(shownOffers) ? shownOffers : [];
  if (freeOfferShown) {
    const kl = keyLineEligible({ floorKind: k, bound: e.bound, paid: e.paid, digest: shown.includes('digest'),
      unlock: shown.includes('email_unlock') || !!keyAsked, env }) ? keyLine({ keyed: e.keyed }) : '';
    const ahead = kl ? [{ kind: KEY_LINE_KIND, kinds: [KEY_LINE_KIND], place: 'ahead_of_digest', ask: KEY_LINE_ASK, line: kl }] : [];
    if (one) return mintedOnly(ahead, link).filter((o) => statesOnlyCanonLimits(o.line));
    offers.push(...ahead);
  }
  if (!freeOfferShown) {
    const kl = keyLineEligible({ floorKind: k, bound: e.bound, paid: e.paid, digest: true, unlock: !!keyAsked, env }) ? keyLine({ keyed: e.keyed }) : '';
    // With the key line ahead, the digest line drops its own trailing claim_free_key clause (the key line names it).
    const digestLine = floorOfferLine(k, { keyed: e.keyed || !!kl, bound: e.bound, depth: deep });
    const line = kl ? kl + '\n\n' + digestLine : digestLine;   // two paragraphs, one offer
    const kind = k === 'email' && !e.bound ? 'email_unlock' : 'digest';
    const kinds = [kind];
    if (kind === 'digest' && !e.keyed) kinds.push('free_key');   // the digest line (or the key line) names claim_free_key
    if (kl) kinds.push(KEY_LINE_KIND);
    offers.push({ kind, kinds, place: 'floor', ask: kl ? KEY_LINE_ASK : (kind === 'email_unlock' ? 'line' : 'digest_line'), line });
  }
  if (depthTrialEligible({ tool, walled, depth: deep, paid: e.paid, link, env })) {
    offers.push({ kind: 'trial', kinds: ['trial'], place: 'below_link', ask: null, line: depthTrialLine() });
  }
  const kept = mintedOnly(offers, link).filter((o) => statesOnlyCanonLimits(o.line));
  return one ? oneRoute(kept) : kept;
}

export function wallOneRouteOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_ONE_ROUTE) || '').trim());
}

// The one offer a wall keeps: the free floor first, then the sign-in, then the trial. [] when there is none.
const ROUTE_RANK = Object.freeze({ floor: 0, ahead_of_digest: 0, lead: 1, below_link: 2 });
export function oneRoute(offers) {
  const list = (Array.isArray(offers) ? offers : []).filter((o) => o && ROUTE_RANK[o.place] !== undefined);
  if (!list.length) return [];
  return [list.reduce((a, b) => (ROUTE_RANK[b.place] < ROUTE_RANK[a.place] ? b : a), list[0])];
}

// Every kind the offers name, sorted (the offers_shown vocabulary).
export function offerKinds(offers) {
  const s = new Set();
  for (const o of (Array.isArray(offers) ? offers : [])) for (const k of (o.kinds || [])) if (OFFER_KINDS.includes(k)) s.add(k);
  return [...s].sort();
}
