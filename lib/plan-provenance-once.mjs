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
//
// ENVELOPE ONCE (Grok note K item 9, 2026-11-15). The equal-only rule above still left the envelope repeated:
// a step's identity, next_session (and the digest_offer inside it) differ from the plan's by a truncated
// string or a tool list, and every grid / timeline / queue step carried its own capacity_source (~0.6 KB
// each). Measured with a non-QA client through the real /mcp handler: identity 1, next_session 3,
// capacity_source 5 copies in one plan, and Grok's iso comparison at 42,640 bytes against the 30 KB budget.
// So, on top of D1, each of these is emitted ONCE per response, at the plan's top level:
//   * identity: every step drops its copy (the plan runs under one caller). The plan keeps its own; with none,
//     the first step's moves up. A step whose tier differed keeps it as `served_as` (one short string).
//   * next_session / _next_session: every step drops its copy; the plan keeps its own, else the first step's.
//   * digest_offer: lives inside next_session; a step's standalone one goes, and moves up only when the plan
//     carries none anywhere. A plan holding both keeps the one inside next_session.
//   * capacity_source: every step drops its block; the plan gets one, the first step's block with the most
//     live listings, the other places' browse calls listed once in `other_places` ({tool, arguments, steps}),
//     and `steps` naming every step whose answer named a place.
//   * upgrade_options: a step's offer list goes (the plan's envelope carries the one route: human_url and
//     for_your_human). Live 2026-11-15 a search_facilities step carried the backend's
//     [{plan:'pack'}, {plan:'developer'}] list (note K item 8: agent-facing text names no plans or prices).
// Kill switch for this part alone: DCHUB_PLAN_ENVELOPE_ONCE=0 (D1 above stays).

import { splitLeadingJson } from './facility-location.mjs';

export function planProvenanceOnceOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_PROVENANCE_ONCE) || '').trim());
}

export function planEnvelopeOnceOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_ENVELOPE_ONCE) || '').trim());
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

// The keys a step drops because the plan's envelope carries them once (ENVELOPE ONCE above).
export const STEP_ENVELOPE_KEYS = Object.freeze(['identity', 'next_session', '_next_session', 'digest_offer',
  'capacity_source', 'upgrade_options']);

const liveOf = (b) => {
  const n = Number.isFinite(b.live_listings_matching) ? b.live_listings_matching : b.live_listings;
  return Number.isFinite(n) ? n : 0;
};

// One capacity_source for the plan from its steps' blocks ([{ step, block }], in step order).
export function mergeCapacitySource(found) {
  const list = (Array.isArray(found) ? found : []).filter((f) => f && isObj(f.block));
  if (!list.length) return null;
  const base = list.reduce((a, b) => (liveOf(b.block) > liveOf(a.block) ? b : a), list[0]);
  const out = { ...base.block };
  const argsOf = (b) => (isObj(b.browse_call) && isObj(b.browse_call.arguments) ? b.browse_call.arguments
    : (isObj(b.next_step) && isObj(b.next_step.args) ? b.next_step.args : null));
  const places = new Map();
  for (const f of list) {
    const a = argsOf(f.block);
    const k = JSON.stringify(a);
    if (!places.has(k)) places.set(k, { arguments: a, steps: [] });
    if (!places.get(k).steps.includes(f.step)) places.get(k).steps.push(f.step);
  }
  const baseKey = JSON.stringify(argsOf(base.block));
  const others = [...places.entries()].filter(([k, p]) => k !== baseKey && p.arguments)
    .map(([, p]) => ({ tool: 'source_capacity', arguments: p.arguments, steps: [...p.steps].sort((a, b) => a - b) }));
  if (others.length) out.other_places = others;
  if (!isObj(out.next_call)) {
    const nc = list.map((f) => f.block.next_call).find(isObj);
    if (nc) out.next_call = nc;
  }
  out.steps = [...new Set(list.map((f) => f.step))].sort((a, b) => a - b);
  return out;
}

// ENVELOPE ONCE over a plan whose steps D1 has already compacted. Returns { value, steps }.
export function planEnvelopeOnceObject(plan) {
  if (!isObj(plan) || plan._entity !== 'plan_execution' || !Array.isArray(plan.executed)) return { value: plan, steps: 0 };
  const first = { identity: null, next_session: null, digest_offer: null };
  const caps = [];
  let steps = 0;
  const topTier = isObj(plan.identity) ? plan.identity.tier : undefined;
  const executed = plan.executed.map((e, i) => {
    if (!isObj(e) || !isObj(e.result)) return e;
    const r = e.result;
    if (!STEP_ENVELOPE_KEYS.some((k) => r[k] !== undefined)) return e;
    const nr = { ...r };
    const stepNo = Number.isFinite(e.step) ? e.step : i + 1;
    if (isObj(r.identity)) {
      if (!first.identity) first.identity = r.identity;
      const t = r.identity.tier;
      if (topTier !== undefined && t !== undefined && t !== topTier && nr.served_as === undefined) nr.served_as = t;
    }
    for (const k of ['next_session', '_next_session']) if (!first.next_session && isObj(r[k])) first.next_session = r[k];
    if (!first.digest_offer && isObj(r.digest_offer)) first.digest_offer = r.digest_offer;
    if (isObj(r.capacity_source)) caps.push({ step: stepNo, block: r.capacity_source });
    for (const k of STEP_ENVELOPE_KEYS) delete nr[k];
    steps += 1;
    return { ...e, result: nr };
  });
  if (!steps) return { value: plan, steps: 0 };
  const value = { ...plan, executed };
  if (value.identity === undefined && first.identity) value.identity = first.identity;
  const hasNs = isObj(value.next_session) || isObj(value._next_session);
  if (!hasNs && first.next_session) value.next_session = first.next_session;
  const nsDigest = [value.next_session, value._next_session].some((n) => isObj(n) && n.digest_offer !== undefined);
  if (nsDigest && value.digest_offer !== undefined) delete value.digest_offer;
  else if (!nsDigest && value.digest_offer === undefined && first.digest_offer) value.digest_offer = first.digest_offer;
  if (value.capacity_source === undefined && caps.length) value.capacity_source = mergeCapacitySource(caps);
  return { value, steps };
}

// Pure. Returns { value, steps } where steps counts the steps that were compacted; value is the input when 0.
// envelopeOnce (default: DCHUB_PLAN_ENVELOPE_ONCE, on) runs ENVELOPE ONCE after D1.
export function planProvenanceOnceObject(plan, { envelopeOnce = planEnvelopeOnceOn() } = {}) {
  const d1 = planProvenanceOnceD1(plan);
  if (!envelopeOnce) return d1;
  const env = planEnvelopeOnceObject(d1.value);
  return { value: env.value, steps: Math.max(d1.steps, env.steps) };
}

function planProvenanceOnceD1(plan) {
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
    const envelopeOnce = planEnvelopeOnceOn(env);
    if (!result || typeof result !== 'object' || result.isError === true || !Array.isArray(result.content)) return result;
    let changed = false;
    const out = { ...result };
    if (isObj(result.structuredContent)) {
      const { value, steps } = planProvenanceOnceObject(result.structuredContent, { envelopeOnce });
      if (steps) { out.structuredContent = value; changed = true; }
    }
    const b0 = result.content[0];
    if (b0 && b0.type === 'text' && typeof b0.text === 'string') {
      const sp = splitLeadingJson(b0.text);
      if (sp && isObj(sp.json)) {
        const { value, steps } = planProvenanceOnceObject(sp.json, { envelopeOnce });
        if (steps) {
          out.content = [{ ...b0, text: sp.head + JSON.stringify(value) + sp.rest }, ...result.content.slice(1)];
          changed = true;
        }
      }
    }
    return changed ? out : result;
  } catch (_) { return result; }
}
