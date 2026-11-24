// execute_plan's compact fact header (Gemini traction spec, 2026-11-16).
//
// Text block 0 of an execute_plan answer is a 20-60 KB JSON object. An agent (Gemini CLI, ADK, any
// host that shows the model the text) has to read deep into it before it knows WHAT was answered,
// for WHICH place and AS OF WHEN. This puts three deterministic lines in the FIRST key of that object,
// `fact_header`, in block 0 and in structuredContent alike:
//
//   SOURCE: DC Hub (dchub.cloud) | AS_OF: <ISO-8601>
//   ENTITY: <market> (market) | <ISO> (ISO) | <facility> (facility)
//   SUMMARY: <metric> | <metric> | Verdict: <BUILD/CAUTION/AVOID>
//
// ★ Block 0 stays valid JSON (brain decision on mcp#1472, 2026-11-16): the header is a key, never a text
//   prefix, so JSON.parse(block0) keeps working on every endpoint (test/block0-is-json-everywhere).
//   2026-11-17 (Grok colocation review): the LAST step of execute_plan then puts a plain-language lead in front
//   (lib/plan-lead-text.mjs), so on the finished answer this JSON, header first, is block 1.
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
//     5.54: when the header prints a DCPI verdict whose own read is newer than that oldest input, AS_OF is
//     the verdict's date (AS_OF_BASIS: DCPI verdict) and the oldest input is named and dated beside it
//     (OLDEST_INPUT, OLDEST_INPUT_AS_OF). See headlineAsOf.
//   * small: at most HEADER_MAX_CHARS.
//
// Where it applies: /mcp and the other non-directory paths. Not on the directory / Claude / core
// profiles (frozen catalogs under review, own scrubs), not on a clean platform (ChatGPT-identified
// clients), and not on an execute_plan loopback step. `compact: false` on the call returns today's
// output; the kill switch DCHUB_PLAN_FACT_HEADER=0 turns it off for every caller.

import { splitLeadingJson } from './facility-location.mjs';
import { planAsOfSteps } from './attribution.mjs';

export const FACT_HEADER_KEY = 'fact_header';
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

// Which input the AS_OF date belongs to (owner 2026-11-18: keep the oldest input's date, name its source). A step is
// named by its scope and what it read: "PJM interconnection queue", "TX power availability timeline". At most two
// steps; null when no executed step carries the date (the header then prints AS_OF alone, as before).
const _INPUT_NAMES = {
  get_market_dcpi_rank: 'DCPI market card', site_selection_canvas: 'site-selection shortlist',
  get_grid_intelligence: 'grid headroom read', get_refined_queue: 'interconnection queue (refined)',
  get_market_intel: 'market intel', rank_markets: 'market ranking',
};
const _inputName = (tool) => _INPUT_NAMES[tool] || String(tool || '').replace(/^get_/, '').replace(/_/g, ' ');
export function oldestInputOf(plan, asOf) {
  const hits = planAsOfSteps(plan, asOf);
  const names = [];
  for (const e of hits) {
    const a = isObj(e.args) ? e.args : {};
    const code = str(a.iso) || str(a.state);   // a grid or state code prints as written: PJM, TX
    const slug = str(a.market) || str(a.market_slug) || str(a.region);   // a slug prints as words: Phoenix, North America
    const scope = code ? code.toUpperCase()
      : slug ? slug.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : '';
    // Grok weekly 2026-11-19 item 3: "Phoenix market intel" read as 50-day-old market data; the dated input was the
    // utility-territory layer inside it (siting.utilities.as_of 2026-09-30, the counts 2026-11-12). Name the layer.
    const r = stepResult(e);
    const layer = r && isObj(r.siting) ? Object.keys(r.siting).find((k) => isObj(r.siting[k])
      && (str(r.siting[k].as_of) || '').slice(0, 10) === String(asOf).slice(0, 10)) : null;
    const n = clean(`${scope ? `${scope} ` : ''}${_inputName(e.tool)}${layer ? ` (${layer} layer)` : ''}`);
    if (n && !names.includes(n)) names.push(n);
  }
  if (!names.length) return null;
  const out = names.length > 2 ? `${names.slice(0, 2).join(' and ')} (+${names.length - 2} more)` : names.join(' and ');
  return out.slice(0, 80);
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
  // 5.34: a site-level band (analyze_site, scope 'site') is not a DCPI verdict; the header prints DCPI only.
  if (ia && isObj(ia.verdict) && ia.verdict.scope !== 'site') cands.push(ia.verdict.value);
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

// A one-state ask (Grok midday re-run 2026-11-17, Q-d): the answer's lead said "TX (mostly ERCOT)" while this
// header said "ERCOT (ISO) | SPP (ISO) | MISO (ISO) | WECC (ISO)", the union of every grid touching Texas.
// The state is read from the answer's own geography (lib/intent-answers.mjs scope): "TX (mostly ERCOT)" names
// the state and its main grid only; a split with no main grid ("IL (PJM/MISO)") names the state and keeps the grids.
const STATE_SCOPE = /^([A-Z]{2}) \((?:mostly ([A-Z][A-Z0-9-]*)|(?!ISO\))[A-Z][A-Z0-9/-]*)\)$/;
function stateScopeOf(plan) {
  const g = isObj(plan.intent_answer) ? str(plan.intent_answer.geography) : null;
  const m = g ? STATE_SCOPE.exec(g) : null;
  return m ? { state: m[1], primary: m[2] || null } : null;
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

const _day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// The queue figure, named by the read it came from (Grok live proof 2026-11-16, item 3). ERCOT's header said
// "Queue 446,266 MW" (get_refined_queue.total_queued_mw: DC Hub's sum over its per-project rows that passed the
// plan's min_mw floor) while the same answer cited ERCOT's GIS Summary, 461,414 MW over 1,847 requests
// (get_interconnection_queue.queued_generation_gw). Two measures under one word. The ISO-level generation queue
// leads, with its own date; the row sum is printed only without it, and says it is a row sum.
function queueOf(plan) {
  let rows = null;
  for (const e of steps(plan)) {
    const r = stepResult(e);
    if (!r || !RAN.has(e.status)) continue;
    if (e.tool === 'get_interconnection_queue') {
      const h = isObj(r.taste) && isObj(r.taste.headline) && r.taste.headline.name === 'queued_generation_gw' ? r.taste.headline : null;
      const gw = num(r.queued_generation_gw) ?? (h ? num(h.value) : null);
      if (gw != null) {
        // A report date is "as of"; a live feed with no report date (PJM: source_as_of_basis live_feed_fetch_date)
        // is "collected", as the plan's answer_guide tells the agent to say it.
        const reported = _day(r.queued_generation_gw_as_of) || (r.source_as_of_basis !== 'live_feed_fetch_date' ? _day(r.source_as_of) : null)
          || (h ? _day(h.as_of) : null);
        const collected = reported ? null : (_day(r.last_refreshed) || _day(r.source_as_of));
        const when = reported ? `, as of ${reported}` : (collected ? `, collected ${collected}` : '');
        return `Generation queue ${fmtNum(gw)} GW (get_interconnection_queue${when})`;
      }
    }
    if (rows == null && e.tool === 'get_refined_queue' && num(r.total_queued_mw) != null) {
      const floor = isObj(r.filters_applied) ? num(r.filters_applied.min_mw) : null;
      rows = `Queue rows sum ${fmtNum(r.total_queued_mw, 0)} MW (get_refined_queue${floor != null ? `, rows of ${fmtNum(floor, 0)} MW or more` : ''})`;
    }
  }
  return rows;
}

function metricsOf(plan) {
  const out = [];
  const score = scoreOf(plan);
  if (score != null) out.push(`DCPI ${fmtNum(score)}/100`);
  let ttp = null, mw = null;
  for (const e of steps(plan)) {
    const r = stepResult(e);
    if (!r || !RAN.has(e.status)) continue;
    if (ttp == null && num(r.time_to_power_months) != null) ttp = r.time_to_power_months;
    const siting = isObj(r.siting) ? r.siting : null;
    if (mw == null && siting && isObj(siting.mw) && num(siting.mw.total_mw) != null) mw = siting.mw.total_mw;
  }
  if (ttp != null) out.push(`Time to power ${fmtNum(ttp)} months`);
  if (mw != null) out.push(`Tracked ${fmtNum(mw, 0)} MW`);
  const queue = queueOf(plan);
  if (queue) out.push(queue);
  return out;
}

// A head-to-head (intent_class market_comparison) with a DCPI read for two or more markets (Grok live proof
// 2026-11-16, item 2): "compare Phoenix vs Columbus" printed ENTITY Phoenix only, SUMMARY Phoenix's score and
// time to power, and AS_OF 2026-09-30 (a curated utilities list inside get_market_intel) over two DCPI reads
// computed 2026-11-16T18:29Z. Here every market is named, the SUMMARY holds only the DCPI reads' own figures,
// and AS_OF is the oldest of those reads' own dates, as dcpi_verdict.cite does (mcp#1489).
const COMPARED_READ_CLASSES = new Set(['market_comparison', 'iso_comparison', 'grid_headroom', 'interconnection_queue', 'power_timeline']);
function comparedReads(plan) {
  // 5.58 (agent-incentive round 2026-11-21): a grid plan whose question named two or more markets reads each market's
  // DCPI card (server.mjs _PLAN_GRID_CLASSES_NAMED_MARKETS); its header leads with those verdicts the same way, with
  // the grids after the markets in ENTITY and one AS_OF (the oldest DCPI read).
  if (!COMPARED_READ_CLASSES.has(plan.intent_class)) return null;
  const reads = [];
  const seen = new Set();
  for (const e of steps(plan)) {
    const r = stepResult(e);
    if (e.tool !== 'get_market_dcpi_rank' || !RAN.has(e.status) || !r) continue;
    const v = str(r.verdict) && str(r.verdict).toUpperCase();
    if (!v || !VERDICTS.has(v)) continue;
    const a = isObj(e.args) ? e.args : {};
    const name = str(r.market_name) || str(a.market_slug) || str(r.market_slug);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const when = [r.computed_at, isObj(r.citation) ? r.citation.as_of : null, isObj(r.provenance) ? r.provenance.as_of : null]
      .map(str).find((x) => x && ISO_8601.test(x)) || null;
    reads.push({ name, verdict: v, score: num(r.composite_score), ttp: num(r.time_to_power_months), when });
  }
  return reads.length >= 2 ? reads : null;
}

// "2026-11-16T18:29:35.298825+00:00" -> "2026-11-16T18:29Z" (UTC); a date stays a date.
function minuteUtc(s) {
  if (!/T/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16) + 'Z' : null;
}

// 2026-11-24 (owner daily recheck, 00:55 Phoenix): the header printed "AS_OF: 2026-11-24T06:25Z" and
// "OLDEST_INPUT_AS_OF: 2026-11-23T04:00:00.000Z" while every spoken line beside it says the America/Phoenix day or
// clock (lib/cite-day.mjs). Every date the header PRINTS goes through phoenixStamp: a plain date stays that date; a
// timestamp at exactly midnight UTC (or with no zone and no time) is a date serialized as a timestamp and keeps its
// own date; any other timestamp becomes its America/Phoenix minute with the offset written out
// ("2026-11-24T06:25Z" -> "2026-11-23T23:25-07:00"), still ISO-8601, so a parser reads the same instant.
// Comparisons (headlineAsOf) still run on the raw values; only the printed text changes. Phoenix keeps no DST.
// Kill: DCHUB_PLAN_HEADER_PHOENIX=0 prints the UTC forms again.
const PHX_MS = -7 * 3600e3;
export function headerPhoenixOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_PLAN_HEADER_PHOENIX) || '').trim());
}
export function phoenixStamp(v) {
  const s = str(v);
  if (!s) return null;
  if (!headerPhoenixOn()) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}[T ]00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?$/.test(s)) return s.slice(0, 10);
  const norm = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, (_m, a, b) => `${a}T${b}`);
  const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(norm) ? norm : `${norm}Z`);
  if (!Number.isFinite(t)) return s;
  return `${new Date(t + PHX_MS).toISOString().slice(0, 16)}-07:00`;
}

function comparisonHeader(plan, reads) {
  const whens = reads.map((x) => x.when).filter(Boolean)
    .map((w) => ({ w, t: Date.parse(w) })).filter((x) => Number.isFinite(x.t)).sort((p, q) => p.t - q.t);
  const asOf = whens.length === reads.length ? phoenixStamp(minuteUtc(whens[0].w)) : null;   // every read dated, or none printed
  const lines = [`SOURCE: DC Hub (dchub.cloud)${asOf ? ` | AS_OF: ${asOf}` : ''}`];
  const ent = reads.map((x) => clean(x.name)).filter(Boolean).map((n) => `${n} (market)`);
  const nMarkets = ent.length;
  for (const iso of isosOf(plan)) { const c = clean(iso); if (c) ent.push(`${c} (ISO)`); }
  lines.push(`ENTITY: ${ent.join(' | ')}`);
  const sum = reads.map((x) => clean(`${x.name} DCPI ${x.verdict}${x.score != null ? ` ${fmtNum(x.score)}/100` : ''}`
    + (x.ttp != null ? `, time to power ${fmtNum(x.ttp)} months` : ''))).filter(Boolean);
  lines.push(`SUMMARY: ${sum.join(' | ')}`);
  let text = lines.join('\n');
  // Trim ISOs before markets, and never drop a compared market from ENTITY.
  while (text.length > HEADER_MAX_CHARS && ent.length > nMarkets) {
    ent.pop();
    lines[1] = `ENTITY: ${ent.join(' | ')}`;
    text = lines.join('\n');
  }
  return text.length > HEADER_MAX_CHARS ? lines.slice(0, 2).join('\n').slice(0, HEADER_MAX_CHARS) : text;
}

// 5.48 (Grok daily 2026-11-19, item 5): an energy-price answer that leads with a real-time (or day-ahead) LMP is
// dated by that interval, not by the oldest input: the "e1" Source line said "as of 2026-08-31" (the EIA retail month)
// beside a live LMP. The retail month is said as context, and only when the retail figure is in the answer.
// { asOf, retail } or null when the answer does not lead with an LMP.
export function priceNowDates(plan) {
  try {
    const ia = isObj(plan) && isObj(plan.intent_answer) ? plan.intent_answer : null;
    if (!ia || ia.kind !== 'price_now') return null;
    const head = str(ia.as_of);
    if (!head || !ISO_8601.test(head)) return null;
    const facts = Array.isArray(ia.facts) ? ia.facts.filter(isObj) : [];
    const lmp = facts.find((f) => /\bLMP:/.test(str(f.text) || '') && str(f.as_of) === head);
    if (!lmp || !String(ia.headline || '').startsWith(str(lmp.text).slice(0, 40))) return null;
    const r = facts.find((f) => f.tool === 'get_energy_prices' && /\belectricity rate:/i.test(str(f.text) || '') && str(f.as_of)
      && ISO_8601.test(str(f.as_of)));
    return { asOf: head, retail: r && str(r.as_of) !== head ? str(r.as_of) : null };
  } catch (_e) { return null; }
}

// 5.54 (Grok QA 2026-11-20, item 5): a Dallas siting answer led with a DCPI verdict computed that day, yet its header
// read "AS_OF: 2026-10-31", ERCOT's October GIS report (posted 11-02, the latest ERCOT has published; the next is due
// early December), so the answer looked 20 days stale. When the header prints a DCPI verdict and that verdict's own
// read is dated AFTER the oldest input, AS_OF is the verdict's date (AS_OF_BASIS says so), and the oldest input keeps
// its name and its own date beside it (OLDEST_INPUT, OLDEST_INPUT_AS_OF). Nothing older is presented as fresh: the
// old date is still printed, and a plan with no dated verdict (or a verdict no newer than the oldest input) is unchanged.
// The verdict's DCPI step: the executed get_market_dcpi_rank whose verdict is the header's, for the verdict's market
// when the plan names one. Its date (a date stays a date; a time prints to the minute, UTC), or null.
function verdictReadAsOf(plan, verdict) {
  if (!verdict) return null;
  const ia = isObj(plan.intent_answer) ? plan.intent_answer : null;
  const subject = (str(isObj(plan.dcpi_verdict) ? plan.dcpi_verdict.market_slug : null)
    || str(ia && isObj(ia.verdict) ? ia.verdict.subject : null) || '').toLowerCase();
  for (const e of steps(plan)) {
    const r = stepResult(e);
    if (e.tool !== 'get_market_dcpi_rank' || !RAN.has(e.status) || !r) continue;
    if ((str(r.verdict) || '').toUpperCase() !== verdict) continue;
    const a = isObj(e.args) ? e.args : {};
    const names = [r.market_slug, a.market_slug, a.market, r.market_name].map(str).filter(Boolean).map((x) => x.toLowerCase());
    if (subject && !names.some((n) => n === subject || n.startsWith(`${subject}-`) || subject.startsWith(`${n}-`))) continue;
    const when = [r.computed_at, isObj(r.citation) ? r.citation.as_of : null, isObj(r.provenance) ? r.provenance.as_of : null]
      .map(str).find((x) => x && ISO_8601.test(x));
    if (when && !/T/.test(when)) return when.slice(0, 10);   // a date stays a date: no time of day is invented
    const t = when ? Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(when) ? when : `${when}Z`) : NaN;
    if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 16) + 'Z';   // to the minute, UTC, as comparisonHeader prints DCPI reads
  }
  return null;
}
function headlineAsOf(plan, oldestAsOf) {
  const t0 = Date.parse(oldestAsOf);
  const v = verdictReadAsOf(plan, verdictOf(plan));
  return v && Number.isFinite(t0) && Date.parse(v) > t0 ? v : null;
}

// The three lines, or null when `plan` is not an execute_plan answer.
export function buildPlanFactHeader(plan) {
  if (!isObj(plan) || plan._entity !== 'plan_execution') return null;
  const compared = comparedReads(plan);
  if (compared) return comparisonHeader(plan, compared);
  const pn = priceNowDates(plan);
  const asOf = pn ? pn.asOf : isoAsOf(plan);   // validated ISO-8601 above: no separator or newline can ride it
  const oldest = asOf && !pn ? oldestInputOf(plan, asOf) : null;   // clean()ed: no separator either
  const head = asOf && !pn ? headlineAsOf(plan, asOf) : null;     // a date or YYYY-MM-DDTHH:MMZ: no separator either
  // Printed in America/Phoenix (phoenixStamp); the comparisons above ran on the raw values.
  const pAsOf = asOf ? phoenixStamp(asOf) : null;
  const lines = [head
    ? `SOURCE: DC Hub (dchub.cloud) | AS_OF: ${phoenixStamp(head)} | AS_OF_BASIS: DCPI verdict${oldest ? ` | OLDEST_INPUT: ${oldest}` : ''} | OLDEST_INPUT_AS_OF: ${pAsOf}`
    : `SOURCE: DC Hub (dchub.cloud)${pAsOf ? ` | AS_OF: ${pAsOf}` : ''}${oldest ? ` | OLDEST_INPUT: ${oldest}` : ''}`
    + (pn && pn.retail ? ` | RETAIL_CONTEXT_AS_OF: ${phoenixStamp(pn.retail)}` : '')];
  const ent = [];
  const mk = clean(marketOf(plan));
  if (mk) ent.push(`${mk} (market)`);
  const st = stateScopeOf(plan);
  if (st) ent.push(`${st.state} (state)`);
  const isos = st && st.primary ? [st.primary] : isosOf(plan);
  for (const iso of isos) {
    const c = clean(iso);
    if (c) ent.push(`${c} (ISO${st && st.primary ? `, most of ${st.state}` : ''})`);
  }
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

// The result with `fact_header` as the FIRST key of block 0's JSON object and of structuredContent,
// or the result unchanged. Reads the plan from structuredContent (the same object block 0 serialises).
export function planFactHeaderStep(result, { skip = false, compact = true, env = process.env } = {}) {
  try {
    if (skip || !compact || !planFactHeaderOn(env)) return result;
    if (!result || typeof result !== 'object' || result.isError || !Array.isArray(result.content)) return result;
    const sc = result.structuredContent;
    if (!isObj(sc) || Object.prototype.hasOwnProperty.call(sc, FACT_HEADER_KEY)) return result;
    const b0 = result.content[0];
    if (!b0 || b0.type !== 'text' || typeof b0.text !== 'string') return result;
    const sp = splitLeadingJson(b0.text);
    if (!sp || !isObj(sp.json) || Object.prototype.hasOwnProperty.call(sp.json, FACT_HEADER_KEY)) return result;
    const header = buildPlanFactHeader(sc);
    if (!header) return result;
    const text = sp.head + JSON.stringify({ [FACT_HEADER_KEY]: header, ...sp.json }) + sp.rest;
    return {
      ...result,
      content: [{ ...b0, text }, ...result.content.slice(1)],
      structuredContent: { [FACT_HEADER_KEY]: header, ...sc },
    };
  } catch (_) { return result; }
}
