// lib/canon.mjs — the ONE reader of dchub.cloud's published commercial canon for copy.
//
// Grok A1/A5 (2026-10-09): the one-time credit pack price ("$10") was typed into
// ~60 string literals across server.mjs and lib/*.mjs. A price an agent reads back
// to a human must come from canon, not from a number typed into prose, so every
// such literal now interpolates PACK_PRICE from here.
//
// SOURCE: canonical/tier_limits.json -> credit_pack, the daily fail-closed snapshot of
// GET /api/v1/tiers (credit_pack == GET /api/v1/canon prices.credit_pack, same
// dchub-backend owner). scripts/refresh-tier-limits.mjs writes it from
// daily-manifest-sync.yml; this module reads it through lib/tier-canon.mjs, the same
// mechanism that already feeds the plan ladder. FRESHNESS GATE = that lane's
// fail-closed contract: a backend blip or malformed pack leaves the committed snapshot
// UNCHANGED (the last good price), it never writes a guess. test/canon-pack-price.test.mjs
// pins that the committed snapshot equals what served copy says.
//
// Nothing here states a price. A missing pack renders 'n/a' (honest and smaller, the
// same convention as the tier ladder) instead of a restated number.
import { TIER_CANON } from './tier-canon.mjs';

const pack = TIER_CANON.credit_pack || {};
const num = (n) => (Number.isFinite(n) && n > 0 ? n : null);

export const PACK_PRICE_USD = num(pack.price_usd);
export const PACK_CREDITS = num(pack.credits);
/** "$10" — the display form copy interpolates. */
export const PACK_PRICE = PACK_PRICE_USD === null ? 'n/a' : '$' + PACK_PRICE_USD;
