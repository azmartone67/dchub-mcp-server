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

import { factsFromStep, stepAsOf } from './plan-step-facts.mjs';

export const CROSS_DOMAIN_KIND = 'cross_domain';
export const WHOLESALE_SCOPE_NOTE = 'DC Hub serves EIA retail electricity rates and the Henry Hub natural-gas spot, not wholesale power prices or LMPs.';
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
    { step: 4, tool: 'source_capacity', depends_on: [], estimated_calls: 1, routing: 'capacity_procurement',
      why: 'Listed powered land, powered shells and turnkey capacity in North America that can deliver the size asked: the capacity side of the question.',
      args_hint: { ...(mw ? { min_mw: mw } : {}), region: 'north_america', ...(by ? { available_by: by } : {}) } },
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
  const projects = num(p.project_count) ?? (isObj(p.taste) && isObj(p.taste.project_count) ? num(p.taste.project_count.value) : null);
  const report = day(h && h.as_of) || day(isObj(p.taste) && isObj(p.taste.source) ? p.taste.source.as_of : null);
  const collected = day(p.last_refreshed) || day(p.as_of);
  const when = report ? `ISO report, as of ${report}` : collected ? `collected ${collected}` : 'undated';
  return { tool: s.tool, step: s.step, entity: iso, as_of: report || null, ...(report ? {} : { collected_at: collected || null }),
    text: `${iso} interconnection queue: ${fmt(gw)} GW of requested generation${projects != null ? ` across ${fmt(projects)} projects` : ''} (${when}; generation, not load or headroom).`,
    short: `${iso} queue ${fmt(gw)} GW (${report ? `as of ${report}` : collected ? `collected ${collected}` : 'undated'})` };
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
  return { tool: s.tool, step: s.step, entity: iso, as_of: hd, withheld: true,
    text: `${iso} grid headroom (average time to power, DCPI build rate and constraint band, reserves) is withheld at this access level`
      + `${dm != null ? `; live demand was ${fmt(Math.round(dm))} MW (EIA-930 hourly${hd ? `, as of ${hd}` : ''}), a load reading, not headroom` : ''}.`,
    short: `${iso} headroom figures withheld` };
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
    out.push({ tool: s.tool, step: s.step, entity: name, as_of: vd,
      text: `${name ? `${name} ` : ''}Data Center Power Index (DCPI) verdict: ${v}${vd ? ` (as of ${vd})` : ''}.`,
      short: `DCPI ${v}${vd ? ` (as of ${vd})` : ''}` });
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
  return { ...f, step: s.step, short };
}

// site_selection_canvas: the ranked rows (market, state, grid, verdict, time to power when readable).
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
  const at = day(isObj(p.retrieval_receipt) ? p.retrieval_receipt.retrieved_at : null);
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
  'get_power_availability_timeline', 'get_grid_data', 'get_retirement_headroom']);

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
    if (!steps.some((s) => DC_TOOLS.has(s.tool)) || !steps.some((s) => POWER_TOOLS.has(s.tool))) return null;
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
    const price = steps.filter((x) => x.tool === 'get_energy_prices').map((s) => priceFact(s, wholesale)).filter(Boolean).map(add)[0] || null;
    const cap = steps.find((x) => x.tool === 'source_capacity');
    const capF = cap ? add(capacityFact(cap, mw)) : null;
    // Any other power step's dated fact (timeline, refined queue headline, grid data), for the evidence list.
    for (const s of steps.filter((x) => POWER_TOOLS.has(x.tool) && !['get_interconnection_queue', 'get_grid_intelligence', 'get_energy_prices'].includes(x.tool))) {
      for (const f of factsFromStep(s.tool, s.p, s.args).slice(0, 1)) add(f);
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
      geography = 'US (DC Hub ranked markets)';
      for (const r of top) {
        const q = queues.get(r.iso);
        const h = heads.get(r.iso);
        const f = add({ tool: canvas.tool, step: canvas.step, entity: r.market, as_of: cAsOf,
          text: `${r.market}${withState(r) ? `, ${r.state}` : ''} (${r.iso || 'grid not named'}): DCPI ${r.verdict || 'verdict not read'}`
            + `${r.ttp != null ? `, time to power ${fmt(r.ttp)} months` : r.ttp_withheld ? ', time to power withheld at this access level' : ''}`
            + ` (DC Hub site-selection shortlist${cAsOf ? `, as of ${cAsOf}` : ', undated: the shortlist names no as_of'}).` });
        evidence.push(`${f.text.replace(/\.$/, '')}. Queue: ${q ? q.text.replace(/^[A-Z-]+ interconnection queue: /, '') : `${r.iso || 'its grid'} queue not read in this run.`} Headroom: ${h ? h.text.replace(/^[A-Z-]+ grid headroom:? ?/, '') : `${r.iso || 'its grid'} headroom not read in this run.`}`);
      }
      const name = (r) => `${r.market}${withState(r) ? ` ${r.state}` : ''} (${r.iso}${r.ttp != null ? `, ${fmt(r.ttp)} mo` : ''})`;
      const isos = [...new Set(top.map((r) => r.iso).filter(Boolean))];
      const lead = top.length
        ? `${mw ? `${fmt(mw)} MW` : 'Capacity'}${months ? ` with power in under ${months} months` : ''}, US: ${top.map(name).join(', ')}`
          + `; ${verdictsSaid(top)}.`
        : `${mw ? `${fmt(mw)} MW` : 'Capacity'}${months ? ` with power in under ${months} months` : ''}, US: no ranked market came back${months && ttpOn ? ` within ${months} months` : ''}.`;
      const qParts = isos.map((i) => queues.get(i)).filter(Boolean).map((f) => f.short);
      const hParts = isos.map((i) => heads.get(i)).filter(Boolean);
      const hShort = hParts.length && hParts.every((f) => f.withheld) ? 'Headroom figures withheld at this access level.'
        : hParts.filter((f) => !f.withheld).map((f) => f.short).join('; ') + (hParts.length ? '.' : '');
      headline = fitParts(lead, [qParts.length ? `${qParts.join('; ')}.` : '', hShort, capF ? `${capF.short[0].toUpperCase()}${capF.short.slice(1)}.` : '']);
      if (months && !ttpOn) {
        notEstablished.push(`Time to power is withheld at this access level, so "under ${months} months" was not applied: these are DC Hub's top DCPI-ranked markets, not markets confirmed to deliver power within ${months} months.`);
      }
      if (top.length < 3) notEstablished.push(`The shortlist returned ${top.length} market${top.length === 1 ? '' : 's'}${months && ttpOn ? ` within ${months} months` : ''}, not three.`);
      if (mw) notEstablished.push(`The shortlist is not sized to ${fmt(mw)} MW: its rows carry scores, not megawatts available.`);
    } else {
      // A place: one line per side.
      const place = isObj(ctx.place) ? ctx.place : {};
      const where = one(place.label) || one(place.state) || '';
      const iso = normIso(place.iso || '');
      geography = where ? `${where}${iso ? ` (${iso})` : ''}` : (iso || 'the place asked');
      const dcF = [];
      for (const s of steps.filter((x) => x.tool === 'get_market_intel')) for (const f of marketIntelFact(s)) dcF.push(add(f));
      if (!dcF.length) {
        for (const s of steps.filter((x) => DC_TOOLS.has(x.tool) && x.tool !== 'source_capacity')) {
          for (const f of factsFromStep(s.tool, s.p, s.args).slice(0, 1)) dcF.push(add({ ...f, short: f.text.replace(/\.$/, '') }));
        }
      }
      const pw = [];
      for (const f of queues.values()) pw.push(f);
      if (price) pw.push(price);
      for (const f of heads.values()) pw.push(f);
      const dcPart = dcF.length ? `Data centers: ${dcF.map((f) => f.short).join('; ')}.` : 'Data centers: no figure this caller can read came back.';
      headline = fitParts(`${geography}.`, [dcPart]);
      // The power side item by item (queue, price, headroom), as many whole items as fit.
      let pwPart = '';
      for (const f of pw) {
        const next = pwPart ? `${pwPart}; ${f.short}` : `Power: ${f.short}`;
        if (`${headline} ${next}.`.length > HEADLINE_MAX) break;
        pwPart = next;
      }
      headline = `${headline} ${pwPart ? `${pwPart}.` : 'Power: no figure this caller can read came back.'}`;
      if (wholesale && !price) headline = fitParts(headline, ['DC Hub has no wholesale/LMP prices.']);
      for (const f of [...dcF, ...pw]) evidence.push(f.text);
      if (energyPriceAsk(intent) && !price) notEstablished.push('No power price was read in this run: call get_energy_prices with the state.');
    }
    for (const f of facts) if (!evidence.includes(f.text) && !(cls === 'capacity_grid' && (f.tool === 'get_interconnection_queue' || f.tool === 'get_grid_intelligence' || f.tool === 'site_selection_canvas'))) evidence.push(f.text);
    if (wholesale) notEstablished.push(WHOLESALE_SCOPE_NOTE);
    if (!facts.length) return null;
    const dates = facts.map((f) => f.as_of).filter((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    return {
      kind: CROSS_DOMAIN_KIND, requested_mw: mw, geography, headline, verdict: null, evidence, not_established: notEstablished,
      as_of: dates[0] || null, relay: null,
      source: 'Source: DC Hub (dchub.cloud), each figure dated in its own fact.',
      facts: facts.map(({ short, ...f }) => f),
    };
  } catch (_e) { return null; }
}
