// paid-full-only.mjs — owner decision 2026-11-23: these tools give a FULL answer only to a paid key (Developer
// and up). A keyless caller and a free-class key (no email, a bound email, a trial key) get the tool's existing
// preview or withheld path, never the full answer.
//
// One list, so no lane can drift from it: the keyless first full answer (lib/keyless-first-full.mjs) and the
// keyless full-answer trial (lib/keyless-full-trial.mjs) refuse every name here, whatever their own sets or
// env lists say, and server.mjs's gate (PAID_ONLY_TOOLS, the free-class preview branch) reads it.
//
//   execute_plan                      its steps run at the caller's own depth; a free-class plan is a preview
//                                     (lib/siting-email-seat.mjs PLAN_PAID_ONLY_TOOL)
//   get_grid_data                     preview = the get_grid_intelligence-depth taste (lib/free-decision-taste.mjs)
//   get_refined_queue                 preview = the generic trial trim (server.mjs trimForTrial)
//   get_power_availability_timeline   preview = the generic trial trim (it left FREE_FULL_TOOLS)
//   rank_markets                      preview = the ALWAYS_PARTIAL_PREVIEW trim (no free-key trial_taste full answers)
//   get_market_context                preview = the backend's _free_preview depth tease (no trial_taste exemption)
//   get_energy_prices                 preview = its taste (lib/free-decision-taste.mjs; it left KEYED_FREE_BONUS and
//                                     the keyless first full answer)
//   ai_capacity_index                 preview = the ALWAYS_PARTIAL_PREVIEW trim (no free-key trial_taste full answers)
//   get_grid_intelligence             preview = its taste (lib/free-decision-taste.mjs); the bound-email key's
//   get_interconnection_queue         daily full answers (server.mjs _emailFullDecisionTool) and the keyless first
//                                     full answer of the day (lib/keyless-first-full.mjs) no longer serve them
export const PAID_FULL_ONLY_TOOLS = Object.freeze([
  'execute_plan', 'get_grid_data', 'get_refined_queue', 'get_power_availability_timeline',
  'rank_markets', 'get_market_context', 'get_energy_prices', 'ai_capacity_index',
  'get_grid_intelligence', 'get_interconnection_queue',
]);
// The ones answered by the tier gate (execute_plan is gated through its siting seat instead).
export const PAID_FULL_ONLY_GATED_TOOLS = Object.freeze(PAID_FULL_ONLY_TOOLS.filter((t) => t !== 'execute_plan'));
export function isPaidFullOnly(name) {
  return PAID_FULL_ONLY_TOOLS.includes(String(name || ''));
}
