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
  const empty = Object.freeze({ calls_per_day: Object.freeze({}), price_usd_month: Object.freeze({}), stripe_link: Object.freeze({}) });
  try {
    const j = JSON.parse(readFileSync(new URL('../canonical/tier_limits.json', import.meta.url), 'utf8'));
    const pick = (o) => Object.freeze(Object.fromEntries(
      Object.entries((o && typeof o === 'object') ? o : {})
        .filter(([, v]) => v === null || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string')));
    return Object.freeze({
      calls_per_day:   pick(j.calls_per_day),
      price_usd_month: pick(j.price_usd_month),
      stripe_link:     pick(j.stripe_link),
    });
  } catch { return empty; }
})();
// The free ladder, named the way copy uses it. `full_answers_per_day` is the
// per-tool flagship taste (TRIAL_DAILY_FULL_CAP, env-tunable — an operator
// knob, not a published tier rung, so it stays where it is and is only
// MIRRORED here, resolved lazily because that const is declared further down).
const _rung = (t) => (Number.isFinite(TIER_CANON.calls_per_day[t]) ? TIER_CANON.calls_per_day[t] : 'n/a');
export const _rungNum = (t) => (Number.isFinite(TIER_CANON.calls_per_day[t]) ? TIER_CANON.calls_per_day[t] : null);
export const FREE_TIER = Object.freeze({
  anonymous_calls_per_day:  _rung('anonymous'),   // keyless, per IP
  free_calls_per_day:       _rung('free'),        // a claim_free_key dch_live_ key, unbound
  identified_calls_per_day: _rung('identified'),  // the same key once bind_email has run
  starter_calls_per_day:    _rung('starter'),
  // The unbound-key gate: how many calls a fresh dch_live_ key gets before
  // bind_email is required. The backend owns the gate and reports the number
  // on the claim response (free_calls_unbound); this is the published default
  // it falls back to, and it is the free rung — one number, not a fifth.
  unbound_calls_total:      _rung('free'),
});
// Plan prices — `null` means "custom / contact sales", `undefined` means the
// rung is not on the ladder today (founding is promotional and can be retired
// by the backend without a deploy here: the entry just disappears).
export const PLAN_PRICE = TIER_CANON.price_usd_month;
export const _priceLabel = (t) => (Number.isFinite(PLAN_PRICE[t]) ? '$' + PLAN_PRICE[t] + '/mo' : null);
export const _callsPerDay = (t) => _rung(t);
export const _rungNumPrice = (t) => (Number.isFinite(PLAN_PRICE[t]) ? PLAN_PRICE[t] : null);
// The one paid-plans line every nudge quotes. Founding LEADS while the rung
// exists (it is the SKU that sells and it is Pro access); it vanishes from the
// line the day the backend retires it — no copy edit, no deploy here.
export function _paidPlansLine() {
  const parts = [];
  if (_priceLabel('founding')) parts.push('Founding ' + _priceLabel('founding') + ' (Pro access, while seats last)');
  if (_priceLabel('developer')) parts.push('Developer ' + _priceLabel('developer'));
  if (_priceLabel('pro'))       parts.push('Pro ' + _priceLabel('pro'));
  return parts.join(' · ');
}
// The founding licence link, from the same snapshot (null when the rung is retired).
export const FOUNDING_URL = (typeof TIER_CANON.stripe_link.founding === 'string') ? TIER_CANON.stripe_link.founding : null;
