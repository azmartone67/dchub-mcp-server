// plan-workflows-1122.mjs — planner 5.60 (/workflows spec §7, 2026-11-22). Pure; never throws.
//
// §7.2 fiberOverlapSequence: the fiber class's default recipe. "Where do fiber routes, substations and candidate data
//      center sites overlap around Hillsboro, Oregon?" ran fiber reads only, and with no lat/lon get_fiber_readiness was
//      skipped_unresolved. Now the metro the text or context.market names lends its published centroid (COLO_METROS),
//      and a question naming substations or candidate sites adds get_infrastructure (substation counts around the point)
//      and find_sites (substation-anchored search areas with fiber distance).
// §7.3 dueDiligenceClass / dueDiligenceSequence: "Evaluate the infrastructure risks of a proposed 300 MW data center
//      investment in Atlanta ..." routed to water_climate and read no power or fiber. The default six steps, in order:
//      DCPI verdict, grid power, fiber at the point, water, FEMA hazard, permitting. A caller passing max_steps 8 also
//      gets the state's refined queue and the seismic/climate read (steps 7-8).
import { resolveColoMetro } from './colocation-plan.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const number = (seq) => { seq.forEach((x, i) => { x.step = i + 1; }); return seq; };
const step = (tool, why, args_hint, depends_on = []) => ({ step: 0, tool, depends_on, estimated_calls: 1, why, args_hint });
const givenPoint = (d) => (d && d.coords && isNum(d.coords.lat) && isNum(d.coords.lon)) ? { lat: d.coords.lat, lon: d.coords.lon } : null;
const metroOf = (text, market) => { try { return resolveColoMetro(text, market) || null; } catch (_e) { return null; } };

const SUBSTATION_RE = /\bsubstations?\b/i;
const SITES_RE = /\b(?:candidate|data[-\s]cent(?:er|re)|campus|buildable)\s+(?:data[-\s]cent(?:er|re)\s+)?sites?\b/i;

export function fiberOverlapSequence(d, text) {
  const t = String(text || '');
  const metro = metroOf(t, d && d.market);
  let pt = givenPoint(d);
  let viaCentroid = false;
  if (!pt && metro && metro.metro && isNum(metro.metro.lat) && isNum(metro.metro.lon)) {
    pt = { lat: metro.metro.lat, lon: metro.metro.lon }; viaCentroid = true;
  }
  const market = (d && d.market) || (metro && metro.metro && metro.metro.dcpi_slug) || null;
  const seq = [
    step('get_fiber_intel', 'Long-haul / metro dark-fiber routes, carriers, and route density (GeoJSON) — optionally scoped to one metro.',
      { route_type: 'longhaul', market: market || '<metro name or slug, e.g. dallas>' }),
    step('get_fiber_readiness', viaCentroid
      ? `Point-level connectivity score + nearest-carrier distance at ${metro.metro.label}'s published centroid (no site point was given). Independent — run in parallel with step 1.`
      : 'Point-level connectivity score + nearest-carrier distance for a specific site. Independent — run in parallel with step 1.',
      pt ? { lat: pt.lat, lon: pt.lon } : { lat: '<site lat>', lon: '<site lon>' }),
  ];
  const subs = SUBSTATION_RE.test(t);
  if (pt && subs) {
    seq.push(step('get_infrastructure', `Substations (and transmission, gas and plants) counted within 25 km of ${pt.lat}, ${pt.lon}: the power side of the overlap the question asks for.`,
      { lat: pt.lat, lon: pt.lon, radius_km: 25 }));
  }
  if (pt && (subs || SITES_RE.test(t))) {
    seq.push(step('find_sites', 'Candidate search areas anchored on real substations near the point, each with its fiber and gas distance: where fiber, substations and sites coincide. A search area is not a parcel.',
      { lat: pt.lat, lon: pt.lon }));
  }
  seq.push(step('plan_fiber_leadin', 'N diverse road-following lead-in routes from the site to a carrier hotel/POP, with indicative cost + diversity read — pick the POP from the step-1 carrier map.',
    { from: pt ? `${pt.lat},${pt.lon}` : '<site "lat,lng" or address>', to: '<carrier hotel / POP from the step-1 carrier map>', n: 4 }, [1]));
  return number(seq);
}

// deps: { stateScope(d) -> 'GA' | null, isRto(iso) -> bool, waterWhere(d) -> args | null } from server.mjs.
export function dueDiligenceSequence(d, deps) {
  const st = (deps && deps.stateScope && deps.stateScope(d)) || null;
  const slug = (d && d.market) || (d && d.__outlook && typeof d.__outlook.slug === 'string' ? d.__outlook.slug : null);
  const metro = slug ? metroOf('', slug) : null;
  let pt = givenPoint(d);
  if (!pt && metro && metro.metro && isNum(metro.metro.lat) && isNum(metro.metro.lon)) pt = { lat: metro.metro.lat, lon: metro.metro.lon };
  const state = st || (metro && metro.metro && metro.metro.state) || null;
  const rawIso = d && (d.iso || d.isoFromPlace);
  const P = () => (pt ? { lat: pt.lat, lon: pt.lon } : { lat: '<site lat>', lon: '<site lon>' });
  const S = state || '<2-letter state>';
  const water = (deps && deps.waterWhere && deps.waterWhere(d)) || { state: S };
  return number([
    step('get_market_dcpi_rank', "The market's Data Center Power Index (DCPI) card: BUILD/CAUTION/AVOID verdict, time to power and its as_of. The power verdict an investment read leads with.",
      { market_slug: slug || '<market slug>' }),
    (deps && deps.isRto && deps.isRto(rawIso))
      ? step('get_grid_intelligence', 'Grid supply for the ISO: headroom, constraints, generation additions and time to power.', { iso: rawIso })
      : step('get_power_availability_timeline', "The state's power timeline (dated new capacity, retirements, queue context): grid supply where the place is on no US RTO.", { state: S }),
    step('get_fiber_readiness', 'Fiber at the site point: on-net / near-net status, nearest carrier distance and carrier diversity.', P()),
    step('get_water_risk', 'Water availability (U.S. Drought Monitor / WRI Aqueduct water stress) for the place.', water),
    step('get_disaster_risk', 'FEMA National Risk Index rating and top hazards at the point.', P()),
    step('get_permitting_intel', 'Permitting climate for the state: moratoriums, zoning actions and local opposition signals.', { state: S }),
    // Steps 7-8 run only when the caller raises max_steps to 8.
    step('get_refined_queue', 'Interconnection-queue survivors in the state (state filter): the queue side of grid risk.',
      { state: S, ...(d && d.mw ? { min_mw: d.mw } : {}), geocoded_only: true }),
    step('get_climate_intel', 'USGS seismic and NOAA cooling degree-days at the point.', P()),
  ]);
}

export function dueDiligenceClass(sequence) {
  return {
    id: 'due_diligence', recipe: null,
    patterns: [
      [/\bdue[-\s]diligence\b/i, 7], [/\binfrastructure\s+risks?\b/i, 7],
      [/\binvestment\s+(?:risks?|case|thesis|review|memo)\b/i, 4],
      [/\b(?:evaluate|assess|underwrite|vet)\b[^.?!]{0,80}\b(?:investment|acquisition|campus\s+deal)\b/i, 4],
    ],
    rationale: 'One risk read across every side an investor underwrites: the market power verdict, grid supply, fiber, water, hazard and permitting, each a dated, cited read on the same place, run in one parallel wave.',
    sequence,
    alternatives: [
      { tool: 'get_composite_site_score', when: 'You want ONE 0-100 verdict with a per-factor coverage map instead of the separate reads.',
        rejected_because: 'An investment read keeps each side citable on its own; the composite folds them into one number.' },
      { tool: 'generate_site_analysis', when: 'You want a written site report for one parcel.',
        rejected_because: 'The intent asked for a multi-side risk read on a market or campus, not a report document.' },
    ],
    coverage_notes: 'Each step returns its own as_of and citation. Water and permitting read at state or point grain, so say which grain a figure is. Report an unavailable factor as unknown; never estimate.',
  };
}
