// cross-domain-answer.mjs -- planner 5.39: one answer that names both sides, data centers and the power behind them.
//
// WHY. Grok's cross-domain head-to-head (2026-11-17 night, server 2.12.59, planner 5.38) lost 35/60 to Coloprice 41 and
// Colocation Scout 39 on two keyless, compact questions:
//   (a) "Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do
//       grid headroom and the interconnection queue look like there?" routed to interconnection_queue, read no market
//       and no headroom, built no intent_answer, and the lead said "DC Hub ran 3 lookups ...";
//   (b) "For new data center capacity in Northern Virginia, how do wholesale power prices, grid headroom and the PJM
//       queue affect it?" never read get_energy_prices, and its POWER SIDE line said no figure came back while facts[]
//       held PJM's live demand from the same step.
//
// WHAT.
//   * capacityGridAsk(text, d): a size, a data-center capacity noun, a grid-side ask (headroom, queue,
//     interconnection) and no one place named. Such a question is the capacity_grid class: the DCPI-ranked shortlist
//     for the size and deadline (site_selection_canvas), then each finalist grid's queue and headroom (fan-out by
//     ISO), and Capacity Source last (capacityGridSequence).
//   * energyPriceAsk(text) / energyPriceStep(...): power-price wording about one US place adds get_energy_prices for
//     its state when the plan has none. wholesaleAsked(text): the question asked for wholesale / LMP prices, which
//     DC Hub does not serve (WHOLESALE_SCOPE_NOTE says so in the answer).
//   * buildCrossDomainAnswer(ctx, executed, fullByEntry): the intent_answer for a cross-domain plan. Every figure in
//     it comes from a step's own result at the caller's depth, as one dated fact; the facts it used ride in
//     intent_answer.facts, and the compact answer puts them first in facts[] (lib/plan-compact.mjs), so the lead never
//     names a figure that facts[] does not hold. A withheld figure is named as withheld, never estimated.
// Pure; nothing here throws.

import { demandFreshness } from './demand-freshness.mjs';
import { factsFromStep, stepAsOf, stepAsOfRaw } from './plan-step-facts.mjs';
import { spokenDay, phoenixDay } from './cite-day.mjs';
import { gridLabel, whereGridPowerAsk, COUNTY_QUEUE_ISO } from './dc-power-place.mjs';
import { queueCounties } from './intent-answers.mjs';
import { lmpFact, wholesaleContextFacts, wholesaleContextLead, liveLink, noLmpNote } from './energy-answers.mjs';

export const CROSS_DOMAIN_KIND = 'cross_domain';
// Planner 5.40 follow-up (be#8996): wholesale LMP is served by ISO where the ISO's terms allow, so the line is scoped to
// what a state read returns instead of saying DC Hub has no LMP at all.
export const WHOLESALE_SCOPE_NOTE = 'A state power price from DC Hub is the EIA retail rate, not a wholesale price; wholesale LMP is served by ISO (get_energy_prices with iso) only where that ISO\'s terms allow.';
// The headline is the lead's first sentence; the lead holds PLAN_LEAD_MAX (600) characters with its Source, preview
// and pointer lines, so a longer headline would be cut mid-figure. Whole parts only, in priority order.
export const HEADLINE_MAX = 300;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 10) / 10));
const normIso = (v) => { const s = String(v || '').toUpperCase(); return s === 'ISONE' ? 'ISO-NE' : s; };

const DC_CAPACITY_RE = /\b(?:colo(?:cation)?|powered\s+(?:capacity|land|shells?|sites?)|data\s*cent(?:er|re)\s+(?:capacity|space)|wholesale\s+capacity|turnkey|capacity|space|lease|leasing)\b/i;
const GRID_SIDE_RE = /\b(?:grid\s+headroom|headroom|interconnection|queues?|queue\s+depth|grid\s+capacity)\b/i;
const WHERE_RE = /\b(?:where|which\s+(?:markets?|sites?|places?|metros?|regions?)|best|top|options?|find)\b/i;
// "power prices", "wholesale prices", "electricity cost", "energy prices", "LMP": a price ask about power.
const PRICE_RE = /\b(?:(?:wholesale\s+)?(?:power|electricity|energy|electric)\s+(?:prices?|costs?|rates?)|wholesale\s+(?:power\s+|electricity\s+)?(?:prices?|costs?|rates?)|lmps?|locational\s+marginal)\b/i;
const WHOLESALE_RE = /\b(?:wholesale\s+(?:power\s+|electricity\s+|energy\s+)?(?:prices?|costs?|rates?|markets?)|lmps?|locational\s+marginal|spot\s+(?:power|electricity))\b/i;

/** The question asks a power price (retail, wholesale or LMP wording). */
export function energyPriceAsk(text) { return PRICE_RE.test(String(text || '').slice(0, 2000)); }
// Grok -> Brain 2026-11-25: "where is power cheapest" ranks places by power price. PRICE_RE does not read "cheapest"
// (and widening it would move routing), so this wider reading is used ONLY to say when no price step ran.
const PRICE_RANK_RE = /\b(?:cheap(?:est|er)?|least\s+expensive|lowest[-\s]+cost)\s+(?:power|electricity|energy)\b|\b(?:power|electricity|energy)\s+(?:is\s+|are\s+)?(?:the\s+)?(?:cheap(?:est|er)?|least\s+expensive)\b|\blowest\s+(?:power|electricity|energy)\s+(?:prices?|costs?|rates?)\b/i;
/** The tools whose answer is a power or gas price. */
export const PRICE_TOOLS = Object.freeze(['get_energy_prices', 'get_gas_index', 'get_gas_economics']);
export const PRICE_NOT_USED_LINE = 'Power prices were not used to rank: no energy-price step ran for this question. '
  + 'Call get_energy_prices with each finalist\u2019s state for its EIA retail rate.';
/** The question asks a power price or which place has the cheapest power. */
export function priceRankAsk(text) {
  const t = String(text || '').slice(0, 2000);
  return PRICE_RE.test(t) || PRICE_RANK_RE.test(t);
}
/**
 * The dropped_filters entry when the question asked about power price and no price step came back, else null. Pure.
 * A price step that ran (executed or at preview depth) is a price read, so nothing is said.
 */
export function priceNotUsed(text, executed) {
  try {
    if (!priceRankAsk(text)) return null;
    const ran = (Array.isArray(executed) ? executed : []).some((e) => e && PRICE_TOOLS.includes(e.tool)
      && (e.status === 'executed' || e.status === 'gated_preview'));
    if (ran) return null;
    return { step: null, tool: 'execute_plan', param: 'power_price', kind: 'not_used', reason: PRICE_NOT_USED_LINE };
  } catch (_e) { return null; }
}
/** The question asks a wholesale or LMP price, which DC Hub does not serve. */
export function wholesaleAsked(text) { return WHOLESALE_RE.test(String(text || '').slice(0, 2000)); }

// One place the planner bound from the question (a state, a market, a town, a grid, several states or markets).
function placeBound(d) {
  if (!isObj(d)) return false;
  return !!(d.state || d.stateFromPlace || d.iso || d.__citySlug || d.coords
    || (d.__outlook && d.__outlook.slug) || (Array.isArray(d.states) && d.states.length)
    || (Array.isArray(d.__namedMarkets) && d.__namedMarkets.length));
}

/**
 * A capacity + grid question with no place: a size, a data-center capacity noun, a grid-side ask and a "where".
 * "Where can I get 50 MW of colocation ... and what do grid headroom and the interconnection queue look like there?"
 */
export function capacityGridAsk(text, d) {
  try {
    const t = String(text || '').slice(0, 2000);
    const mw = isObj(d) ? num(d.mw) : null;
    if (!mw || mw <= 0) return false;
    if (!DC_CAPACITY_RE.test(t) || !GRID_SIDE_RE.test(t) || !WHERE_RE.test(t)) return false;
    return !placeBound(d);
  } catch (_e) { return false; }
}

// Planner 5.40 follow-up (Grok 1118 item 2): "Which US markets have the most available grid power for a 100 MW data
// center campus running Llama inference, and what does the interconnection queue look like?" carries no capacity noun
// (campus, not capacity/colocation/space), so capacityGridAsk missed it, interconnection_queue won on its own two words,
// and the plan read two ISO-wide queue tables with no market in them. A ranking ask ("which markets", "where") about
// where power is available for a data center, with no place named, is the same shortlist: DCPI-ranked markets first,
// then each finalist grid's queue and headroom. No Capacity Source step: nothing was asked to buy or lease.
const AVAILABLE_POWER_RE = /\b(?:most|more|available|spare|unused|excess|untapped)\s+(?:grid\s+|electric(?:al|ity)?\s+)?(?:power|electricity)\b(?!\s+(?:plants?|purchase|prices?|costs?|rates?))|\bpower\s+(?:is\s+)?availab(?:le|ility)\b|\bmost\s+(?:grid\s+)?headroom\b/i;
const DC_LOAD_RE = /\b(?:data\s*cent(?:er|re)s?|campus(?:es)?|hyperscale|(?:gpu|ai)\s+(?:cluster|campus|factory)|training\s+cluster|inference)\b/i;
const RANK_WHERE_RE = /\b(?:where|which\s+(?:us\s+|u\.s\.\s+)?(?:markets?|metros?|regions?|places?|states?|locations?)|best|top|rank(?:ing|ed)?)\b/i;

/**
 * A where-is-power-available ranking with no place: "which markets have the most available power for a data center".
 * Never true for a single named place (dc_power_place and the place classes read those).
 */
export function powerMarketsAsk(text, d) {
  try {
    const t = String(text || '').slice(0, 2000);
    if (!AVAILABLE_POWER_RE.test(t) || !DC_LOAD_RE.test(t) || !RANK_WHERE_RE.test(t)) return false;
    return !placeBound(d);
  } catch (_e) { return false; }
}

/** The capacity_grid steps: the ranked shortlist, each finalist grid's queue and headroom, Capacity Source last. */
export function capacityGridSequence(d) {
  const mw = isObj(d) && num(d.mw) ? Math.round(d.mw) : null;
  const months = isObj(d) && isObj(d.deadline) && num(d.deadline.months) ? d.deadline.months : null;
  const by = isObj(d) && isObj(d.deadline) && typeof d.deadline.by === 'string' ? d.deadline.by : null;
  return [
    { step: 1, tool: 'site_selection_canvas', depends_on: [], estimated_calls: 1,
      why: `US markets ranked by Data Center Power Index (DCPI) verdict and time to power${mw ? ` for ${mw} MW` : ''}`
        + `${months ? `, held to ${months} months where the caller's access applies the cut` : ''}. Each row names its grid (ISO), which the next two reads take.`,
      args_hint: { ...(mw ? { capacity_mw: mw } : {}), ...(months ? { max_months: months } : {}), limit: 5 } },
    { step: 2, tool: 'get_interconnection_queue', depends_on: [1], estimated_calls: 3,
      why: 'Queue depth (requested generation, GW, with the ISO report date) for each finalist\'s grid: one call per distinct ISO, all parallel.',
      args_hint: { iso: '<ISO serving the finalist market>' } },
    { step: 3, tool: 'get_grid_intelligence', depends_on: [1], estimated_calls: 3,
      why: 'Grid headroom for each finalist\'s grid: average time to power, the DCPI build rate and constraint band, operating reserve, each with its as_of. One call per distinct ISO, all parallel.',
      args_hint: { iso: '<ISO serving the finalist market>' } },
    // 5.41 (Grok 2026-11-18 xd-a): a deadline asks for time-to-power evidence per finalist, so each finalist's state
    // power timeline (EIA-860M firm supply by year) is read too: the shortlist rows carry scores, not MW.
    ...(months ? [{ step: 4, tool: 'get_power_availability_timeline', depends_on: [1], estimated_calls: 3,
      why: 'Dated firm-supply signal (EIA-860M under construction + testing, less retirements) for each finalist\'s state: one call per distinct state, all parallel.',
      args_hint: { state: '<finalist_state of each shortlist row>' } }] : []),
    // A power-availability ranking (powerMarketsAsk) asked nothing to buy or lease: no listings step.
    ...(isObj(d) && d.__powerMarkets ? [] : [
    { step: months ? 5 : 4, tool: 'source_capacity', depends_on: [], estimated_calls: 1, routing: 'capacity_procurement',
      why: 'Listed powered land, powered shells and turnkey capacity in North America that can deliver the size asked: the capacity side of the question.',
      args_hint: { ...(mw ? { min_mw: mw } : {}), region: 'north_america', ...(by ? { available_by: by } : {}) } }]),
  ];
}

/**
 * The get_energy_prices step a price ask about one US place needs, or null. place: { state, label } the plan bound
 * (lib/plan-pairs.mjs pairPlace); tools: the tools already planned.
 */
export function energyPriceStep(text, place, tools) {
  try {
    if (!energyPriceAsk(text)) return null;
    if (Array.isArray(tools) && tools.includes('get_energy_prices')) return null;
    const st = isObj(place) && typeof place.state === 'string' && /^[A-Z]{2}$/.test(place.state) ? place.state : null;
    if (!st) return null;
    const where = place.label ? `${place.label} (${st})` : st;
    return { tool: 'get_energy_prices', depends_on: [], estimated_calls: 1, price_side: true,
      why: `The question asks what power costs in ${where}: the ${st} retail electricity rate (EIA, dated by its last month) and the Henry Hub gas spot. `
        + WHOLESALE_SCOPE_NOTE,
      args_hint: { state: st } };
  } catch (_e) { return null; }
}

// ---- facts, one per figure, each from its own step ----

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
function readSteps(executed, fullByEntry) {
  const out = [];
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (p) out.push({ step: e.step, tool: e.tool, args: e.args || {}, p });
  }
  return out;
}
const headlineOf = (p) => (isObj(p.taste) && isObj(p.taste.headline) ? p.taste.headline : null);

// get_interconnection_queue: requested generation in the ISO queue. Dated by the ISO's own report when it names one,
// else said as when DC Hub collected it (never "as of" a collection time).
export function queueFact(s) {
  const p = s.p;
  const iso = normIso(p.iso || s.args.iso);
  const h = headlineOf(p);
  const gw = num(p.queued_generation_gw) ?? (h && /queued_generation_gw/.test(String(h.name || '')) ? num(h.value) : null)
    ?? num(p.total_gw);
  if (gw == null) return null;
  // 2026-11-27: ERCOT's GW is ERCOT's own report (queued_generation_gw_not_comparable_to names DC Hub's per-project rows),
  // so DC Hub's row count (1,766) is never set beside it; the count is ERCOT's own (1,847 requests in the cited GIS line),
  // or none. The backend's queue page holds the same rule (test_ercot_row_carries_its_report_date_and_published_request_count).
  // A preview carries the same GW as its taste headline, with no marker; the backend sets the marker on ERCOT alone.
  const genGw = num(p.queued_generation_gw) != null || (h && /queued_generation_gw/.test(String(h.name || '')) && num(h.value) != null);
  const ownGw = genGw && (!!p.queued_generation_gw_not_comparable_to || iso === 'ERCOT');
  const cited = ownGw ? /([\d,]+)\s+generation interconnection/i.exec(String(p.queued_generation_gw_source || '')) : null;
  const requests = cited ? num(Number(cited[1].replace(/,/g, ''))) : null;
  const projects = ownGw ? null
    : num(p.project_count) ?? (isObj(p.taste) && isObj(p.taste.project_count) ? num(p.taste.project_count.value) : null);
  // The ISO's own report date first (ERCOT GIS 2026-10-31): a full read carries it as queued_generation_gw_as_of, or as
  // source_as_of beside a basis that names a data date; a live feed's fetch date is never a report date.
  const report = day(p.queued_generation_gw_as_of)
    || (['published_report', 'source_file_date'].includes(p.source_as_of_basis) ? day(p.source_as_of) : null)
    || day(h && h.as_of) || day(isObj(p.taste) && isObj(p.taste.source) ? p.taste.source.as_of : null);
  const collected = day(p.last_refreshed) || day(p.as_of);
  const when = report ? `ISO report, as of ${report}` : collected ? `collected ${collected}` : 'undated';
  return { tool: s.tool, step: s.step, entity: iso, as_of: report || null, ...(report ? {} : { collected_at: collected || null }),
    _gw: gw, _projects: projects,
    text: `${iso} interconnection queue: ${fmt(gw)} GW of requested generation${requests != null ? ` across ${fmt(requests)} requests`
      : projects != null ? ` across ${fmt(projects)} projects` : ''} (${when}; generation, not load or headroom).`,
    short: `${iso} queue ${fmt(gw)} GW (${report ? `as of ${report}` : collected ? `collected ${collected}` : 'undated'})` };
}

// 5.57 (Grok daily 2026-11-20 item 10): "where in Texas" led with "Fisher County (1), Franklin County (1), Leon County (1)
// (3 rows shown of 1,761, not a TX county ranking)", the three rows a preview returned. The by-iso read now carries the
// ISO's own table (summary.by_county: queued MW per county, 193 ERCOT counties). The top three by queued MW lead, each
// with its MW and project count, dated by the table. Only for an ISO whose footprint lies inside the state asked
// (dc-power-place COUNTY_QUEUE_ISO), so every county named is in that state. Queued MW is requested generation.
export function countyQueueFact(s, state) {
  const p = s && s.p;
  const bc = isObj(p) && isObj(p.summary) && isObj(p.summary.by_county) ? p.summary.by_county : null;
  const iso = normIso((bc && bc.iso) || (p && p.iso) || (s && s.args && s.args.iso));
  const st = String(state || '').toUpperCase();
  if (!bc || !st || COUNTY_QUEUE_ISO[st] !== iso) return null;
  const top = (Array.isArray(bc.top) ? bc.top : []).filter((r) => isObj(r) && one(r.county) && num(r.queued_mw) != null)
    .sort((a, b) => b.queued_mw - a.queued_mw).slice(0, 3);
  if (!top.length) return null;
  const d = day(bc.as_of);
  const mw = (v) => fmt(Math.round(v));
  const cty = (r) => `${one(r.county)} County (${mw(r.queued_mw)} MW${num(r.projects) != null ? `, ${fmt(r.projects)} projects` : ''})`;
  const n = num(bc.counties);
  const lead = `Where in ${st}: the ${iso} queue's requested generation is largest in ${top.map(cty).join(', ')}`;
  return { tool: s.tool, step: s.step, entity: st, as_of: d, _rank: -1, _dim: 'place',
    text: `${lead} (${iso} queue by county${n != null ? ` across ${fmt(n)} counties` : ''}${d ? `, as of ${d}` : ''}; queued generation MW, not available load).`,
    short: `${lead} (${iso} queue${d ? `, as of ${d}` : ''}; queued generation MW)`,
    _tight: `${st} top queue counties: ${top.map((r) => `${one(r.county)} ${mw(r.queued_mw)} MW`).join(', ')}${d ? ` (as of ${d})` : ''}` };
}

// 5.42 (Grok 2026-11-18 item 7): one count per GW figure. xd-a said "461.4 GW ... across 1,766 projects (ISO report)"
// and, from the timeline's queue context, "ERCOT's own reported generation queue: 461.4 GW across 1,847 requests": the
// same GW with two unlabelled counts. When the timeline's operator echo repeats a queue GW already read, the queue fact
// carries the operator's own request count and says the queue read's row count with its basis; the echo is not said
// again. Returns true when the echo was folded in.
export function mergeQueueEcho(f, queues) {
  if (!f || !f._echo || num(f._gw) == null || !queues) return false;
  const iso = normIso(f._iso || '');
  const q = queues.get(iso);
  if (!q || num(q._gw) == null || Math.abs(q._gw - f._gw) > 0.05) return false;
  if (q._merged) return true;
  const req = num(f._requests);
  const d = f.as_of || q.as_of;
  q.text = `${iso} interconnection queue: ${fmt(q._gw)} GW of requested generation${req != null ? ` across ${fmt(req)} requests` : ''}`
    + ` (${iso} report${d ? `, as of ${d}` : ''}; generation, not load or headroom).`;
  q._merged = true;
  return true;
}
// The operator echo said alone (no queue read to fold into): ISO-wide, its own report date, said once.
function echoShort(f) {
  const iso = normIso(f._iso || '') || 'Grid operator';
  return `${iso}-wide queue: ${fmt(f._gw)} GW${num(f._requests) != null ? ` across ${fmt(f._requests)} requests` : ''} (${iso} report${f.as_of ? `, as of ${f.as_of}` : ''})`;
}

// 5.42 (Grok 2026-11-18 item 6): each power side the question asked gets one headline slot before anything it did not
// ask. xd-b asked wholesale prices, headroom and the PJM queue; the withheld firm-supply line (timing, not asked) took
// the room and the VA retail rate sat in evidence only.
const ASKED_DIMS = [
  ['queue', /\b(?:queues?|interconnection)\b/i],
  ['headroom', /\b(?:headroom|grid\s+capacity|spare\s+capacity)\b/i],
  // 5.48 (Grok daily 2026-11-19, item 10): "firm supply" names the timeline's EIA-860M firm-supply line.
  // 5.57 (Grok daily 2026-11-20 item 8): "firm power", "firm power supply" and "dispatchable" name it too.
  ['timing', /\b(?:fastest|soonest|quickest|how\s+(?:soon|long|quickly|fast)|time[-\s]to[-\s]power|timelines?|months|firm[-\s]+(?:power\s+)?(?:supply|capacity|generation)|firm\s+power|dispatchable(?:\s+(?:supply|capacity|generation|power))?)\b/i],
  ['feeder', /\b(?:feeders?|hosting\s+capacity|distribution)\b/i],
];
export function askedDims(text, priceAsked) {
  const t = String(text || '').slice(0, 2000);
  const out = new Set(ASKED_DIMS.filter(([, re]) => re.test(t)).map(([k]) => k));
  if (priceAsked) out.add('price');
  return out;
}
// 5.46 (item 10): the operator's queue in GW is its own side beside the state's request count: a queue ask gives each
// one a slot, so "power + queue" no longer said the count and dropped the GW.
const askedHas = (asked, dm) => asked.has(dm) || (dm === 'queue_gw' && asked.has('queue'));
function dimOf(f) {
  if (f._dim) return f._dim;
  if (f.tool === 'get_energy_prices') return 'price';
  if (f.tool === 'get_interconnection_queue' || f._echo) return 'queue_gw';
  if (f.tool === 'get_refined_queue') return 'queue';
  if (f.tool === 'get_grid_intelligence' || f.tool === 'get_retirement_headroom') return 'headroom';
  if (f.tool === 'get_hosting_capacity') return 'feeder';
  if (f.tool === 'get_power_availability_timeline') return 'timing';
  return 'other';
}

// get_grid_intelligence: the headroom figures the caller can read. None readable: say they are withheld, and give the
// live reading the step did return, labelled as load, not headroom.
export function headroomFact(s) {
  const p = s.p;
  const iso = normIso(p.iso || s.args.iso);
  const d = day(p.as_of) || stepAsOf(p);
  const parts = [];
  const ttp = num(p.avg_time_to_power_months);
  if (ttp != null) parts.push(`average time to power ${fmt(ttp)} months`);
  const br = num(p.build_rate_pct);
  if (br != null) parts.push(`${fmt(br)}% of its scored markets rated BUILD`);
  const band = isObj(p.taste) && isObj(p.taste.band) && typeof p.taste.band.constraint === 'string' ? p.taste.band.constraint.trim().toUpperCase() : '';
  if (/^(BUILD|CAUTION|AVOID)$/.test(band)) parts.push(`DCPI constraint band ${band}`);
  const res = num(p.operating_reserve_mw);
  if (res != null) parts.push(`operating reserve ${fmt(Math.round(res))} MW`);
  if (parts.length) {
    return { tool: s.tool, step: s.step, entity: iso, as_of: d,
      text: `${iso} grid headroom: ${parts.join(', ')} (DC Hub grid intelligence${d ? `, as of ${d}` : ''}).`,
      short: `${iso} headroom: ${parts[0]}${d ? ` (as of ${d})` : ''}` };
  }
  const h = headlineOf(p);
  const dm = num(p.demand_mw) ?? (h && h.name === 'demand_mw' ? num(h.value) : null);
  const hd = day(h && h.as_of) || d;
  // GDL 2026-11-25 item 5: the demand hour is a moment, said as its America/Phoenix day (lib/cite-day.mjs phoenixDay):
  // after 00:00 UTC (evening in Phoenix) the UTC cut read "as of 2026-11-26" under a 2026-11-25 answer. as_of keeps
  // the machine day.
  const hdRaw = (h && typeof h.as_of === 'string' && h.as_of) || (typeof p.as_of === 'string' && p.as_of) || stepAsOfRaw(p);
  const hdSaid = phoenixDay(hdRaw) || spokenDay(hdRaw) || hd;
  // GDL 2026-11-26 item 1: an EIA-930 hour older than DEMAND_FRESH_HOURS is not "live demand".
  const fr = dm != null ? demandFreshness({ ...p, ...(hdRaw && !p.demand_period ? { demand_period: hdRaw } : {}) }) : null;
  const loadClause = dm == null ? ''
    : fr && fr.stale ? `; the latest EIA-930 demand reading for ${iso} is ${fr.day}, not shown as a current load`
      // 2026-11-27: when the backend serves the ISO's own real-time load in place of a stale EIA hour (demand_source),
      // the clause names that feed and dates it by the reading's own hour, not the EIA series' older as_of.
      : `; live demand was ${fmt(Math.round(dm))} MW (${typeof p.demand_source === 'string' && p.demand_source
        ? "the ISO's own real-time load" : 'EIA-930 hourly'}${(fr && fr.day) || hdSaid ? `, as of ${(fr && fr.day) || hdSaid}` : ''}), a load reading, not headroom`;
  return { tool: s.tool, step: s.step, entity: iso, as_of: hd, withheld: true,
    text: `${iso} grid headroom (average time to power, DCPI build rate and constraint band, reserves) is withheld at this access level`
      + `${loadClause}.`,
    short: `${iso} headroom withheld` };
}

// A time-to-power question: "how soon / how long ... power", "time to power", "when can ... get power".
const TTP_ASK_RE = /\b(?:how\s+(?:soon|long|quickly|fast)\b[^.?!]{0,120}\b(?:power|energi[sz]e|interconnect)|time[-\s]to[-\s]power|when\s+(?:can|could|will|would)\b[^.?!]{0,120}\b(?:get|have|receive)\s+(?:grid\s+)?power)/i;
export function ttpAsk(text) { return TTP_ASK_RE.test(String(text || '').slice(0, 2000)); }
export const TTP_WITHHELD_LINE = 'Time to power is withheld at this access level.';
const ttpGap = (x) => x === TTP_WITHHELD_LINE || /^No time-to-power figure for /.test(String(x || ''));
// A step that held a time-to-power field back (a *_withheld marker on it, or a partial preview).
function ttpHeldBack(p) {
  if (!isObj(p)) return false;
  if (p._avg_time_to_power_months_withheld === true || p._time_to_power_months_withheld === true) return true;
  if (p.preview_is_partial === true || p.trial_preview === true) return true;
  const c = isObj(p.citation) ? p.citation.completeness : null;
  return c === 'partial_preview';
}
// The market's own served DCPI time to power (get_market_dcpi_rank, get_market_intel siting.dcpi), if a step returned
// one. The grid's average (get_grid_intelligence) is said by headroomFact, so the caller counts that one separately.
function servedTtp(steps, where) {
  for (const s of steps) {
    const dc = s.tool === 'get_market_dcpi_rank' ? s.p : s.tool === 'get_market_intel' && isObj(s.p.siting) && isObj(s.p.siting.dcpi) ? s.p.siting.dcpi : null;
    const m = dc ? num(dc.time_to_power_months) : null;
    if (m == null) continue;
    const d = day(dc.computed_at) || day(dc.as_of) || stepAsOf(s.p);
    const name = one((isObj(s.p.market) && s.p.market.name) || s.p.market_name || where || '');
    const field = s.tool === 'get_market_dcpi_rank' ? 'get_market_dcpi_rank.time_to_power_months' : 'get_market_intel.siting.dcpi.time_to_power_months';
    return { tool: s.tool, step: s.step, entity: name || null, as_of: d,
      text: `${name ? `${name} ` : ''}time to power: ${fmt(m)} months (DC Hub DCPI, ${field}${d ? `, as of ${d}` : ''}).`,
      short: `${name ? `${name} ` : ''}time to power ${fmt(m)} months (DCPI${d ? `, as of ${d}` : ''})` };
  }
  return null;
}

// get_market_intel: the market's data centers (facility count, tracked MW) and its DCPI verdict, each dated by itself.
export function marketIntelFact(s) {
  const p = s.p;
  const st = isObj(p.stats) ? p.stats : {};
  const name = one((isObj(p.market) && p.market.name) || s.args.market || '');
  const asOf = day(p.as_of) || stepAsOf(p);
  const n = num(st.facility_count);
  const mw = num(st.total_power_mw);
  const parts = [];
  if (n != null) parts.push(`${fmt(n)} facilities tracked`);
  if (mw != null) parts.push(`${fmt(mw)} MW across the ${num(st.mw_reporting_count) != null ? `${fmt(st.mw_reporting_count)} ` : ''}that report capacity (a floor)`);
  const dc = isObj(p.siting) && isObj(p.siting.dcpi) ? p.siting.dcpi : null;
  const v = dc && typeof dc.verdict === 'string' ? dc.verdict.trim().toUpperCase() : '';
  const out = [];
  if (parts.length) {
    out.push({ tool: s.tool, step: s.step, entity: name, as_of: asOf,
      text: `${name ? `${name}: ` : ''}${parts.join(', ')} (DC Hub market data${asOf ? `, as of ${asOf}` : ''}).`,
      short: `${[n != null ? `${fmt(n)} facilities` : '', mw != null ? `${fmt(mw)} MW` : ''].filter(Boolean).join(', ')} tracked${asOf ? ` (as of ${asOf})` : ''}` });
  }
  if (/^(BUILD|CAUTION|AVOID)$/.test(v)) {
    const vd = day(dc.as_of);
    const sd = spokenDay(dc.as_of);   // the line's America/Phoenix day (lib/cite-day.mjs); as_of keeps the machine day
    out.push({ tool: s.tool, step: s.step, entity: name, as_of: vd,
      text: `${name ? `${name} ` : ''}Data Center Power Index (DCPI) verdict: ${v}${sd ? ` (as of ${sd})` : ''}.`,
      short: `DCPI ${v}${sd ? ` (as of ${sd})` : ''}` });
  }
  return out;
}

// get_energy_prices: the state's retail rate (its own fact sentence), and a short form for the headline that says
// it is retail when the question asked for wholesale.
export function priceFact(s, wholesale) {
  const f = factsFromStep(s.tool, s.p, s.args)[0];
  if (!f) return null;
  const h = headlineOf(s.p);
  const st = one((isObj(s.p.filter) && s.p.filter.state) || s.args.state || '');
  const v = h && num(h.value) != null ? h.value : null;
  const short = v != null
    ? `${st ? `${st} ` : ''}retail rate ${v} ${one(h.unit) || 'cents/kWh'} (EIA${h.window ? ` ${one(String(h.window))} average` : ''}${f.as_of ? `, as of ${f.as_of}` : ''}${wholesale ? '; not wholesale/LMP' : ''})`
    : f.text.replace(/\.$/, '') + (wholesale ? ' (retail, not wholesale/LMP)' : '');
  // 5.42 (item 6): the short form for a headline with little room left; the basis words stay.
  const tight = v != null ? `${st ? `${st} ` : ''}retail ${v} ${one(h.unit) || 'cents/kWh'} (EIA${f.as_of ? `, as of ${f.as_of}` : ''}${wholesale ? '; not wholesale' : ''})` : null;
  return { ...f, step: s.step, short, ...(tight ? { _tight: tight } : {}) };
}

// site_selection_canvas: the ranked rows (market, state, grid, verdict, time to power when readable).
// A timeline read whose year rows carry unit counts but no MW: the MW columns were held back at this access level.
export function timelineMwWithheld(p) {
  const rows = isObj(p) && Array.isArray(p.timeline) ? p.timeline.filter(isObj) : [];
  return rows.length > 0 && rows.every((r) => num(r.cumulative_firm_signal_mw) == null && num(r.under_construction_mw) == null)
    && rows.some((r) => num(r.units) > 0);
}

export function shortlistRows(s) {
  const rows = Array.isArray(s && s.p && s.p.shortlist) ? s.p.shortlist.filter(isObj) : [];
  return rows.map((r) => ({ market: one(r.market || r.name || r.slug || ''), state: one(r.state || ''), iso: normIso(r.iso),
    verdict: typeof r.verdict === 'string' ? r.verdict.trim().toUpperCase() : (typeof r.composite_score_band === 'string' ? r.composite_score_band : ''),
    ttp: num(r.time_to_power_months), ttp_withheld: r._time_to_power_months_withheld === true, slug: one(r.slug || '') }))
    .filter((r) => r.market);
}

// source_capacity: listings that can deliver the size, or that none is live yet.
export function capacityFact(s, mw) {
  const p = s.p;
  const items = Array.isArray(p.items) ? p.items.filter(isObj) : [];
  const n = num(p.count) ?? items.length;
  const size = mw ? `${fmt(mw)} MW or more` : 'the size asked';
  // When DC Hub checked, said as its America/Phoenix day (lib/cite-day.mjs): a check at 17:40 Phoenix read
  // "(checked 2026-11-25)" off the UTC retrieved_at (Grok Brain 2026-11-24 item 6). A check is a moment, so phoenixDay.
  const rawAt = isObj(p.retrieval_receipt) ? p.retrieval_receipt.retrieved_at : null;
  const at = phoenixDay(rawAt) || day(rawAt);
  if (!n) {
    return { tool: s.tool, step: s.step, entity: 'Capacity Source', as_of: null, ...(at ? { collected_at: at } : {}),
      text: `DC Hub Capacity Source has no live listing of ${size} in North America${at ? ` (checked ${at})` : ''}: the first providers are being onboarded, so no listed building or parcel can be named yet.`,
      short: `no Capacity Source listing of ${size} is live yet` };
  }
  const names = items.slice(0, 3).map((x) => one([x.market, x.state].filter(Boolean).join(', ')) + (num(x.contiguous_kw) != null ? ` (${fmt(Math.round(x.contiguous_kw / 1000))} MW contiguous)` : '')).filter(Boolean);
  return { tool: s.tool, step: s.step, entity: 'Capacity Source', as_of: null, ...(at ? { collected_at: at } : {}),
    text: `DC Hub Capacity Source: ${fmt(n)} listing${n === 1 ? '' : 's'} that can deliver ${size}${names.length ? `, including ${names.join('; ')}` : ''}${at ? ` (checked ${at})` : ''}.`,
    short: `${fmt(n)} Capacity Source listing${n === 1 ? '' : 's'} of ${size}` };
}

const DC_TOOLS = new Set(['site_selection_canvas', 'get_market_intel', 'get_market_dcpi_rank', 'get_pipeline', 'search_facilities', 'source_capacity']);
const POWER_TOOLS = new Set(['get_grid_intelligence', 'get_interconnection_queue', 'get_refined_queue', 'get_energy_prices',
  'get_power_availability_timeline', 'get_grid_data', 'get_retirement_headroom', 'get_hosting_capacity']);

/** A plan whose question asks both sides: a data-center noun and a power-side noun. */
export function crossDomainAsk(text) {
  const t = String(text || '').slice(0, 2000);
  return /\b(?:data\s*cent(?:er|re)s?|colo(?:cation)?|facilit(?:y|ies)|capacity|campus)\b/i.test(t)
    && /\b(?:grid|headroom|interconnection|queues?|power\s+prices?|electricity|energy\s+prices?|wholesale|lmps?)\b/i.test(t);
}

// "Upper Peninsula MI" and "Williston, ND" already carry their state.
const withState = (r) => !!r.state && !new RegExp(`(?:,\\s*|\\s)${r.state}$`).test(r.market);
// "all DCPI BUILD", or each row's verdict when they differ.
function verdictsSaid(rows) {
  const v = [...new Set(rows.map((r) => r.verdict).filter(Boolean))];
  if (!v.length) return 'DCPI verdict not read';
  return v.length === 1 ? `${rows.length > 1 ? 'all ' : ''}DCPI ${v[0]}` : `DCPI ${rows.map((r) => r.verdict || 'not read').join(', ')} in that order`;
}

// Whole parts in order until the headline would pass HEADLINE_MAX.
function fitParts(lead, parts, max = HEADLINE_MAX) {
  let out = lead;
  for (const p of parts) {
    if (!p) continue;
    const next = `${out}${out.endsWith(' ') ? '' : ' '}${p}`;
    if (next.length > max) break;
    out = next;
  }
  return out.trim();
}

/**
 * The intent_answer for a cross-domain plan, or null. ctx: { intent, intent_class, requested_mw, deadline_months,
 * place: { label, state, iso } }. executed: execute_plan's executed[]; fullByEntry: Map entry -> full result.
 */
export function buildCrossDomainAnswer(ctx, executed, fullByEntry) {
  try {
    const intent = String((ctx && ctx.intent) || '');
    const cls = ctx && ctx.intent_class;
    if (cls !== 'capacity_grid' && !crossDomainAsk(intent)) return null;
    const steps = readSteps(executed, fullByEntry);
    // 5.42 (item 12): "where in Texas can I get grid power the fastest" reads no facility step (dc-power-place.mjs).
    const whereGrid = cls === 'dc_power_place' && whereGridPowerAsk(intent);
    if (!(steps.some((s) => DC_TOOLS.has(s.tool)) || whereGrid) || !steps.some((s) => POWER_TOOLS.has(s.tool))) return null;
    const mw = num(ctx.requested_mw);
    const months = num(ctx.deadline_months);
    const wholesale = wholesaleAsked(intent);
    const facts = [];
    const evidence = [];
    const notEstablished = [];
    const add = (f) => { if (f && !facts.some((x) => x.text === f.text)) facts.push(f); return f; };

    const queues = new Map();   // ISO -> fact
    for (const s of steps.filter((x) => x.tool === 'get_interconnection_queue')) {
      const f = queueFact(s); if (f && !queues.has(f.entity)) queues.set(f.entity, add(f));
    }
    const heads = new Map();    // ISO -> fact
    for (const s of steps.filter((x) => x.tool === 'get_grid_intelligence')) {
      const f = headroomFact(s); if (f && !heads.has(f.entity)) heads.set(f.entity, add(f));
    }
    // The ISO-keyed price step (5.40 follow-up: dc_power_place adds it when wholesale is asked on an RTO) carries the
    // wholesale block; the state step carries the retail rate.
    const isWholesaleStep = (x) => x.tool === 'get_energy_prices' && x.args && x.args.iso && !x.args.state;
    const price = steps.filter((x) => x.tool === 'get_energy_prices' && !isWholesaleStep(x)).map((s) => priceFact(s, wholesale)).filter(Boolean).map(add)[0] || null;
    const wsStep = steps.find(isWholesaleStep) || null;
    let wsF = null;
    let wsNote = null;
    if (wsStep) {
      const l = lmpFact(wsStep);
      const c = l ? [] : wholesaleContextFacts(wsStep);
      if (l) wsF = add({ ...l, short: l.text.replace(/\.$/, '') });
      else if (c.length) {
        for (const f of c) add(f);
        // Grok Brain 2026-11-24 item 4: one compact clause built from the served figures (the energy price, then the
        // capacity range over the current delivery years), with a shorter form, so the asked price side fits the lead.
        // The live-price link moves to evidence.
        const lead = wholesaleContextLead(wsStep);
        const link = liveLink(wsStep);
        wsF = lead ? { ...c[0], short: lead.short, _tight: lead.tight, _link: link } : { ...c[0], short: `${c[0]._short}${link ? `; ${link}` : ''}` };
      }
      // Only a response that says why (wholesale_lmp_withheld) gets its own note; one with no wholesale field at all is a
      // backend before be#8996, and the scope line below stays true of it. With published figures quoted, the note says
      // the live LMP is what is not served, so it does not read as contradicting the quoted averages.
      if (!l && isObj(wsStep.p.wholesale_lmp_withheld)) {
        wsNote = noLmpNote(wsStep, normIso(wsStep.args.iso || ''));
        if (c.some((f) => f._energy)) wsNote = wsNote.replace(/ wholesale LMP is not served:/, ' live wholesale LMP is not served (the LMP figures quoted are published report averages):');
      }
    }
    const cap = steps.find((x) => x.tool === 'source_capacity');
    const capF = cap ? add(capacityFact(cap, mw)) : null;
    // Any other power step's dated fact (timeline, refined queue headline, grid data), for the evidence list.
    for (const s of steps.filter((x) => POWER_TOOLS.has(x.tool) && !['get_interconnection_queue', 'get_grid_intelligence', 'get_energy_prices', 'get_hosting_capacity'].includes(x.tool))) {
      for (const f of factsFromStep(s.tool, s.p, s.args).slice(0, 1)) if (!mergeQueueEcho(f, queues)) add(f);
    }
    const canvas = steps.find((x) => x.tool === 'site_selection_canvas');
    let headline = '';
    let geography = '';

    if (cls === 'capacity_grid' && canvas) {
      let rows = shortlistRows(canvas);
      const ttpOn = rows.some((r) => r.ttp != null);
      if (months && ttpOn) rows = rows.filter((r) => r.ttp != null && r.ttp <= months);
      const top = rows.slice(0, 3);
      const cAsOf = stepAsOf(canvas.p);
      // 5.40 (Grok round 2, gap 1): the shortlist carries no data date; its rows say when DC Hub read the DCPI
      // verdicts (a collection date, never an as_of), so no row reads as undated.
      const cRead = cAsOf ? null : day(isObj(canvas.p.citation) ? canvas.p.citation.retrieved_at : null)
        || day(isObj(canvas.p.provenance) ? canvas.p.provenance.retrieved_at : null);
      // The row text says the America/Phoenix day of each (lib/cite-day.mjs); as_of / collected_at keep the machine day.
      // Grok 2026-11-23 17:40 Phoenix: "DCPI verdicts read 2026-11-24" off a 00:40Z retrieved_at.
      const sAsOf = cAsOf ? spokenDay(stepAsOfRaw(canvas.p)) : null;
      const readRaw = [isObj(canvas.p.citation) ? canvas.p.citation.retrieved_at : null,
        isObj(canvas.p.provenance) ? canvas.p.provenance.retrieved_at : null].find((v) => day(v)) || null;
      const sRead = cRead ? spokenDay(readRaw) || cRead : null;
      geography = 'US (DC Hub ranked markets)';
      for (const r of top) {
        const q = queues.get(r.iso);
        const h = heads.get(r.iso);
        const f = add({ tool: canvas.tool, step: canvas.step, entity: r.market, as_of: cAsOf, ...(cRead ? { collected_at: cRead } : {}),
          text: `${r.market}${withState(r) ? `, ${r.state}` : ''} (${r.iso || 'grid not named'}): DCPI ${r.verdict || 'verdict not read'}`
            + `${r.ttp != null ? `, time to power ${fmt(r.ttp)} months` : r.ttp_withheld ? ', time to power withheld at this access level' : ''}`
            + ` (DC Hub site-selection shortlist${cAsOf ? `, as of ${sAsOf || cAsOf}` : cRead ? `, DCPI verdicts read ${sRead}` : ', undated: the shortlist names no as_of'}).` });
        evidence.push(`${f.text.replace(/\.$/, '')}. Queue: ${q ? q.text.replace(/^[A-Z-]+ interconnection queue: /, '') : `${r.iso || 'its grid'} queue not read in this run.`} Headroom: ${h ? h.text.replace(/^[A-Z-]+ grid headroom:? ?/, '') : `${r.iso || 'its grid'} headroom not read in this run.`}`);
      }
      // 5.41 (Grok 2026-11-18 xd-a): each finalist carries its state's dated firm-supply figure when it was read.
      const firmBy = new Map();
      let firmWithheld = false;
      for (const s of steps.filter((x) => x.tool === 'get_power_availability_timeline')) {
        const st = one(s.p.state || (s.args && s.args.state)).toUpperCase();
        const f = factsFromStep(s.tool, s.p, s.args).find((x) => /firm-supply signal/.test(x.text));
        if (f && st && !firmBy.has(st)) firmBy.set(st, add({ ...f, entity: st }));
        else if (!f && timelineMwWithheld(s.p)) firmWithheld = true;
      }
      const firmShort = (r) => {
        const f = firmBy.get(String(r.state || '').toUpperCase());
        const m = f && /(\d{4}) firm-supply signal: ([\d,.]+) MW/.exec(f.text);
        return m ? `${r.state}-wide ${m[1]} firm supply ${m[2]} MW` : '';
      };
      const name = (r) => `${r.market}${withState(r) ? ` ${r.state}` : ''} (${r.iso}${r.ttp != null ? `, ${fmt(r.ttp)} mo` : ''}${firmShort(r) ? `; ${firmShort(r)}` : ''})`;
      // 5.57 (Grok daily 2026-11-20 item 8): the short form a finalist takes when the asked queue GW would not fit.
      const firmMw = (r) => { const f = firmBy.get(String(r.state || '').toUpperCase()); const m = f && /(\d{4}) firm-supply signal: ([\d,.]+) MW/.exec(f.text); return m ? m[2] : ''; };
      const tightName = (r) => `${r.market}${withState(r) ? ` ${r.state}` : ''} (${r.iso}${r.ttp != null ? `, ${fmt(r.ttp)} mo` : ''}${firmMw(r) ? `; firm ${firmMw(r)} MW` : ''})`;
      const isos = [...new Set(top.map((r) => r.iso).filter(Boolean))];
      // 5.39 follow-up (2026-11-18): the lead claimed "with power in under 24 months" while the cut was not applied
      // (time to power withheld keyless; only notEstablished said so). The deadline is claimed only when the rows
      // carry time to power and were filtered by it; otherwise the lead says the cut was not applied (the same length as
      // the old claim, so no queue or headroom figure is pushed out; not_established says why).
      // 5.40 (Grok round 2, gap 1): with the cut not applied the lead says what the rows are, top DCPI-ranked markets
      // for the load, and that the timing was not applied at this access level, before naming any market.
      const verdicts = [...new Set(top.map((r) => r.verdict).filter(Boolean))];
      const what = `${mw ? `${fmt(mw)} MW` : 'Capacity'}${months && ttpOn ? ` with power in under ${months} months` : ''}, US`;
      const noCut = months && !ttpOn;
      // Kept short: the 300-character headline must still hold each finalist grid's queue and headroom.
      const topWhat = `Top ${verdicts.length === 1 ? `DCPI ${verdicts[0]}` : 'DCPI-ranked'} markets for ${mw ? `${fmt(mw)} MW` : 'the load'}`
        + ` (${months}-month cut not applied)`;
      const leadWith = (nm) => (top.length
        ? (noCut ? `${topWhat}: ${top.map(nm).join(', ')}.` : `${what}: ${top.map(nm).join(', ')}; ${verdictsSaid(top)}.`)
        : `${noCut ? topWhat : what}: no ranked market came back${months && ttpOn ? ` within ${months} months` : ''}.`);
      const lead = leadWith(name);
      const qParts = isos.map((i) => queues.get(i)).filter(Boolean).map((f) => f.short);
      const hParts = isos.map((i) => heads.get(i)).filter(Boolean);
      const hShort = hParts.length && hParts.every((f) => f.withheld) ? 'Headroom figures withheld at this access level.'
        : hParts.filter((f) => !f.withheld).map((f) => f.short).join('; ') + (hParts.length ? '.' : '');
      const firmDates = [...new Set(top.map((r) => firmBy.get(String(r.state || '').toUpperCase())).filter(Boolean).map((f) => f.as_of).filter(Boolean))];
      const firmPart = firmBy.size ? `Firm supply: EIA-860M state totals${firmDates.length ? `, as of ${firmDates.join(' / ')}` : ''}.`
        : firmWithheld ? 'State firm-supply MW (EIA-860M) withheld at this access level.' : '';
      const qPart = qParts.length ? `${qParts.join('; ')}.` : '';
      const capPart = capF ? `${capF.short[0].toUpperCase()}${capF.short.slice(1)}.` : '';
      headline = fitParts(lead, [firmPart, qPart, hShort, capPart]);
      // 5.57 (Grok daily 2026-11-20 item 8): xd-a asked for the queue, and the long finalist names with their firm
      // supply filled the 300 characters, so "461.4 GW ERCOT, 256.9 GW MISO" sat in evidence only (fitParts stops at the
      // first part that does not fit). When the asked queue is cut, the finalists take their short form ("firm N MW")
      // and the firm-supply basis its short line, so the queue GW and the firm supply both reach the headline.
      if (qPart && askedDims(intent, false).has('queue') && !headline.includes(qPart)) {
        const firmTight = firmBy.size ? `Firm: EIA-860M state supply${firmDates.length ? `, as of ${firmDates.join(' / ')}` : ''}.` : firmPart;
        const qs = isos.map((i) => queues.get(i)).filter(Boolean);
        const qDates = [...new Set(qs.map((f) => f.as_of).filter(Boolean))];
        const qColl = [...new Set(qs.filter((f) => !f.as_of && f.collected_at).map((f) => f.collected_at))];
        const qWhen = [qDates.length ? `as of ${qDates.join(' / ')}` : '', qColl.length ? `collected ${qColl.join(' / ')}` : ''].filter(Boolean).join('; ');
        const qTight = `Queue: ${qs.map((f) => `${f.entity} ${fmt(f._gw)} GW`).join(', ')}${qWhen ? ` (${qWhen})` : ''}.`;
        const tight = fitParts(leadWith(tightName), [firmTight, qTight, hShort, capPart]);
        if (tight.includes(qTight)) headline = tight;
      }
      const noFirm = top.filter((r) => !firmShort(r)).map((r) => r.market);
      if (firmBy.size && noFirm.length) notEstablished.push(`No dated firm-supply figure came back for ${noFirm.join(', ')}.`);
      if (months && !ttpOn) {
        notEstablished.push(`Time to power is withheld at this access level, so "under ${months} months" was not applied: these are DC Hub's top DCPI-ranked markets, not markets confirmed to deliver power within ${months} months.`);
      }
      if (top.length < 3) notEstablished.push(`The shortlist returned ${top.length} market${top.length === 1 ? '' : 's'}${months && ttpOn ? ` within ${months} months` : ''}, not three.`);
      if (mw) notEstablished.push(`The shortlist is not sized to ${fmt(mw)} MW: its rows carry scores, not megawatts available.`);
    } else {
      // A place: one line per side. 5.40 (Grok round 2): DC side (facilities, MW floor, DCPI, dated), then the power
      // side narrowest first (the state slice of the queue, else the ISO queue; headroom or "withheld"; utility feeder
      // hosting capacity; time to power; price with its basis), then one honest gap. Every power step's dated fact is
      // a candidate, so a run that read Arizona's firm supply never says it read no power figure.
      const place = isObj(ctx.place) ? ctx.place : {};
      const where = one(place.label) || one(place.state) || '';
      const iso = normIso(place.iso || '');
      geography = gridLabel({ ...place, label: where }, iso || null) || (iso || 'the place asked');
      const dcF = [];
      let dcGap = null;
      for (const s of steps.filter((x) => x.tool === 'get_market_intel')) for (const f of marketIntelFact(s)) dcF.push(add(f));
      if (!dcF.length) {
        for (const s of steps.filter((x) => DC_TOOLS.has(x.tool) && x.tool !== 'source_capacity')) {
          for (const f of factsFromStep(s.tool, s.p, s.args).slice(0, 1)) dcF.push(add({ ...f, short: f.text.replace(/\.$/, '') }));
        }
      }
      const pw = [];
      // 5.57 (Grok daily 2026-11-20 item 10): a "where in <state>" power ask leads with the ISO's queued MW by county.
      const byCounty = whereGrid ? steps.map((x) => (x.tool === 'get_interconnection_queue' ? countyQueueFact(x, one(place.state)) : null)).find(Boolean) || null : null;
      if (byCounty) pw.push(add(byCounty));
      const sliceStep = steps.find((x) => x.tool === 'get_refined_queue' && x.args && x.args.state && x.args.status !== 'withdrawn');
      const slice = sliceStep ? factsFromStep(sliceStep.tool, sliceStep.p, sliceStep.args)[0] : null;
      if (slice) {
        const fa = isObj(sliceStep.p.filters_applied) ? sliceStep.p.filters_applied : {};
        const qIso = normIso(fa.iso || sliceStep.args.iso || iso || '');
        const st = one(fa.state || sliceStep.args.state || '');
        // A non-ISO state: no "Queue (GA): 0", and rows from a non-serving ISO named by their source file.
        const covShort = slice._coverage === 'none' ? slice.text.replace(/\s*\(not a count[^)]*\)\.?$/, '')
          : slice._coverage === 'foreign' ? `${fmt(slice._count)} requests ${slice._src ? `from ${slice._src}` : 'from ISO queue files'} located in ${st} (not ${st}'s own queue)${slice.as_of ? ` (as of ${slice.as_of})` : ''}` : null;
        pw.push(add({ ...slice, step: sliceStep.step,
          short: covShort || `${qIso ? `${qIso} queue` : 'Queue'} (${st}): ${fmt(slice._count)} ${slice._status === 'all' ? '' : `${slice._status} `}requests${slice.as_of ? ` (as of ${slice.as_of})` : ''}`,
          _tight: slice._coverage === 'none' ? `${st} outside ISO queue coverage`
            : slice._coverage === 'foreign' ? `${fmt(slice._count)} rows from ${slice._src ? slice._src.replace(/ files?$/, '') : 'ISO queues'} in ${st}`
              : `${st || 'state'} queue ${fmt(slice._count)} requests${slice.as_of ? ` (as of ${slice.as_of})` : ''}` }));
        // 5.42 (item 12): a "where in <state>" ask leads with where the returned requests sit, said as the rows shown.
        // 5.57 (item 10): the ISO's own MW-by-county table, when the run read it, leads instead (countyQueueFact).
        const rowsShown = Array.isArray(sliceStep.p.results) ? sliceStep.p.results.length : 0;
        const counties = whereGrid && !byCounty ? queueCounties(sliceStep.p.results, st) : [];
        if (counties.length) {
          const cText = `${st} queue requests returned sit in ${counties.map((c) => `${c.county} County (${c.n})`).join(', ')}`
            + ` (${fmt(rowsShown)} row${rowsShown === 1 ? '' : 's'} shown of ${fmt(slice._count)}, not a ${st} county ranking)`;
          pw.unshift(add({ tool: sliceStep.tool, step: sliceStep.step, entity: st, as_of: slice.as_of, _rank: -1, _dim: 'place', text: `${cText}.`, short: cText }));
        }
      }
      const queueAsked = askedDims(intent, false).has('queue');
      for (const f of queues.values()) if (!slice || queueAsked) pw.push(f); else if (!evidence.includes(f.text)) evidence.push(f.text);
      if (!slice && sliceStep) notEstablished.push(`The ${one(sliceStep.args.state)} slice of the queue came back with no count at this access level.`);
      for (const f of heads.values()) pw.push(f);
      for (const s of steps.filter((x) => x.tool === 'get_retirement_headroom')) {
        const f = factsFromStep(s.tool, s.p, s.args)[0];
        if (f) pw.push(add({ ...f, step: s.step, short: f.text.replace(/^Filed retirements(?: in [^:]+)?: \d[\d,]* returned; first /, 'filed retirement: ').replace(/ \(EIA-860M.*$/, ' (EIA-860M)') }));
      }
      for (const s of steps.filter((x) => x.tool === 'get_hosting_capacity')) {
        const f = factsFromStep(s.tool, s.p, { ...s.args, place_label: where || null })[0];
        if (f) pw.push(add({ ...f, step: s.step, short: f._short || f.text.replace(/\.$/, '') }));
      }
      for (const s of steps.filter((x) => x.tool === 'get_power_availability_timeline' || x.tool === 'get_grid_data')) {
        // The dated firm-supply figure is the time-to-power evidence: it goes ahead of the operator's queue echo
        // and ranks with the queue slice (Grok 2026-11-18 Q-d: the TX 2026 firm-supply MW never reached the lead).
        const fs = factsFromStep(s.tool, s.p, s.args);
        const firm = fs.find((f) => /firm-supply signal/.test(f.text));
        // 5.46 (item 10): a queue ask keeps the operator's GW beside the firm-supply line instead of dropping it.
        for (const f of firm ? [firm, ...(queueAsked ? fs.filter((x) => x._echo) : [])] : fs.slice(0, 1)) {
          if (mergeQueueEcho(f, queues)) continue;
          pw.push(add({ ...f, step: s.step, ...(f === firm ? { _rank: 0.5 } : {}),
            short: f._echo ? echoShort(f) : f.text.replace(/\s*\((?:EIA|DC Hub)[^)]*\)\.?$/, '').replace(/\.$/, '') + (f.as_of ? ` (as of ${f.as_of})` : ''),
            // 5.46 (item 10): the short forms an asked side falls back to when the headline is nearly full.
            ...(f._echo ? { _tight: `${normIso(f._iso || '') || 'Operator'} queue ${fmt(f._gw)} GW${f.as_of ? ` (as of ${f.as_of})` : ''}` }
              : f === firm ? { _tight: `${one(s.p.state || (s.args && s.args.state)) || 'state'} firm supply ${(/firm-supply signal: ([\d,.]+) MW/.exec(f.text) || [])[1] || '?'} MW${f.as_of ? ` (as of ${f.as_of})` : ''}` } : {}) }));
        }
        if (s.tool === 'get_power_availability_timeline' && !firm && timelineMwWithheld(s.p)) {
          pw.push({ tool: s.tool, step: s.step, _rank: 0.5, withheld: true, text: `${one(s.p.state || (s.args && s.args.state)) || 'The state'}'s EIA-860M firm-supply MW by year is withheld at this access level.`,
            short: `${one(s.p.state || (s.args && s.args.state)) || 'state'} firm-supply MW (EIA-860M) withheld at this access level`,
            _tight: `${one(s.p.state || (s.args && s.args.state)) || 'state'} firm-supply MW withheld` });
        }
      }
      if (price) pw.push({ ...price, _rank: 2 });
      if (wsF) pw.push({ ...wsF, _rank: 1.5 });   // asked for by name: ahead of the retail rate
      // No data-center figure: a power figure that did come back leads, and the gap is said once in not_established
      // instead of "no figure this caller can read came back" ahead of real power data (Grok 2026-11-18 Q-d).
      const dcPart = dcF.length ? `Data centers: ${dcF.map((f) => f.short).join('; ')}.` : pw.some((f) => !f.withheld) || whereGrid ? '' : 'Data centers: no figure this caller can read came back.';
      if (!dcF.length && dcPart === '' && steps.some((x) => DC_TOOLS.has(x.tool))) dcGap = `The ${where || 'place'} facility search returned no data-center figure this caller can read (MW and counts held back at this access level).`;
      headline = fitParts(`${geography}.`, [dcPart]);
      // The power side: whole items picked by priority (the narrowest queue, headroom, then the price the question
      // asked) while they fit, then said in the order above, so a long feeder or timeline line never pushes out a price.
      const rank = (f) => (f._rank != null ? f._rank : f.tool === 'get_refined_queue' || f.tool === 'get_interconnection_queue' ? 0
        : f.tool === 'get_grid_intelligence' || f.tool === 'get_retirement_headroom' ? 1 : 3);
      const said = (set) => pw.filter((f) => set.has(f)).map((f) => f.short).join('; ');
      const asked = askedDims(intent, wholesale || energyPriceAsk(intent));
      const firstOfDim = new Set();
      for (const f of [...pw].sort((a, b) => rank(a) - rank(b))) {
        const dm = dimOf(f);
        if (askedHas(asked, dm) && ![...firstOfDim].some((x) => dimOf(x) === dm)) firstOfDim.add(f);
      }
      const key = (f) => (firstOfDim.has(f) || f._rank === -1 ? 0 : 1);
      // 5.48 (Grok daily 2026-11-19, item 10): when the asked sides do not all fit whole, each one that has a short
      // form takes it first, so a fourth asked side (the queue GW, the firm supply) is not the one cut.
      const asked0 = pw.filter((f) => key(f) === 0);
      if (asked0.length > 1 && `${headline} Power: ${said(new Set(asked0))}.`.length > HEADLINE_MAX) {
        for (const f of asked0) {
          // 5.57: the place lead (where in the state) keeps its whole form; the sides after it shorten first.
          if (!f._tight || f._dim === 'place') continue;
          const t = { ...f, short: f._tight };
          pw.splice(pw.indexOf(f), 1, t);
          if (firstOfDim.delete(f)) firstOfDim.add(t);
        }
      }
      const pick = (base) => {
        const kept = new Set();
        for (const f of [...pw].sort((a, b) => key(a) - key(b) || rank(a) - rank(b))) {
          const trial = new Set([...kept, f]);
          if (`${base} Power: ${said(trial)}.`.length <= HEADLINE_MAX) { kept.add(f); continue; }
          // An asked side that does not fit whole tries its short form.
          if (key(f) === 0 && f._tight && f.short !== f._tight) {
            const t = { ...f, short: f._tight };
            const i = pw.indexOf(f);
            const asked1 = firstOfDim.delete(f);
            pw.splice(i, 1, t);
            if (asked1) firstOfDim.add(t);
            if (`${base} Power: ${said(new Set([...kept, t]))}.`.length <= HEADLINE_MAX) kept.add(t);
            else { pw.splice(i, 1, f); if (asked1) { firstOfDim.delete(t); firstOfDim.add(f); } }
          }
        }
        return kept;
      };
      let keep = pick(headline);
      // 5.57 (Grok daily 2026-11-20 item 8): four asked power sides beside the market's facility line and its DCPI verdict
      // do not fit 300 characters, and one asked side was cut (VA firm supply on xd-b). The data-center side then gives
      // up its second figure (the verdict stays in evidence) before an asked power side is dropped.
      const keptAsked = (k) => pw.filter((f) => key(f) === 0 && k.has(f)).length;
      if (dcF.length > 1 && pw.some((f) => key(f) === 0 && !keep.has(f))) {
        const base2 = fitParts(`${geography}.`, [`Data centers: ${dcF[0].short}.`]);
        const k2 = pick(base2);
        if (keptAsked(k2) > keptAsked(keep)) { headline = base2; keep = k2; }
      }
      const pwPart = keep.size ? `Power: ${said(keep)}` : '';
      headline = `${headline} ${pwPart ? `${pwPart}.` : pw.length ? `Power: ${pw.length} dated figure${pw.length === 1 ? '' : 's'} in facts[].` : 'Power: no figure this caller can read came back.'}`;
      if (wholesale && !price && !wsF) headline = fitParts(headline, ['No wholesale or retail price came back in this run.']);
      for (const f of [...dcF, ...pw]) if (!evidence.includes(f.text)) evidence.push(f.text);
      if (wsF && wsF._link && !evidence.includes(wsF._link)) evidence.push(wsF._link);
      if (energyPriceAsk(intent) && !price) notEstablished.push('No power price was read in this run: call get_energy_prices with the state.');
      const headsAllWithheld = heads.size && [...heads.values()].every((f) => f.withheld);
      if (headsAllWithheld && !notEstablished.length) notEstablished.push('Grid headroom figures (time to power, build rate, reserves) are withheld at this access level.');
      if (dcGap) notEstablished.push(dcGap);
      // 2026-11-23 head-to-head item 7: a time-to-power ask on a place with no US RTO (Phoenix) reads no grid headroom
      // step, so neither the served figure nor the withheld line above ever appeared. The ask gets one of the two.
      if (ttpAsk(intent)) {
        const gridServed = [...heads.values()].some((f) => !f.withheld && /average time to power/.test(f.text));
        const served = gridServed ? null : servedTtp(steps, where || one(place.state));
        if (gridServed) { /* the headroom fact carries the served figure with its date */ } else if (served) {
          if (!facts.some((f) => f.text === served.text)) { add(served); evidence.push(served.text); }
          if (!headline.includes(served.short)) headline = fitParts(headline, [`${served.short}.`]);
        } else if (!notEstablished.some((x) => /time to power/i.test(x))) {
          notEstablished.unshift(steps.some((x) => ttpHeldBack(x.p))
            ? TTP_WITHHELD_LINE
            : `No time-to-power figure for ${where || 'the place'} came back in this run.`);
        }
      }
      // One honest gap, when it fits. The time-to-power gap answers the question asked, so it gets the gap allowance
      // (HEADLINE_MAX + 120) rather than being cut by a long power side.
      if (notEstablished.length) {
        const gap = `Not established: ${notEstablished[0].replace(/\.$/, '')}.`;
        headline = fitParts(headline, [gap], ttpGap(notEstablished[0]) ? HEADLINE_MAX + 120 : HEADLINE_MAX);
      }
    }
    for (const f of facts) if (!evidence.includes(f.text) && !(cls === 'capacity_grid' && (f.tool === 'get_interconnection_queue' || f.tool === 'get_grid_intelligence' || f.tool === 'site_selection_canvas'))) evidence.push(f.text);
    // The scope line only when no wholesale block was read; a read block says itself why it holds no LMP.
    if (wholesale && !wsF && !wsNote) notEstablished.push(WHOLESALE_SCOPE_NOTE);
    if (wsNote && !notEstablished.includes(wsNote)) notEstablished.push(wsNote);
    if (!facts.length) return null;
    const dates = facts.map((f) => f.as_of).filter((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    return {
      kind: CROSS_DOMAIN_KIND, requested_mw: mw, geography, headline, verdict: null, evidence, not_established: notEstablished,
      as_of: dates[0] || null, relay: null,
      source: 'Source: DC Hub (dchub.cloud), each figure dated in its own fact.',
      facts: facts.map(({ short, ...f }) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('_')))),
    };
  } catch (_e) { return null; }
}
