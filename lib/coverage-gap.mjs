// execute_plan coverage-gap counter (Grok MASTER TASK 2026-10-16 item 11, v1).
//
// Partner routing (design: ~/Downloads/dchub-orchestration-partner-routing-design-2026-10-17.md)
// is only worth building if agents actually ask execute_plan for things DC Hub has no data
// for. A 30-day read of prod mcp_call_log (2026-10-17) found 5 of 140 external execute_plan
// intents mentioning lease, price, vacancy, colo or comps, and the planner has no class for
// them, so nothing counted the gap. This module names the gap; server.mjs writes it onto the
// execute_plan_steps telemetry row only. It is NOT agent-facing: the plan response, its
// routing and its text are unchanged.
//
// Topics (DC Hub tracks none of these as data today):
//   lease_comps         lease / sale transaction comps, lease or rental rates
//   colo_pricing        colocation or wholesale pricing, $/kW, per-kW-month rates
//   vacancy_absorption  vacancy, absorption, occupancy rate, pre-leasing
//   colo_availability   colocation space / inventory on offer (source_capacity covers DC Hub's
//                       own listings; the count says how often it was asked, not that it failed)
// Energy prices ($/MWh, LMP, "energy price") are DC Hub data and are never a gap here;
// neither is "available power" or "capacity" on its own.

export const COVERAGE_GAP_TOPICS = Object.freeze([
  'lease_comps', 'colo_pricing', 'vacancy_absorption', 'colo_availability',
]);

const _COLO = String.raw`(?:colo(?:cation)?|wholesale|retail\s+colo|data[\s-]*cent(?:er|re)\s+(?:space|lease))`;

const _RULES = [
  ['lease_comps', new RegExp(String.raw`\b(?:`
    + String.raw`(?:lease|leasing|rental|sale|transaction|deal)\s+comps?`
    + String.raw`|comps?\s+(?:for|on|in)\s+(?:lease|leasing|rent)`
    + String.raw`|(?:lease|leasing|rental|asking)\s+(?:rates?|rents?|pricing|prices?)`
    + String.raw`|asking\s+rents?`
    + String.raw`)\b`, 'i')],
  ['colo_pricing', new RegExp(String.raw`(?:\b${_COLO}\s+(?:pricing|prices?|rates?|costs?)\b`
    + String.raw`|\b(?:pricing|prices?|rates?|cost)\s+(?:of|for)\s+${_COLO}\b`
    + String.raw`|\$\s*/\s*kw\b(?!h)`
    + String.raw`|\bper\s+kw(?:[\s-]*(?:per\s+)?(?:mo|month))\b`
    + String.raw`|\bkw[\s-]*(?:mo|month)\b`
    + String.raw`|\b(?:rack|cabinet|cage)\s+(?:pricing|prices?|rates?)\b`
    + String.raw`|\bprice\s+per\s+(?:rack|cabinet|kw)\b(?!h))`, 'i')],
  ['vacancy_absorption', /\b(?:vacanc(?:y|ies)|absorption|occupancy\s+rates?|pre-?leas(?:ed|ing))\b/i],
  ['colo_availability', new RegExp(String.raw`\b(?:`
    + String.raw`${_COLO}\s+(?:space|availability|inventory|capacity\s+(?:available|for\s+lease))`
    + String.raw`|available\s+(?:${_COLO}|white\s*space|racks?|cages?|suites?|data[\s-]*hall)`
    + String.raw`|white\s*space\s+(?:available|for\s+lease)`
    + String.raw`|(?:space|suites?|data[\s-]*hall|powered\s+shell)\s+for\s+(?:lease|rent)`
    + String.raw`)\b`, 'i')],
];

// Returns the sorted, de-duplicated list of gap topics an intent names, or [] when none.
export function coverageGaps(intent) {
  const t = String(intent || '').slice(0, 2000);
  if (!t) return [];
  const out = [];
  for (const [topic, re] of _RULES) if (re.test(t)) out.push(topic);
  return out.sort();
}
