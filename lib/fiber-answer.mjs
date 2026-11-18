// fiber-answer.mjs — intent_answer for an execute_plan in the fiber class (planner 5.37 routes carrier hotel / IX /
// metro fiber asks to get_metro_fiber + get_peering_intel + get_fiber_intel).
//
// WHY (Grok, live 2026-11-17 night, planner 5.38). Keyless execute_plan "Which carrier hotels in Dallas have the most
// fiber carriers?" with detail:"compact" led with "DC Hub ran 3 lookups for ...", carried no intent_answer and no step
// results, and answer_guide still said "Compose the answer from executed[].result". buildIntentAnswer only knew three
// kinds (power timing, market check, siting) and the fiber class matched none, so every fiber plan had no answer block;
// the compact form then stripped the step bodies the agent was told to compose from. get_peering_intel had returned
// connectivity.top_facilities (PeeringDB facilities near the metro core, each with net_count and ix_count): the
// facilities the question asks for, with their counts, sitting in a step body nobody read.
//
// WHAT. buildFiberAnswer reads only what the steps returned at the caller's depth:
//   * get_peering_intel  connectivity.top_facilities -> the facilities ranked by PeeringDB network count (the headline
//                        of a facility ask), plus the facilities / IX / network totals around the point;
//   * get_metro_fiber    the curated metro profile (summary, key_carrier_hotels; a dated baseline, not a live feed) and
//                        the PeeringDB carrier-presence totals for the metro's cities;
//   * any other fiber step (get_fiber_readiness, get_subsea_cables) through lib/plan-step-facts.mjs.
// RULES (same as lib/intent-answers.mjs): no count is computed, estimated or carried over from another place; a field
// the step did not return (withheld at this tier, or absent) is left out and named in not_established; PeeringDB's
// net_count is said as networks (carriers, ISPs, content and cloud networks), never as fiber carriers alone; as_of is
// the OLDEST data date among the steps used. Pure; never throws (returns null).

import { sourceLine, dataAsOfDay } from './source-line.mjs';
import { factsFromExecuted } from './plan-step-facts.mjs';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));

export const FIBER_TOP_FACILITIES_MAX = 5;
// An ask about buildings (which carrier hotel, which facility has the most carriers / networks), not metro depth.
export const FACILITY_ASK_RE = /\bcarrier[-\s]hotels?\b|\bmeet[-\s]me\b|\bcolo(?:cation)?s?\b|\bfacilit(?:y|ies)\b|\bbuildings?\b|\bdata\s*cent(?:er|re)s?\b|\binternet\s+exchanges?\b|\bIXPs?\b|\bpeering\b|\bmost\s+(?:fib(?:er|re)\s+)?(?:carriers|networks)\b/i;
export const NETWORK_COUNT_NOTE = 'PeeringDB net_count counts every network listed at a facility (carriers, ISPs, content '
  + 'and cloud networks), not fiber carriers alone; DC Hub holds no carrier-only count per building.';

function parsed(full) {
  if (isObj(full)) return full;
  if (typeof full === 'string') { try { const o = JSON.parse(full); return isObj(o) ? o : null; } catch (_e) { return null; } }
  return null;
}
function readSteps(executed, fullByEntry) {
  const out = [];
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || !(e.status === 'executed' || e.status === 'gated_preview')) continue;
    const p = parsed((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result);
    if (p) out.push({ step: e.step, tool: e.tool, args: e.args || {}, p, entry: e });
  }
  return out;
}

// The facilities the peering read returned, most networks first. A row keeps only the fields it carries as values.
export function peeringFacilities(p) {
  const c = isObj(p && p.connectivity) ? p.connectivity : (isObj(p) ? p : {});
  const rows = Array.isArray(c.top_facilities) ? c.top_facilities : [];
  const out = [];
  for (const r of rows) {
    if (!isObj(r) || !one(r.name)) continue;
    const row = { name: one(r.name) };
    if (one(r.city)) row.city = one(r.city);
    if (num(r.net_count) != null) row.net_count = num(r.net_count);
    if (num(r.ix_count) != null) row.ix_count = num(r.ix_count);
    out.push(row);
  }
  // stable: rows without a count keep their read order, after the counted ones
  return out.map((r, i) => [r, i]).sort((a, b) => ((b[0].net_count ?? -1) - (a[0].net_count ?? -1)) || a[1] - b[1]).map((x) => x[0]);
}

function facilityPhrase(r) {
  const parts = [];
  if (r.net_count != null) parts.push(`${fmt(r.net_count)} networks`);
  if (r.ix_count != null) parts.push(`${fmt(r.ix_count)} IX${r.ix_count === 1 ? '' : 's'}`);
  return parts.length ? `${r.name} (${parts.join(', ')})` : r.name;
}

export function buildFiberAnswer(ctx, executed, fullByEntry) {
  try {
    const steps = readSteps(executed, fullByEntry);
    if (!steps.length) return null;
    const intent = String((ctx && ctx.intent) || '').slice(0, 1000);
    const facilityAsk = FACILITY_ASK_RE.test(intent);
    const peering = steps.find((s) => s.tool === 'get_peering_intel' && isObj(s.p.connectivity));
    const metro = steps.find((s) => s.tool === 'get_metro_fiber' && (isObj(s.p.summary) || isObj(s.p.presence_carriers)));
    const evidence = [];
    const notEstablished = [];
    const dates = [];
    const market = one(metro && (metro.p.market || metro.args.market)) || one(peering && peering.args.market);
    const point = peering && num(peering.args.lat) != null && num(peering.args.lon) != null ? `${peering.args.lat}, ${peering.args.lon}` : '';
    const place = market || point || 'the place asked';

    // ---- PeeringDB around the metro core ----
    let ranked = [];
    let rankLine = '';
    if (peering) {
      const c = peering.p.connectivity;
      const served = day(isObj(peering.p.freshness) ? peering.p.freshness.served_at : null);
      const src = `PeeringDB via get_peering_intel, read live${served ? ` on ${served}` : ''}`;
      const radDeg = num(isObj(peering.p.location) ? peering.p.location.radius_deg : null);
      const within = radDeg != null ? `within about ${Math.round(radDeg * 111)} km of ${point || place}` : `around ${point || place}`;
      const fac = num(c.facilities_nearby), ix = num(c.total_ix_presence), nets = num(c.total_networks);
      const parts = [];
      if (fac != null) parts.push(`${fmt(fac)} facilities`);
      if (ix != null) parts.push(`${fmt(ix)} IX presences`);
      if (nets != null) parts.push(`${fmt(nets)} networks`);
      if (parts.length) evidence.push(`PeeringDB ${within}: ${parts.join(', ')} (${src}).`);
      ranked = peeringFacilities(peering.p).slice(0, FIBER_TOP_FACILITIES_MAX);
      const counted = ranked.filter((r) => r.net_count != null);
      if (ranked.length) {
        rankLine = `${ranked.map(facilityPhrase).join('; ')}`;
        if (counted.length) {
          evidence.push(NETWORK_COUNT_NOTE);
          evidence.push(`Ranked among the ${fac != null ? fmt(fac) + ' ' : ''}facilities the peering read returned ${within} (${src}).`);
        }
        const more = num(c._top_facilities_total_available);
        if (more != null && more > ranked.length) notEstablished.push(`${more - ranked.length} more ranked facilit${more - ranked.length === 1 ? 'y is' : 'ies are'} in the full read, not this one.`);
        if (counted.length < ranked.length) {
          notEstablished.push(`No network count for ${ranked.filter((r) => r.net_count == null).map((r) => r.name).join(', ')} in this read.`);
        }
        // backend /api/v2/connectivity/summary reads at most 50 PeeringDB facilities around the point
        if (fac === 50) notEstablished.push('The peering read stops at 50 facilities around the point, so this ranking is among those 50, not every facility in the metro.');
      } else {
        notEstablished.push(`The peering read returned no per-facility rows${point ? ` around ${point}` : ''}, so no facility is ranked by network count here.`);
      }
    }

    // ---- the metro profile (curated baseline) and PeeringDB carrier presence for the metro's cities ----
    let hotels = [];
    let baselineDay = null;
    if (metro) {
      const m = metro.p;
      const s = isObj(m.summary) ? m.summary : {};
      baselineDay = day(isObj(m.baseline) ? m.baseline.as_of : null) || dataAsOfDay(m);
      if (baselineDay) dates.push(baselineDay);
      const bits = [];
      if (num(s.total_carriers) != null) bits.push(`${fmt(num(s.total_carriers))} carriers profiled`);
      if (num(s.total_route_miles) != null) bits.push(`${fmt(num(s.total_route_miles))} route miles`);
      if (num(s.total_on_net_buildings) != null) bits.push(`${fmt(num(s.total_on_net_buildings))} on-net buildings`);
      if (num(s.fiber_density_score) != null) bits.push(`fiber density ${num(s.fiber_density_score)}/100`);
      const base = `DC Hub curated baseline${baselineDay ? ` as of ${baselineDay}` : ''}, not a live feed`;
      if (bits.length) evidence.push(`${market || 'Metro'} curated fiber profile: ${bits.join(', ')} (get_metro_fiber, ${base}).`);
      hotels = (Array.isArray(s.key_carrier_hotels) ? s.key_carrier_hotels : []).map(one).filter(Boolean);
      if (hotels.length) evidence.push(`Key carrier hotels in DC Hub's curated ${market || 'metro'} profile: ${hotels.join(', ')} (${base}).`);
      const pc = isObj(m.presence_carriers) ? m.presence_carriers : null;
      if (pc && pc.status === 'ok' && num(pc.total_carriers) != null) {
        const d = day(pc.as_of);
        if (d) dates.push(d);
        evidence.push(`PeeringDB lists ${fmt(num(pc.total_carriers))} carriers present${num(pc.total_facilities) != null ? ` across ${fmt(num(pc.total_facilities))} facilities` : ''}`
          + ` in ${market || 'the metro'}'s cities (presence at a facility, not route miles; get_metro_fiber${d ? `, as of ${d}` : ''}).`);
      }
    }

    // ---- any other fiber step's dated fact (on-net at a point, nearest subsea landing) ----
    const others = factsFromExecuted(executed, fullByEntry).filter((f) => f.tool !== 'get_peering_intel');
    for (const f of others) {
      if (!evidence.includes(f.text)) evidence.push(f.text);
      if (day(f.as_of)) dates.push(day(f.as_of));
    }

    let headline;
    if (facilityAsk && rankLine && ranked.some((r) => r.net_count != null)) {
      headline = `Carrier hotels and facilities near ${place} with the most networks on PeeringDB: ${rankLine}.`;
    } else if (facilityAsk && rankLine) {
      // The counts were withheld at this tier (a keyless preview returns the rows with net_count null): the rows still
      // come in PeeringDB's order, most networks first (backend connectivity_summary sorts by net_count).
      headline = `Carrier hotels and facilities near ${place} that PeeringDB lists with the most networks, most first: `
        + `${ranked.map((r) => r.name).join('; ')} (the network counts are not in this read).`;
    } else if (facilityAsk && hotels.length) {
      headline = `Key carrier hotels in ${market || place}: ${hotels.join(', ')} (DC Hub curated profile${baselineDay ? `, baseline as of ${baselineDay}` : ''}).`
        + ' No per-facility carrier or network count was returned in this read.';
    } else {
      const first = evidence.find((x) => x !== NETWORK_COUNT_NOTE && !/^Ranked among/.test(x));
      headline = first || `The fiber reads for ${place} ran but returned no figure at this depth.`;
      if (facilityAsk && !rankLine && !hotels.length) notEstablished.push(`No facility in ${place} was ranked by carrier or network count in this read.`);
    }
    if (facilityAsk && /\bcarriers?\b/i.test(intent) && ranked.some((r) => r.net_count != null)) {
      notEstablished.push('A count of fiber carriers per building is not in DC Hub; the ranking uses PeeringDB network counts.');
    }

    const cite = metro || peering || steps[0];
    const asOf = dates.length ? dates.slice().sort()[0] : null;
    return {
      kind: 'fiber',
      geography: place,
      headline,
      verdict: null,
      evidence,
      not_established: notEstablished,
      ...(ranked.length ? { ranked_facilities: ranked, ranked_facilities_basis: 'get_peering_intel connectivity.top_facilities (PeeringDB), most networks first' } : {}),
      as_of: asOf,
      relay: null,
      source: sourceLine(cite.p, cite.tool, cite.args),
    };
  } catch (_e) { return null; }
}
