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
//   * the human line says what the one route gets the caller, in canon's words.
// Data rows are strings too, so a sentence is rewritten only when it matches BANNED, and a URL only when it is a CTA.
// Paid callers are skipped (they meet no wall). Kill switch: DCHUB_PLAN_NEUTRAL_CTA=0.

import { leanObject } from './lean-response.mjs';
import { splitLeadingJson } from './facility-location.mjs';
import { FREE_OFFER_EMAIL, FREE_OFFER_LAND_POWER } from './tier-canon.mjs';

export const CONNECT_URL = 'https://dchub.cloud/connect';
export const NEUTRAL_GATED = "Some fields aren't included in this answer; connect a free key at dchub.cloud/connect.";
export const FREE_OFFERS = FREE_OFFER_EMAIL + '; ' + FREE_OFFER_LAND_POWER;
// What the acceptance test bans (coordinator, note L1/L2), plus "behind a paid tier".
export const BANNED = /paid upgrade|paid data tier|paid (?:DC Hub )?(?:plan|tier|key)s?\b|paid-plan|behind a paid|upgrade page|\/pricing|\/upgrade|checkout|stripe|\$\d|\b(?:Pro|Developer|Enterprise|Starter) plan/i;
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

export function neutralString(s) {
  if (typeof s !== 'string' || !s) return s;
  // A URL match can swallow the sentence's closing punctuation ("…/pricing."); keep it, or the next sentence would
  // read as part of this one.
  let t = s.replace(CTA_URL, (u) => CONNECT_URL + ((u.match(/[.,;:!?]+$/) || [''])[0])).replace(RELAY_PROMISE, 'to connect a free key (' + FREE_OFFERS + ')')
    .replace(EMAIL_OFFER, 'Free: ' + FREE_OFFER_EMAIL).replace(BOUND_OFFER, 'the free offer is ' + FREE_OFFER_EMAIL);
  if (!BANNED.test(t)) return t;
  // Sentence by sentence, keeping line breaks: a banned sentence goes, the neutral one is said once in its place.
  let said = t.includes(NEUTRAL_GATED);
  t = t.split('\n').map((line) => {
    if (!BANNED.test(line)) return line;
    const parts = line.split(/(?<=[.!?])\s+/);
    const kept = [];
    for (const p of parts) {
      if (!BANNED.test(p)) { kept.push(p); continue; }
      if (!said) { kept.push(NEUTRAL_GATED); said = true; }
    }
    return kept.join(' ');
  }).join('\n');
  return BANNED.test(t) ? NEUTRAL_GATED : t;
}

// Commerce fields: a checkout / pricing / credits / plan link has no neutral form, so the key goes (its value would
// otherwise become a second /connect link under a name that still says checkout). An offer object for a paid rung
// (developer / pack / pro, or one carrying a checkout link) goes from its list the same way.
const COMMERCE_KEY = /^(?:upgrade_this_key[a-z_]*|checkout(?:_url)?|credits_url|pro_url|pack_url|developer_url|upgrade_url|pricing_url|stripe[a-z_]*)$/i;
const PAID_RUNG = new Set(['developer', 'pack', 'pro', 'credits', 'starter', 'enterprise']);
const isPaidOffer = (x) => isObj(x) && ((typeof x.id === 'string' && PAID_RUNG.has(x.id.toLowerCase()))
  || (typeof x.plan === 'string' && PAID_RUNG.has(x.plan.toLowerCase())) || 'checkout_url' in x);

function walk(v, depth = 0) {
  if (depth > 60) return v;
  if (typeof v === 'string') return neutralString(v);
  if (Array.isArray(v)) return v.filter((x) => !isPaidOffer(x)).map((x) => walk(x, depth + 1));
  if (!isObj(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) { if (!COMMERCE_KEY.test(k)) out[k] = walk(x, depth + 1); }
  return out;
}

// The plan object: steps lose the relay / upsell keys, then every string is neutralised.
export function neutralPlanObject(plan) {
  if (!isObj(plan)) return plan;
  const p = { ...plan };
  if (Array.isArray(p.executed)) {
    p.executed = p.executed.map((e) => (isObj(e) && isObj(e.result) ? { ...e, result: leanObject(e.result) } : e));
  }
  return walk(p);
}

// The step server.mjs runs on a finished execute_plan answer. `paid`: the caller is on a paid plan (skipped).
export function neutralCtaStep(result, { skip = false, paid = false, env = process.env } = {}) {
  try {
    if (skip || paid || !neutralCtaOn(env)) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const out = { ...result };
    if (isObj(result.structuredContent)) out.structuredContent = neutralPlanObject(result.structuredContent);
    out.content = result.content.map((b, i) => {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') return b;
      if (i === 0) {
        const sp = splitLeadingJson(b.text);
        if (sp && isObj(sp.json)) return { ...b, text: neutralString(sp.head) + JSON.stringify(neutralPlanObject(sp.json)) + neutralString(sp.rest) };
      }
      const t = neutralString(b.text);
      return t === b.text ? b : { ...b, text: t };
    });
    return out;
  } catch (_) { return result; }
}
