#!/usr/bin/env node
// ============================================================================
// refresh-tier-limits.mjs (2026-08-23) — pull the CANONICAL per-tier daily
// call allowance into a committed snapshot, so every surface that advertises
// the free tier can be checked against ONE origin.
//
// WHY THIS EXISTS. Measured 2026-08-23, this repo advertised the free tier as
// 10 calls/day (×12 places), 50 calls/day, AND 100 calls/day — three different
// numbers for one product — while the canonical ladder
// (dchub-backend tier_registry.TIER_LIMITS, served at /api/v1/tiers) says
// anonymous=5. The anonymous figure went 10 → 5 on 2026-08-03 specifically to
// restore a real first rung (anon 5 → free 10 → identified 50 → starter 200);
// every surface still saying 10 erased the rung the change existed to create,
// and over-claimed 2x on the entry tier.
//
// ★ DERIVE, NEVER RESTATE — same contract as refresh-tool-maturity.mjs and
// refresh-problem-taxonomy.mjs. Nothing in this file states an allowance. It
// fetches the ladder and writes it down verbatim. A hand-authored copy is a
// second source of truth and it WILL drift; that is the whole defect here.
//
// FAIL-CLOSED, and closed means UNCHANGED: any fetch error, non-ok body, or a
// malformed ladder → log and exit 0 WITHOUT writing. A half-written snapshot
// would silently move every claim in the repo.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// DCHUB_TIER_LIMITS_OUT: tests write to a temp file, never the committed snapshot.
const OUT = process.env.DCHUB_TIER_LIMITS_OUT || path.join(ROOT, 'canonical', 'tier_limits.json');
const SRC = process.env.DCHUB_API_BASE || 'https://dchub.cloud';
const URL_ = `${SRC}/api/v1/tiers`;

// The tiers a published claim is allowed to name. Anything else in the ladder
// (admin, research_seed) is internal and must never reach copy.
const PUBLIC_TIERS = ['anonymous', 'free', 'identified', 'starter',
                      'developer', 'pro', 'enterprise'];

function bail(why) {
  console.log(`[tier-limits] FAIL-CLOSED (snapshot unchanged): ${why}`);
  process.exit(0);
}

const res = await fetch(URL_, {
  headers: { 'User-Agent': 'dchub-tier-limits-sync/1.0' },
  signal: AbortSignal.timeout(15000),
}).catch((e) => bail(`fetch failed: ${e.message}`));

if (!res || !res.ok) bail(`HTTP ${res ? res.status : '?'}`);
const body = await res.json().catch((e) => bail(`unparseable JSON: ${e.message}`));
const tiers = body && body.tiers;
if (!tiers || typeof tiers !== 'object') bail('no `tiers` object in the response');

// r-price-canon (2026-09-02, QA sweep pricing #3 + D8): the SAME snapshot now
// also carries the per-tier monthly price and Stripe link, read from the SAME
// ladder row — so server.mjs can name the founding $99 licence (the only SKU
// that has sold: 10 of 14 active external subs) without a literal anywhere in
// this repo. `founding` is a PROMOTIONAL rung the backend can retire; it is
// therefore OPTIONAL here (absent → omitted, and every plan list that reads
// it simply drops the entry) rather than a bail — a sold-out programme must
// not freeze the calls/day snapshot. Same DERIVE-NEVER-RESTATE contract.
const PRICED_TIERS = ['starter', 'founding', 'developer', 'pro', 'team', 'enterprise'];
const OPTIONAL_PRICED = new Set(['founding', 'team']);

// ★ 2026-09-27 — THE FREE-TIER RULE (owner decision D2). The backend now
// publishes each tier's allowance IN ITS OWN UNIT (`allowance`: calls + period)
// and a null calls_per_day for the two tiers that have no per-day count:
//   anonymous  previews, no key needed  (calls null)
//   free       10 calls IN TOTAL                            (period 'lifetime')
// Those two may be null here ONLY when `allowance` names a non-daily unit; a
// null with no unit is still a degraded read. An older backend that still
// sends an anonymous calls_per_day is accepted as-is, so the merge order of
// the two repos does not matter.
const PERIODS = new Set([null, 'day', 'lifetime', 'month']);
const out = {};
const allowance = {};
for (const t of PUBLIC_TIERS) {
  const row = tiers[t];
  if (!row) bail(`ladder is missing the public tier '${t}'`);
  const a = row.allowance;
  if (a !== undefined) {
    const calls = a && a.calls;
    const period = a ? (a.period === undefined ? null : a.period) : undefined;
    if (!a || typeof a !== 'object' || !PERIODS.has(period)
        || !(calls === null || (Number.isSafeInteger(calls) && calls > 0))
        || (calls === null) !== (period === null)) {
      bail(`'${t}'.allowance is malformed: ${JSON.stringify(a)}`);
    }
    const full = a.full_answers_per_tool_per_day;
    allowance[t] = {
      calls, period,
      ...(Number.isSafeInteger(full) && full > 0 ? { full_answers_per_tool_per_day: full } : {}),
    };
  }
  const n = row.calls_per_day;
  if (n === null && allowance[t] && allowance[t].period !== 'day') continue;
  // A zero or negative allowance is never a real published tier; treat it as a
  // degraded read rather than writing "0 calls/day" onto every surface.
  if (!Number.isSafeInteger(n) || n <= 0) bail(`'${t}'.calls_per_day is ${JSON.stringify(n)}`);
  out[t] = n;
}
// The per-DAY ladder must be MONOTONIC over the tiers that have one —
// free <= identified <= starter <= dev <= pro <= ent (anonymous and a lifetime
// free key sit off it). A ladder that inverts means the upstream is degraded
// (or a tier was renamed), and publishing it would advertise a paid tier as
// smaller than free.
const daily = PUBLIC_TIERS.filter((t) => out[t] !== undefined);
for (let i = 1; i < daily.length; i++) {
  const lo = daily[i - 1], hi = daily[i];
  if (out[hi] < out[lo]) bail(`ladder inverts: ${lo}=${out[lo]} > ${hi}=${out[hi]}`);
}

const price = {};
const stripe_link = {};
for (const t of PRICED_TIERS) {
  const row = tiers[t];
  if (!row) {
    if (OPTIONAL_PRICED.has(t)) continue;
    bail(`ladder is missing the priced tier '${t}'`);
  }
  const p = row.price_usd_month;
  // enterprise is "custom" (null) by contract; every other priced rung must be
  // a positive integer or the read is degraded.
  if (p === null || p === undefined) {
    if (t === 'enterprise') { price[t] = null; continue; }
    bail(`'${t}'.price_usd_month is ${JSON.stringify(p)}`);
  }
  if (!Number.isSafeInteger(p) || p <= 0) bail(`'${t}'.price_usd_month is ${JSON.stringify(p)}`);
  price[t] = p;
  const link = row.stripe_link;
  if (typeof link === 'string' && /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/.test(link)) {
    stripe_link[t] = link;
  }
}
// ★ 2026-09-28 (owner decision 3a): FOUNDING IS A CLOSED EARLY-SUPPORTER
// COHORT, NOT A PUBLIC TIER. It is Pro access (backend `rule`), and since
// r-price-collapse (09-05) it costs the SAME as Pro ($99 == $99). This check
// used to demand founding < pro, so the day the two prices met every daily
// refresh bailed ("founding 99 is not below pro 99") and the whole snapshot —
// calls/day, allowance, every price and link — froze with it.
//   founding <= pro   fine (equal is the steady state)
//   founding >  pro   bail: an early supporter never pays MORE than Pro; that
//                     is a degraded or mis-keyed read, not a price change.
// Nonsense values (missing/null/zero/negative/non-integer) already bailed in
// the loop above, for founding as for every other priced rung.
if (price.founding !== undefined && price.pro !== undefined && price.founding > price.pro) {
  bail(`founding ${price.founding} is above pro ${price.pro}`);
}
// …and it is VALIDATED but never PUBLISHED. lib/tier-canon.mjs turns any
// price_usd_month.founding into "Founding $99/mo (Pro access, while seats
// last)" at the head of _paidPlansLine() and into the `pricing` block, i.e.
// into served copy — and the only public price is the $10 pack, the /mcp
// tools/list is frozen, and the /mcp/chatgpt catalog is frozen. So the price
// rung stays OUT of the snapshot. stripe_link.founding stays IN: legacy /go
// links and the existing founding subscriptions still attribute through it
// (FOUNDING_URL → _GO_PLAN_BY_LINK), and it offers nothing to a new buyer.
delete price.founding;

const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
const next = JSON.stringify({
  _comment: 'DERIVED — do not hand-edit. Source: GET /api/v1/tiers (owner: dchub-backend tier_registry.TIER_LIMITS). Refresh: node scripts/refresh-tier-limits.mjs',
  source: '/api/v1/tiers',
  calls_per_day: out,
  ...(Object.keys(allowance).length ? { allowance } : {}),
  price_usd_month: price,
  stripe_link,
}, null, 2) + '\n';

if (prev.trim() === next.trim()) {
  console.log('[tier-limits] unchanged —', JSON.stringify(out));
} else {
  fs.writeFileSync(OUT, next);
  console.log('[tier-limits] WROTE', JSON.stringify(out));
}
