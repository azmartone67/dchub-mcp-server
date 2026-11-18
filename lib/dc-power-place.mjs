// dc-power-place.mjs -- planner 5.40: one place, both sides; energy price, gas price and queue-withdrawal asks.
//
// WHY. Grok's round-2 runs (2026-11-17 night, planner 5.39, keyless):
//   * cross-domain DC Hub 45/60. A data-center question about one place's power took whatever power class scored
//     highest: Phoenix went to capacity_search and its lead said "WECC (ISO)" with no power figure; Columbus went to
//     interconnection_queue and led with PJM's 373.5 GW while the Ohio slice and AEP Ohio's published feeder hosting
//     capacity (307 feeders, best 7.5 MW, keyless) were never quoted; Dallas went to price and read the US average
//     rate (13.04 cents/kWh) because get_energy_prices ran with no state, not Texas (7.68).
//   * energy head-to-head 132/240. "What is the price of electricity in ERCOT right now?" led with the generation
//     queue (461.4 GW); a gas question led with a data-center pipeline count; "how many projects withdrew from the
//     PJM queue" read the active queue.
//
// WHAT.
//   * dcPowerPlaceAsk(text, d, place): a data-center noun, a power noun and ONE bound place. The dc_power_place class
//     reads, in one wave: the market (facilities, MW floor, DCPI verdict), the grid's headroom (US RTO) or the filed
//     retirements (no RTO), the state slice of the queue, the utility's published feeder hosting capacity when the
//     place sits in a load-side covered territory, the state power timeline, and the state's electricity price when
//     price words are present (dcPowerPlaceSequence).
//   * priceNowAsk / priceNowSequence: a power-price ask about a grid with no data-center noun reads the price for
//     that grid and its live demand (get_grid_data metric=demand), so the answer leads with a price and its basis.
//   * queueWithdrawalsAsk / queueWithdrawalsSequence: withdrawn requests by ISO (and state).
//   * gridLabel(place, iso): "Phoenix (APS/SRP/TEP, WECC)", never "WECC (ISO)": WECC is a reliability region, not an
//     ISO, and the utilities are who a load interconnects with.
//   * anchorMarketForState(st): the market get_gas_economics reads when the question named only a state.
// Pure; nothing here throws.

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const DC_POWER_PLACE_MAX_STEPS = 8;

const DC_NOUN_RE = /\b(?:data\s*cent(?:er|re)s?|colo(?:cation)?|campus(?:es)?|facilit(?:y|ies)|hyperscale|ai\s+(?:cluster|campus|factory))\b/i;
const POWER_NOUN_RE = /\b(?:grid|headroom|interconnection|queues?|electricity|energy\s+prices?|power\s+(?:prices?|costs?|rates?|availability|supply|timing|timeline|side)|wholesale|lmps?|time[-\s]to[-\s]power|get\s+power|utility\s+power|substations?|feeders?|hosting\s+capacity)\b/i;
// "how soon ... power", "how long ... to get power": a timing ask about power.
const POWER_TIMING_RE = /\bhow\s+(?:soon|long|quickly|fast)\b[^.?!]{0,100}\bpower\b/i;
const PRICE_WORDS_RE = /\b(?:prices?|costs?|rates?|cents|kwh|mwh|tariffs?|lmps?)\b/i;

export function dcNoun(text) { return DC_NOUN_RE.test(String(text || '').slice(0, 2000)); }
export function powerNoun(text) { const t = String(text || '').slice(0, 2000); return POWER_NOUN_RE.test(t) || POWER_TIMING_RE.test(t); }
const WHOLESALE_RE = /\b(?:wholesale|lmps?|locational\s+marginal|spot\s+(?:power|electricity)|real[-\s]?time\s+(?:power\s+)?prices?|day[-\s]?ahead)\b/i;
export function priceWords(text) { return PRICE_WORDS_RE.test(String(text || '').slice(0, 2000)); }

// The classes a one-place data-center + power question may take over: each answers one side only. Every other class
// (colocation, gas, fiber, siting over several states, a point read, comparisons, rankings) keeps its question.
// market_outlook keeps "the power and interconnection outlook for <market>" (DCPI, brief, timeline). capacity_search
// ("how fast can 300 MW near Abilene get power") is taken only when the question also asks about the grid, and price
// ("power prices in Arizona for a data center") only when it also asks about the grid or timing.
export const DC_POWER_PLACE_STEALS = new Set(['grid_headroom', 'interconnection_queue', 'power_timeline', 'price',
  'capacity_search', 'dc_capacity', 'facility_search', 'unknown']);
const GRID_SIDE_RE = /\b(?:grid|headroom|interconnection|queues?|substations?|feeders?|hosting\s+capacity)\b/i;
/** May dc_power_place take a question the class `topId` would otherwise answer? */
export function dcPowerPlaceTakes(topId, text) {
  const t = String(text || '').slice(0, 2000);
  if (!DC_POWER_PLACE_STEALS.has(topId)) return false;
  if (topId === 'capacity_search') return GRID_SIDE_RE.test(t);
  // A timing-only question ("when can a data center get power in Georgia") keeps the timeline class, which leads with
  // time to power; a second power side (grid, queue, feeders, price) makes it a two-sided place question.
  if (topId === 'power_timeline') return GRID_SIDE_RE.test(t) || priceWords(t);
  if (topId === 'price') return GRID_SIDE_RE.test(t) || POWER_TIMING_RE.test(t) || /\btime[-\s]to[-\s]power\b/i.test(t);
  return true;
}

/**
 * A one-place data-center + power question. d: planner signals; place: lib/plan-pairs.mjs pairPlace(d) ({ market,
 * label, state, iso }). One place only: several states or markets, an explicit point (no corridor), a candidate id
 * or a colocation metro/pair keep their own class.
 */
export function dcPowerPlaceAsk(text, d, place) {
  try {
    if (!dcNoun(text) || !powerNoun(text)) return false;
    if (!isObj(d) || !isObj(place) || !place.state) return false;
    if (Array.isArray(d.states) && d.states.length > 1) return false;
    if (Array.isArray(d.__namedMarkets) && d.__namedMarkets.length > 1) return false;
    if (d.comparePair || (Array.isArray(d.isos) && d.isos.length > 1)) return false;
    if (d.coords && !d.placeScope) return false;
    if (d.candidateId) return false;
    if (d.__colo && (d.__colo.metro || d.__colo.pair || d.__colo.address)) return false;
    return true;
  } catch (_e) { return false; }
}

// Downtown points for the markets inside a utility territory that publishes LOAD-side hosting capacity (AEP Ohio and
// I&M, Ameren Illinois, Central Hudson, Avista). Used only to place a hosting-capacity read near a named market.
export const HOSTING_POINTS = Object.freeze({
  columbus: { lat: 39.9612, lon: -82.9988, label: 'Columbus, OH' },
  'columbus-oh': { lat: 39.9612, lon: -82.9988, label: 'Columbus, OH' },
  'new-albany': { lat: 40.0812, lon: -82.8088, label: 'New Albany, OH' },
  'new-albany-oh': { lat: 40.0812, lon: -82.8088, label: 'New Albany, OH' },
  'fort-wayne': { lat: 41.0793, lon: -85.1394, label: 'Fort Wayne, IN' },
  'fort-wayne-in': { lat: 41.0793, lon: -85.1394, label: 'Fort Wayne, IN' },
  peoria: { lat: 40.6936, lon: -89.5890, label: 'Peoria, IL' },
  'springfield-il': { lat: 39.7817, lon: -89.6501, label: 'Springfield, IL' },
  spokane: { lat: 47.6588, lon: -117.4260, label: 'Spokane, WA' },
  'spokane-wa': { lat: 47.6588, lon: -117.4260, label: 'Spokane, WA' },
  poughkeepsie: { lat: 41.7004, lon: -73.9210, label: 'Poughkeepsie, NY' },
});

/** The point a hosting-capacity read takes for this plan, or null: an explicit corridor point, else a market point. */
export function hostingPoint(d, place) {
  try {
    if (isObj(d) && isObj(d.coords) && num(d.coords.lat) != null && num(d.coords.lon) != null) {
      return { lat: d.coords.lat, lon: d.coords.lon, label: (isObj(place) && place.label) || null, radius_km: num(d.radiusKm) || 25 };
    }
    const keys = [isObj(place) && place.market, isObj(d) && d.__citySlug, isObj(d) && isObj(d.__outlook) && d.__outlook.slug]
      .filter((k) => typeof k === 'string' && k).map((k) => k.toLowerCase());
    for (const k of keys) if (HOSTING_POINTS[k]) return { ...HOSTING_POINTS[k], radius_km: 25 };
    return null;
  } catch (_e) { return null; }
}

// Who a load interconnects with in a market that sits on no US RTO.
export const NON_RTO_UTILITIES = Object.freeze({
  phoenix: 'APS/SRP/TEP', 'phoenix-az': 'APS/SRP/TEP', tucson: 'TEP', 'tucson-az': 'TEP',
  'las-vegas': 'NV Energy', 'las-vegas-nv': 'NV Energy', reno: 'NV Energy', 'reno-nv': 'NV Energy',
  'salt-lake-city': 'Rocky Mountain Power', 'salt-lake-city-ut': 'Rocky Mountain Power',
  atlanta: 'Georgia Power', 'atlanta-ga': 'Georgia Power',
  portland: 'PGE/PacifiCorp', 'portland-or': 'PGE/PacifiCorp', seattle: 'Seattle City Light/PSE', 'seattle-wa': 'Seattle City Light/PSE',
  denver: 'Xcel Energy', 'denver-co': 'Xcel Energy',
});
// Filed-retirement balancing authorities for a no-RTO state (get_retirement_headroom region_iso). AZ read live
// 2026-11-18 keyless: AZPS,SRP,TEPC returned Springerville 1 (TEPC, filed 2027-12-01) with the IRP caveat.
export const STATE_RETIREMENT_BAS = Object.freeze({ AZ: 'AZPS,SRP,TEPC', NV: 'NEVP', UT: 'PACE', WY: 'PACE' });

const RTOS = new Set(['ERCOT', 'PJM', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISO-NE', 'ISONE']);
const NON_RTO_REGION = { AZ: 'WECC', NV: 'WECC', UT: 'WECC', CO: 'WECC', OR: 'WECC', WA: 'WECC', ID: 'WECC', NM: 'WECC',
  GA: 'SERC', AL: 'SERC', NC: 'SERC', SC: 'SERC', TN: 'SERC', FL: 'SERC' };

/** "Phoenix (APS/SRP/TEP, WECC)" for a no-RTO place; "Columbus (PJM)" for an RTO place; never "<region> (ISO)". */
export function gridLabel(place, iso) {
  try {
    const p = isObj(place) ? place : {};
    const name = String(p.label || p.state || '').trim();
    const g = String(iso || p.iso || '').toUpperCase();
    if (g && RTOS.has(g)) return name ? `${name} (${g === 'ISONE' ? 'ISO-NE' : g})` : g;
    const key = String(p.market || '').toLowerCase();
    const utils = NON_RTO_UTILITIES[key] || NON_RTO_UTILITIES[name.toLowerCase().replace(/\s+/g, '-')] || null;
    const region = (g && !RTOS.has(g) ? g : null) || NON_RTO_REGION[String(p.state || '').toUpperCase()] || null;
    const inner = [utils, region].filter(Boolean).join(', ');
    if (name) return inner ? `${name} (${inner})` : name;
    return '';
  } catch (_e) { return ''; }
}

/**
 * The dc_power_place steps. place: pairPlace(d); hc: _planHostingCoverage(text, point) for the hosting point (only a
 * load-side hit earns a step); text: the question (price words add the price step).
 */
export function dcPowerPlaceSequence(d, place, hc, text) {
  const p = isObj(place) ? place : {};
  const st = p.state || null;
  const iso = p.iso && RTOS.has(String(p.iso).toUpperCase()) ? String(p.iso).toUpperCase() : null;
  const mw = isObj(d) && num(d.mw) ? Math.round(d.mw) : null;
  const where = p.label ? `${p.label}${st ? `, ${st}` : ''}` : st;
  const seq = [];
  const add = (tool, args, why, extra = {}) => seq.push({ step: seq.length + 1, tool, depends_on: [], estimated_calls: 1, why, args_hint: args, ...extra });
  if (p.market) {
    add('get_market_intel', { market: p.market }, `The data-center side of ${where}: facilities tracked, the MW floor of those that report capacity, and the market's Data Center Power Index (DCPI) verdict, each dated.`);
  } else {
    add('search_facilities', { state: st, ...(mw ? { min_capacity_mw: mw } : {}), limit: 10 }, `The data centers in ${st}${mw ? ` at ${mw} MW or more where capacity is disclosed` : ''}.`);
  }
  if (iso) {
    add('get_grid_intelligence', { iso }, `${iso} headroom for ${where}: average time to power, DCPI build rate and constraint band, reserves, each with its as_of (withheld below full access, and said so).`);
  } else if (st && STATE_RETIREMENT_BAS[st]) {
    add('get_retirement_headroom', { target_mw: mw || 100, horizon_months: 36, region_iso: STATE_RETIREMENT_BAS[st] },
      `${where} is on no US RTO (${gridLabel(p, null)}): headroom read as filed generator retirements in the serving balancing authorities (EIA-860M), with the utility-plan caveat.`);
  }
  if (st) {
    add('get_refined_queue', { ...(iso ? { iso: iso === 'ISO-NE' ? 'ISONE' : iso } : {}), state: st },
      `The ${st} slice of the ${iso || 'US'} interconnection queue (active generation requests located in ${st}, dated by the ISO file): the narrowest queue read for the place.`,
      // The whole slice: a min_mw of the buyer's size would count only the large requests and mislabel the count.
      { unsized: true });
  }
  const pt = hostingPoint(d, p);
  if (pt && isObj(hc) && hc.answers_load) {
    add('get_hosting_capacity', { lat: pt.lat, lon: pt.lon, radius_km: pt.radius_km || 25, capacity_type: 'load', limit: 10 },
      `Utility-published LOAD-side feeder hosting capacity near ${pt.label || where} (${hc.utility}): distribution grain, not binding; verify with the utility.`);
  }
  if (st) {
    add('get_power_availability_timeline', { state: st, ...(mw ? { mw } : {}) },
      `Time to power context for ${st}: firm-supply signal by year (EIA-860M) and the queue context, supply-side only.`);
  }
  if (st && priceWords(text)) {
    add('get_energy_prices', { state: st }, `What power costs in ${st}: the EIA retail rate, dated by its last month (a retail average, not a wholesale price).`, { price_side: true });
  }
  // Wholesale asked on an RTO: the ISO's own price block (live LMP where its publisher allows, published figures and
  // the live-price link for PJM, or the reason it is withheld). The backend reads wholesale prices by iso, not state.
  if (iso && WHOLESALE_RE.test(String(text || '').slice(0, 2000))) {
    add('get_energy_prices', { iso: iso === 'ISO-NE' ? 'ISONE' : iso }, `${iso} wholesale prices: the hub LMP where ${iso}'s terms allow republishing (credited, with its interval), else ${iso}'s published price figures or the reason none is served.`, { price_side: true, wholesale_side: true });
  }
  return seq;
}

// ---- price_now: a power price for a grid, now ----
const PRICE_NOW_RE = /\b(?:(?:power|electricity|energy|electric|wholesale|spot)\s+(?:prices?|costs?|rates?)|prices?\s+of\s+(?:power|electricity|energy)|lmps?|locational\s+marginal|cents\s*\/\s*kwh|\$\s*\/\s*mwh)\b/i;
export function priceNowAsk(text, d) {
  try {
    const t = String(text || '').slice(0, 2000);
    if (!PRICE_NOW_RE.test(t) || dcNoun(t)) return false;
    if (/\bgas\b|\bhenry\s*hub\b|\bmmbtu\b/i.test(t)) return false;
    return !!(isObj(d) && (d.iso || (Array.isArray(d.isos) && d.isos.length === 1)));
  } catch (_e) { return false; }
}
export function priceNowSequence(d) {
  const iso = String((isObj(d) && (d.iso || (Array.isArray(d.isos) && d.isos[0]))) || '').toUpperCase();
  return [
    { step: 1, tool: 'get_energy_prices', depends_on: [], estimated_calls: 1,
      why: `The power price DC Hub serves for ${iso}: the EIA retail rate averaged over the ISO footprint, dated by its last month. DC Hub serves EIA retail averages and the Henry Hub spot, not real-time LMP.`,
      args_hint: { iso: iso === 'ISO-NE' ? 'ISONE' : iso } },
    { step: 2, tool: 'get_grid_data', depends_on: [], estimated_calls: 1,
      why: `${iso} live demand (EIA-930 hourly), the "right now" side of the question.`,
      args_hint: { iso: iso === 'ISO-NE' ? 'ISONE' : iso, metric: 'demand' } },
  ];
}

// ---- queue_withdrawals ----
const WITHDRAW_RE = /\bwithdr(?:ew|awn|awals?|aw(?:ing|s)?)\b|\bdropped\s+out\b|\bcancell?ed\b/i;
const QUEUE_RE = /\b(?:queues?|interconnection|requests?|projects?)\b/i;
export function queueWithdrawalsAsk(text) { const t = String(text || '').slice(0, 2000); return WITHDRAW_RE.test(t) && QUEUE_RE.test(t); }
export function queueWithdrawalsSequence(d, place) {
  const iso = isObj(d) && d.iso ? String(d.iso).toUpperCase() : (isObj(place) && place.iso ? place.iso : null);
  const st = (isObj(d) && (d.state || d.stateFromPlace)) || (isObj(place) && place.state) || null;
  return [
    { step: 1, tool: 'get_refined_queue', depends_on: [], estimated_calls: 1,
      why: `Withdrawn generation requests${iso ? ` in the ${iso} queue` : ''}${st ? ` located in ${st}` : ''} (status=withdrawn), dated by the ISO file.`,
      args_hint: { ...(iso ? { iso: iso === 'ISO-NE' ? 'ISONE' : iso } : {}), ...(st ? { state: st } : {}), status: 'withdrawn' } },
    { step: 2, tool: 'get_interconnection_queue', depends_on: [], estimated_calls: 1,
      why: `The active queue${iso ? ` for ${iso}` : ''} the withdrawals left, with the ISO report date.`,
      args_hint: iso ? { iso: iso === 'ISO-NE' ? 'ISONE' : iso } : {} },
  ];
}

// ---- gas economics from a state ----
export const STATE_ANCHOR_MARKET = Object.freeze({
  TX: 'dallas', VA: 'northern-virginia', AZ: 'phoenix', GA: 'atlanta', OH: 'columbus', IL: 'chicago', OR: 'portland',
  NV: 'las-vegas', UT: 'salt-lake-city', NC: 'charlotte', NJ: 'new-jersey', NY: 'new-york', CA: 'silicon-valley',
  WA: 'seattle', CO: 'denver', PA: 'pittsburgh', LA: 'new-orleans', OK: 'oklahoma-city', TN: 'nashville', FL: 'miami',
});
export function anchorMarketForState(st) { return STATE_ANCHOR_MARKET[String(st || '').toUpperCase()] || null; }
