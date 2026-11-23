// facility-join.mjs -- planner 5.62: a plan whose question asks for facilities reads them.
//
// WHY. Grok answer-quality note (2026-11-23, P7): "Help me think about a data center site in Columbus, Ohio: power,
// fiber, and nearby facilities." routed to fiber_power_pairing, a fixed four-step recipe (metro fiber, fiber intel,
// DCPI, grid). search_facilities was never planned, though a direct search_facilities {query:"Columbus", state:"OH"}
// returns AWS Hilliard, QTS NAL1 and New Albany rows. Planner 5.61 joins a moratorium read to a site hunt after routing;
// nothing joined a facility read.
//
// WHAT.
//   * facilitiesAsk(text): the question asks which facilities / data centers are in or near a place, nearby facilities,
//     colocation sites, operators in a place, or who is in a market.
//   * facilityJoinArgs(d, town): the search held to the place the question named: the town ({city, state}) when the
//     corridor table names one, else the metro query ({query, state}), else null (no place: nothing is joined).
//   * FACILITY_JOIN_SKIP: classes that already read facilities (or answer one named thing) and never get the join.
//   * SITE_CONTEXT_CLASSES: site classes that get the step as context when it fits in the step budget, even unasked.
// Pure; nothing here throws.

const ASK_RES = [
  /\bfacilit(?:y|ies)\b/i,
  // "a 100 MW data center in Eagle Mountain" is the asker's own build, and "the outlook for data centers in X" asks
  // about the market: neither asks which facilities exist. A list word before, or a nearness word after, does.
  /\b(?:which|what|list|show|name|existing|other|operating|current)\s+(?:\w+\s+){0,2}data[\s-]*cent(?:er|re)s\b/i,
  /\bdata[\s-]*cent(?:er|re)s\s+(?:are\s+)?(?:there\s+)?(?:near|nearby|close\s+to|around|within)\b/i,
  /\b(?:nearby|neighbou?ring|existing|surrounding)\s+(?:data[\s-]*cent(?:er|re)s?|facilit(?:y|ies)|campus(?:es)?)\b/i,
  /\bwhich\s+data[\s-]*cent(?:er|re)s?\b/i,
  /\bcolo(?:cation)?\s+(?:sites?|facilit(?:y|ies)|providers?)\b/i,
  /\boperators?\s+(?:in|near|around)\b/i,
  /\bwho\s+(?:is|operates|has\s+(?:a\s+)?(?:data[\s-]*cent(?:er|re)s?|facilit(?:y|ies)))\s+in\b/i,
];

export function facilitiesAsk(text) {
  try {
    const t = String(text || '').slice(0, 1500);
    return ASK_RES.some((re) => re.test(t));
  } catch (_e) { return false; }
}

export function facilityJoinArgs(d, town) {
  try {
    if (!d || typeof d !== 'object') return null;
    const metro = d.__facMetro && typeof d.__facMetro === 'object' ? d.__facMetro : null;
    const st = d.state || (metro && metro.state) || d.stateFromPlace || null;
    if (town && town.city && st) return { city: town.city, state: st };
    if (metro && metro.query) return { query: metro.query, ...(metro.state ? { state: metro.state } : {}) };
    return null;
  } catch (_e) { return null; }
}

export const FACILITY_JOIN_SKIP = new Set(['facility_search', 'named_campus', 'colocation', 'pricing_out_of_scope', 'unknown']);
export const SITE_CONTEXT_CLASSES = new Set(['site_analysis', 'siting_search', 'dc_power_place', 'fiber_power_pairing']);
export const FIBER_TOOLS = new Set(['get_metro_fiber', 'get_fiber_intel', 'get_fiber_readiness', 'get_peering_intel']);
// The step budget a plan runs within when the caller sets none (execute_plan max_steps default).
export const DEFAULT_MAX_STEPS = 6;
