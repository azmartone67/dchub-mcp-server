// execute_plan quality, agent-consensus round (Grok -> Brain paste, 2026-11-27 evening,
// planner 5.66). Five agents (Grok, Claude, ChatGPT, Gemini, Le Chat) asked the same four
// questions and got answers that missed the market DCPI ranks first:
//
//   1. "Where can 100 MW get power fastest in ERCOT, by DCPI?"  -> grid_headroom (queue
//      reads only). rank_markets criteria=ai_ready ranks Midland–Odessa #1 (BUILD) and the
//      plan never called it.
//   2. "Compare power availability and interconnection queue for Northern Virginia vs
//      Columbus."  -> market_comparison with a queue step and no grid-headroom read.
//   4. "Best US markets for a 50 MW AI data center by power, fiber and tax incentives." ->
//      incentives_tax (a ONE-STATE statutory class) with no state, so nothing ranked.
//
// This module holds the pure text tests and small helpers; server.mjs wires them in.
// PURE: no I/O, never throws.
//
// Rollback: DCHUB_EXECUTE_PLAN_QUALITY_DISABLE=1 (true/yes/on) restores 5.65 routing,
// rank_markets without the iso filter, and the plan answer without the dropped-filter lead.

export const PLAN_QUALITY_VERSION = '5.66';

export function planQualityOn(env = process.env) {
  return !/^(1|true|yes|on)$/i.test(String((env && env.DCHUB_EXECUTE_PLAN_QUALITY_DISABLE) || '').trim());
}

// The lead's "Not applied: the N MW size ..." sentence is opt-in (DCHUB_EXECUTE_PLAN_DROP_LINE=1), and the kill switch
// above still wins. Off, the lead is origin/main's byte for byte (test/wall-relay-value-first-1121 pins keyless /mcp);
// the same fact is always in the JSON as dropped_filters.
export function dropLineOn(env = process.env) {
  return planQualityOn(env) && /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_EXECUTE_PLAN_DROP_LINE) || '').trim());
}

// A speed-of-power word: fastest / quickest / soonest power, shortest time to power,
// "get power", time to power.
const SPEED_RE = /\b(?:fastest|quickest|soonest|shortest\s+time(?:[-\s]to[-\s]power)?|time[-\s]to[-\s]power|get\s+(?:grid\s+)?power)\b/i;
// The ask is for WHERE (a ranking), not "how long in X".
const WHERE_RE = /\b(?:where|which\s+(?:markets?|metros?|places?|counties|locations?|cities|grids?)|rank(?:ing|ed)?|best|top\s+\d*|shortlist)\b/i;
// "how long / when can I get power in Dallas" is a one-place timeline, not a ranking.
const ONE_PLACE_TIMELINE_RE = /\b(?:how\s+(?:long|soon)|when\s+(?:can|will|could))\b/i;

/**
 * "Where can N MW get power fastest in <ISO>" is a market ranking by DCPI buildability
 * (rank_markets criteria=ai_ready), not a grid read. False for a head-to-head (two
 * markets named), a point, or a "how long in <place>" timeline ask.
 */
export function fastestPowerRankingAsk(text, d = {}) {
  const t = String(text || '');
  if (!SPEED_RE.test(t) || !WHERE_RE.test(t)) return false;
  // Scope is a grid, or nothing. A named market, place, state, point or deadline already has a class that holds
  // it (market_outlook, siting_search near a metro, the one-state canvas, capacity_grid with a deadline).
  if (d && (d.comparePair || d.coords || d.candidateId || d.__address || d.market || d.state || d.deadline
    || (d.__outlook && (d.__outlook.slug || d.__outlook.unresolved)) || d.placeScope)) return false;
  if (ONE_PLACE_TIMELINE_RE.test(t) && !/\b(?:where|which|rank|best|top)\b/i.test(t)) return false;
  return true;
}

// The factor families a multi-factor market ranking names.
const FACTOR_RES = {
  power: /\b(?:power|grid|energy|electric(?:ity)?|time[-\s]to[-\s]power|dcpi)\b/i,
  fiber: /\b(?:fib(?:er|re)|connectivity|latency|carriers?)\b/i,
  tax: /\b(?:tax(?:es)?|incentives?|abatements?|exemptions?)\b/i,
};
const RANKING_RE = /\b(?:best|top\s*\d*|rank(?:ing|ed)?|which|where)\b[^.?!]{0,60}\b(?:markets?|metros?|locations?|places?|regions?)\b|\b(?:markets?|metros?)\b[^.?!]{0,40}\b(?:ranked|by)\b/i;

/** The factor families the text names, in a fixed order. */
export function namedFactors(text) {
  const t = String(text || '');
  return Object.keys(FACTOR_RES).filter((k) => FACTOR_RES[k].test(t));
}

/**
 * "Best US markets ... by power, fiber and tax incentives": a NATIONAL ranking over two or
 * more factor families. False when one US state is named (incentives_tax and the state
 * canvas already answer that), a point is given, or two markets are compared.
 */
export function multiFactorRankingAsk(text, d = {}) {
  const t = String(text || '');
  if (!RANKING_RE.test(t)) return false;
  if (d && (d.comparePair || d.state || d.coords)) return false;
  // Tax is the family no ranking read carried; power + fiber alone is fiber_power_pairing's question.
  const f = namedFactors(t);
  return f.length >= 2 && f.includes('tax');
}

// "power availability" / headroom words beside a comparison: the grid read is part of the ask.
// Time to power alone is not it: each market's DCPI card already carries it.
const POWER_AVAIL_RE = /\b(?:power\s+(?:is\s+)?availab(?:le|ility)|headroom|grid\s+capacity|available\s+power|how\s+much\s+power)\b/i;
export function powerAvailabilityAsk(text) { return POWER_AVAIL_RE.test(String(text || '')); }

/** Normalised grid code for comparing a row's iso with the asked one ("ISO-NE" == "ISONE"). */
export function normIso(v) {
  return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const ISO_CODES = new Set(['ERCOT', 'PJM', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISONE', 'WECC', 'SERC', 'TVA', 'BPA', 'AESO', 'IESO']);
/** A rank_markets `iso` argument, normalised; null when it is not a grid code this filter knows. */
export function rankIsoArg(v) {
  const n = normIso(v);
  return n && ISO_CODES.has(n) ? n : null;
}

/**
 * rank_markets iso filter: keep only rows on the asked grid, in their rank order, cut to
 * `limit`. A row with no iso is dropped (it cannot be shown to be in scope). Returns the
 * body with `results` replaced and an `iso_filter` block saying what was done; a body with
 * no `results` array comes back unchanged.
 */
// The backend ranking returns at most this many rows, whatever limit is asked (measured live 2026-11-28: limit 200
// on /mcp and 300 on /api/v1/mcp/tools/rank_markets each returned 50).
export const RANK_READ_CAP = 50;

// `gridIndex` (optional): { markets: [{ slug, iso }], as_of } from the DCPI market index. With it, the markets on the
// asked grid that the read did not reach are counted and named, so a one-row answer ("ERCOT: midland-tx") is not
// read as the whole grid (2026-11-28: 19 ERCOT markets in the index, 1 in the national top 50).
export function filterRankRowsByIso(body, iso, limit, gridIndex) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.results)) return body;
  const want = normIso(iso);
  const before = body.results.length;
  const kept = body.results.filter((r) => r && typeof r === 'object' && normIso(r.iso) === want);
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  const results = kept.slice(0, n);
  const iso_filter = {
    iso: want,
    rows_read: before,
    rows_on_grid: kept.length,
    rows_returned: results.length,
    note: `Rows are held to ${want}: markets on other grids were removed before the limit was applied.`,
  };
  const idx = gridIndex && Array.isArray(gridIndex.markets) ? gridIndex.markets : null;
  if (idx && before >= RANK_READ_CAP) {
    const seen = new Set();
    for (const r of body.results) {
      if (!r || typeof r !== 'object') continue;
      for (const k of ['market', 'metro_slug', 'slug']) if (r[k]) seen.add(String(r[k]).toLowerCase());
    }
    const below = idx.filter((m) => m && m.slug && normIso(m.iso) === want && !seen.has(String(m.slug).toLowerCase()))
      .map((m) => String(m.slug));
    iso_filter.searched_top = RANK_READ_CAP;
    iso_filter.below_cutoff = below.length;
    if (below.length) {
      iso_filter.below_cutoff_markets = below.slice(0, 20);
      const asOf = gridIndex.as_of ? ` (as of ${String(gridIndex.as_of).slice(0, 10)})` : '';
      iso_filter.note += ` Only the top ${RANK_READ_CAP} ranked markets nationally were searched, the most the ranking returns, so this is not a full ${want} ranking: ${below.length} more ${want} market${below.length === 1 ? '' : 's'} in the DCPI market index${asOf} rank below that cutoff (below_cutoff_markets). get_market_dcpi_rank reads any one of them.`;
    }
  }
  return { ...body, results, iso_filter };
}

/**
 * One plain sentence naming each dropped capacity filter, for the FIRST paragraph of a plan
 * answer. `dropped` is the plan's dropped_filters array. Null when nothing size-like was dropped.
 */
export function droppedSizeLine(dropped) {
  if (!Array.isArray(dropped) || !dropped.length) return null;
  const seen = new Set();
  const parts = [];
  for (const f of dropped) {
    if (!f || typeof f !== 'object') continue;
    if (f.kind && !['not_applied', 'locked', 'dropped'].includes(f.kind)) continue;
    const arg = String(f.param || f.arg || f.name || '');
    if (!/^(?:capacity_mw|min_mw|min_capacity_mw|mw|target_mw|min_kw)$/i.test(arg)) continue;
    const val = f.asked != null ? f.asked : (f.value != null ? f.value : null);
    const tool = String(f.tool || '');
    const key = tool + '|' + arg;
    if (seen.has(key)) continue;
    seen.add(key);
    const unit = /kw/i.test(arg) ? 'kW' : 'MW';
    parts.push((val != null ? `the ${val} ${unit} size` : `the ${arg} filter`) + (tool ? ` on ${tool}` : ''));
  }
  if (!parts.length) return null;
  return `Not applied: ${parts.join('; ')}. The results below are not sized to that load.`;
}
