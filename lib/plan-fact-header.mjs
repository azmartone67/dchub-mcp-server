// execute_plan's compact fact header (Gemini traction spec, 2026-11-16).
//
// Text block 0 of an execute_plan answer is a 20-60 KB JSON object. An agent (Gemini CLI, ADK, any
// host that shows the model the text) has to read deep into it before it knows WHAT was answered,
// for WHICH place and AS OF WHEN. This puts three deterministic lines in front of that JSON:
//
//   SOURCE: DC Hub (dchub.cloud) | AS_OF: <ISO-8601>
//   ENTITY: <market> (market) | <ISO> (ISO) | <facility> (facility)
//   SUMMARY: <metric> | <metric> | Verdict: <BUILD/CAUTION/AVOID>
//
// Rules, each pinned in test/plan-fact-header.test.mjs:
//   * every value is read from the plan's OWN result (dcpi_verdict, intent_answer, provenance,
//     constraint_iso, executed[].args / executed[].result). Nothing is typed here, nothing is looked up.
//   * a value the plan does not hold is DROPPED, never printed as null/undefined/"n/a"; a line with
//     no value left is dropped whole (SOURCE always stays: it names DC Hub).
//   * the verdict is printed only when the plan carries one in the DCPI domain (BUILD / CAUTION /
//     AVOID). A plan with no verdict gets no "Verdict:" segment: one is never derived from a score.
//   * AS_OF is the plan's provenance.as_of: the OLDEST input ("an answer is no fresher than its
//     stalest input"), so the header never claims a freshness the answer does not have. When no step
//     stated a source date (as_of_kind 'generated_at': the run time, not a data date) there is no AS_OF.
//   * small: at most HEADER_MAX_CHARS. It leads block 0; it does not add a block.
//
// Where it applies: /mcp and the other non-directory paths. Not on the directory / Claude / core
// profiles (their scrubs and size caps JSON.parse block 0, so a text lead would defeat them, and
// their catalogs are under review), not on a clean platform (ChatGPT-identified clients), and not on
// an execute_plan loopback step. `compact: false` on the call returns today's output; the
// kill switch DCHUB_PLAN_FACT_HEADER=0 turns it off for every caller.

export const HEADER_MAX_CHARS = 320;
const VERDICTS = new Set(['BUILD', 'CAUTION', 'AVOID']);
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function planFactHeaderOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_FACT_HEADER) || '').trim());
}

// `compact` as the caller sent it: absent means the default (true); false / "false" / 0 turn it off.
export function compactRequested(args) {
  const v = args && typeof args === 'object' ? args.compact : undefined;
  if (v === undefined || v === null || v === '') return true;
  if (v === false || v === 0) return false;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// One line per field: a value carrying a separator or a newline would forge a field.
const clean = (s) => (s == null ? null : String(s).replace(/[\r\n|:]+/g, ' ').replace(/\s+/g, ' ').trim() || null);

function fmtNum(v, dp = 1) {
  const f = Math.round(v * 10 ** dp) / 10 ** dp;
  return f.toLocaleString('en-US', { maximumFractionDigits: dp });
}

// A data date, never a run time: when no step stated a source date, provenance.as_of is when DC Hub ran
// the plan (as_of_kind 'generated_at', "NOT when the data was collected"), and the header prints no AS_OF.
function isoAsOf(plan) {
  const p = isObj(plan.provenance) ? plan.provenance : null;
  if (!p || p.as_of_kind === 'generated_at') return null;
  const s = str(p.as_of);
  return s && ISO_8601.test(s) ? s : null;
}

function steps(plan) {
  return Array.isArray(plan.executed) ? plan.executed.filter(isObj) : [];
}
const stepResult = (e) => (isObj(e.result) ? e.result : null);
const RAN = new Set(['executed', 'gated_preview']);

function verdictOf(plan) {
  const cands = [];
  if (isObj(plan.dcpi_verdict)) cands.push(plan.dcpi_verdict.verdict);
  const ia = isObj(plan.intent_answer) ? plan.intent_answer : null;
  if (ia && isObj(ia.verdict)) cands.push(ia.verdict.value);
  for (const c of cands) {
    const v = str(c) && str(c).toUpperCase();
    if (v && VERDICTS.has(v)) return v;
  }
  return null;
}

function scoreOf(plan) {
  if (isObj(plan.dcpi_verdict) && num(plan.dcpi_verdict.composite_score) != null) return plan.dcpi_verdict.composite_score;
  const ia = isObj(plan.intent_answer) ? plan.intent_answer : null;
  if (ia && isObj(ia.verdict) && num(ia.verdict.composite_score) != null) return ia.verdict.composite_score;
  for (const e of steps(plan)) {
    const r = stepResult(e);
    if (e.tool === 'get_market_dcpi_rank' && RAN.has(e.status) && r && num(r.composite_score) != null) return r.composite_score;
  }
  return null;
}

function marketOf(plan) {
  // The display name a step returned beats the slug the plan was given.
  for (const e of steps(plan)) {
    const r = stepResult(e);
    if (!r || !RAN.has(e.status)) continue;
    if (str(r.market_name)) return str(r.market_name);
    if (isObj(r.market) && str(r.market.name)) return str(r.market.name);
  }
  if (isObj(plan.dcpi_verdict) && str(plan.dcpi_verdict.market_slug)) return str(plan.dcpi_verdict.market_slug);
  for (const e of steps(plan)) {
    const a = isObj(e.args) ? e.args : {};
    const m = str(a.market_slug) || str(a.market);
    if (m) return m;
  }
  return null;
}

function isosOf(plan) {
  const set = Array.isArray(plan.constraint_iso) ? plan.constraint_iso
    : (str(plan.constraint_iso) ? [plan.constraint_iso] : []);
  return set.map(str).filter(Boolean).slice(0, 4);
}

function facilityOf(plan) {
  for (const e of steps(plan)) {
    if (!/facility/.test(String(e.tool || '')) || !RAN.has(e.status)) continue;
    const r = stepResult(e);
    if (r && str(r.name) && (e.tool === 'get_facility' || e.tool === 'score_facility')) return str(r.name);
    if (r && isObj(r.facility) && str(r.facility.name)) return str(r.facility.name);
  }
  return null;
}

function metricsOf(plan) {
  const out = [];
  const score = scoreOf(plan);
  if (score != null) out.push(`DCPI ${fmtNum(score)}/100`);
  let ttp = null, mw = null, queue = null;
  for (const e of steps(plan)) {
    const r = stepResult(e);
    if (!r || !RAN.has(e.status)) continue;
    if (ttp == null && num(r.time_to_power_months) != null) ttp = r.time_to_power_months;
    const siting = isObj(r.siting) ? r.siting : null;
    if (mw == null && siting && isObj(siting.mw) && num(siting.mw.total_mw) != null) mw = siting.mw.total_mw;
    if (queue == null && e.tool === 'get_refined_queue' && num(r.total_queued_mw) != null) queue = r.total_queued_mw;
  }
  if (ttp != null) out.push(`Time to power ${fmtNum(ttp)} months`);
  if (mw != null) out.push(`Tracked ${fmtNum(mw, 0)} MW`);
  if (queue != null) out.push(`Queue ${fmtNum(queue, 0)} MW`);
  return out;
}

// The three lines, or null when `plan` is not an execute_plan answer.
export function buildPlanFactHeader(plan) {
  if (!isObj(plan) || plan._entity !== 'plan_execution') return null;
  const asOf = isoAsOf(plan);   // validated ISO-8601 above: no separator or newline can ride it
  const lines = [`SOURCE: DC Hub (dchub.cloud)${asOf ? ` | AS_OF: ${asOf}` : ''}`];
  const ent = [];
  const mk = clean(marketOf(plan));
  if (mk) ent.push(`${mk} (market)`);
  for (const iso of isosOf(plan)) { const c = clean(iso); if (c) ent.push(`${c} (ISO)`); }
  const fac = clean(facilityOf(plan));
  if (fac) ent.push(`${fac} (facility)`);
  if (ent.length) lines.push(`ENTITY: ${ent.join(' | ')}`);
  const sum = metricsOf(plan).map(clean).filter(Boolean);
  const v = verdictOf(plan);
  if (v) sum.push(`Verdict: ${v}`);
  if (sum.length) lines.push(`SUMMARY: ${sum.join(' | ')}`);
  let text = lines.join('\n');
  if (text.length > HEADER_MAX_CHARS) {
    // Trim whole segments from the ENTITY line first, never cut a value in half.
    while (text.length > HEADER_MAX_CHARS && ent.length > 1) {
      ent.pop();
      lines[1] = `ENTITY: ${ent.join(' | ')}`;
      text = lines.join('\n');
    }
    if (text.length > HEADER_MAX_CHARS) text = lines[0];
  }
  return text;
}

// Block 0's text split into the header (or null) and the plan JSON after it. For a reader that wants
// only the JSON: JSON.parse(splitPlanFactHeader(text).json).
export function splitPlanFactHeader(text) {
  const t = String(text == null ? '' : text);
  if (!t.startsWith('SOURCE: DC Hub (dchub.cloud)')) return { header: null, json: t };
  const cut = t.indexOf('\n\n{');
  return cut < 0 ? { header: null, json: t } : { header: t.slice(0, cut), json: t.slice(cut + 2) };
}

// The result with the header leading text block 0, or the result unchanged.
// Reads the plan from structuredContent (the same object block 0 serialises).
export function planFactHeaderStep(result, { skip = false, compact = true, env = process.env } = {}) {
  try {
    if (skip || !compact || !planFactHeaderOn(env)) return result;
    if (!result || typeof result !== 'object' || result.isError || !Array.isArray(result.content)) return result;
    const b0 = result.content[0];
    if (!b0 || b0.type !== 'text' || typeof b0.text !== 'string' || !b0.text.startsWith('{')) return result;
    const header = buildPlanFactHeader(result.structuredContent);
    if (!header) return result;
    return { ...result, content: [{ ...b0, text: `${header}\n\n${b0.text}` }, ...result.content.slice(1)] };
  } catch (_) { return result; }
}
