// compact-guide.mjs -- answer_guide in a compact execute_plan answer (lib/plan-compact.mjs and the keyless first full
// answer, lib/keyless-first-full.mjs). No imports: lib/tier-canon.mjs imports keyless-first-full, and the canon
// scripts run it in a sandbox without node_modules.
//
// answer_guide opens "Compose the answer from executed[].result (each already tier-honest)." (server.mjs
// _execAnswerGuide). A compact answer has no executed[].result, so an agent following that sentence composes from
// nothing (Grok, live 2026-11-17 night: the Dallas carrier-hotel plan). compactAnswerGuide says it for the fields the
// compact answer does carry, and how to get the bodies. It also re-says a guide an earlier compaction already
// rewrote (the keyless first full answer, lib/keyless-first-full.mjs, then this step), so a block dropped in between
// is never named.
// Short on purpose: it rides inside the compact answer's ~9.5 KB budget (lib/plan-compact.mjs PLAN_COMPACT_BUDGET),
// which some answers already fill to within a few bytes.
export const COMPACT_BODIES_CLAUSE = 'tier-honest; detail:"full" adds step bodies';
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPOSE_RE = new RegExp('Compose the answer from (?:executed\\[\\]\\.result \\(each already tier-honest\\)|[^;()]*? \\('
  + reEsc(COMPACT_BODIES_CLAUSE) + '\\))\\.\\s*');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function compactAnswerGuide(guide, obj) {
  if (typeof guide !== 'string' || !COMPOSE_RE.test(guide)) return guide;
  const o = isObj(obj) ? obj : {};
  const steps = Array.isArray(o.executed) ? o.executed : [];
  const from = [];
  if (str(o.answer)) from.push('answer');
  for (const k of ['intent_answer', 'ranked_answer', 'paired_sides']) if (isObj(o[k])) from.push(k);
  if (Array.isArray(o.facts) && o.facts.length) from.push('facts');
  if (steps.some((e) => isObj(e) && e.figures !== undefined)) from.push('executed[].figures');
  if (Array.isArray(o.citations) && o.citations.length) from.push('citations');
  if (!from.length) from.push('each step\'s status and citation');
  const list = from.length > 1 ? `${from.slice(0, -1).join(', ')} and ${from[from.length - 1]}` : from[0];
  return guide.replace(COMPOSE_RE, `Compose the answer from ${list} (${COMPACT_BODIES_CLAUSE}). `);
}
