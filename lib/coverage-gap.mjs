// Coverage-gap measurement for execute_plan (owner decision, item 11, 2026-10-17).
//
// MEASUREMENT ONLY. Two pure helpers, no I/O:
//   classifyCoverageGap(intent, executed, fullByEntry) -> topic string | null
//   isEvalIntent(intent)                               -> boolean
//
// coverage_gap is written to the LOGGED plan record (the execute_plan_steps call row and
// the recipe_lifecycle 'completed' event) and NOWHERE ELSE. It is never added to the
// agent-facing response, to any tool output, or to a directory profile
// (test/coverage-gap-log-only.test.mjs pins that).
//
// Topics (a DC Hub gap = the question asks for something the planner has no class for):
//   lease_comps, colo_pricing, vacancy_absorption, colo_availability_nofit
// colo_availability_nofit additionally needs a source_capacity step that ran and found
// no fit; with no such step (or an unreadable result) the answer is null, never a guess.

export const COVERAGE_GAP_TOPICS = Object.freeze([
  'lease_comps', 'colo_pricing', 'vacancy_absorption', 'colo_availability_nofit',
]);

const COLO = /\b(colo|colocation|co-location|colocated)\b/i;
const PRICE = /\b(pric(e|es|ing)|rates?|costs?|quotes?|per\s*kw|\$\s*\/\s*kw)\b/i;
const AVAIL = /\b(availab\w*|spaces?|cabinets?|racks?|capacity|suites?|mw|kw)\b/i;
const LEASE_COMPS = new RegExp([
  '\\blease\\s+comps?\\b',
  '\\bcomparable\\s+(leases?|rents?|transactions?)\\b',
  '\\b(asking|market|average|going|current)\\s+(lease|rent)s?\\b',
  '\\b(lease|leasing|rental|rent)\\s+(rates?|prices?|pricing|comps?|comparables?)\\b',
].join('|'), 'i');
const VACANCY = /\b(vacancy|vacant|net\s+absorption|absorption|occupancy)\b/i;

// A source_capacity result that answered and found nothing: browse -> items [],
// match -> exact [] and bundles [] (a shortfall may ride along). Anything else,
// including an unreadable shape, is NOT a no-fit.
export function sourceCapacityNoFit(full) {
  if (!full || typeof full !== 'object' || Array.isArray(full)) return false;
  if (Array.isArray(full.exact) || Array.isArray(full.bundles) || 'shortfall' in full) {
    return !(Array.isArray(full.exact) && full.exact.length)
      && !(Array.isArray(full.bundles) && full.bundles.length);
  }
  if (Array.isArray(full.items)) return full.items.length === 0;
  return false;
}

function _noFitStep(executed, fullByEntry) {
  if (!Array.isArray(executed)) return false;
  return executed.some((e) => e && e.tool === 'source_capacity' && e.status === 'executed'
    && sourceCapacityNoFit((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result));
}

export function classifyCoverageGap(intent, executed, fullByEntry) {
  try {
    const t = String(intent || '').slice(0, 1000);
    if (!t) return null;
    if (LEASE_COMPS.test(t)) return 'lease_comps';
    if (COLO.test(t) && PRICE.test(t)) return 'colo_pricing';
    if (VACANCY.test(t)) return 'vacancy_absorption';
    if (COLO.test(t) && AVAIL.test(t) && _noFitStep(executed, fullByEntry)) return 'colo_availability_nofit';
  } catch (_) { /* telemetry classification never breaks a plan */ }
  return null;
}

// The scripted "live land + power screen for ~75-100 MW" prompt family (measured 2026-10-17 on
// prod mcp_call_log, see the PR body): a "75-100 MW" range AND the words land and power. "live" is
// NOT required (nine of the 44 measured prompts omit it). One shape, deliberately narrow: a
// 50-100 MW or 100 MW ask, or any range without both words, is a real question.
export function isEvalIntent(intent) {
  try {
    const t = String(intent || '').slice(0, 1000);
    return /\b75\s*[\u2013\u2014-]\s*100\s*MW\b/i.test(t)
      && /\bland\b/i.test(t) && /\bpower\b/i.test(t);
  } catch (_) { return false; }
}
