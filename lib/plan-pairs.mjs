// plan-pairs.mjs -- planner 5.38: every execute_plan answer about a place reads BOTH sides of it (owner, 2026-11-17,
// via a Grok note). DC Hub covers data centers and the energy behind them, so a data-center question about a place
// also reads that place's power, and a power question about a place also reads its data centers.
//
// WHAT. pairStepFor(classId, d, seq, h) looks at the plan a class built and returns the one step the other side
// needs, or a record of why none was added:
//   * data-center-first classes (PAIR_POWER_CLASSES: colocation, facility_search, market_outlook, dc_capacity) with
//     no power step bound to the place get a POWER step: get_grid_intelligence for the market's US RTO (time to power,
//     queue depth, retail rate, each dated by the step), else get_power_availability_timeline for its US state;
//   * power-first classes (PAIR_DC_CLASSES: grid_headroom, interconnection_queue, power_timeline, price,
//     capacity_search, gas_price) that name a place and have no data-center step bound to it get a DATA CENTER step:
//     get_market_intel for a resolved market (facility count, tracked MW and the market's Data Center Power Index
//     (DCPI) verdict in one read), else get_pipeline for the named US state.
// Never on a placeholder: the place is the market or state the planner already bound from the question. Never a
// state or market on a step whose grid does not serve it: a grid the question names that does not serve the place
// adds no step, and the record says so. One step at most, so the plan stays inside max_steps (default 6); the
// executor holds the step back, and says so, when the budget has no room left after the steps that answer the
// question (pairHeldBack).
//
// pairLines(executed, fullOf) writes the two answer lines, one per side, each from its own step's figures and its
// own as_of (never a date borrowed from another step). Pure; nothing here throws.

import { COLO_METROS } from './colocation-plan.mjs';
import { factsFromStep, stepAsOf, stepAsOfRaw, facilityCount, facilityRows, newestRowDate } from './plan-step-facts.mjs';
import { spokenDay } from './cite-day.mjs';

export const PAIR_POWER_CLASSES = new Set(['colocation', 'facility_search', 'market_outlook', 'dc_capacity']);
export const PAIR_DC_CLASSES = new Set(['grid_headroom', 'interconnection_queue', 'power_timeline', 'price', 'capacity_search', 'gas_price']);
export const DC_SIDE_TOOLS = new Set(['get_market_dcpi_rank', 'get_market_intel', 'search_facilities', 'get_pipeline', 'get_facility']);
export const POWER_SIDE_TOOLS = new Set(['get_grid_intelligence', 'get_power_availability_timeline', 'get_interconnection_queue',
  'get_refined_queue', 'get_energy_prices', 'get_grid_data', 'get_retirement_headroom', 'compare_isos']);
const DC_GEO_KEYS = ['market_slug', 'market', 'query', 'city', 'state', 'country'];
const POWER_GEO_KEYS = ['iso', 'state', 'market', 'region_iso', 'lat'];

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));
const normIso = (v) => { const s = String(v || '').toUpperCase(); return s === 'ISO-NE' ? 'ISONE' : s; };
// A concrete value: present and not an "<angle bracket>" hand-off.
const concrete = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && !/^\s*</.test(v));
// "<the market named in the intent ...>" is filled at execution from the market the question named (the constraint
// slug), so it binds exactly when the planner resolved that market; with none it runs skipped_unresolved.
const NAMED_MARKET_PH = /^\s*<the market named/;
const bound = (step, keys, marketBound) => !!step && isObj(step.args_hint)
  && keys.some((k) => concrete(step.args_hint[k]) || (marketBound && NAMED_MARKET_PH.test(String(step.args_hint[k] || ''))));

/** Steps already on each side, bound to a place (a placeholder nothing fills covers nothing). */
export function sidesOf(seq, marketBound = false) {
  const s = Array.isArray(seq) ? seq.filter(isObj) : [];
  return {
    dc: s.filter((x) => DC_SIDE_TOOLS.has(x.tool) && bound(x, DC_GEO_KEYS, marketBound)),
    power: s.filter((x) => POWER_SIDE_TOOLS.has(x.tool) && bound(x, POWER_GEO_KEYS, marketBound)),
  };
}

/**
 * The place the plan bound: { market, label, state, iso } (each null when not bound). h: { rtos: Set, stateIso: {ST: [ISO]},
 * usMarketState(o), stateScope(d) } from server.mjs.
 */
export function pairPlace(d, h) {
  const o = d && d.__outlook && typeof d.__outlook.slug === 'string' && d.__outlook.slug ? d.__outlook : null;
  const metro = o ? COLO_METROS.find((m) => m.dcpi_slug === o.slug || m.id === o.slug || m.id === o.intel) : null;
  let state = null;
  try { state = (o && h.usMarketState(o)) || (metro && metro.state) || h.stateScope(d) || null; } catch (_e) { state = null; }
  const rtoOf = (v) => (v && h.rtos.has(normIso(v)) ? normIso(v) : null);
  const iso = (o && (rtoOf(o.rto) || rtoOf(o.iso))) || (metro && rtoOf(metro.iso)) || null;
  return {
    market: o ? (o.intel || o.slug) : null,
    label: o ? (one(o.name) || (metro && metro.label) || o.slug) : null,
    state: state ? String(state).toUpperCase() : null,
    iso,
  };
}

function record(side, status, note, extra = {}) { return { side, status, note, ...extra }; }

/**
 * One pairing step for the plan, or why none: { record, step }. `step` is null unless a step is added. classId: the
 * winning class; d: the planner signals; seq: the class's own steps; h: helpers (see pairPlace) plus `multiState`.
 */
export function pairStepFor(classId, d, seq, h) {
  try {
    const wantPower = PAIR_POWER_CLASSES.has(classId);
    const wantDc = PAIR_DC_CLASSES.has(classId);
    if (!wantPower && !wantDc) return { record: null, step: null };
    const side = wantPower ? 'power' : 'data_center';
    const marketBound = !!(d && ((d.__outlook && d.__outlook.slug) || d.__citySlug
      || (Array.isArray(d.__namedMarkets) && d.__namedMarkets.length === 1)));
    const have = sidesOf(seq, marketBound);
    const mine = wantPower ? have.power : have.dc;
    if (mine.length) {
      return { record: record(side, 'already_paired', `The plan already reads the ${side === 'power' ? 'power' : 'data-center'} side of the place (step ${mine[0].step}, ${mine[0].tool}).`,
        { step: mine[0].step, tool: mine[0].tool }), step: null };
    }
    if (h.multiState || (Array.isArray(d.states) && d.states.length > 1) || (Array.isArray(d.__namedMarkets) && d.__namedMarkets.length > 1)) {
      return { record: record(side, 'not_added', 'The question names more than one place, so no single-place pairing step was added; ask about one place for both sides.'), step: null };
    }
    const p = pairPlace(d, h);
    const textIso = d && d.isoFromText ? normIso(d.iso) : null;
    if (wantPower) {
      if (p.iso) {
        return { record: record(side, 'added', `Power side for ${p.label || p.market}: ${p.iso}, the grid that serves it.`, { tool: 'get_grid_intelligence', place: p }),
          step: { tool: 'get_grid_intelligence', depends_on: [], estimated_calls: 1, pair_side: 'power',
            why: `Pairing (both sides of the place): ${p.iso}, the grid that serves ${p.label || p.market}. Time to power, queue depth and the retail rate, each with its own as_of. One step; it never displaces a step that answers the question.`,
            args_hint: { iso: p.iso } } };
      }
      if (p.state && Object.prototype.hasOwnProperty.call(h.stateIso, p.state)) {
        const where = p.label ? `${p.label} (${p.state})` : p.state;
        return { record: record(side, 'added', `Power side for ${where}: the ${p.state} power-availability timeline (no US RTO has its own grid read there).`, { tool: 'get_power_availability_timeline', place: p }),
          step: { tool: 'get_power_availability_timeline', depends_on: [], estimated_calls: 1, pair_side: 'power',
            why: `Pairing (both sides of the place): the power side of ${where}. Dated new capacity, retirements and queue context for ${p.state}, the state it sits in. One step; it never displaces a step that answers the question.`,
            args_hint: { state: p.state } } };
      }
      return { record: record(side, 'not_added', 'No US market or state was bound from the question, so no power step was added; name the market or state for the grid side.'), step: null };
    }
    // data-center side
    if (!p.market && !p.state) {
      return { record: record(side, 'not_added', 'The question names a grid but no place, so no data-center step was added; name a market or state for the data-center side.'), step: null };
    }
    if (textIso && p.iso && textIso !== p.iso) {
      return { record: record(side, 'not_added', `${textIso} does not serve ${p.label || p.market} (its grid is ${p.iso}), so no data-center step was added for it.`), step: null };
    }
    if (textIso && p.state && Array.isArray(h.stateIso[p.state]) && !h.stateIso[p.state].map(normIso).includes(textIso)) {
      return { record: record(side, 'not_added', `${textIso} does not serve ${p.state}, so no data-center step was added for it.`), step: null };
    }
    if (p.market) {
      return { record: record(side, 'added', `Data-center side for ${p.label || p.market}: facility count, tracked MW and its Data Center Power Index (DCPI) verdict.`, { tool: 'get_market_intel', place: p }),
        step: { tool: 'get_market_intel', depends_on: [], estimated_calls: 1, pair_side: 'data_center',
          why: `Pairing (both sides of the place): the data centers in ${p.label || p.market}. Facility count, tracked MW and the market's Data Center Power Index (DCPI) verdict in one read, each with its own as_of. One step; it never displaces a step that answers the question.`,
          args_hint: { market: p.market } } };
    }
    if (!Object.prototype.hasOwnProperty.call(h.stateIso, p.state)) {
      return { record: record(side, 'not_added', 'The place named is not a US state DC Hub scopes, so no data-center step was added.'), step: null };
    }
    return { record: record(side, 'added', `Data-center side for ${p.state}: the data-center pipeline on record there.`, { tool: 'get_pipeline', place: p }),
      step: { tool: 'get_pipeline', depends_on: [], estimated_calls: 1, pair_side: 'data_center',
        why: `Pairing (both sides of the place): the data centers in ${p.state}. Projects announced, permitted and under construction there, with MW where stated and the pipeline's as_of. One step; it never displaces a step that answers the question.`,
        args_hint: { country: 'US', state: p.state } } };
  } catch (_e) { return { record: null, step: null }; }
}

/**
 * Whether the executor holds the pairing step back: true when running it would leave fewer slots than the
 * steps that answer the question still need. seq: the plan; s: the pairing step; done: Set of step numbers already
 * run or placed; ran: steps run so far; cap: the step cap for this step.
 */
export function pairHeldBack(seq, s, done, ran, cap) {
  try {
    const pending = (Array.isArray(seq) ? seq : []).filter((x) => isObj(x) && !x.pair_side && x.routing !== 'capacity_procurement'
      && Number(x.step) < Number(s.step) && !done.has(x.step));
    return ran + pending.length >= cap;
  } catch (_e) { return false; }
}

/** The note on a held-back pairing step: what was not read and how to read it. */
export function pairHeldNote(s, maxSteps) {
  const args = isObj(s && s.args_hint) ? s.args_hint : {};
  return `pairing step held back: max_steps ${maxSteps} leaves no room after the steps that answer the question. `
    + `The ${s && s.pair_side === 'power' ? 'power' : 'data-center'} side was not read: call ${s && s.tool} ${JSON.stringify(args)} directly, or raise max_steps (up to 8).`;
}

// ---- the two answer lines ----

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
const dated = (d) => (d ? `as of ${d}` : 'undated: the step names no as_of');

function marketIntelFigures(p, args) {
  const parts = [];
  const st = isObj(p.stats) ? p.stats : {};
  const where = one((isObj(p.market) && p.market.name) || (args && args.market) || '');
  const asOf = day(p.as_of) || stepAsOf(p);
  const n = num(st.facility_count);
  if (n != null) {
    const mw = num(st.total_power_mw);
    parts.push(`${fmt(n)} facilities tracked${mw != null ? `, ${fmt(mw)} MW across the ${num(st.mw_reporting_count) != null ? `${fmt(st.mw_reporting_count)} ` : ''}that report capacity (a floor)` : ''} (${dated(asOf)})`);
  }
  const dc = isObj(p.siting) && isObj(p.siting.dcpi) ? p.siting.dcpi : null;
  const v = dc && typeof dc.verdict === 'string' ? dc.verdict.trim().toUpperCase() : '';
  // The DCPI date is said as its America/Phoenix day (lib/cite-day.mjs), as the DCPI evidence line says it.
  if (/^(BUILD|CAUTION|AVOID)$/.test(v)) parts.push(`Data Center Power Index (DCPI) verdict ${v} (${dated(spokenDay(dc.as_of))})`);
  return { where, parts, as_of: asOf };
}

function gridIntelFigures(p, args) {
  const parts = [];
  const iso = one(p.iso || (args && args.iso));
  const asOf = day(p.as_of) || stepAsOf(p);
  const ttp = num(p.avg_time_to_power_months);
  if (ttp != null) parts.push(`average time to power ${fmt(ttp)} months (${dated(day(p.dcpi_computed_at) || asOf)})`);
  const q = num(p.queue_depth_gw);
  if (q != null) parts.push(`generation queue ${fmt(q)} GW (${dated(day(p.queue_depth_as_of) || asOf)})`);
  const price = num(p.retail_price_cents_kwh);
  if (price != null) parts.push(`retail electricity ${price} cents/kWh (${dated(asOf)})`);
  if (!parts.length) {
    const dm = num(p.demand_mw);
    if (dm != null) parts.push(`live demand ${fmt(Math.round(dm))} MW (${dated(asOf)})`);
  }
  return { where: iso, parts, as_of: asOf };
}

// 5.62 (P4): the count is the rows kept in the place (submarket_scope.kept) when they were cut to a town, and the date
// is the newest row date, labelled as row dates; a facility row carries its own as_of even when the step names none.
function searchFigures(p, args) {
  const c = facilityCount(p);
  const where = c.place || one((args && (args.city || args.query || args.state)) || '');
  const rowDay = newestRowDate(facilityRows(p));
  const asOf = rowDay || stepAsOf(p);
  const when = rowDay ? `as of ${rowDay}, the newest facility row date` : dated(asOf);
  return { where, parts: c.n != null ? [`${fmt(c.n)} facilities ${c.scoped ? 'on record' : 'matched'} (${when})`] : [], as_of: asOf };
}

function dcpiFigures(p, args) {
  const v = typeof p.verdict === 'string' ? p.verdict.trim().toUpperCase() : '';
  const where = one(p.market_name || (args && args.market_slug) || p.market_slug || '');
  const asOf = day(p.computed_at) || stepAsOf(p);
  if (!/^(BUILD|CAUTION|AVOID)$/.test(v)) return { where, parts: [], as_of: asOf };
  const sc = num(p.composite_score);
  // The line says the America/Phoenix day (lib/cite-day.mjs); as_of keeps the machine day.
  const sd = spokenDay(day(p.computed_at) ? p.computed_at : stepAsOfRaw(p));
  return { where, parts: [`Data Center Power Index (DCPI) verdict ${v}${sc != null ? `, composite score ${sc}` : ''} (${dated(sd)})`], as_of: asOf };
}

function queueFigures(p, args) {
  const where = one(p.iso || (args && args.iso) || '');
  const asOf = stepAsOf(p);
  const gw = num(p.queued_generation_gw) ?? num(p.total_gw) ?? num(p.queue_depth_gw);
  return { where, parts: gw != null ? [`queued generation ${fmt(gw)} GW (${dated(asOf)})`] : [], as_of: asOf };
}

function figuresOf(tool, p, args) {
  if (tool === 'get_market_dcpi_rank') return dcpiFigures(p, args);
  if (tool === 'get_interconnection_queue') return queueFigures(p, args);
  if (tool === 'get_market_intel') return marketIntelFigures(p, args);
  if (tool === 'get_grid_intelligence') return gridIntelFigures(p, args);
  if (tool === 'search_facilities') return searchFigures(p, args);
  const facts = factsFromStep(tool, p, args);
  const f = facts[0];
  // A fact's own sentence already names its source and date; an undated one says so.
  return { where: '', parts: f ? [f.text.replace(/\.\s*$/, '') + (f.as_of ? '' : ' (undated: the step names no as_of)')] : [], as_of: f ? f.as_of : stepAsOf(p), sentence: true };
}

// The step each side's line is read from: the pairing step when it ran, else the side's most telling step that ran
// (the order below), else the pairing step that did not run (its line says why), else none.
const PREFER = {
  data_center: ['get_market_dcpi_rank', 'get_market_intel', 'get_pipeline', 'search_facilities', 'get_facility'],
  power: ['get_grid_intelligence', 'get_power_availability_timeline', 'get_energy_prices', 'get_interconnection_queue',
    'get_refined_queue', 'get_grid_data', 'get_retirement_headroom', 'compare_isos'],
};
function pickStep(executed, side) {
  const order = PREFER[side];
  const rows = (Array.isArray(executed) ? executed : []).filter((e) => isObj(e) && order.includes(e.tool));
  const ran = (e) => e.status === 'executed' || e.status === 'gated_preview';
  const best = rows.filter(ran).sort((a, b) => order.indexOf(a.tool) - order.indexOf(b.tool) || Number(a.step) - Number(b.step))[0];
  return rows.find((e) => e.pair_side === side && ran(e)) || best || rows.find((e) => e.pair_side === side) || rows[0] || null;
}

/**
 * The answer's two pairing lines: { data_center, power, lines } (a side with no step at all is left out). executed:
 * execute_plan's executed[]; fullOf(entry): the full result for an entry, optional.
 */
export function pairLines(executed, fullOf) {
  const out = {};
  for (const side of ['data_center', 'power']) {
    const e = pickStep(executed, side);
    if (!e) continue;
    const label = side === 'power' ? 'POWER SIDE' : 'DATA CENTER SIDE';
    const base = { step: e.step, tool: e.tool, status: e.status, ...(e.pair_side ? { pairing_step: true } : {}) };
    if (!(e.status === 'executed' || e.status === 'gated_preview')) {
      out[side] = { ...base, line: `${label} (step ${e.step}, ${e.tool}): not read in this run (${one(e.note) || e.status}).` };
      continue;
    }
    let p = null;
    try { p = parsed((fullOf && fullOf(e)) || e.result); } catch (_e) { p = null; }
    const f = p ? figuresOf(e.tool, p, e.args || {}) : { where: '', parts: [], as_of: null };
    // 5.39 (Grok cross-domain head-to-head, 2026-11-17 night): the Northern Virginia POWER SIDE said "no figure this
    // caller can read came back" while facts[] held PJM's live demand from the same step (its taste headline, which
    // the figure readers above do not read). A side line never contradicts facts[]: it falls back to the step's fact.
    if (p && !f.parts.length) {
      const fx = factsFromStep(e.tool, p, e.args || {})[0];
      if (fx) { f.parts = [fx.text.replace(/\.\s*$/, '')]; f.as_of = fx.as_of || f.as_of; }
    }
    const where = f.where ? `${f.where}: ` : '';
    const body = f.parts.length ? f.parts.join('; ') : `no figure this caller can read came back (${dated(f.as_of)})`;
    out[side] = { ...base, ...(f.as_of ? { as_of: f.as_of } : {}),
      line: `${label} (step ${e.step}, ${e.tool}): ${where}${body}. Source: DC Hub (dchub.cloud).` };
  }
  const lines = [out.data_center, out.power].filter(Boolean).map((x) => x.line);
  return lines.length ? { ...out, lines } : null;
}
