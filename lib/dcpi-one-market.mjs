// dcpi-one-market.mjs — planner: a DCPI ask about ONE named market reads that market's card (2026-11-22).
//
// WHY. Grok's Cursor/Mistral probe (2026-11-22, planner 5.61) asked execute_plan "What is the Data Center Power
// Index for Ashburn, Virginia?". It routed to `unknown` and ran discover_tools only; the answer said no data tool
// was run. Reproduced locally on 5.61: the spelled-out name matches no class pattern, and the short form ("What is
// the DCPI for Ashburn?") goes to market_ranking, whose second step is get_market_dcpi_rank on an unbound
// "<slug from a step-1 finalist>" placeholder — Ashburn's own card is never read. market_outlook already reads one
// named market's DCPI card; it just had no pattern for the index's own name.
//
// WHAT. With DCHUB_PLANNER_DCPI_CLASSIFY_FIX on, a question that names the index (DCPI or Data Center Power Index)
// beside a market preposition ("for Ashburn", "of Phoenix", "in Northern Virginia") gives market_outlook a base
// score; the class's existing rules then decide: a tracked metro the planner can bind adds +3, and a ranking or
// comparison word (_OUTLOOK_MULTI_RE in server.mjs) or a compare pair still zeroes it. Off: 5.61 routing unchanged.
//
// NOT DONE. Grok also read the shared plan_id (plan_2048e5e35e48eeb4) across two clients as a cached bad plan being
// reused. It is not a cache: lib/plan-replay-id.mjs hashes planner version + intent class + normalised intent +
// context, so the same question always gets the same id. Nothing to change there.

export const DCPI_ONE_MARKET_ASK_RE = /\b(?:dcpi|data\s*cent(?:er|re)\s+power\s+index)\b(?:\s*\((?:dcpi)\))?(?:\s+(?:score|verdict|rating|reading|value|number))?\s+(?:for|of|in|on|at)\s+\S/i;

export function dcpiClassifyFixOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env.DCHUB_PLANNER_DCPI_CLASSIFY_FIX) || '').trim());
}

// Base score market_outlook gets for such a question (the same weight as its other one-market verdict patterns).
export const DCPI_ONE_MARKET_SCORE = 3;
