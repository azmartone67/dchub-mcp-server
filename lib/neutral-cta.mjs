// neutral-cta.mjs -- an execute_plan answer to a caller below a paid plan names no paid tier, no price, no upgrade or
// pricing page, and its one call to action is https://dchub.cloud/connect (Grok note L1 + L2, owner via coordinator
// 2026-11-15).
//
// WHY. Keyless execute_plan answers carried "paid upgrade" / "paid data tier" / upgrade-page wording plus an upgrade
// URL (the /u/ relay link, each step's `upgrade.upgrade_url` / `signup_url` / `redeem_url`, the /mcp/oauth sign-in
// line), and Arcade rendered that URL as [blocked]. Standing owner rule: agent-facing text names no plans and no
// prices; the free offers are stated exactly as canon words them (lib/tier-canon.mjs FREE_OFFER_EMAIL,
// FREE_OFFER_LAND_POWER).
//
// WHAT. On the finished execute_plan answer (server.mjs _sourceLineCb, the LAST step, after the front desk):
//   * every call-to-action URL (relay /u/, /upgrade, /go/, /pricing, /checkout, /signup, /claim, /redeem, the key
//     claim endpoint, the OAuth sign-in URLs, Stripe) becomes https://dchub.cloud/connect, in structuredContent and in
//     every text block (block 0's JSON included);
//   * a sentence naming a paid tier, a price, an upgrade page or a checkout is replaced by the neutral one,
//     NEUTRAL_GATED, said once per string;
//   * the step results lose the relay / upsell keys lean already drops at the top level (lib/lean-response.mjs
//     leanObject: upgrade, continuation, signup_url, ...), so a step carries no second route;
//   * the human line points to the one route with the neutral connect line (option A, owner 2026-11-16: no allowance
//     or price wording, lib/neutral-connect.mjs).
// DATA IS NEVER REWRITTEN (coordinator, blocking on mcp#1465): steps carry real prices ($/MWh, DCGI $/MMBtu, deal
// values, incentive amounts). In the JSON, a string changes only under a CTA / offer / wall / relay key (CTA_KEYS,
// an explicit allowlist, at any depth: a walled step's own human_url / for_your_human / _upgrade are wall copy);
// every other value is passed through as the same value, with ONE exception: the wall's own link. A walled answer
// points every dchub link at its relay link (server.mjs _oneLinkWallStep), so the exact relay URLs found in the CTA
// fields are swapped for /connect wherever that step put them (the URL alone; no sentence there changes). In prose blocks a bare "$<digit>" is a figure, not a
// price of ours: only a DC Hub price shape (a pack, a per-month price) or the commerce words count there.
// Paid callers are skipped (they meet no wall). Kill switch: DCHUB_PLAN_NEUTRAL_CTA=0.

import { leanObject } from './lean-response.mjs';
import { splitLeadingJson } from './facility-location.mjs';
import { FREE_OFFER_EMAIL, FREE_OFFER_LAND_POWER } from './tier-canon.mjs';

export const CONNECT_URL = 'https://dchub.cloud/connect';
// Option A (owner 2026-11-16): the neutral line names no key, allowance or price (lib/neutral-connect.mjs).
export const NEUTRAL_GATED = "Some fields aren't included in this answer; more detail is available at dchub.cloud/connect.";
// Kept for importers; no execute_plan copy states it any more (option A).
export const FREE_OFFERS = FREE_OFFER_EMAIL + '; ' + FREE_OFFER_LAND_POWER;
// What the acceptance test bans (coordinator, note L1/L2), plus "behind a paid tier".
export const BANNED = /paid upgrade|paid data tier|paid (?:DC Hub )?(?:plan|tier|key)s?\b|paid-plan|behind a paid|upgrade page|\/pricing|\/upgrade|checkout|stripe|\$\d|\b(?:Pro|Developer|Enterprise|Starter) plan/i;
// Prose: the commerce words, and a price only in DC Hub's own shapes ("$10 pack", "$99/mo", "$10 one-time").
export const BANNED_PROSE = /paid upgrade|paid data tier|paid (?:DC Hub )?(?:plan|tier|key)s?\b|paid-plan|behind a paid|upgrade page|\/pricing|\/upgrade|checkout|stripe|\b(?:Pro|Developer|Enterprise|Starter) plan|\$\d[\d,.]*\s*(?:\/\s?mo\b|\/month\b|(?:a|per) month\b|one-time\b|(?:credit )?pack\b)/i;
// The keys whose value is call-to-action, offer, wall or relay copy, never data (the explicit allowlist).
export const CTA_KEYS = new Set([
  'human_url', 'human_message', 'human_line', 'relay_to_human', 'user_message', 'for_your_human', 'agent_instruction',
  '_agent_instruction', 'upgrade_options', 'offers', 'offer', 'offer_line', '_upgrade', 'upgrade', 'walls', 'wall',
  'wall_message', 'wall_note', 'tier_note', 'more_detail', 'preview_note', 'withheld_note', 'unlock_note', 'email_ask',
  'relay', 'relay_url', 'free_alternative', 'what_unlocks', 'after_checkout', 'high_intent_instructions',
]);
// A call-to-action URL: anything that sends the person to sign up, claim, pay or unlock.
export const CTA_URL = /https?:\/\/(?:(?:www\.)?dchub\.cloud\/(?:u\/|upgrade|go\/|pricing|checkout|signup|claim|redeem|unlock|mcp\/oauth|mcp\/grok\/oauth|api\/v1\/redeem|api\/v1\/keys\/claim|api\/v1\/claim)|(?:buy|checkout)\.stripe\.com)[^\s"'<>)\]`]*/gi;

export function neutralCtaOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_NEUTRAL_CTA) || '').trim());
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// The relay line's promise ("to see what it found and how to unlock it") names a page /connect is not.
const RELAY_PROMISE = /\bto see what it found and how to unlock it\b/g;
// The keyless wall's own offer sentence states its allowance in its own words; the plan states canon's.
const EMAIL_OFFER = /\bOne email unlocks \d[\d,]* calls a day\b/g;
const BOUND_OFFER = /\ban email-bound key gets \d[\d,]* calls a day, free\b/g;   // server.mjs _sessionlessCapEmailAsk

// `prose`: a text block, where a "$<digit>" figure is data (BANNED_PROSE); a CTA field uses BANNED.
export function neutralString(s, { prose = false } = {}) {
  if (typeof s !== 'string' || !s) return s;
  const BAN = prose ? BANNED_PROSE : BANNED;
  // A URL match can swallow the sentence's closing punctuation ("…/pricing."); keep it, or the next sentence would
  // read as part of this one.
  let t = s.replace(CTA_URL, (u) => CONNECT_URL + ((u.match(/[.,;:!?]+$/) || [''])[0])).replace(RELAY_PROMISE, 'for more detail')
    .replace(EMAIL_OFFER, 'More detail is available at dchub.cloud/connect').replace(BOUND_OFFER, 'more detail is available at dchub.cloud/connect');
  if (!BAN.test(t)) return t;
  // Sentence by sentence, keeping line breaks: a banned sentence goes, the neutral one is said once in its place.
  let said = t.includes(NEUTRAL_GATED);
  t = t.split('\n').map((line) => {
    if (!BAN.test(line)) return line;
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = [];
    for (const p of parts) {
      if (!BAN.test(p)) { kept.push(p); continue; }
      if (!said) { kept.push(NEUTRAL_GATED); said = true; }
    }
    return kept.join(' ');
  }).join('\n');
  return BAN.test(t) ? NEUTRAL_GATED : t;
}

// Commerce fields: a checkout / pricing / credits / plan link has no neutral form, so the key goes (its value would
// otherwise become a second /connect link under a name that still says checkout). An offer object for a paid rung
// (developer / pack / pro, or one carrying a checkout link) goes from its list the same way.
export const COMMERCE_KEY = /^(?:upgrade_this_key[a-z_]*|checkout(?:_url)?|credits_url|pro_url|pack_url|developer_url|upgrade_url|pricing_url|stripe[a-z_]*)$/i;
const PAID_RUNG = new Set(['developer', 'pack', 'pro', 'credits', 'starter', 'enterprise']);
const isPaidOffer = (x) => isObj(x) && ((typeof x.id === 'string' && PAID_RUNG.has(x.id.toLowerCase()))
  || (typeof x.plan === 'string' && PAID_RUNG.has(x.plan.toLowerCase())) || 'checkout_url' in x);

// The call-to-action URLs the CTA fields of v carry (the wall's own links), into `links`.
function collectLinks(v, links, cta = false, depth = 0) {
  if (depth > 60 || v == null) return links;
  if (typeof v === 'string') { if (cta) for (const u of v.match(CTA_URL) || []) links.add(u.replace(/[.,;:!?]+$/, '')); return links; }
  if (Array.isArray(v)) { for (const x of v) collectLinks(x, links, cta, depth + 1); return links; }
  if (isObj(v)) for (const [k, x] of Object.entries(v)) collectLinks(x, links, cta || CTA_KEYS.has(k), depth + 1);
  return links;
}
// The exact wall links in a string outside the CTA fields become /connect; nothing else in it changes.
function swapLinks(s, links) {
  if (!links || !links.size || typeof s !== 'string') return s;
  let t = s;
  for (const u of links) if (u && t.includes(u)) t = t.split(u).join(CONNECT_URL);
  return t;
}

// `cta`: v sits under a CTA_KEYS key. Outside one, a value is returned as it is (data), but for the wall's own
// links (swapLinks); only a commerce-named key is dropped and a CTA key further down is visited.
function walk(v, cta = false, depth = 0, links = null) {
  if (depth > 60) return v;
  if (typeof v === 'string') return cta ? neutralString(v) : swapLinks(v, links);
  if (Array.isArray(v)) return (cta ? v.filter((x) => !isPaidOffer(x)) : v).map((x) => walk(x, cta, depth + 1, links));
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) { if (!COMMERCE_KEY.test(k)) out[k] = walk(x, cta || CTA_KEYS.has(k), depth + 1, links); }
  return out;
}

// The plan object: steps lose the relay / upsell keys, then the CTA fields are neutralised.
export function neutralPlanObject(plan, links = collectLinks(plan, new Set())) {
  if (!isObj(plan)) return plan;
  const p = { ...plan };
  if (Array.isArray(p.executed)) {
    p.executed = p.executed.map((e) => (isObj(e) && isObj(e.result) ? { ...e, result: leanObject(e.result) } : e));
  }
  return walk(p, false, 0, links);
}

// The step server.mjs runs on a finished execute_plan answer. `paid`: the caller is on a paid plan (skipped).
export function neutralCtaStep(result, { skip = false, paid = false, env = process.env } = {}) {
  try {
    if (skip || paid || !neutralCtaOn(env)) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const out = { ...result };
    // the wall's own links, from the CTA fields of both copies (structuredContent and block 0's JSON)
    const links = collectLinks(result.structuredContent, new Set());
    const b0 = result.content[0] && typeof result.content[0].text === 'string' ? splitLeadingJson(result.content[0].text) : null;
    if (b0 && isObj(b0.json)) collectLinks(b0.json, links);
    const prose = (t) => swapLinks(neutralString(t, { prose: true }), links);
    if (isObj(result.structuredContent)) out.structuredContent = neutralPlanObject(result.structuredContent, links);
    out.content = result.content.map((b, i) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return b;
      if (i === 0) {
        const sp = b0;
        if (sp && isObj(sp.json)) {
          const j = neutralPlanObject(sp.json, links);
          const json = JSON.stringify(j) === JSON.stringify(sp.json) ? b.text.slice(sp.head.length, b.text.length - sp.rest.length) : JSON.stringify(j);
          return { ...b, text: prose(sp.head) + json + prose(sp.rest) };
        }
      }
      const t = prose(b.text);
      return t === b.text ? b : { ...b, text: t };
    });
    return out;
  } catch (_) { return result; }
}
