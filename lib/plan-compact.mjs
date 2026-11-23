// plan-compact.mjs -- execute_plan answers in compact form by default: the lead, dated facts, citations and replay
// ids; each step's full result only with detail:"full" (Grok colocation head-to-head, 2026-11-17 midday, item 3;
// owner-approved 1:03 PM MST).
//
// WHY. A keyless colocation plan was 24-44 KB of structuredContent, and block 1 carried the same object again
// (50-90 KB on the wire, measured on the 2026-11-17 08:47Z runs). Almost all of it was executed[].result: whole
// tool envelopes (rows, provenance, relay copy) an agent does not need to answer the question, because the lead,
// the fact header, intent_answer and answer_guide were already composed from them. Grok's target: under ~10 KB
// for a typical colocation ask, with the same lead.
//
// WHAT. compactPlanObject(plan) keeps the answer and drops the bodies:
//   * every answer key the plan composed (KEEP_KEYS: fact_header, dcpi_verdict, intent_answer, ranked_answer,
//     answer_guide, dropped_filters, power_evidence, unresolved, more_detail, the one relay link, ...) as it is;
//   * executed[]: each step keeps every field but `result` (status, args, ms, status_note, the manual-continue
//     note of a not_run step), plus the step's own as_of, completeness and cite_as;
//   * facts: the dated facts the steps returned (lib/plan-step-facts.mjs), the same ones the lead is built from;
//   * citations: one row per step that returned data ({step, tool, as_of, completeness, cite_as}), deduped, and
//     licences: each licence text once with the steps it covers;
//   * provenance: source, licence, as_of and its basis, completeness, what was withheld, and the per-step layers
//     cut to {step_index, layer, evidence_as_of, data_basis};
//   * replay: its ids: plan_id, planner_version and each decision's id, step and status (lib/plan-replay-id.mjs);
//   * first_full_answer_used: its counters and the held-back step numbers, without the sentence listing them;
//   * detail: "compact" and full_detail, the one line saying how to get the step bodies.
// The caller's own continue path stays (human_url, human_message, user_message, for_your_human, _upgrade, agent_hints: the
// email-first ask the owner kept). Every other envelope key goes (next_session, quota, identity, upsell_deduped ...):
// none of them is part of the answer, and identity / next_session are once-per-plan plumbing.
// If the result is still over PLAN_COMPACT_BUDGET, the optional blocks go in OPTIONAL_DROP order, then facts past
// the first four, then the per-step provenance layers.
//
// planCompactStep(result) is the LAST step of execute_plan's response pipeline (server.mjs _sourceLineCb, after
// the lead text, so block 0's plain-language lead is built from the full plan and reads the same either way): it
// rewrites structuredContent and the content block that holds the plan's JSON; the other blocks are untouched.
// Skipped: detail:"full", a paid caller unless it asks for detail:"compact" (paid callers keep every row, owner
// 2026-11-14), a loopback step, the directory / Claude / core profiles and clean platforms (each keeps its reviewed
// shape), and anything that is not a plan envelope. Kill switch DCHUB_PLAN_COMPACT=0 (read per call).

import { splitLeadingJson } from './facility-location.mjs';
import { compactReplay } from './plan-replay-id.mjs';
import { factsFromExecuted, stepAsOf } from './plan-step-facts.mjs';
import { compactAnswerGuide } from './compact-guide.mjs';

export const PLAN_COMPACT_FLAG = 'DCHUB_PLAN_COMPACT';
export const PLAN_COMPACT_BUDGET = 9500;   // bytes of the compact structuredContent; Grok's target is ~10 KB
export const PLAN_FACTS_MAX = 10;
export const FULL_DETAIL_LINE = 'Compact answer: the lead, each step\'s status, the dated facts and citations. '
  + 'Call execute_plan again with detail:"full" (same intent) for every step\'s full result.';

export function planCompactOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env[PLAN_COMPACT_FLAG]) || '').trim());
}

// The caller's `detail`: 'full' or 'compact' when it said so, else null (the default for its tier applies).
export function planDetailRequested(args) {
  const v = args && typeof args === 'object' ? args.detail : undefined;
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t === 'full' || t === 'compact') return t;
  return null;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const bytes = (v) => { try { return Buffer.byteLength(JSON.stringify(v), 'utf8'); } catch (_) { return Infinity; } };

// The keys of the plan's answer, kept as they are, in this order.
export const KEEP_KEYS = Object.freeze([
  // answer / as_of: the keyless first full answer's direct sentence and its date (lib/keyless-first-full.mjs), which
  // this step used to drop when it compacted that answer a second time.
  'answer', 'as_of', 'fact_header', 'dcpi_verdict', '_entity', 'ok', 'intent', 'intent_class', 'planner_version',
  'intent_answer', 'ranked_answer', 'answer_guide', 'paired_sides', 'unresolved', 'geography_scope', 'constraint_iso',
  'dropped_filters', 'power_evidence', 'geocoded', 'grid_ranking', 'more_detail', 'route_back', 'handoff',
  'capacity_source', 'first_full_answer_used', 'human_url', 'human_message', 'user_message', 'for_your_human', '_upgrade', 'agent_hints', 'deal_desk',
  'next_tools', 'next_recipe', 'plan_id', 'rerun', 'totals', 'minted', 'citation', 'cite_as', '_source',
]);

// answer_guide's "Compose the answer from executed[].result" sentence, said for what the compact answer carries
// (lib/compact-guide.mjs, dependency-free so lib/keyless-first-full.mjs can use it without this module's imports).
export { compactAnswerGuide, COMPACT_BODIES_CLAUSE } from './compact-guide.mjs';

// Dropped in this order while the compact answer is over PLAN_COMPACT_BUDGET (the lead, steps and citations stay).
export const OPTIONAL_DROP = Object.freeze(['minted', 'deal_desk', 'geocoded', 'grid_ranking', 'ranked_answer',
  'power_evidence', 'rerun']);

function compactStep(e) {
  if (!isObj(e)) return e;
  const { result, ...rest } = e;
  const r = isObj(result) ? result : (() => { try { const o = JSON.parse(result); return isObj(o) ? o : null; } catch (_) { return null; } })();
  if (!r) return rest;
  const out = { ...rest };
  const asOf = stepAsOf(r);
  if (asOf) out.as_of = asOf;
  const cit = isObj(r.citation) ? r.citation : null;
  const comp = (cit && str(cit.completeness)) || (isObj(r.provenance) && str(r.provenance.completeness));
  if (comp) out.completeness = comp;
  if (r.truncated === true) out.truncated = true;
  return out;
}

function citationsOf(executed) {
  const out = [];
  const seen = new Set();
  const licences = new Map();
  for (const [i, e] of executed.entries()) {
    if (!isObj(e) || !isObj(e.result)) continue;
    const r = e.result;
    const cit = isObj(r.citation) ? r.citation : {};
    const row = { step: Number.isFinite(e.step) ? e.step : i + 1, tool: e.tool };
    const asOf = stepAsOf(r);
    if (asOf) row.as_of = asOf;
    if (str(cit.completeness)) row.completeness = str(cit.completeness);
    if (str(cit.cite_as) || str(r.cite_as)) row.cite_as = str(cit.cite_as) || str(r.cite_as);
    const lic = str(cit.license);
    const k = JSON.stringify([row.tool, row.as_of, row.cite_as, lic]);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
    if (lic) { if (!licences.has(lic)) licences.set(lic, []); licences.get(lic).push(row.step); }
  }
  return { rows: out, licences: [...licences.entries()].map(([license, steps]) => ({ license, steps })) };
}

// Replay ids: each decision's id, step and status (the full rationale is on plan_query / detail:"full").
function replayIds(replay) {
  const cr = replay.compact === true ? replay : compactReplay(replay);
  if (!isObj(cr)) return null;
  return {
    ...(cr.plan_id ? { plan_id: cr.plan_id } : {}),
    planner_version: cr.planner_version,
    decisions: (Array.isArray(cr.decisions) ? cr.decisions : []).filter(isObj).map((d) => ({
      id: d.id, ...(d.step !== undefined ? { step: d.step } : {}), status: d.status,
      ...(d.status_note !== undefined ? { status_note: d.status_note } : {}),
    })),
    compact: true,
  };
}

// The caller's continue path without its explanations: what binds, how much is left, and the call that continues.
const UPGRADE_KEEP = ['tier', 'unlock_kind', 'binding_limit', 'remaining_today', 'next_tool', 'email_ask', 'message', 'url', 'human_url'];
function continuePath(u) {
  const out = {};
  for (const k of UPGRADE_KEEP) if (u[k] !== undefined) out[k] = u[k];
  return Object.keys(out).length ? out : u;
}

// The keyless first-full-answer block without its step-by-step sentence (each step's completeness says it).
function firstFullCounts(b) {
  if (!isObj(b)) return b;
  const out = {};
  for (const k of ['used', 'limit', 'resets']) if (b[k] !== undefined) out[k] = b[k];
  if (Array.isArray(b.held_back) && b.held_back.length) out.held_back_steps = b.held_back.map((h) => (isObj(h) ? h.step : h));
  return out;
}

function compactProvenance(p) {
  if (!isObj(p)) return p;
  const out = {};
  // as_of_kind says whether as_of is a data date or the run time (generated_at): without it a run time reads as data.
  for (const k of ['source', 'url', 'license', 'cite_as', 'retrieved_at', 'as_of', 'as_of_kind', 'as_of_basis', 'basis_class', 'basis_class_basis', 'provenance_revision', 'completeness', 'preview_warning']) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  if (isObj(p.preview)) {
    const pv = {};
    if (Array.isArray(p.preview.withheld_fields) && p.preview.withheld_fields.length) pv.withheld_fields = p.preview.withheld_fields;
    if (pv.withheld_fields && typeof p.preview.withheld_label === 'string') pv.withheld_label = p.preview.withheld_label;
    if (Number.isFinite(p.preview.shown)) pv.shown = p.preview.shown;
    if (Number.isFinite(p.preview.total)) pv.total = p.preview.total;
    if (Object.keys(pv).length) out.preview = pv;
  }
  const layers = isObj(p.evidence) && Array.isArray(p.evidence.layers) ? p.evidence.layers : null;
  if (layers) {
    out.layers = layers.filter(isObj).map((l) => {
      const o = {};
      for (const k of ['step_index', 'layer', 'evidence_as_of', 'data_basis']) if (l[k] !== undefined) o[k] = l[k];
      return o;
    });
  }
  return out;
}

// The compact plan. A non-plan value comes back as it is.
export function compactPlanObject(plan) {
  if (!isObj(plan) || plan._entity !== 'plan_execution' || !Array.isArray(plan.executed)) return plan;
  const out = {};
  for (const k of KEEP_KEYS) {
    if (k === 'totals' || plan[k] === undefined) continue;
    out[k] = plan[k];
  }
  out.detail = 'compact';
  out.full_detail = FULL_DETAIL_LINE;
  out.executed = plan.executed.map(compactStep);
  let facts = [];
  try { facts = factsFromExecuted(plan.executed); } catch (_) { facts = []; }
  // 5.39 (Grok cross-domain head-to-head, 2026-11-17 night): the lead may only claim figures that facts[] holds. A
  // composed answer (lib/cross-domain-answer.mjs) reads its figures from the FULL step results, which this compact
  // form no longer carries, so the facts it used go first.
  try {
    const own = isObj(plan.intent_answer) && Array.isArray(plan.intent_answer.facts) ? plan.intent_answer.facts.filter(isObj) : [];
    // 5.40 (Grok round 2, gap 4): a step fact the answer already states for the same tool and entity is the same figure
    // said twice (PJM's queue appeared as "373.5 GW of requested generation" and "queued generation: 373.5 GW").
    const key = (f) => `${f.tool}|${String(f.entity || '').toLowerCase()}`;
    if (own.length) facts = [...own, ...facts.filter((f) => !own.some((o) => o.text === f.text || (o.entity && key(o) === key(f))))];
  } catch (_) { /* facts are optional */ }
  facts = facts.slice(0, PLAN_FACTS_MAX);
  const ownFacts = isObj(plan.intent_answer) && Array.isArray(plan.intent_answer.facts) ? Math.min(plan.intent_answer.facts.length, PLAN_FACTS_MAX) : 0;
  if (facts.length) out.facts = facts;
  if (ownFacts && isObj(out.intent_answer)) { const { facts: _dup, ...ia } = out.intent_answer; out.intent_answer = { ...ia, facts_in: 'facts[]' }; }
  const cites = citationsOf(plan.executed);
  if (cites.rows.length) out.citations = cites.rows;
  if (cites.licences.length) out.licences = cites.licences;
  if (plan.provenance !== undefined) out.provenance = compactProvenance(plan.provenance);
  if (isObj(plan.replay)) {
    const ri = replayIds(plan.replay);
    if (ri) out.replay = ri;
  }
  if (isObj(out.first_full_answer_used)) out.first_full_answer_used = firstFullCounts(out.first_full_answer_used);
  if (isObj(out._upgrade)) out._upgrade = continuePath(out._upgrade);
  if (plan.totals !== undefined) out.totals = plan.totals;
  // Said for what this answer carries: before the budget drops (so they count its length), and again after them
  // (a block they dropped is no longer named).
  const guide = () => { if (typeof out.answer_guide === 'string') out.answer_guide = compactAnswerGuide(out.answer_guide, out); };
  guide();
  for (const k of OPTIONAL_DROP) {
    if (bytes(out) <= PLAN_COMPACT_BUDGET) break;
    delete out[k];
  }
  guide();
  // The answer's own facts stay whole: its lead names them.
  if (bytes(out) > PLAN_COMPACT_BUDGET && Array.isArray(out.facts) && out.facts.length > Math.max(4, ownFacts)) out.facts = out.facts.slice(0, Math.max(4, ownFacts));
  // last: the per-step provenance layers (each step already carries its own as_of and completeness)
  if (bytes(out) > PLAN_COMPACT_BUDGET && isObj(out.provenance) && out.provenance.layers) {
    const { layers: _l, ...pv } = out.provenance;
    out.provenance = pv;
  }
  // 5.62: still over, the facts past the answer's own go from the end (each is also in its step's citation).
  while (bytes(out) > PLAN_COMPACT_BUDGET && Array.isArray(out.facts) && out.facts.length > Math.max(1, ownFacts)) out.facts.pop();
  return out;
}

// The step. `detail`: what the caller asked for ('full' | 'compact' | null). `paid`: a paid caller (full by default).
export function planCompactStep(result, { skip = false, detail = null, paid = false, env = process.env } = {}) {
  try {
    if (skip || !planCompactOn(env)) return result;
    if (detail === 'full' || (paid && detail !== 'compact')) return result;
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const sc = result.structuredContent;
    if (!isObj(sc) || sc._entity !== 'plan_execution' || !Array.isArray(sc.executed)) return result;
    const next = compactPlanObject(sc);
    if (next === sc) return result;
    const js = JSON.stringify(next);
    let swapped = false;
    const content = result.content.map((b) => {
      if (swapped || !b || b.type !== 'text' || typeof b.text !== 'string') return b;
      const sp = splitLeadingJson(b.text);
      if (!sp || !isObj(sp.json) || sp.json._entity !== 'plan_execution') return b;
      swapped = true;
      return { ...b, text: sp.head + js + sp.rest };
    });
    return { ...result, content, structuredContent: next };
  } catch (_) { return result; }   // a shorter answer is never worth losing the answer
}
