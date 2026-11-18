// cross-domain-answer.mjs -- planner 5.39: "where can I get N MW, and what do the grid and the queue look like
// there?" (Grok cross-domain head-to-head, 2026-11-17 night, item a).
//
// WHY. "Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what
// do grid headroom and the interconnection queue look like there?" routed to interconnection_queue: a US-wide
// queue read, the queue survivors and an analyze_site that never bound. The compact lead was "DC Hub ran 3 lookups"
// with no market, no MW and no grid figure. DC Hub lost the cross-domain set 35/60 to two colocation-only servers.
//
// WHAT.
//   * capacityGridEligible(text, d): a size, a where/find ask and a grid word (headroom, queue, interconnection,
//     grid, time to power), with no market, state, point or ISO bound and no non-US region named.
//   * capacityGridSequence(d): the DCPI-ranked US shortlist for that size and deadline (site_selection_canvas), the
//     grid read and the queue for each finalist's ISO (fan-out from the shortlist rows), and Capacity Source
//     listings at that size (source_capacity).
//   * buildCapacityGridAnswer(ctx, executed, fullByEntry): the intent_answer. Its headline names the top three
//     markets (verdict and ISO, time to power when the caller can read it) and, per finalist ISO, the grid and
//     queue figures the steps returned, each with its own date. When the canvas could not apply the deadline (time
//     to power is not readable at this access level) the evidence says the list is not cut to it.
// Every figure is read from a step result; nothing is looked up or invented. Pure; never throws.

import { figuresOf } from './plan-pairs.mjs';
import { stepAsOf } from './plan-step-facts.mjs';

export const CAPACITY_GRID_CLASS = 'capacity_grid';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));

const WHERE_RE = /\b(?:where|which\s+(?:markets?|places?|regions?|states?)|find|locate|source|secure|get|land)\b/i;
const GRID_RE = /\b(?:headroom|interconnection|queues?|grid|time[- ]to[- ]power|energi[sz]ed?|with\s+power)\b/i;

/** Whether a question is the open US capacity + grid search this class answers. */
export function capacityGridEligible(text, d, { nonUsRegion = false } = {}) {
  try {
    const t = String(text || '');
    if (!d || typeof d !== 'object' || nonUsRegion) return false;
    if (!(typeof d.mw === 'number' && d.mw > 0)) return false;
    if (!WHERE_RE.test(t) || !GRID_RE.test(t)) return false;
    const states = Array.isArray(d.states) ? d.states : [];
    const markets = Array.isArray(d.__namedMarkets) ? d.__namedMarkets : [];
    if (states.length || d.state || d.stateFromPlace || d.market || markets.length || d.__citySlug) return false;
    if ((d.__outlook && d.__outlook.slug) || d.coords || d.candidateId || d.iso) return false;
    return true;
  } catch (_e) { return false; }
}

/** The class's steps. d: planner signals (mw, deadline). */
export function capacityGridSequence(d) {
  const mw = Math.round(d && d.mw ? d.mw : 50);
  const months = (d && d.deadline && d.deadline.months) || null;
  return [
    { step: 1, tool: 'site_selection_canvas', depends_on: [], estimated_calls: 1,
      why: `The US markets DCPI rates for ${mw} MW${months ? ` within ${months} months` : ''}: verdict, excess-power headroom, time to power and ISO per market. Each row names the ISO the next two reads take.`,
      args_hint: { region: 'us', capacity_mw: mw, ...(months ? { max_months: months } : {}), limit: 5 } },
    { step: 2, tool: 'get_grid_intelligence', depends_on: [1], estimated_calls: 2,
      why: 'The grid behind each finalist: time to power, queue depth and live demand for the ISO that serves it, each dated by the read. One call per distinct finalist ISO.',
      args_hint: { iso: '<ISO serving the finalist market>' } },
    { step: 3, tool: 'get_interconnection_queue', depends_on: [1], estimated_calls: 2,
      why: 'The interconnection queue of each finalist ISO: queued generation in GW, with the date DC Hub collected it. One call per distinct finalist ISO.',
      args_hint: { iso: '<ISO serving the finalist market>' } },
    { step: 4, tool: 'source_capacity', depends_on: [], estimated_calls: 1, routing: 'capacity_procurement',
      why: `Colocation and powered capacity listed for lease or sale at ${mw} MW or more in North America (DC Hub Capacity Source), matched against the block a listing can deliver.`,
      args_hint: { min_mw: mw, region: 'north_america' } },
  ];
}

export const CAPACITY_GRID_CLASS_DEF = {
  id: CAPACITY_GRID_CLASS, recipe: 'market_selection',
  // Wins only through the override in _planQuery (capacityGridEligible), never on its own words.
  patterns: [],
  rationale: (d) => `An open US search for ${d.mw ? Math.round(d.mw) + ' MW' : 'capacity'}`
    + (d.deadline && d.deadline.months ? ` energized within ${d.deadline.months} months` : '')
    + ' that also asks about the grid is answered as both sides at once: the DCPI-ranked markets for that size and deadline, then the grid read and the interconnection queue of the ISO behind each finalist, then capacity listed at that size.',
  sequence: (d) => capacityGridSequence(d),
  alternatives: [
    { tool: 'get_interconnection_queue', when: 'You want one ISO\'s queue and already know the ISO.',
      rejected_because: 'The question asked where, so the markets come first and the queue is read for the ISOs behind them.' },
    { tool: 'get_refined_queue', when: 'You want queue survivors at the size floor in one ISO or state.',
      rejected_because: 'Queue survivors are generation projects, not places to put load; they follow once a market is chosen.' },
    { tool: 'rank_markets', when: 'You want the full national DCPI ranking without a size or deadline.',
      rejected_because: 'site_selection_canvas takes the size and the deadline; rank_markets does not.' },
  ],
  coverage_notes: 'US only. The canvas applies the time-to-power deadline only where the caller can read time to power; otherwise it ranks without it and says so (max_months_applied false). Market rows carry a 0-100 excess-power index, not MW. Grid figures are ISO-wide, not per market.',
};

function parsed(v) {
  if (isObj(v)) return v;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}

// One figure, short: "ERCOT queued generation: 461.4 GW (generation … , DC Hub, as of 2026-10-31)" -> "queued generation
// 461.4 GW (as of 2026-10-31)". The ISO is dropped (the line names it) and the date is the step's own.
export function terse(text, iso, asOf) {
  const t = one(text);
  const head = (/^(.*?)\s+\(/.exec(t) || [null, t.replace(/\.$/, '')])[1];
  const body = head.replace(new RegExp(`^${iso ? iso.replace(/[^A-Za-z0-9-]/g, '') : '\\b'}\\s+`, 'i'), '').replace(/:\s+/, ' ');
  return `${body} (${asOf ? `as of ${asOf}` : 'undated: the step names no as_of'})`;
}

const ran = (e) => isObj(e) && (e.status === 'executed' || e.status === 'gated_preview');

function bodyOf(e, fullByEntry) {
  try { return parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result); } catch (_e) { return null; }
}

// The ISO a step read: its args, else the payload.
const isoOf = (e, p) => one(String((e.args && e.args.iso) || (p && p.iso) || '')).toUpperCase();

/**
 * The intent_answer for a capacity_grid plan, or null. ctx: { intent, intent_class, requested_mw, deadline_months }.
 */
export function buildCapacityGridAnswer(ctx, executed, fullByEntry) {
  try {
    if (!ctx || ctx.intent_class !== CAPACITY_GRID_CLASS) return null;
    const ex = Array.isArray(executed) ? executed.filter(isObj) : [];
    const canvasE = ex.find((e) => e.tool === 'site_selection_canvas' && ran(e));
    const canvas = canvasE ? bodyOf(canvasE, fullByEntry) : null;
    const rows = canvas && Array.isArray(canvas.shortlist) ? canvas.shortlist.filter(isObj).slice(0, 3) : [];
    const mw = num(ctx.requested_mw);
    const months = num(ctx.deadline_months);
    const evidence = [];
    const dates = [];

    // ---- the data-center side: the markets ----
    // The canvas states no score date (provenance.as_of null): retrieved_at is when DC Hub served it, never a data date.
    const canvasDate = canvas ? stepAsOf(canvas) : null;
    const ttpOpen = rows.some((r) => num(r.time_to_power_months) != null);
    const marketBits = rows.map((r) => {
      const name = one(r.market) || one(r.slug);
      const st = one(r.state);
      const ttp = num(r.time_to_power_months);
      const tags = [one(r.iso), one(r.verdict), ttp != null ? `time to power ${fmt(ttp)} months` : ''].filter(Boolean);
      return `${name}${st && !name.includes(st) ? `, ${st}` : ''}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    });
    if (canvasDate) dates.push(canvasDate);

    // ---- the power side: per finalist ISO, grid read then queue ----
    const isos = [...new Set(rows.map((r) => one(r.iso).toUpperCase()).filter(Boolean))];
    const isoBits = [];
    for (const iso of isos) {
      const parts = [];
      for (const tool of ['get_grid_intelligence', 'get_interconnection_queue']) {
        const e = ex.find((x) => x.tool === tool && ran(x) && isoOf(x, bodyOf(x, fullByEntry)) === iso);
        if (!e) continue;
        const p = bodyOf(e, fullByEntry);
        if (!p) continue;
        const f = figuresOf(tool, p, e.args || {});
        if (f.parts.length) {
          parts.push(terse(f.parts[0], iso, f.as_of));
          if (f.as_of) dates.push(f.as_of);
        }
      }
      if (parts.length) isoBits.push(`${iso}: ${parts.join('; ')}`);
      else isoBits.push(`${iso}: no grid or queue figure this access level shows came back`);
    }

    // ---- capacity listed at that size ----
    const capE = ex.find((e) => e.tool === 'source_capacity' && ran(e));
    const cap = capE ? bodyOf(capE, fullByEntry) : null;
    if (cap) {
      const items = Array.isArray(cap.items) ? cap.items : Array.isArray(cap.listings) ? cap.listings : null;
      const total = num(cap.total) ?? num(cap.count) ?? (items ? items.length : null);
      if (total != null) {
        evidence.push(total > 0
          ? `Capacity Source: ${fmt(total)} listing${total === 1 ? '' : 's'} of colocation or powered capacity at ${mw ? fmt(mw) + ' MW' : 'that size'} or more in North America (source_capacity).`
          : `Capacity Source: no listing at ${mw ? fmt(mw) + ' MW' : 'that size'} or more in North America yet (source_capacity); the markets above are where the power is, not listed space.`);
      }
    }

    if (!rows.length) {
      const note = canvas && isObj(canvas.empty_result) ? one(canvas.empty_result.message || canvas.empty_result.reason) : '';
      return {
        headline: `No US market came back from DC Hub's Data Center Power Index for ${mw ? fmt(mw) + ' MW' : 'this size'}${months ? ` within ${months} months` : ''}${note ? `: ${note}` : ''}.`,
        evidence, as_of: dates.sort()[0] || null, source: 'DC Hub (dchub.cloud)', kind: CAPACITY_GRID_CLASS,
      };
    }

    const top = `${rows.length === 1 ? 'Top US market' : `Top ${rows.length} US markets`} for ${mw ? fmt(mw) + ' MW' : 'this load'} in DC Hub's Data Center Power Index (DCPI${canvasDate ? `, read ${canvasDate}` : ''}): ${marketBits.join('; ')}.`;
    const grid = isoBits.length ? ` Grid and queue: ${isoBits.join('. ')}.` : '';
    const headline = (top + grid).replace(/\.\.+/g, '.');

    if (months && canvas && canvas.max_months_applied === false) {
      evidence.unshift(`Time to power is not readable at this access level, so the ${months}-month cut was NOT applied: the markets are ranked by DCPI verdict, not filtered to power within ${months} months.`);
    } else if (months && !ttpOpen) {
      evidence.unshift(`The shortlist was asked for power within ${months} months; the rows carry no time-to-power figure to quote.`);
    }
    if (canvas && !canvasDate) evidence.push('The shortlist rows carry no DCPI score date (the canvas states none); each market\'s own DCPI card (get_market_dcpi_rank) is dated.');
    if (canvas && isObj(canvas.constraint_coverage) && isObj(canvas.constraint_coverage.capacity_mw) && canvas.constraint_coverage.capacity_mw.applied === false) {
      evidence.push(`The list is not sized to ${mw ? fmt(mw) + ' MW' : 'the load'}: DCPI rows carry a 0-100 excess-power index, not megawatts.`);
    }
    evidence.push('Grid and queue figures are ISO-wide, not per market; a queue is requested generation, not load headroom.');

    return {
      headline,
      evidence,
      markets: rows.map((r) => ({ market: one(r.market), slug: one(r.slug), state: one(r.state), iso: one(r.iso),
        verdict: one(r.verdict), time_to_power_months: num(r.time_to_power_months) })),
      isos,
      as_of: dates.sort()[0] || null,
      source: 'DC Hub (dchub.cloud)',
      kind: CAPACITY_GRID_CLASS,
    };
  } catch (_e) { return null; }
}
