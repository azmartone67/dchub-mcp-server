// plan-routing.mjs — planner 5.37 (Grok MCP-dominance evals 2026-11-17, gaps 4 and 6): fiber, subsea and
// point-infrastructure asks reach the tools that answer them. Pure; server.mjs scores and applies these in _planQuery.
//
//   gap 4  Every fiber ask ran one recipe (get_fiber_intel longhaul, then get_fiber_readiness and plan_fiber_leadin
//          skipped_unresolved). get_metro_fiber and get_peering_intel never ran; an on-net check at a point and a
//          subsea ask went to site_analysis.
//          Now: carrier hotel / IX / metro fiber -> get_metro_fiber + get_peering_intel; a point + fiber ->
//          get_fiber_readiness and get_peering_intel AT THAT POINT; subsea -> get_subsea_cables.
//   gap 6  "transmission lines / plants / gas pipelines near <lat, lon>" went to site_analysis bands. Now
//          get_infrastructure at the point: what is within the radius, by asset class, with the counted basis.
//
// ★ get_infrastructure returns COUNTS inside a box around the point (substations, transmission line segments, gas
// pipeline segments, power plants), not a nearest asset. Its `layer` argument is accepted and ignored by the
// backend, so it is never passed. analyze_site runs alongside it for the point's power-infrastructure read.
//
// Fiber 1124 (Grok Brain note 2026-11-24, item 10a-c):
//   a  A fiber ask at a building the text names ("350 E Cermak, Chicago") reads that building: the address is
//      geocoded at execution and get_fiber_readiness runs there (fiberAddress, pointFiberSequence).
//   b  An internet-exchange / peering / carrier-hotel ask with no colocation-space wording is a fiber ask
//      (get_metro_fiber + get_peering_intel), not a facility search or a colocation plan (ixAsk).
//   c  A route ask names two metros ("from Phoenix to Los Angeles", "between Dallas and Houston"): both ends are read
//      (get_fiber_intel longhaul per metro) and the pair's round-trip floor (cluster_sites_by_latency) (routePair).
import { COLO_METROS, resolveColoMetro } from './colocation-plan.mjs';
import { addressFromText } from './plan-step-facts.mjs';

export const SUBSEA_RE = /\b(?:sub[-\s]?sea|submarine|undersea)\b|\bcable\s+landings?\b|\blanding\s+(?:stations?|points?|sites?)\b/i;
// Words that make a point ask a fiber ask.
const POINT_FIBER_RE = /\bon[-\s]?net\b|\bnear[-\s]?net\b|\bfib(?:er|re)\b|\bcarriers?\b|\bconnectivity\b|\bpeering\b|\binternet\s+exchanges?\b|\bIXPs?\b|\blit\s+buildings?\b/i;
// Words that make a market-wide fiber ask a metro / interconnection ask.
const METRO_FIBER_RE = /\bcarrier[-\s]hotels?\b|\binternet\s+exchanges?\b|\bIXPs?\b|\bpeering\b|\bmeet[-\s]me\s+rooms?\b|\bmetro\s+fib(?:er|re)\b|\bon[-\s]?net\b|\bcross[-\s]connects?\b/i;
// A point ask that is about the whole site, not fiber alone, stays a site analysis.
const OTHER_SITE_FACTOR_RE = /\b(?:water|flood|hazard|risk|tax|incentives?|zoning|grid|substations?|power|climate|permit|analy[sz]e|evaluate|assess|suitab|feasib|due\s+diligence|site\s+(?:report|analysis))\b/i;
const LEADIN_RE = /\blead[-\s]?ins?\b|\bdiverse\s+(?:paths?|routes?)\b|\broute\s+to\b|\blaterals?\s+to\b/i;

// 10b: the interconnection words. "IX" is matched upper-case only, as a whole word ("six", "mix" never match).
const IX_UPPER_RE = /\bIX(?:P?s)?\b/;
const IX_WORDS_RE = /\binternet\s+exchanges?\b|\bixps?\b|\bpeering\b|\bcarrier[-\s]hotels?\b/i;
// Words that make an interconnection ask a colocation-space ask (space, price, availability, a cross-connect ordered
// in the building), which keeps its plan (5.32).
const COLO_SPACE_RE = /\bcolo(?:cation|cated)?\b|\bcross[-\s]*connects?\b|\bcages?\b|\bcabinets?\b|\bracks?\b|\bkw\b|\bpric(?:e|es|ed|ing)\b|\bcosts?\b|\bleas(?:e|es|ing)\b|\brent(?:al)?\b|\bvacan(?:t|cy)\b|\bavailab(?:le|ility)\b|\bmove[-\s]*in\b|\bcompare\b|\bversus\b|\bvs\b/i;
/** True when the text asks about internet exchanges, peering or carrier hotels, and not about colocation space. */
export function ixAsk(text) {
  const t = String(text || '').slice(0, 2000);
  return (IX_UPPER_RE.test(t) || IX_WORDS_RE.test(t)) && !COLO_SPACE_RE.test(t);
}

// 10c: a route ask names two tracked metros joined by "from X to Y" or "between X and Y".
const ROUTE_ASK_RE = /\bfib(?:er|re)\b|\blatency\b|\brtt\b|\bround[-\s]?trip\b|\blong[-\s]?haul\b|\broutes?\b|\bpaths?\b/i;
const SIDE_END = String.raw`(?=\s*(?:[?.!,;:()]|$)|\s+(?:for|in|with|via|over|on|using|and|at|by|under|within)\b)`;
const PAIR_RES = [
  new RegExp(String.raw`\bbetween\s+(.{2,60}?)\s+and\s+(.{2,60}?)` + SIDE_END, 'i'),
  new RegExp(String.raw`\bfrom\s+(.{2,60}?)\s+to\s+(.{2,60}?)` + SIDE_END, 'i'),
];
/** The two tracked metros a route ask joins ({a, b}: COLO_METROS rows, first-named first), or null. */
export function routePair(text) {
  try {
    const t = String(text || '').slice(0, 1000);
    if (!ROUTE_ASK_RE.test(t) || LEADIN_RE.test(t)) return null;
    for (const re of PAIR_RES) {
      const m = re.exec(t);
      if (!m) continue;
      const a = resolveColoMetro(m[1]), b = resolveColoMetro(m[2]);
      if (a && b && a.metro && b.metro && a.metro.id !== b.metro.id) return { a: a.metro, b: b.metro };
    }
    return null;
  } catch (_e) { return null; }
}

// 10a: the building a fiber ask names. A strict street address (_planSignals __address) is used as it is; otherwise
// a house number + street inside a tracked metro ("350 E Cermak, Chicago") is geocoded as "<number street>, <metro
// town>, <state>". A year ("2026 Phoenix") is never a house number.
const LOOSE_NOT_STREET_RE = /^\d+\s+(?:[NSEW]\.?\s+)?(?:Carriers?|Data|Fib(?:er|re)|Internet|Facilit\w*|Markets?|Sites?|Campus\w*|Colo\w*|Cities|Metros?|Networks?|Routes?|Hotels?|Buildings?|Peering|Exchanges?|Providers?|Operators?|Miles?|Years?|Months?|Days?|Hours?)\b/;
const LOOSE_COUNT_BEFORE_RE = /\b(?:top|best|first|last|over|under|about|around|nearly|almost|than)\s+$/i;
const LOOSE_ADDRESS_END_RE = /^(?:\s*[,?.!;:)]|\s*$|\s+(?:in|at|near|on|for|is|has|have|with)\b)/i;
/** { query, label, state, metro?, strict } for the building a fiber ask names, or null. */
export function fiberAddress(text, d) {
  try {
    if (d && d.__address && typeof d.__address.query === 'string' && d.__address.query) {
      const m = resolveColoMetro(String(text || ''), d && d.market);
      return { query: d.__address.query, label: d.__address.query, state: d.__address.state || null,
        ...(m && m.metro ? { metro: m.metro } : {}), strict: true };
    }
    const t = String(text || '').slice(0, 2000);
    const a = addressFromText(t);
    if (!a || /^(?:19|20)\d{2}\s/.test(a) || LOOSE_NOT_STREET_RE.test(a)) return null;
    // "top 10 Carrier hotels", "about 50 Facilities": a count, not a house number.
    const at = t.indexOf(a);
    if (at > 0 && LOOSE_COUNT_BEFORE_RE.test(t.slice(Math.max(0, at - 20), at))) return null;
    // A building's address ends there ("350 E Cermak, Chicago", "350 E Cermak?", "350 E Cermak in Chicago"); a count
    // runs on into its noun ("25 Largest buildings").
    if (!LOOSE_ADDRESS_END_RE.test(t.slice(at + a.length))) return null;
    const m = resolveColoMetro(t, d && d.market);
    if (!m || !m.metro) return null;
    return { query: `${a}, ${m.metro.query}, ${m.metro.state}`, label: a, state: m.metro.state, metro: m.metro, strict: false };
  } catch (_e) { return null; }
}

export const INFRA_ASSET_RE = /\b(?:transmission|power|hv|high[-\s]voltage|\d{2,3}\s*kv)\s+lines?\b|\bsubstations?\b|\bpower\s+plants?\b|\bgenerat(?:ing|ion)\s+(?:plants?|stations?|units?|assets?)\b|\bgas\s+(?:pipelines?|lines?|laterals?)\b|\bpipelines?\b/i;
const NEAR_RE = /\bnear(?:est|by)?\b|\bclosest\b|\bwithin\b|\baround\b|\bdistances?\b|\bhow\s+far\b|\bproximity\b|\bnext\s+to\b|\bsurrounding\b/i;
const WHOLE_SITE_RE = /\b(?:analy[sz]e|evaluate|assess|score|suitab|feasib|due\s+diligence|site\s+(?:report|analysis)|water|flood|hazard|tax|incentives?)\b/i;

// US subsea landing hubs a question names without coordinates (centroids; landing points are read around them).
const SUBSEA_HUBS = [
  { re: /\bvirginia\s+beach\b/i, label: 'Virginia Beach, VA', lat: 36.8529, lon: -75.978 },
  { re: /\bmyrtle\s+beach\b/i, label: 'Myrtle Beach, SC', lat: 33.6891, lon: -78.8867 },
  { re: /\bjacksonville\b/i, label: 'Jacksonville, FL', lat: 30.3322, lon: -81.6557 },
  { re: /\bboca\s+raton\b/i, label: 'Boca Raton, FL', lat: 26.3683, lon: -80.1289 },
  { re: /\bmiami\b/i, label: 'Miami, FL', lat: 25.7617, lon: -80.1918 },
  { re: /\bnew\s+york\b|\bnyc\b|\bmanhattan\b|\blong\s+island\b/i, label: 'New York, NY', lat: 40.7128, lon: -74.006 },
  { re: /\bwall\s+township\b|\bnew\s+jersey\s+shore\b/i, label: 'Wall Township, NJ', lat: 40.1557, lon: -74.0652 },
  { re: /\bhermosa\s+beach\b|\bel\s+segundo\b|\blos\s+angeles\b/i, label: 'Los Angeles, CA', lat: 34.0522, lon: -118.2437 },
  { re: /\bgrover\s+beach\b|\bmorro\s+bay\b/i, label: 'Grover Beach, CA', lat: 35.1208, lon: -120.6213 },
  { re: /\bpacific\s+city\b|\bhillsboro\b|\boregon\s+coast\b/i, label: 'Pacific City, OR', lat: 45.2023, lon: -123.9627 },
  { re: /\bseattle\b/i, label: 'Seattle, WA', lat: 47.6062, lon: -122.3321 },
  { re: /\bhonolulu\b|\bhawaii\b|\boahu\b/i, label: 'Honolulu, HI', lat: 21.3069, lon: -157.8583 },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const hasPoint = (d) => !!(d && d.coords && isNum(d.coords.lat) && isNum(d.coords.lon));

function km(aLat, aLon, bLat, bLon) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The tracked colocation metro whose interconnection core is nearest the point, within maxKm, or null. */
export function nearestMetro(lat, lon, maxKm = 40) {
  if (!isNum(lat) || !isNum(lon)) return null;
  let best = null;
  for (const m of COLO_METROS) {
    const dk = km(lat, lon, m.lat, m.lon);
    if (dk <= maxKm && (!best || dk < best.km)) best = { metro: m, km: Math.round(dk * 10) / 10 };
  }
  return best;
}

/** 'subsea' | 'route' | 'point' | 'metro' | null — which fiber read the text asks for. d: _planSignals output. */
export function fiberKind(text, d) {
  const t = String(text || '');
  if (SUBSEA_RE.test(t)) return 'subsea';
  // A corridor centroid (placeScope) is not a point the caller gave, so it never blocks a two-metro route ask.
  if (!(hasPoint(d) && !d.placeScope) && routePair(t)) return 'route';
  const pointish = hasPoint(d) ? !d.placeScope : !!fiberAddress(t, d);
  if (pointish && POINT_FIBER_RE.test(t) && !OTHER_SITE_FACTOR_RE.test(t)) return 'point';
  if (METRO_FIBER_RE.test(t) || ixAsk(t)) return 'metro';
  return null;
}

/** True when the text asks what power / gas infrastructure is near a point the plan holds. */
export function pointInfraAsk(text, d) {
  const t = String(text || '');
  return hasPoint(d) && INFRA_ASSET_RE.test(t) && NEAR_RE.test(t) && !WHOLE_SITE_RE.test(t) && !SUBSEA_RE.test(t);
}

/** Where a subsea ask is read: the point the text gave, a corridor centroid, a named landing hub or metro, else null. */
export function subseaWhere(text, d) {
  if (hasPoint(d)) return { lat: d.coords.lat, lon: d.coords.lon, label: d.placeScope && d.placeScope.label ? d.placeScope.label : null };
  const t = String(text || '');
  for (const h of SUBSEA_HUBS) if (h.re.test(t)) return { lat: h.lat, lon: h.lon, label: h.label };
  const m = resolveColoMetro(t, d && d.market);
  if (m && m.metro) return { lat: m.metro.lat, lon: m.metro.lon, label: `${m.metro.label}, ${m.metro.state}` };
  return null;
}

const step = (tool, why, args_hint, depends_on = []) => ({ step: 0, tool, depends_on, estimated_calls: 1, why, args_hint });
const number = (seq) => seq.map((s, i) => ({ ...s, step: i + 1 }));

/** get_subsea_cables near the place (landing points by distance), then peering at that place; the catalogue when no place. */
export function subseaSequence(d) {
  const w = d && d.__subsea;
  if (!w) {
    return number([step('get_subsea_cables', 'No place was named: the subsea cable catalogue (each cable and its landings).', {})]);
  }
  const radius = isNum(d.radiusKm) ? Math.min(500, Math.max(20, d.radiusKm)) : 100;
  return number([
    step('get_subsea_cables', `Subsea landing points within ${radius} km of ${w.label || `${w.lat}, ${w.lon}`}, nearest first, each with its distance.`,
      { lat: w.lat, lon: w.lon, radius_km: radius }),
    step('get_peering_intel', 'The terrestrial interconnection at the same place (PeeringDB facilities, IX presence, networks).',
      { lat: w.lat, lon: w.lon }),
  ]);
}

/** A fiber read at the point the text gave: readiness and peering at that point, and its metro's fiber map when near one. */
export function pointFiberSequence(d, text) {
  // Fiber 1124 (10a): a building the text names is geocoded at execution. Its steps carry the lat/lon placeholders that the
  // planner's geocode pass marks with the address (_planGeocodeTargets basis 'address', filled by _execGeocodePlan).
  const point = hasPoint(d) && !d.placeScope;
  const addr = point ? null : fiberAddress(text, d);
  const lat = addr ? '<site lat>' : d.coords.lat;
  const lon = addr ? '<site lon>' : d.coords.lon;
  const where = addr ? addr.label : `${lat}, ${lon}`;
  const near = addr ? (addr.metro ? { metro: addr.metro, km: null } : null) : nearestMetro(lat, lon);
  const seq = [
    step('get_fiber_readiness', `On-net / near-net status, nearest carrier distance and carrier diversity at ${where}.`,
      { lat, lon, ...(isNum(d.radiusKm) ? { radius_km: Math.min(200, Math.max(5, d.radiusKm)) } : {}) }),
    step('get_peering_intel', `Peering around ${where}: PeeringDB facilities nearby, IX presence and networks.`, { lat, lon }),
  ];
  if (near) {
    seq.push(step('get_metro_fiber', `${near.metro.label}'s fiber map (carriers, key carrier hotels, dark fiber)`
      + (near.km != null ? `: the point is ${near.km} km from its interconnection core.` : `: ${where} is in that metro.`),
      { market: near.metro.label }));
  }
  if (LEADIN_RE.test(String(text || ''))) {
    seq.push(step('plan_fiber_leadin', 'Diverse lead-in routes from the point to the carrier hotel the metro map names.',
      { from: addr ? addr.query : `${lat},${lon}`, to: '<carrier hotel / POP from the get_metro_fiber step>', n: 4 }, near ? [seq.length] : []));
  }
  return number(seq);
}

/** 10c: a route between two metros: long-haul routes touching each end, and the pair's round-trip latency floor. */
export function routeFiberSequence(d) {
  const r = d && d.__fiberRoute;
  if (!r || !r.a || !r.b) return null;
  const { a, b } = r;
  return number([
    step('get_fiber_intel', `Long-haul fiber routes touching ${a.label}, one end of the ${a.label} to ${b.label} route.`,
      { route_type: 'longhaul', market: a.dcpi_slug }),
    step('get_fiber_intel', `Long-haul fiber routes touching ${b.label}, the other end; a route in both reads joins the two metros.`,
      { route_type: 'longhaul', market: b.dcpi_slug }),
    step('cluster_sites_by_latency', `Great-circle distance and round-trip latency floor between ${a.label} and ${b.label} (physics floor x route factor: an estimate, not a measured path).`,
      { sites: `${a.lat},${a.lon}:${a.id};${b.lat},${b.lon}:${b.id}`, max_latency_us: 100000 }),
  ]);
}

/** A metro / interconnection fiber read: the metro fiber map, peering at its core, and its metro routes. */
export function metroFiberSequence(d, text) {
  const m = resolveColoMetro(String(text || ''), d && d.market);
  const market = m && m.metro ? m.metro.label : (d && d.market) || null;
  const seq = [];
  seq.push(step('get_metro_fiber', market ? `${market}'s fiber map: carriers, key carrier hotels and dark fiber.`
    : 'Every tracked metro ranked by fiber density (no metro was named).', market ? { market } : {}));
  if (m && m.metro) {
    seq.push(step('get_peering_intel', `Peering at ${m.metro.label}'s interconnection core: PeeringDB facilities, IX presence and networks.`,
      { lat: m.metro.lat, lon: m.metro.lon }));
  } else {
    seq.push(step('get_peering_intel', 'The internet exchange directory (PeeringDB): no metro point was named.', {}));
  }
  if (market) {
    seq.push(step('get_fiber_intel', `Metro fiber routes touching ${market}.`, { route_type: 'metro', market: (m && m.metro && m.metro.dcpi_slug) || market }));
  }
  return number(seq);
}

/** The fiber class's sequence for a kind fiberKind() set on d.__fiberKind, or null for the default recipe. */
export function fiberKindSequence(d, text) {
  if (!d || !d.__fiberKind) return null;
  if (d.__fiberKind === 'route') return routeFiberSequence(d);
  if (d.__fiberKind === 'point' && ((hasPoint(d) && !d.placeScope) || fiberAddress(text, d))) return pointFiberSequence(d, text);
  if (d.__fiberKind === 'metro') return metroFiberSequence(d, text);
  return null;
}

/** What is near a point: get_infrastructure (counts within the radius by asset class), then analyze_site at the point. */
export function pointInfraSequence(d) {
  const { lat, lon } = d.coords;
  const radius = isNum(d.radiusKm) ? Math.min(200, Math.max(5, d.radiusKm)) : 25;
  return number([
    step('get_infrastructure', `Substations, transmission line segments, gas pipeline segments and power plants within ${radius} km of ${lat}, ${lon}, each count with its basis.`,
      { lat, lon, radius_km: radius }),
    step('analyze_site', 'The same point\'s power-infrastructure read (substation proximity band and the site verdict).', { lat, lon }),
  ]);
}
