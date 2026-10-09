// lib/tier-canon.mjs — ONE source for every allowance and price this repo states.
// Imported by server.mjs (re-exported from there for tests) AND by
// scripts/sync-tools-manifest.mjs, so a tool description that interpolates a
// rung evaluates to the same number in the served tools/list and in every
// committed manifest — no second copy to rot.
import { readFileSync } from 'node:fs';

// ★★★ r-tier-canon (2026-09-02, QA sweep D8 + pricing #3). ONE object for every
// allowance and price this server puts in front of an agent.
//
// MEASURED 2026-09-02 00:29Z: the free tier was described FOUR ways inside the
// same manifest family ("10 calls/day", "10 free calls total", "50 calls/day when
// bound", "2 flagship answers/day", "5 dossiers/day") and the price that
// actually sells — the $99 founding licence, 10 of 14 active external subs —
// appeared in NO plan list an agent reads (unlock_more_data offered $10/$9/$49/
// $299; get_dchub_recommendation's upgrade block said {developer 49, pro 299}).
// Every one of those strings was a literal, so every one drifted on its own.
//
// SOURCE: canonical/tier_limits.json, the daily fail-closed snapshot of
// GET /api/v1/tiers (owner: dchub-backend tier_registry.TIER_LIMITS), refreshed
// by scripts/refresh-tier-limits.mjs and staged by daily-manifest-sync.yml.
// Nothing in this file states an allowance or a price; it reads them. The
// guard in test/free-tier-claims.test.mjs fails the build on any literal
// "<digits> calls/day" inside a server.mjs string, so the drift class cannot
// come back one string at a time.
//
// FAIL-SOFT, and soft means HONEST-AND-SMALLER, never a guess: a missing or
// malformed snapshot leaves the ladder EMPTY — copy that interpolates a rung
// then reads "n/a", a plan list drops the entry, and the process still boots.
// Restating a fallback number here would be a second source of truth, which
// is the defect this exists to remove.
export const TIER_CANON = (() => {
  const empty = Object.freeze({ calls_per_day: Object.freeze({}), allowance: Object.freeze({}), price_usd_month: Object.freeze({}), credit_pack: Object.freeze({}), stripe_link: Object.freeze({}) });
  try {
    const j = JSON.parse(readFileSync(new URL('../canonical/tier_limits.json', import.meta.url), 'utf8'));
    const pick = (o) => Object.freeze(Object.fromEntries(
      Object.entries((o && typeof o === 'object') ? o : {})
        .filter(([, v]) => v === null || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string')));
    // 2026-09-27 (free-tier rule): each tier's allowance in its OWN unit —
    // {calls, period} where period is 'day' | 'lifetime' | 'month' | null.
    const allowance = Object.freeze(Object.fromEntries(
      Object.entries((j.allowance && typeof j.allowance === 'object') ? j.allowance : {})
        .filter(([, a]) => a && typeof a === 'object'
          && (a.calls === null || (typeof a.calls === 'number' && Number.isFinite(a.calls))))
        .map(([t, a]) => [t, Object.freeze({ ...a })])));
    return Object.freeze({
      calls_per_day:   pick(j.calls_per_day),
      allowance,
      price_usd_month: pick(j.price_usd_month),
      credit_pack:     pick(j.credit_pack),
      stripe_link:     pick(j.stripe_link),
    });
  } catch { return empty; }
})();
// The free ladder, named the way copy uses it. `full_answers_per_day` is the
// per-tool flagship taste (TRIAL_DAILY_FULL_CAP, env-tunable — an operator
// knob, not a published tier rung, so it stays where it is and is only
// MIRRORED here, resolved lazily because that const is declared further down).
// A rung is the tier's per-day count, or — for the free key, whose published
// allowance is 10 IN TOTAL rather than per day (free-tier rule, 2026-09-27) —
// its allowance count. Anonymous has neither (no call count at all) → 'n/a'.
const _rungOfIn = (canon, t) => {
  const d = canon.calls_per_day && canon.calls_per_day[t];
  if (Number.isFinite(d)) return d;
  const a = canon.allowance && canon.allowance[t];
  return (a && Number.isFinite(a.calls)) ? a.calls : null;
};
const _rungOf = (t) => _rungOfIn(TIER_CANON, t);
const _rung = (t) => { const n = _rungOf(t); return n === null ? 'n/a' : n; };
export const _rungNum = (t) => _rungOf(t);
export const FREE_TIER = Object.freeze({
  anonymous_calls_per_day:  _rung('anonymous'),   // keyless, per IP
  free_calls_per_day:       _rung('free'),        // a claim_free_key dch_live_ key, unbound
  identified_calls_per_day: _rung('identified'),  // the same key once bind_email has run
  starter_calls_per_day:    _rung('starter'),
  // The unbound-key gate: how many calls a fresh dch_live_ key gets before
  // bind_email is required. The backend owns the gate and reports the number
  // on the claim response (free_calls_unbound); this is the published default
  // it falls back to, and it is the free rung — one number, not a fifth.
  // B1 (D4): 'n/a' once the free key is a daily allowance (no call count);
  // copy reads _freeKeyOfferText / _unboundKeyLadderText instead.
  unbound_calls_total:      _rung('free'),
});
// Per-tool full answers a day, from the allowance block (anonymous 2, bound 10;
// the free key 2 once B1's daily allowance is published).
const _fullIn = (canon, t) => {
  const a = canon.allowance && canon.allowance[t];
  return (a && Number.isFinite(a.full_answers_per_tool_per_day)) ? a.full_answers_per_tool_per_day : null;
};
export const _fullAnswersPerToolPerDay = (t) => _fullIn(TIER_CANON, t);

// ── B1 (D4, owner 2026-10-03; live 2026-10-04 00:15Z) ──────────────────
// The free key's allowance renews daily: previews plus N full answers per tool
// per day (the server's TRIAL_DAILY_FULL_CAP), no call count. The backend
// publishes it as allowance.free = {calls: null, period: 'day',
// full_answers_per_tool_per_day: N} on /api/v1/tiers. Every free-key sentence
// below reads THAT SHAPE, so this server says "10 calls to try" exactly as
// long as the snapshot says lifetime (and again if the backend's kill switch,
// DCHUB_FREE_KEY_LIFETIME_GATE=1, restores the gate) and the daily sentence
// the moment the snapshot flips. Nothing here states the figure itself.
// The `canon` argument exists for tests; callers use the default.
export function _freeKeyIsDaily(canon = TIER_CANON) {
  const a = canon.allowance && canon.allowance.free;
  return !!a && a.period === 'day' && !Number.isFinite(a.calls)
    && Number.isFinite(a.full_answers_per_tool_per_day);
}
// "Free key: <this>." — the offer clause, in the published rule's words.
export function _freeKeyOfferText(canon = TIER_CANON) {
  if (_freeKeyIsDaily(canon)) {
    return 'previews plus ' + _fullIn(canon, 'free') + ' full answers per tool per day';
  }
  const n = _rungOfIn(canon, 'free');
  return (n === null ? 'n/a' : n) + ' calls to try';
}
// "an unbound key gets <this>; binding restores…" (bind_email's ladder line).
export function _unboundKeyLadderText(canon = TIER_CANON) {
  if (_freeKeyIsDaily(canon)) {
    return 'previews plus ' + _fullIn(canon, 'free')
      + ' full answers per tool per day, renewed daily, then previews until the next day';
  }
  const n = _rungOfIn(canon, 'free');
  return (n === null ? 'n/a' : n) + ' free calls total, then results drop to previews until it\'s bound';
}
// The free key's allowance, said the way /pricing says it: the free-key
// clause, then a per-day rung once the key is bound to an email. Every runtime
// message that offers claim_free_key quotes this instead of "<free> calls/day",
// which read the lifetime allowance as a daily one (free-tier rule, 2026-09-27).
export function _freeKeyAllowanceText(canon = TIER_CANON) {
  const ident = _rungOfIn(canon, 'identified');
  return _freeKeyOfferText(canon) + ', ' + (ident === null ? 'n/a' : ident) + '/day with an email';
}
// The published free-tier rule (dchub-backend ai_surface_canon.free_tier_rule),
// composed from the same snapshot so the numbers cannot drift from the rungs.
// null when any rung is missing: a sentence with "n/a" in it is worse than none.
export function _freeTierRuleText(canon = TIER_CANON) {
  const ident = _rungOfIn(canon, 'identified');
  const identFull = _fullIn(canon, 'identified');
  if (_freeKeyIsDaily(canon)) {
    // B1 sentence, byte for byte the backend pin. The anonymous clause is
    // A1's literal (D1, mcp#701): anonymous gets previews.
    const freeFull = _fullIn(canon, 'free');
    if (![freeFull, ident, identFull].every(Number.isFinite)) return null;
    return 'Anonymous: previews, no key needed. '
      + 'Free key: previews plus ' + freeFull + ' full answers per tool per day. '
      + 'Add an email: ' + ident + ' calls/day '
      + '(up to ' + identFull + ' full answers per tool per day). '
      + 'Paid plans: dchub.cloud/pricing.';
  }
  const free = _rungOfIn(canon, 'free');
  if (![free, ident, identFull].every(Number.isFinite)) return null;
  // ★2026-09-28 (owner rule 09-27): the only price DC Hub states is the $10
  // pack, so the sentence names no plan price. It ended "Developer $49:
  // 500/day." and now points at /pricing (backend#5868 changed the pin).
  // ★A1 (owner D1, 2026-10-03): the anonymous clause states live behavior.
  // An unbound anonymous seat is served previews and is never charged a full
  // answer (server.mjs full_answers_unavailable_reason "NOT YET APPLICABLE at
  // an anonymous seat"), so the sentence no longer promises full answers there
  // and no longer reads the anonymous allowance figure.
  return 'Anonymous: previews, no key needed. '
    + 'Free key: ' + free + ' calls to try. Add an email: ' + ident + ' calls/day '
    + '(up to ' + identFull + ' full answers per tool per day). '
    + 'Paid plans: dchub.cloud/pricing.';
}
// The rule as a GATE section hands it to an agent: the published sentence without its
// trailing pricing pointer. A pricing page is never the unlock path (agents emit the URL
// printed most often; the unlock is the /upgrade/h/ or /u/ link a gated answer carries as
// human_url). The full sentence, pinned verbatim by the backend canon, still serves
// claim_free_key / bind_email as `free_tier_rule`.
export function _freeTierRuleForGate(canon = TIER_CANON) {
  const r = _freeTierRuleText(canon);
  return r ? r.replace(/ Paid plans: dchub\.cloud\/pricing\.$/, '') : r;
}
// Plan prices — `null` means "custom / contact sales", `undefined` means the
// rung is not on the ladder today (founding is promotional and can be retired
// by the backend without a deploy here: the entry just disappears).
export const PLAN_PRICE = TIER_CANON.price_usd_month;
export const _callsPerDay = (t) => _rung(t);
export const _rungNumPrice = (t) => (Number.isFinite(PLAN_PRICE[t]) ? PLAN_PRICE[t] : null);
// Is this plan on the ladder today? Runtime copy NAMES a plan without pricing it
// (owner rule 09-27), but a rung the canon no longer carries must still vanish
// from the copy — this is that check, with no price in it.
export const _planOnLadder = (t) => Number.isFinite(PLAN_PRICE[t]);
// The public pricing page. No gate or wall output points at it any more (r-relay-contract
// 2026-10-06: the only unlock path an agent is handed is the /upgrade/h/ or /u/ link in
// human_url); kept as a constant for the plan-terms docs that may still name it.
export const PRICING_URL = 'https://dchub.cloud/pricing';
// ★2026-09-28 / 2026-10-02 — owner rule 09-27: the only price DC Hub states is
// the $10 pack, so no copy this server serves names a monthly plan price.
//   _paidPlansOutputLine() — the one plans line: "Paid plans: on the page behind the human_url link".
// _priceLabel() ("$99/mo") and _paidPlansLine() ("Developer $49/mo · Pro $99/mo")
// are RETIRED with the /mcp tools/list byte freeze (2026-10-02): their last
// callers were the unlock_more_data description and the /mcp initialize
// instructions. Nothing can render a monthly price from the canon any more;
// test/paywall-output-no-monthly-price.test.mjs fails if either comes back.
export function _paidPlansOutputLine() {
  return 'Paid plans: on the page behind the human_url link';
}
// The founding licence link, from the same snapshot (null when the rung is retired).
//
// ★ RETIRED AS AN OFFER (r-price-collapse, owner call 2026-09-05). The LINK
// survives here on purpose: legacy /go links and the 10 existing founding
// subscriptions still resolve through it, and _GO_PLAN_BY_LINK still needs to
// attribute a click on one. Nothing should OFFER it to a new buyer — founding
// has no price rung any more, so `_planOnLadder('founding')` is false and
// the ladder check (_planOnLadder) drops it. New buyers are sold Pro at the same $99 on a
// DIFFERENT link, so the webhook stamps plan_name='pro', not 'founding'.
export const FOUNDING_URL = (typeof TIER_CANON.stripe_link.founding === 'string') ? TIER_CANON.stripe_link.founding : null;

// The Pro checkout link, from the same snapshot.
//
// ★ THIS REPLACES A HARDCODED LITERAL in server.mjs that pointed at the $299
// payment link. Verified against the live Stripe pages on 2026-09-08:
//     dRm28s2gGcfP6yx0PEaZi0p -> $99.00 per month   (canon, correct)
//     7sY7sM9J8enX7CB69YaZi0l -> $299.00 per month  (what server.mjs served)
// Pro has been $99 since 2026-09-05, so every agent handed the old link was
// sent to a checkout charging 3x the real price. Reading the snapshot means
// the link and the price it quotes cannot drift apart again.
export const PRO_URL = (typeof TIER_CANON.stripe_link.pro === 'string') ? TIER_CANON.stripe_link.pro : null;
