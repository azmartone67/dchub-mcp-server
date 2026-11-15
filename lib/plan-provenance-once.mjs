// plan-provenance-once.mjs -- execute_plan carries provenance ONCE per plan, not once per step (D1, owner
// wave 2, 2026-11-14).
//
// WHY. Every execute_plan step is a full loopback tools/call, so every step result came back with the whole
// envelope a direct call gets: its own `provenance` block (with `evidence`, ~2 KB), `identity` (~0.5 KB, the
// same caller every time), `citation` and `quota`. The plan's own top-level provenance already composes those
// step blocks: lib/evidence-contract.mjs lists one layer per step in `provenance.evidence.layers`, each with
// its `step_index`, as_of, as_of_basis, source and licence. So each step's copy said again what the plan's block
// says, in both copies of the answer (structuredContent and block 0's JSON). Measured on a local main build
// against recorded live backend answers (see the PR): keyless plans of 84-117 KB on the wire.
//
// WHAT. On the finished, stamped execute_plan answer (server.mjs _sourceLineCb, before the size budget):
//   * a step's `provenance` becomes a short pointer that keeps what an agent quotes from it: as_of,
//     completeness, the withheld field names and shown/total when the step was a preview, and `see`, the
//     layer of the plan's provenance that holds the rest. Only when that layer exists: a step with no layer
//     in the plan's block (a capped layer list, a block that did not compose) keeps its own block whole.
//   * a step's `identity` and `quota` go when they equal the plan's top-level ones (same caller, same call).
//   * a step's `citation` keeps cite_as, completeness, as_of and licence; `retrieved_at`, `source` and `url`
//     go when the plan's top-level citation carries the same source and url (retrieved_at is the plan's).
//   * `next_session` (the come-back / digest / cookbook block, ~1 KB) is the same text on every step that
//     carries it: it moves to the plan's top level once, and the steps drop their copies. A step whose block
//     differs from the first one keeps its own.
// No data row, verdict, figure, relay link or upsell field is touched; nothing else in the step changes.
// Skipped for an execute_plan loopback step (it is shaped once, as the plan) and when the answer is not a
// plan envelope. Kill switch: DCHUB_PLAN_PROVENANCE_ONCE=0.

import { splitLeadingJson } from './facility-location.mjs';

export function planProvenanceOnceOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_PROVENANCE_ONCE) || '').trim());
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; } };

function layerFor(plan, i) {
  const layers = isObj(plan.provenance) && isObj(plan.provenance.evidence) && Array.isArray(plan.provenance.evidence.layers)
    ? plan.provenance.evidence.layers : [];
  return layers.find((l) => isObj(l) && l.step_index === i) || null;
}

function compactProvenance(p, i) {
  const out = { as_of: p.as_of !== undefined ? p.as_of : null };
  if (p.completeness !== undefined) out.completeness = p.completeness;
  const pv = isObj(p.preview) ? p.preview : null;
  if (pv && Array.isArray(pv.withheld_fields) && pv.withheld_fields.length) out.withheld_fields = pv.withheld_fields;
  if (pv && Number.isFinite(pv.shown) && Number.isFinite(pv.total)) { out.shown = pv.shown; out.total = pv.total; }
  if (typeof p.preview_warning === 'string') out.preview_warning = p.preview_warning;
  out.see = `provenance.evidence.layers[step_index=${i}] of this plan (source, as_of basis, licence)`;
  return out;
}

function compactCitation(cit, top) {
  if (!isObj(cit)) return cit;
  const out = { ...cit };
  delete out.retrieved_at;
  if (isObj(top) && top.source === cit.source && top.url === cit.url) { delete out.source; delete out.url; }
  return out;
}

// Pure. Returns { value, steps } where steps counts the steps that were compacted; value is the input when 0.
export function planProvenanceOnceObject(plan) {
  if (!isObj(plan) || plan._entity !== 'plan_execution' || !Array.isArray(plan.executed)) return { value: plan, steps: 0 };
  let steps = 0;
  const firstNs = plan.executed.map((e) => (isObj(e) && isObj(e.result) && isObj(e.result.next_session)) ? e.result.next_session : null).find(Boolean) || null;
  const topNs = isObj(plan.next_session) ? plan.next_session : firstNs;
  const executed = plan.executed.map((e, i) => {
    if (!isObj(e) || !isObj(e.result)) return e;
    const r = e.result;
    const nr = { ...r };
    let changed = false;
    if (isObj(r.provenance) && layerFor(plan, i)) { nr.provenance = compactProvenance(r.provenance, i); changed = true; }
    if (r.identity !== undefined && plan.identity !== undefined && same(r.identity, plan.identity)) { delete nr.identity; changed = true; }
    if (r.quota !== undefined && plan.quota !== undefined && same(r.quota, plan.quota)) { delete nr.quota; changed = true; }
    if (topNs && isObj(r.next_session) && same(r.next_session, topNs)) { delete nr.next_session; changed = true; }
    if (isObj(r.citation)) {
      const c2 = compactCitation(r.citation, plan.citation);
      if (!same(c2, r.citation)) { nr.citation = c2; changed = true; }
    }
    if (!changed) return e;
    steps += 1;
    return { ...e, result: nr };
  });
  if (!steps) return { value: plan, steps: 0 };
  const value = { ...plan, executed };
  if (topNs && !isObj(plan.next_session) && executed.some((e, i) => e !== plan.executed[i] && isObj(plan.executed[i].result) && isObj(plan.executed[i].result.next_session) && !(isObj(e.result) && e.result.next_session))) value.next_session = topNs;
  return { value, steps };
}

// The step server.mjs runs on a finished execute_plan result. Never fails a response.
export function planProvenanceOnceStep(result, { skip = false, env = process.env } = {}) {
  try {
    if (skip || !planProvenanceOnceOn(env)) return result;
    if (!result || typeof result !== 'object' || result.isError === true || !Array.isArray(result.content)) return result;
    let changed = false;
    const out = { ...result };
    if (isObj(result.structuredContent)) {
      const { value, steps } = planProvenanceOnceObject(result.structuredContent);
      if (steps) { out.structuredContent = value; changed = true; }
    }
    const b0 = result.content[0];
    if (b0 && b0.type === 'text' && typeof b0.text === 'string') {
      const sp = splitLeadingJson(b0.text);
      if (sp && isObj(sp.json)) {
        const { value, steps } = planProvenanceOnceObject(sp.json);
        if (steps) {
          out.content = [{ ...b0, text: sp.head + JSON.stringify(value) + sp.rest }, ...result.content.slice(1)];
          changed = true;
        }
      }
    }
    return changed ? out : result;
  } catch (_) { return result; }
}
