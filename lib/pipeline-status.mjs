// pipeline-status.mjs -- planner 5.56: a status ask reads the pipeline, and a capacity ask reads both sides.
//
// WHY. Grok's daily MCP note (2026-11-20), live on planner 5.55:
//   item 3  "Which data center campuses are under construction in Northern Virginia, with operator and MW?" routed to
//           facility_search (search_facilities + get_facility + get_grid_intelligence PJM) and led with "PJM demand:
//           95,340 MW". The status words never reached get_pipeline, and grid demand headed a facility question.
//   item 4  "How much data center capacity in Texas is operational versus under construction (MW)?" planned get_pipeline,
//           search_facilities, a timeline backup and source_capacity: no operational count or MW anywhere (the plan's own
//           alternatives rejected get_market_intel), and facts[] said "1 project shown" while paired_sides said "2".
//
// WHAT.
//   * pipelineStatusOf(text): the pipeline status a question asks for: 'construction' (under construction, being
//     built), 'announced' (planned, announced, proposed), 'permitted', 'any' (pipeline alone), or null.
//   * capacityAsksOperational(text): the capacity question asks the operating side (operational, existing, in service)
//     or a total ("how much capacity"); a pipeline-only ask keeps the 5.29 plan.
//   * marketsForState(st): the tracked markets the market brief (get_market_intel) resolves directly in a state, the
//     two largest first. A state is not a market there; these are named market by market, never summed as the state.
//   * buildPipelineStatusAnswer(ctx, executed, fullByEntry): the status ask leads with the projects (name and company,
//     MW where served or the withheld sentence) and the count on record; grid figures never lead.
//   * buildCapacitySidesAnswer(ctx, executed, fullByEntry): the operational side (get_market_intel: facilities tracked
//     and the MW floor of those that report capacity, dated) and the build side (get_pipeline status=construction: the
//     count on record or the withheld sentence). Its pipeline fact is factsFromStep over the same full step result
//     paired_sides reads, so the two never disagree.
// Pure; nothing here throws.

import { spokenDay } from './cite-day.mjs';
import { asOfIsReadTime } from './no-future-day.mjs';
import { factsFromStep, PIPELINE_MW_WITHHELD, MW_NOT_HELD } from './plan-step-facts.mjs';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
// Grok 2026-11-27 cd2: a figure of 1,000 or more is whole and comma-grouped ("7302.1 MW" read as 7,302 MW).
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10));

export const PIPELINE_STATUS_KIND = 'pipeline_status';
export const CAPACITY_SIDES_KIND = 'capacity_sides';

const CONSTRUCTION_RE = /\b(?:under\s+construction|being\s+built|being\s+constructed|in\s+construction|currently\s+building)\b/i;
const ANNOUNCED_RE = /\b(?:planned|announced|proposed|upcoming)\b/i;
const PERMITTED_RE = /\bpermitted\b/i;
const PIPELINE_RE = /\b(?<!gas\s|power\s|generation\s|transmission\s)pipeline\b(?!\s+(?:gas|routes?|operators?))/i;

/** The pipeline status the question asks for, or null when it asks none. */
export function pipelineStatusOf(text) {
  const t = String(text || '').slice(0, 1000);
  if (CONSTRUCTION_RE.test(t)) return 'construction';
  if (PERMITTED_RE.test(t)) return 'permitted';
  if (ANNOUNCED_RE.test(t)) return 'announced';
  if (PIPELINE_RE.test(t)) return 'any';
  return null;
}

// The question asks the built, operating side of capacity (or a total, "how much capacity"), not the pipeline alone.
const OPERATIONAL_RE = /\b(?:operational|operating|existing|in\s+(?:service|operation)|already\s+built|built\s+out|online\s+(?:now|today)|installed)\b|\bhow\s+much\b[^.?!]{0,60}\bcapacity\b/i;
export function capacityAsksOperational(text) { return OPERATIONAL_RE.test(String(text || '').slice(0, 1000)); }

// The markets /api/v1/markets/<slug> resolves on its curated fast path, by state, largest first (dchub-backend
// MARKET_ALIASES). Arizona and New Jersey are curated as themselves.
const STATE_MARKETS = Object.freeze({
  TX: ['dallas', 'houston'], AZ: ['arizona'], VA: ['northern-virginia'], GA: ['atlanta'], IL: ['chicago'],
  CA: ['silicon-valley', 'los-angeles'], NJ: ['new-jersey'], NY: ['new-york'], WA: ['seattle'], CO: ['denver'],
  FL: ['miami'], OH: ['columbus'], UT: ['salt-lake-city'], OR: ['portland'], NV: ['las-vegas', 'reno'],
  MA: ['boston'], MN: ['minneapolis'], MI: ['detroit'], PA: ['philadelphia'], MO: ['kansas-city'],
  NC: ['charlotte', 'raleigh'], TN: ['nashville'], IN: ['indianapolis'],
});
const STATE_WIDE = new Set(['arizona', 'new-jersey']);
/** The tracked markets of a state for the market brief (at most two), or []. */
export function marketsForState(st) {
  const k = typeof st === 'string' ? st.trim().toUpperCase() : '';
  return STATE_MARKETS[k] ? [...STATE_MARKETS[k]] : [];
}
export function marketIsStateWide(slug) { return STATE_WIDE.has(String(slug || '')); }

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
const ran = (e) => isObj(e) && (e.status === 'executed' || e.status === 'gated_preview');
const titled = (s) => one(s).replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
const rowsOf = (p) => (isObj(p) && (Array.isArray(p.projects) ? p.projects : Array.isArray(p.data) ? p.data
  : Array.isArray(p.results) ? p.results : Array.isArray(p.pipeline) ? p.pipeline : null)) || [];
const previewOf = (p) => p.preview_is_partial === true || p.trial_preview === true
  || (Array.isArray(p._locked_fields) && p._locked_fields.some((f) => /capacity/i.test(String(f))));
const STATUS_WORD = { construction: 'Under construction', announced: 'Announced or planned', permitted: 'Permitted', any: 'In the pipeline' };

function pipelineStep(executed) {
  return (Array.isArray(executed) ? executed : []).find((e) => e && e.tool === 'get_pipeline' && ran(e)) || null;
}
function placeOfArgs(args, p) {
  const sc = isObj(p && p.scope) ? p.scope : {};
  return one(sc.market) || titled(args && args.market) || one(args && args.state) || '';
}

/** The status ask's answer: the projects first (name, company, MW or withheld), then the count. */
export function buildPipelineStatusAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || !ctx.status || ctx.intent_class !== 'facility_search') return null;
    const e = pipelineStep(executed);
    if (!e) return null;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (!p) return null;
    const rows = rowsOf(p).filter(isObj);
    const where = placeOfArgs(e.args, p);
    // Grok 2026-11-27 cd1: said as the America/Phoenix day (as_of is the UTC request time when rows carry no date).
    const d = spokenDay(p.as_of) || (isObj(p.citation) ? spokenDay(p.citation.as_of) : null) || day(p.as_of);
    const dw = asOfIsReadTime(p) ? 'read on' : 'as of';
    const label = `${STATUS_WORD[ctx.status] || 'In the pipeline'}${where ? ` in ${where}` : ''}`;
    const fact = factsFromStep('get_pipeline', p, e.args || {})[0] || null;
    const withheld = previewOf(p);
    if (!rows.length) {
      const headline = `${label}: no project on record in this read (DC Hub pipeline${d ? `, ${dw} ${d}` : ''}).`;
      return { kind: PIPELINE_STATUS_KIND, status: ctx.status, headline, evidence: [], facts: fact ? [fact] : [], not_established: [] };
    }
    const shown = rows.slice(0, 5).map((r) => {
      const name = one(r.project) || one(r.name) || 'unnamed project';
      const co = one(r.company) || one(r.developer) || one(r.operator);
      const mw = num(r.capacity_mw) ?? num(r.capacity);
      const size = mw != null && mw > 0 ? `${fmt(mw)} MW` : (withheld ? PIPELINE_MW_WITHHELD : MW_NOT_HELD);
      return `${name} (${co ? `${co}, ` : ''}${size})`;
    });
    const headline = `${label} (DC Hub pipeline${d ? `, ${dw} ${d}` : ''}): ${shown.join('; ')}${rows.length > shown.length ? `; and ${rows.length - shown.length} more` : ''}.`
      + (fact ? ` ${fact.text}` : '');
    return {
      kind: PIPELINE_STATUS_KIND, status: ctx.status, headline,
      evidence: ['Projects from get_pipeline with the status filter; facility-registry and grid reads are context, not the answer.'],
      facts: fact ? [fact] : [],
      not_established: withheld ? ['Project MW is withheld at this access level.'] : [],
    };
  } catch (_e) { return null; }
}

function intelSide(e, p) {
  const st = isObj(p.stats) ? p.stats : {};
  const n = num(st.facility_count);
  if (n == null) return null;
  const where = one(isObj(p.market) && p.market.name) || titled(e.args && e.args.market);
  const d = spokenDay(p.as_of) || (isObj(p.citation) ? spokenDay(p.citation.as_of) : null) || day(p.as_of);
  const mw = num(st.total_power_mw);
  const rep = num(st.mw_reporting_count);
  const text = `${where ? `${where}: ` : ''}${fmt(n)} facilities tracked${mw != null ? `, ${fmt(mw)} MW across the ${rep != null ? `${fmt(rep)} ` : ''}that report capacity (a floor)` : ', MW withheld at this access level'}`
    + ` (DC Hub market brief${d ? `, as of ${d}` : ''})`;
  return { text, as_of: d, where };
}

// Grok 2026-11-27 (cd4): a colocation question that asks capacity or additions ("how much capacity do they have, and
// how much is being added?") reads the market brief and the construction pipeline (lib/colocation-plan.mjs
// coloSupplyAsk). This is its lead: "Phoenix: 246 facilities tracked, 4,323 MW across the 45 that report capacity (a
// floor) (DC Hub market brief, as of ...). Under construction: <named projects> (DC Hub pipeline, as of ...)." null
// when neither step returned a figure.
export function coloSupplyLine(executed, fullByEntry) {
  try {
    const ex = Array.isArray(executed) ? executed : [];
    const full = (e) => parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    const ie = ex.find((e) => e && e.tool === 'get_market_intel' && ran(e));
    const intel = ie && full(ie) ? intelSide(ie, full(ie)) : null;
    const pe = pipelineStep(ex);
    const pp = pe ? full(pe) : null;
    const rows = pp ? rowsOf(pp).filter(isObj) : [];
    const d = pp ? (spokenDay(pp.as_of) || (isObj(pp.citation) ? spokenDay(pp.citation.as_of) : null)) : null;
    const dw = pp && asOfIsReadTime(pp) ? 'read on' : 'as of';
    const names = rows.slice(0, 3).map((r) => {
      const name = one(r.project) || one(r.name);
      const co = one(r.company) || one(r.developer) || one(r.operator);
      return name ? `${name}${co && !name.toLowerCase().includes(co.toLowerCase()) ? ` (${co})` : ''}` : '';
    }).filter(Boolean);
    const build = !pp ? ''
      : names.length ? `Under construction: ${names.join('; ')}${rows.length > names.length ? `; and ${rows.length - names.length} more` : ''} (DC Hub pipeline${d ? `, ${dw} ${d}` : ''}).`
        : `Under construction: no project on record in this read (DC Hub pipeline${d ? `, ${dw} ${d}` : ''}).`;
    if (!intel && !build) return null;
    return { text: [intel ? `${intel.text}.` : '', build].filter(Boolean).join(' '), intel, projects: names };
  } catch (_e) { return null; }
}

// GDL 2026-11-27 (cd2): "which are the largest campuses?" The facility rows of 100 MW or more (search_facilities
// min_capacity_mw, marked largest_campuses by the planner) and the largest projects under construction, names and
// operators, MW only where the row serves it. A size filter the backend did not apply (_params_not_applied) is said:
// the rows are then facilities in the state, not ranked by size. null when neither read named one.
const mwOfRow = (r) => { const v = num(r.power_mw) ?? num(r.capacity_mw) ?? num(r.capacity); return v != null && v > 0 ? v : null; };
function campusName(r) {
  const name = one(r.name) || one(r.project);
  const co = one(r.provider) || one(r.operator) || one(r.company) || one(r.developer);
  const mw = mwOfRow(r);
  const tail = [co && !name.toLowerCase().includes(co.toLowerCase()) ? co : '', mw != null ? `${fmt(mw)} MW` : ''].filter(Boolean).join(', ');
  return name ? `${name}${tail ? ` (${tail})` : ''}` : '';
}
export function largestCampusLine(ex, full, pp, stateName) {
  try {
    const parts = [];
    const se = (Array.isArray(ex) ? ex : []).find((e) => e && e.tool === 'search_facilities' && ran(e) && e.args && e.args.min_capacity_mw != null);
    const sp = se ? full(se) : null;
    if (sp) {
      const rows = rowsOf(sp).filter(isObj);
      const notApplied = Array.isArray(sp._params_not_applied) && sp._params_not_applied.includes('min_capacity_mw');
      const sorted = [...rows].sort((a, b) => (mwOfRow(b) ?? -1) - (mwOfRow(a) ?? -1));
      const names = sorted.map(campusName).filter(Boolean).slice(0, 5);
      if (names.length) {
        parts.push(notApplied
          ? `Facilities in ${stateName || 'the state'} (the 100 MW size filter is not applied at this access level, so these are not ranked by size): ${names.join('; ')}.`
          : `Largest campuses on record in ${stateName || 'the state'} (100 MW or more): ${names.join('; ')}.`);
      }
    }
    const prow = pp ? rowsOf(pp).filter(isObj).filter((r) => mwOfRow(r) != null).sort((a, b) => mwOfRow(b) - mwOfRow(a)) : [];
    if (prow.length) parts.push(`Largest under construction: ${prow.slice(0, 3).map(campusName).filter(Boolean).join('; ')}.`);
    return parts.length ? parts.join(' ') : null;
  } catch (_e) { return null; }
}

/** The capacity ask's answer: the operational side and the build side, each dated. */
export function buildCapacitySidesAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== 'dc_capacity') return null;
    const ex = Array.isArray(executed) ? executed : [];
    const full = (e) => parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    const intel = ex.filter((e) => e.tool === 'get_market_intel' && ran(e) && !e.pair_side)
      .map((e) => { const p = full(e); return p ? intelSide(e, p) : null; }).filter(Boolean);
    const pe = pipelineStep(ex);
    const pp = pe ? full(pe) : null;
    const pf = pp ? factsFromStep('get_pipeline', pp, pe.args || {})[0] || null : null;
    if (!intel.length && !pf) return null;
    const stateName = one(ctx.state_label) || one(ctx.state);
    const opLabel = intel.length > 1 || (ctx.state && intel.length && !intel.every((x) => marketIsStateWide(x.where)))
      ? `Operational, in ${stateName ? `${stateName}'s` : 'the'} tracked market${intel.length === 1 ? '' : 's'} (named one by one, not a state total)`
      : 'Operational';
    const op = intel.length ? `${opLabel}: ${intel.map((x) => x.text).join('; ')}.`
      : 'Operational: no market brief was read in this run, so no operational count is given.';
    const build = pf ? `Under construction: ${pf.text}`
      : 'Under construction: the pipeline step returned no project count in this read.';
    const campus = largestCampusLine(ex, full, pp, stateName);
    const facts = [...intel.map((x) => ({ tool: 'get_market_intel', entity: x.where, as_of: x.as_of, text: `${x.text}.` })), ...(pf ? [pf] : [])];
    return {
      kind: CAPACITY_SIDES_KIND,
      headline: `${op} ${build}${campus ? ` ${campus}` : ''}`,
      evidence: ['Operational figures from get_market_intel (facilities tracked; MW only for those that report capacity, so a floor); the build side from get_pipeline status=construction.'],
      facts,
      not_established: ['A complete operational MW total: many facilities do not report capacity, so the MW figure is a floor.'],
    };
  } catch (_e) { return null; }
}
