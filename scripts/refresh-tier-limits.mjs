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
const OUT = path.join(ROOT, 'canonical', 'tier_limits.json');
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

const out = {};
for (const t of PUBLIC_TIERS) {
  const row = tiers[t];
  if (!row) bail(`ladder is missing the public tier '${t}'`);
  const n = row.calls_per_day;
  // A zero or negative allowance is never a real published tier; treat it as a
  // degraded read rather than writing "0 calls/day" onto every surface.
  if (!Number.isSafeInteger(n) || n <= 0) bail(`'${t}'.calls_per_day is ${JSON.stringify(n)}`);
  out[t] = n;
}
// The ladder must be MONOTONIC — anon <= free <= identified <= starter <= dev <= pro <= ent.
// A ladder that inverts means the upstream is degraded (or a tier was
// renamed), and publishing it would advertise a paid tier as smaller than free.
for (let i = 1; i < PUBLIC_TIERS.length; i++) {
  const lo = PUBLIC_TIERS[i - 1], hi = PUBLIC_TIERS[i];
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
// founding == pro for access (backend `rule`); its price must sit BELOW pro or
// the "founding is the deal" copy every surface derives from this is a lie.
if (price.founding !== undefined && price.pro !== undefined && price.founding >= price.pro) {
  bail(`founding ${price.founding} is not below pro ${price.pro}`);
}

const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
const next = JSON.stringify({
  _comment: 'DERIVED — do not hand-edit. Source: GET /api/v1/tiers (owner: dchub-backend tier_registry.TIER_LIMITS). Refresh: node scripts/refresh-tier-limits.mjs',
  source: '/api/v1/tiers',
  calls_per_day: out,
  price_usd_month: price,
  stripe_link,
}, null, 2) + '\n';

if (prev.trim() === next.trim()) {
  console.log('[tier-limits] unchanged —', JSON.stringify(out));
} else {
  fs.writeFileSync(OUT, next);
  console.log('[tier-limits] WROTE', JSON.stringify(out));
}
