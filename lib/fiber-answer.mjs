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

//
// Fiber 1124 (Grok Brain note 2026-11-24, item 10a/10c):
//   * a point or a building the caller gave (ctx.point_given / ctx.address) leads with the get_fiber_readiness read
//     there (on-net / near-net, nearest carrier km, its source); the PeeringDB facility count is evidence, never the
//     lead of a point ask. A metro-core readiness read (no point given) never leads.
//   * a route ask between two metros (routePair) leads with a long-haul route named in both end reads, else the pair's
//     round-trip estimate (cluster_sites_by_latency), else one sentence saying no route or latency was returned; one
//     not_established line says a measured route latency is not served.

import { sourceLine, dataAsOfDay } from './source-line.mjs';
import { factsFromExecuted } from './plan-step-facts.mjs';
import { phoenixDay, spokenDay } from './cite-day.mjs';
import { routePair } from './plan-routing.mjs';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
// The America/Phoenix day of a serve / retrieval moment (lib/cite-day.mjs); a shape phoenixDay cannot read keeps its date.
const servedDay = (v) => (typeof v === 'string' ? phoenixDay(v.replace(/^(\d{4}-\d{2}-\d{2}) (?=\d{2}:)/, '$1T')) || day(v) : null);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(n));

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

// A long-haul route's name without its segment suffix ("... [La - Pheonix - Dallas] seg22" -> "... [La - Pheonix - Dallas]").
const routeBase = (n) => one(n).replace(/\s+seg(?:ment)?\s*\d+$/i, '');
function routeNames(p) {
  const out = [];
  for (const f of Array.isArray(p && p.features) ? p.features : []) {
    const nm = routeBase(isObj(f) && isObj(f.properties) ? f.properties.name : '');
    if (nm && !out.includes(nm)) out.push(nm);
  }
  return out;
}
const ms = (us) => Math.round(us / 100) / 10;

/** 10c: the answer to a route ask between two metros, read from the end reads and the latency floor. */
export function buildFiberRouteAnswer(pair, steps) {
  const { a, b } = pair;
  const route = `${a.label} to ${b.label}`;
  const evidence = [];
  const dates = [];
  const ends = [a, b].map((m) => ({ m, s: steps.find((s) => s.tool === 'get_fiber_intel' && String(s.args.market || '').toLowerCase() === m.dcpi_slug) }));
  for (const { m, s } of ends) {
    if (!s) continue;
    const p = s.p;
    const shown = Array.isArray(p.features) ? p.features.length : null;
    const total = num(p._features_total_available) ?? shown;
    const d = day(isObj(p.provenance) ? p.provenance.as_of : null) || day(isObj(p.citation) ? p.citation.as_of : null);
    if (d) dates.push(d);
    if (total != null) {
      evidence.push(`${fmt(total)} long-haul fiber route${total === 1 ? '' : 's'} on record touching ${m.label}`
        + `${shown != null && shown < total ? ` (${fmt(shown)} shown at this access level)` : ''}`
        + ` (get_fiber_intel, DC Hub fiber routes${d ? `, ingested as of ${d}` : ''}; the ingest date, not a survey date).`);
    }
  }
  const [na, nb] = ends.map((e) => (e.s ? routeNames(e.s.p) : []));
  const common = na.filter((n) => nb.includes(n));
  const lat = steps.find((s) => s.tool === 'cluster_sites_by_latency' && Array.isArray(s.p.pairs));
  const lp = lat ? lat.p.pairs.find((x) => isObj(x) && num(x.est_rtt_us) != null) : null;
  const latLine = lp
    ? `estimated fiber round trip ${ms(lp.est_rtt_us)} ms${num(lp.floor_rtt_us) != null ? `, physics floor ${ms(lp.floor_rtt_us)} ms` : ''}`
      + `${num(lp.distance_km) != null ? ` over ${fmt(Math.round(lp.distance_km))} km great-circle` : ''}`
      + ' (cluster_sites_by_latency: light in fiber x route factor 1.4, an estimate, not a measured path)'
    : '';
  let headline;
  if (common.length) {
    headline = `Long-haul fiber routes on record touching both ${a.label} and ${b.label}: ${common.slice(0, 3).join('; ')}`
      + ` (get_fiber_intel, DC Hub fiber routes${dates.length ? `, ingested as of ${dates.slice().sort()[0]}` : ''}).`
      + (latLine ? ` ${route}: ${latLine}.` : '');
  } else if (latLine) {
    headline = `${route}: ${latLine}. No long-haul route named in both end reads was returned at this depth.`;
  } else {
    headline = `DC Hub returned no fiber route or route latency between ${a.label} and ${b.label} in this read.`;
  }
  const notEstablished = [lp
    ? `A measured route latency between ${a.label} and ${b.label} is not served by DC Hub; the round-trip figure is a physics-floor estimate, not a carrier-quoted or measured path.`
    : `Route latency between ${a.label} and ${b.label} is not served by DC Hub in this read.`];
  const cite = (ends[0].s || ends[1].s || lat || steps[0]);
  return {
    kind: 'fiber',
    geography: route,
    headline,
    verdict: null,
    evidence,
    not_established: notEstablished,
    ...(common.length ? { routes_both_ends: common.slice(0, 10) } : {}),
    as_of: dates.length ? dates.slice().sort()[0] : null,
    relay: null,
    source: sourceLine(cite.p, cite.tool, cite.args),
  };
}

export function buildFiberAnswer(ctx, executed, fullByEntry) {
  try {
    const steps = readSteps(executed, fullByEntry);
    if (!steps.length) return null;
    const intent = String((ctx && ctx.intent) || '').slice(0, 1000);
    // 10c: a route ask between two metros answers from its end reads and latency floor.
    const pair = routePair(intent);
    if (pair && steps.some((s) => s.tool === 'cluster_sites_by_latency' || (s.tool === 'get_fiber_intel'
      && [pair.a.dcpi_slug, pair.b.dcpi_slug].includes(String(s.args.market || '').toLowerCase())))) {
      return buildFiberRouteAnswer(pair, steps);
    }
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
    let peeringDay = null;
    if (peering) {
      const c = peering.p.connectivity;
      // A keyless read carries no freshness block: the PeeringDB read is dated by when DC Hub served it (Grok
      // 2026-11-18 Dallas: the answer was dated by the March curated baseline instead).
      // Said as the America/Phoenix day (Grok Brain 2026-11-24 item 10d: "read live on 2026-11-25" at 17:40 Phoenix).
      const served = servedDay(isObj(peering.p.freshness) ? peering.p.freshness.served_at : null)
        || servedDay(isObj(peering.p.provenance) ? peering.p.provenance.retrieved_at : null)
        || servedDay(isObj(peering.p.citation) ? peering.p.citation.retrieved_at : null);
      peeringDay = served;
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
      // The curated baseline's date is said ONCE, labelled as the baseline's (Grok Brain 2026-11-24 item 10d: a fiber
      // answer read as_of 2026-03-17, cite_as 2026-11-23 and "read live on 2026-11-25" with nothing saying which was which).
      const base = `DC Hub curated metro baseline${baselineDay ? ` as of ${baselineDay}` : ''}, not a live feed`;
      let baseSaid = false;
      const baseRef = () => { if (baseSaid) return 'same curated metro baseline, not a live feed'; baseSaid = true; return base; };
      if (bits.length) evidence.push(`${market || 'Metro'} curated fiber profile: ${bits.join(', ')} (get_metro_fiber, ${baseRef()}).`);
      hotels = (Array.isArray(s.key_carrier_hotels) ? s.key_carrier_hotels : []).map(one).filter(Boolean);
      if (hotels.length) evidence.push(`Key carrier hotels in DC Hub's curated ${market || 'metro'} profile: ${hotels.join(', ')} (${baseRef()}).`);
      const pc = isObj(m.presence_carriers) ? m.presence_carriers : null;
      if (pc && pc.status === 'ok' && num(pc.total_carriers) != null) {
        const d = spokenDay(pc.as_of);   // the line's America/Phoenix day (lib/cite-day.mjs)
        if (d) dates.push(d);
        evidence.push(`PeeringDB lists ${fmt(num(pc.total_carriers))} carriers present${num(pc.total_facilities) != null ? ` across ${fmt(num(pc.total_facilities))} facilities` : ''}`
          + ` in ${market || 'the metro'}'s cities (presence at a facility, not route miles; get_metro_fiber${d ? `, as of ${d}` : ''}).`);
      }
    }

    // ---- any other fiber step's dated fact (on-net at a point, nearest subsea landing) ----
    const address = ctx && typeof ctx.address === 'string' && ctx.address ? ctx.address : null;
    const others = factsFromExecuted(executed, fullByEntry, address ? { address } : {}).filter((f) => f.tool !== 'get_peering_intel');
    for (const f of others) {
      if (!evidence.includes(f.text)) evidence.push(f.text);
      if (day(f.as_of)) dates.push(day(f.as_of));
    }

    // 10a: at a point or a building the caller gave, the on-net / near-net read there is the answer. A ranking ask
    // ("which carrier hotels near <point> have the most networks") keeps its ranking lead.
    const pointGiven = !!(ctx && (ctx.point_given || address));
    const readiness = pointGiven ? others.find((f) => f.tool === 'get_fiber_readiness') : null;
    const rankAsk = facilityAsk && /\b(?:which|most|top|rank\w*|list|best)\b/i.test(intent) && !/\b(?:on|near)[-\s]?net\b/i.test(intent);

    let headline;
    const liveOn = peeringDay ? `PeeringDB, read live on ${peeringDay}` : 'PeeringDB, read live';
    if (readiness && !(rankAsk && rankLine)) {
      headline = readiness.text;
    } else if (facilityAsk && rankLine && ranked.some((r) => r.net_count != null)) {
      headline = `Carrier hotels and facilities near ${place} with the most networks on PeeringDB: ${rankLine} (${liveOn}).`;
    } else if (facilityAsk && rankLine) {
      // The counts were withheld at this tier (a keyless preview returns the rows with net_count null): the rows still
      // come in PeeringDB's order, most networks first (backend connectivity_summary sorts by net_count).
      headline = `Carrier hotels and facilities near ${place} that PeeringDB lists with the most networks, most first: `
        + `${ranked.map((r) => r.name).join('; ')} (${liveOn}; the per-facility network counts are withheld at this access level).`;
    } else if (facilityAsk && hotels.length) {
      headline = `Key carrier hotels in ${market || place}: ${hotels.join(', ')} (DC Hub curated profile${baselineDay ? `, curated metro baseline as of ${baselineDay}` : ''}).`
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
    // A lead ranked from the live PeeringDB read is dated by that read; the curated baseline keeps its own date in
    // its evidence line.
    const asOf = facilityAsk && rankLine && peeringDay ? peeringDay : dates.length ? dates.slice().sort()[0] : null;
    // The answer's own cite (Source line and cite_as) says the answer's as_of, one date, never another step's: the
    // curated baseline keeps its date in baseline_as_of and its evidence line, labelled as the baseline's.
    let source = sourceLine(cite.p, cite.tool, cite.args);
    if (asOf) source = /, as of \d{4}-\d{2}-\d{2}$/.test(source) ? source.replace(/, as of \d{4}-\d{2}-\d{2}$/, `, as of ${asOf}`) : `${source}, as of ${asOf}`;
    return {
      kind: 'fiber',
      geography: place,
      headline,
      verdict: null,
      evidence,
      not_established: notEstablished,
      ...(ranked.length ? { ranked_facilities: ranked, ranked_facilities_basis: 'get_peering_intel connectivity.top_facilities (PeeringDB), most networks first' } : {}),
      as_of: asOf,
      ...(baselineDay && baselineDay !== asOf ? { baseline_as_of: baselineDay, baseline_as_of_basis: 'DC Hub curated metro baseline (get_metro_fiber), not a live feed' } : {}),
      ...(asOf ? { cite_as: `DC Hub (dchub.cloud), as of ${asOf}` } : {}),
      relay: null,
      source,
    };
  } catch (_e) { return null; }
}
