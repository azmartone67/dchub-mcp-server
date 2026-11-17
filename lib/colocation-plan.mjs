// colocation-plan.mjs — planner 5.32: the colocation intent class (Brain note, colocation head-to-head 2026-11-16).
//
// Repro before this module (keyless, 2026-11-17 04:19–04:21Z, planner 5.31):
//   "Colocation options in Northern Virginia (Ashburn) for about 500 kW" (market="Northern Virginia", state="VA")
//     -> facility_search: search_facilities{state:VA} -> get_facility{slug:"northern-virginia"} (404)
//        -> site_selection_canvas{region:VA}; the answer led with "Culpeper: AVOID · Aldie: AVOID · Chester: AVOID".
//   Dallas, Atlanta and Chicago: get_facility{slug:"dallas-tx" | "atlanta-ga" | "chicago-il"} (404), facility search
//   widened to the whole state, no comparison step.
// Causes: colocation words scored only 2 inside facility_search; the facility search took the state, never the
// metro; and get_facility's '<slug from a step-1 row>' resolved through the shared slug pool, whose first value is
// the intent's MARKET slug (_execResolveArgs puts __constraint_slug first).
//
// This module owns what is colocation-specific and pure: the words, the metro table, the kW size, the named
// facility pair, the market-slug guard for get_facility, and the step sequences. server.mjs wires it into
// _PLAN_CLASSES and the executor. Pure; nothing here throws.

import { capacityKwFromText } from './capacity-source-summary.mjs';
import { addressFromText } from './plan-step-facts.mjs';

// ── words ────────────────────────────────────────────────────────────────────
export const COLO_WORD_RE = /\b(?:colo(?:cation|cated)?|cages?|cabinets?|racks?|carrier[\s-]+hotels?|cross[\s-]*connects?|carrier[\s-]+neutral|meet[\s-]+me[\s-]+rooms?)\b/i;
// Class weights. colo/colocation alone (4) clears facility_search's colo credit (2) plus its operator credit (1.5).
export const COLO_PATTERNS = [
  [/\bcolo(?:cation|cated)?\b/i, 4],
  [/\b(?:cages?|cabinets?|racks?)\b/i, 2.5],
  [/\b\d+(?:\.\d+)?\s*(?:kw|kilowatts?)\b/i, 2.5],
  [/\b(?:retail|wholesale)\s+colo/i, 1],
  [/\bcarrier[\s-]+hotels?\b/i, 4],
  [/\bcross[\s-]*connects?\b/i, 4],
  [/\bcarrier[\s-]+neutral\b/i, 3],
  [/\bmeet[\s-]+me[\s-]+rooms?\b/i, 3],
];
// A price ask about colocation. Energy-price words alone ("power cost in ERCOT") stay with the price class:
// this one needs a colocation word too (pricing_out_of_scope is gated in _planQuery).
export const COLO_PRICE_RE = /(?:\$\s*\/?\s*kw\b|\bper\s+kw\b|\/\s*kw\b|\bkw\s*\/\s*mo|\b(?:costs?|pric(?:e|es|ed|ing)|quotes?|quoted|(?:lease|leasing|rental|rack|asking|colo(?:cation)?)\s+rates?|rates?\s+(?:per|for)\b|how\s+much\s+(?:does|do|is|would|will)\s+(?:it|a|an|one|colo\w*|\d)))/i;
// "available now", "move-in ready", "space available": an availability ask (source_capacity stays teaser-only).
export const COLO_AVAILABLE_RE = /\b(?:available(?:\s+now)?|availability|move[\s-]*in|ready\s+now|immediately|vacan(?:t|cy)|open\s+space|space\s+available)\b/i;
export const COLO_COMPARE_RE = /\b(?:compare|comparison|versus|vs\.?|side[\s-]+by[\s-]+side|which\s+is\s+better|head[\s-]+to[\s-]+head)\b/i;
// The interconnection asks get_peering_intel answers (carrier hotel, IX, peering, cross-connects, on-ramps).
export const COLO_PEERING_RE = /\b(?:peering|ix|internet\s+exchanges?|carrier[\s-]+hotels?|cross[\s-]*connects?|on[\s-]*ramps?)\b/i;
export const COLO_FIBER_RE = /\b(?:fiber|carriers?|carrier[\s-]+(?:hotel|neutral)|peering|ix|internet\s+exchange|on[\s-]*ramps?|cross[\s-]*connects?|connectivity|latency|network[\s-]+dense)\b/i;

export function coloIntent(text) {
  return COLO_WORD_RE.test(String(text || '').slice(0, 2000));
}
export function coloPriceIntent(text) {
  const t = String(text || '').slice(0, 2000);
  return coloIntent(t) && COLO_PRICE_RE.test(t);
}

// ── metros ───────────────────────────────────────────────────────────────────
// A colocation ask is about a METRO, not a state: "Ashburn" is the Northern Virginia market, "Dallas" is DFW.
// query is what search_facilities' free-text filter expands to the metro's cities (measured 2026-11-17, keyless:
// q="Northern Virginia" -> 669 facilities across Ashburn, Sterling, Manassas, Herndon; state=VA alone -> 799
// including McLean and Richmond). dcpi_slug is the slug /api/v1/dcpi/scores/<slug> answers (northern-virginia
// resolves to the ashburn card). iso only for US RTOs; a non-RTO metro reads the state's power timeline instead.
// lat/lon: the metro's interconnection core, for the connectivity read.
export const COLO_METROS = [
  { id: 'northern-virginia', label: 'Northern Virginia', dcpi_slug: 'northern-virginia', query: 'Northern Virginia', state: 'VA', iso: 'PJM', lat: 39.0438, lon: -77.4874,
    aliases: ['northern virginia', 'nova', 'n. virginia', 'ashburn', 'sterling', 'loudoun', 'leesburg', 'manassas', 'reston', 'herndon', 'chantilly', 'dulles', 'prince william', 'data center alley'] },
  { id: 'dallas', label: 'Dallas-Fort Worth', dcpi_slug: 'dallas', query: 'Dallas', state: 'TX', iso: 'ERCOT', lat: 32.7767, lon: -96.797,
    aliases: ['dallas-fort worth', 'dallas fort worth', 'dallas', 'dfw', 'fort worth', 'plano', 'richardson', 'irving', 'garland', 'carrollton', 'allen', 'lewisville'] },
  { id: 'atlanta', label: 'Atlanta', dcpi_slug: 'atlanta', query: 'Atlanta', state: 'GA', iso: null, lat: 33.749, lon: -84.388,
    aliases: ['atlanta', 'alpharetta', 'suwanee', 'douglasville', 'lithia springs', 'norcross', 'duluth, ga'] },
  { id: 'chicago', label: 'Chicago', dcpi_slug: 'chicago', query: 'Chicago', state: 'IL', iso: 'PJM', lat: 41.853, lon: -87.618,
    aliases: ['chicago', 'elk grove village', 'franklin park', 'itasca', 'lombard', 'northlake', 'cermak'] },
  { id: 'phoenix', label: 'Phoenix', dcpi_slug: 'phoenix', query: 'Phoenix', state: 'AZ', iso: null, lat: 33.4484, lon: -112.074,
    aliases: ['phoenix', 'chandler', 'mesa', 'goodyear', 'tempe', 'scottsdale'] },
  { id: 'silicon-valley', label: 'Silicon Valley', dcpi_slug: 'silicon-valley', query: 'Santa Clara', state: 'CA', iso: 'CAISO', lat: 37.3541, lon: -121.9552,
    aliases: ['silicon valley', 'santa clara', 'san jose', 'sunnyvale', 'milpitas', 'bay area'] },
  { id: 'los-angeles', label: 'Los Angeles', dcpi_slug: 'los-angeles', query: 'Los Angeles', state: 'CA', iso: null, lat: 34.0522, lon: -118.2437,
    aliases: ['los angeles', 'one wilshire', 'el segundo'] },
  { id: 'new-york', label: 'New York', dcpi_slug: 'new-york', query: 'New York', state: 'NY', iso: 'NYISO', lat: 40.7128, lon: -74.006,
    aliases: ['new york city', 'new york', 'nyc', 'manhattan', '60 hudson', '111 8th'] },
  { id: 'new-jersey', label: 'New Jersey', dcpi_slug: 'secaucus', query: 'Secaucus', state: 'NJ', iso: 'PJM', lat: 40.7895, lon: -74.0565,
    aliases: ['secaucus', 'north bergen', 'piscataway', 'weehawken', 'carteret'] },
  { id: 'seattle', label: 'Seattle', dcpi_slug: 'seattle', query: 'Seattle', state: 'WA', iso: null, lat: 47.6062, lon: -122.3321, aliases: ['seattle', 'tukwila', 'westin building'] },
  { id: 'hillsboro', label: 'Portland / Hillsboro', dcpi_slug: 'hillsboro', query: 'Hillsboro', state: 'OR', iso: null, lat: 45.5229, lon: -122.9898, aliases: ['hillsboro', 'portland'] },
  { id: 'denver', label: 'Denver', dcpi_slug: 'denver', query: 'Denver', state: 'CO', iso: null, lat: 39.7392, lon: -104.9903, aliases: ['denver', 'aurora, co', 'englewood'] },
  { id: 'houston', label: 'Houston', dcpi_slug: 'houston', query: 'Houston', state: 'TX', iso: 'ERCOT', lat: 29.7604, lon: -95.3698, aliases: ['houston', 'katy', 'the woodlands'] },
  { id: 'austin', label: 'Austin', dcpi_slug: 'austin', query: 'Austin', state: 'TX', iso: 'ERCOT', lat: 30.2672, lon: -97.7431, aliases: ['austin', 'round rock'] },
  { id: 'san-antonio', label: 'San Antonio', dcpi_slug: 'san-antonio', query: 'San Antonio', state: 'TX', iso: 'ERCOT', lat: 29.4241, lon: -98.4936, aliases: ['san antonio'] },
  { id: 'columbus', label: 'Columbus', dcpi_slug: 'columbus', query: 'Columbus', state: 'OH', iso: 'PJM', lat: 39.9612, lon: -82.9988, aliases: ['columbus', 'new albany', 'dublin, oh', 'hilliard'] },
  { id: 'miami', label: 'Miami', dcpi_slug: 'miami', query: 'Miami', state: 'FL', iso: null, lat: 25.7617, lon: -80.1918, aliases: ['miami', 'boca raton'] },
  { id: 'boston', label: 'Boston', dcpi_slug: 'boston', query: 'Boston', state: 'MA', iso: 'ISONE', lat: 42.3601, lon: -71.0589, aliases: ['boston', 'needham', 'waltham'] },
  { id: 'salt-lake-city', label: 'Salt Lake City', dcpi_slug: 'salt-lake-city', query: 'Salt Lake City', state: 'UT', iso: null, lat: 40.7608, lon: -111.891, aliases: ['salt lake city', 'salt lake', 'west jordan'] },
  { id: 'las-vegas', label: 'Las Vegas', dcpi_slug: 'las-vegas', query: 'Las Vegas', state: 'NV', iso: null, lat: 36.1699, lon: -115.1398, aliases: ['las vegas', 'henderson, nv'] },
  { id: 'reno', label: 'Reno', dcpi_slug: 'reno', query: 'Reno', state: 'NV', iso: null, lat: 39.5296, lon: -119.8138, aliases: ['reno', 'sparks', 'tahoe reno'] },
  { id: 'minneapolis', label: 'Minneapolis', dcpi_slug: 'minneapolis', query: 'Minneapolis', state: 'MN', iso: 'MISO', lat: 44.9778, lon: -93.265, aliases: ['minneapolis', 'shakopee', 'chaska'] },
  { id: 'kansas-city', label: 'Kansas City', dcpi_slug: 'kansas-city', query: 'Kansas City', state: 'MO', iso: 'SPP', lat: 39.0997, lon: -94.5786, aliases: ['kansas city'] },
  { id: 'charlotte', label: 'Charlotte', dcpi_slug: 'charlotte', query: 'Charlotte', state: 'NC', iso: null, lat: 35.2271, lon: -80.8431, aliases: ['charlotte'] },
  { id: 'nashville', label: 'Nashville', dcpi_slug: 'nashville', query: 'Nashville', state: 'TN', iso: null, lat: 36.1627, lon: -86.7816, aliases: ['nashville', 'franklin, tn'] },
];
const _esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _ALIAS_INDEX = (() => {
  const out = [];
  for (const m of COLO_METROS) for (const a of m.aliases) out.push({ alias: a, re: new RegExp('(?:^|[^a-z0-9])' + _esc(a) + '(?![a-z0-9])', 'i'), metro: m });
  // Longest alias first, so "dallas-fort worth" beats "dallas" and "new york city" beats "new york".
  return out.sort((x, y) => y.alias.length - x.alias.length);
})();

/**
 * The metro a colocation question names: { metro, matched, basis } or null. A typed context.market wins over
 * the text (it is matched against the same aliases, then against a metro id or DCPI slug). Every metro named
 * is returned in `all`, first-named first, so a two-metro ask can be told apart from a one-metro ask.
 */
export function resolveColoMetro(text, market) {
  try {
    const t = String(text || '').slice(0, 2000);
    const named = [];
    for (const { alias, re, metro } of _ALIAS_INDEX) {
      const m = re.exec(t);
      if (!m) continue;
      if (named.some((n) => n.metro.id === metro.id)) continue;
      named.push({ metro, matched: alias, at: m.index });
    }
    named.sort((a, b) => a.at - b.at);
    let typed = null;
    if (typeof market === 'string' && market.trim()) {
      const mk = market.trim().toLowerCase();
      typed = COLO_METROS.find((m) => m.id === mk || m.dcpi_slug === mk || m.aliases.includes(mk))
        || (_ALIAS_INDEX.find(({ re }) => re.test(mk)) || {}).metro || null;
    }
    const lead = typed ? { metro: typed, matched: market.trim(), basis: 'context.market' }
      : (named[0] ? { metro: named[0].metro, matched: named[0].matched, basis: 'text' } : null);
    if (!lead) return null;
    return { ...lead, all: named.map((n) => n.metro.id) };
  } catch (_e) { return null; }
}

// ── size ─────────────────────────────────────────────────────────────────────
/** The size a colocation ask names, in kW ("500 kW" -> 500; "1 MW" -> 1000), or null. MW from the planner signal. */
export function coloKw(text, mw) {
  try {
    const kw = capacityKwFromText(text);
    if (kw) return kw;
    if (typeof mw === 'number' && Number.isFinite(mw) && mw > 0) return Math.round(mw * 1000);
    return null;
  } catch (_e) { return null; }
}

// ── a named facility pair ("Equinix DC2 vs CoreSite VA1") ────────────────────
const _OPERATOR_RE = /\b(?:equinix|digital\s+realty|interxion|coresite|qts|cyrusone|vantage|ntt|stack|switch|aligned|flexential|cologix|iron\s+mountain|databank|h5|centersquare|evoque|cyxtera|lumen|level\s*3|zayo|sabey|edgeconnex|compass|t5|tierpoint|colohouse|365\s+data\s+centers|element\s+critical|prime|yondr|google|microsoft|meta|amazon|aws)\b/i;
const _FACILITY_CODE_RE = /\b[A-Za-z]{2,4}-?\d{1,3}[A-Za-z]?\b/;   // DC2, VA1, CH1, DFW36, NVA9
const _ADDRESS_RE = /^\s*\d{2,5}\s+[A-Za-z]/;                    // "350 E Cermak", "60 Hudson"
const _PAIR_RES = [
  /\bcompare\s+(.{2,60}?)\s+(?:vs\.?|versus|against|and|with|to)\s+(.{2,60}?)(?=\s+(?:for|in|on|by|regarding|re)\b|[?.!,;]|$)/i,
  /(?:^|[:,]\s*)([^,:;?]{2,60}?)\s+(?:vs\.?|versus)\s+(.{2,60}?)(?=\s+(?:for|in|on|by)\b|[?.!,;]|$)/i,
];
function _facilityLike(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 60) return false;
  return _OPERATOR_RE.test(t) || _ADDRESS_RE.test(t) || (_FACILITY_CODE_RE.test(t) && /[A-Za-z]{2}/.test(t));
}
function _cleanSide(s) {
  // "two Dallas colocation facilities: Equinix DA11" -> "Equinix DA11" (Grok re-run 2026-11-17, Q-b: the whole
  // lead-in went to search_facilities as the query).
  return String(s || '').replace(/^[^:]*:\s*/, '').replace(/^\s*(?:the|between)\s+/i, '').replace(/\s+(?:colocation|colo|facilit(?:y|ies)|data\s*cent(?:er|re)s?)\s*$/i, '').trim();
}
/** Two named facilities a comparison asks about: { a, b } (as written) or null when either side is not facility-like. */
export function coloFacilityPair(text) {
  try {
    const t = String(text || '').slice(0, 500);
    for (const re of _PAIR_RES) {
      const m = re.exec(t);
      if (!m) continue;
      const a = _cleanSide(m[1]), b = _cleanSide(m[2]);
      if (a && b && a.toLowerCase() !== b.toLowerCase() && _facilityLike(a) && _facilityLike(b)) return { a, b };
    }
    return null;
  } catch (_e) { return null; }
}

// ── get_facility guard ───────────────────────────────────────────────────────
// get_facility takes ONE FACILITY's slug. A market slug ("northern-virginia", "dallas-tx") 404s there, so it is
// never sent: the executor marks the step skipped_unresolved and the planner never hints one.
const _MARKET_SLUG_SHAPE = /^[a-z]+(?:-[a-z]+)*-[a-z]{2}$/;   // letters and hyphens, ending in a state code: dallas-tx
const _KNOWN_MARKET_SLUGS = new Set(COLO_METROS.flatMap((m) => [m.id, m.dcpi_slug, ...m.aliases.map((a) => a.replace(/[^a-z0-9]+/gi, '-').toLowerCase())]));
export function isMarketSlug(v, extra) {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  if (!s) return false;
  if (_MARKET_SLUG_SHAPE.test(s) || _KNOWN_MARKET_SLUGS.has(s)) return true;
  return !!(extra && typeof extra.has === 'function' && extra.has(s));
}
export const FACILITY_ID_ARGS = ['slug', 'facility_id', 'id'];
/** The note for a get_facility call that would send a market slug, or null when the call is fine. */
export function facilitySlugGuard(tool, args, extra) {
  try {
    if (tool !== 'get_facility' || !args || typeof args !== 'object') return null;
    for (const k of FACILITY_ID_ARGS) {
      if (isMarketSlug(args[k], extra)) {
        return { missing: k, value: args[k],
          note: `get_facility takes one facility's slug; "${args[k]}" is a market slug, so this step did not run. Pick a facility slug from a search_facilities row.` };
      }
    }
    return null;
  } catch (_e) { return null; }
}
/** Planner guard: drop a concrete market slug from a get_facility args_hint (replaced by the facility placeholder). */
export function guardPlanFacilitySteps(seq, extra) {
  try {
    for (const s of Array.isArray(seq) ? seq : []) {
      if (!s || s.tool !== 'get_facility' || !s.args_hint) continue;
      for (const k of FACILITY_ID_ARGS) {
        if (isMarketSlug(s.args_hint[k], extra)) {
          const { [k]: _drop, ...rest } = s.args_hint;
          s.args_hint = { ...rest, slug: FACILITY_SLUG_PLACEHOLDER };
          s.guarded = { dropped: k, value: _drop, reason: 'market slug sent to get_facility' };
        }
      }
    }
  } catch (_e) { /* routing must never throw */ }
  return seq;
}
// The placeholder kind the executor resolves ONLY from search_facilities rows (never from the market-slug pool).
export const FACILITY_SLUG_PLACEHOLDER = '<facility slug from a search_facilities row>';
// `rank` picks the Nth row of that step (1-based): "#2" is the second facility the search returned.
export const facilitySlugFromStep = (n, rank = 1) => `<facility slug${rank > 1 ? ' #' + rank : ''} from step ${n} search_facilities row>`;

/** Facility slugs on a search_facilities result (rows under data/facilities/results), first `cap`. */
export function facilitySlugsFromSearch(result, cap = 3) {
  try {
    const p = typeof result === 'string' ? JSON.parse(result) : result;
    const rows = (p && (p.data || p.facilities || p.results)) || [];
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const v = r && (r.slug || r.facility_id || r.id);
      if (typeof v === 'string' && v && !isMarketSlug(v) && !out.includes(v)) out.push(v);
      if (out.length >= cap) break;
    }
    return out;
  } catch (_e) { return []; }
}

// ── signals ──────────────────────────────────────────────────────────────────
/** The colocation signals for one intent: read once by _planSignals, consumed by the two classes below. */
export function coloSignals(text, sig) {
  try {
    const t = String(text || '').slice(0, 2000);
    const d = sig && typeof sig === 'object' ? sig : {};
    if (!coloIntent(t)) return null;
    const metro = resolveColoMetro(t, d.market);
    return {
      metro: metro ? metro.metro : null,
      metro_matched: metro ? metro.matched : null,
      metro_basis: metro ? metro.basis : null,
      metros_named: metro ? metro.all : [],
      kw: coloKw(t, d.mw),
      pair: coloFacilityPair(t),
      // A street address named in the ask ("near 350 E Cermak"): resolved as the facility asked about.
      address: addressFromText(t),
      price: COLO_PRICE_RE.test(t),
      available: COLO_AVAILABLE_RE.test(t),
      fiber: COLO_FIBER_RE.test(t),
      peering: COLO_PEERING_RE.test(t),
      compare: COLO_COMPARE_RE.test(t),
    };
  } catch (_e) { return null; }
}

// ── sequences ────────────────────────────────────────────────────────────────
function _powerStep(step, metro, depends) {
  return metro.iso
    ? { step, tool: 'get_grid_intelligence', depends_on: depends, estimated_calls: 1,
        why: `Power headroom and time to power on ${metro.iso}, the grid that serves ${metro.label}: whether new colocation load in the metro can be powered, and how soon.`,
        args_hint: { iso: metro.iso } }
    : { step, tool: 'get_power_availability_timeline', depends_on: depends, estimated_calls: 1,
        why: `${metro.label} is on no US RTO, so its power read is the ${metro.state} power-availability timeline (dated supply-side signals).`,
        args_hint: { state: metro.state } };
}
function _searchStep(step, metro, kw, extra = {}) {
  return { step, tool: 'search_facilities', depends_on: [], estimated_calls: 1,
    why: `Facilities in the ${metro.label} metro (query "${metro.query}", kept to ${metro.state}): who operates there, each row with a facility slug. The metro, not the whole state.`
      + (kw ? ` Size asked: ${kw} kW (min_capacity_mw=${+(kw / 1000).toFixed(3)}; a caller who cannot read capacity fields gets this filter dropped, and the answer says so).` : ''),
    args_hint: { query: metro.query, state: metro.state, limit: 10, ...(kw ? { min_capacity_mw: +(kw / 1000).toFixed(3) } : {}), ...extra } };
}

/** The colocation sequence for one metro, a facility pair, or (no metro) the honest unresolved read. */
export function colocationSequence(d) {
  const cs = d && d.__colo;
  if (!cs) return [];
  const metro = cs.metro;
  if (cs.pair) {
    const seq = [
      { step: 1, tool: 'search_facilities', depends_on: [], estimated_calls: 1,
        why: `Resolve "${cs.pair.a}" to a facility slug (free-text search over name, operator and location).`,
        args_hint: { query: cs.pair.a, limit: 5, ...(metro ? { state: metro.state } : {}) } },
      { step: 2, tool: 'search_facilities', depends_on: [], estimated_calls: 1,
        why: `Resolve "${cs.pair.b}" to a facility slug.`,
        args_hint: { query: cs.pair.b, limit: 5, ...(metro ? { state: metro.state } : {}) } },
      { step: 3, tool: 'get_facility', depends_on: [1], estimated_calls: 1,
        why: `Full profile of "${cs.pair.a}": operator, power, fiber carriers and on-net count, and the DCPI verdict of its market.`,
        args_hint: { slug: facilitySlugFromStep(1) } },
      { step: 4, tool: 'get_facility', depends_on: [2], estimated_calls: 1,
        why: `Full profile of "${cs.pair.b}", the other side of the comparison.`,
        args_hint: { slug: facilitySlugFromStep(2) } },
    ];
    if (metro) {
      seq.push({ step: 5, tool: 'get_market_dcpi_rank', depends_on: [], estimated_calls: 1,
        why: `DCPI verdict for ${metro.label}, the market the comparison sits in.`, args_hint: { market_slug: metro.dcpi_slug } });
      // Owner 2026-11-17: get_peering_intel is on the allowlist; it names the IX-dense facilities at the core.
      seq.push({ step: 6, tool: 'get_peering_intel', depends_on: [], estimated_calls: 1,
        why: `Peering at ${metro.label}'s interconnection core (PeeringDB): facilities nearby, internet exchanges and networks.`,
        args_hint: { lat: metro.lat, lon: metro.lon } });
    }
    return seq;
  }
  const metros = (cs.metros_named || []).map((id) => COLO_METROS.find((m) => m.id === id)).filter(Boolean);
  if (cs.compare && metros.length >= 2) {
    const [a, b] = metros;
    const seq = [
      { step: 1, tool: 'get_market_dcpi_rank', depends_on: [], estimated_calls: 1,
        why: `DCPI verdict for ${a.label}, side A of the comparison.`, args_hint: { market_slug: a.dcpi_slug } },
      { step: 2, tool: 'get_market_dcpi_rank', depends_on: [], estimated_calls: 1,
        why: `DCPI verdict for ${b.label}, side B of the comparison.`, args_hint: { market_slug: b.dcpi_slug } },
      _searchStep(3, a, cs.kw),
      _searchStep(4, b, cs.kw),
      _powerStep(5, a, []),
    ];
    if ((b.iso || b.state) !== (a.iso || a.state)) seq.push(_powerStep(6, b, []));
    return seq;
  }
  if (!metro) {
    // No metro bound: search what the question gives, never a guessed market (the plan says it is unresolved).
    return [
      { step: 1, tool: 'search_facilities', depends_on: [], estimated_calls: 1,
        why: 'No colocation metro could be bound from the question, so this is a facility search on what it names; name the metro (e.g. Ashburn, Dallas, Chicago) for a metro-scoped answer.',
        args_hint: { ...(d.state ? { state: d.state } : (d.stateFromPlace ? { state: d.stateFromPlace } : {})), limit: 10,
          ...(cs.kw ? { min_capacity_mw: +(cs.kw / 1000).toFixed(3) } : {}) } },
    ];
  }
  const seq = [
    { step: 1, tool: 'get_market_dcpi_rank', depends_on: [], estimated_calls: 1,
      why: `DCPI verdict for ${metro.label}, the market asked about: the answer leads with it, not with other markets.`,
      args_hint: { market_slug: metro.dcpi_slug } },
    _searchStep(2, metro, cs.kw),
    _powerStep(3, metro, []),
  ];
  if (cs.fiber) {
    seq.push({ step: seq.length + 1, tool: 'get_metro_fiber', depends_on: [], estimated_calls: 1,
      why: `${metro.label} metro fiber: carriers, dark fiber and route density for the market.`,
      args_hint: { market: metro.dcpi_slug } });
    // Owner 2026-11-17: a carrier-hotel / IX / cross-connect ask reads peering at the core. A named address keeps
    // get_fiber_readiness: its on-net read leads that answer (Q-f), and the plan has no room for both.
    if (cs.peering && !cs.address) {
      seq.push({ step: seq.length + 1, tool: 'get_peering_intel', depends_on: [], estimated_calls: 1,
        why: `Peering at ${metro.label}'s interconnection core (PeeringDB): carrier-hotel, IX and network density.`,
        args_hint: { lat: metro.lat, lon: metro.lon } });
    } else {
      seq.push({ step: seq.length + 1, tool: 'get_fiber_readiness', depends_on: [], estimated_calls: 1,
        why: `Connectivity score and nearest carriers at ${metro.label}'s interconnection core.`,
        args_hint: { lat: metro.lat, lon: metro.lon } });
    }
  }
  if (cs.address) {
    // Grok re-run 2026-11-17, Q-f: "near 350 E Cermak" profiled the metro search's first row (QTS Chicago). The
    // address is the facility asked about: search it by name and profile that row.
    const n = seq.length + 1;
    seq.push({ step: n, tool: 'search_facilities', depends_on: [], estimated_calls: 1,
      why: `Resolve the address "${cs.address}" to the facility there (free-text search over name and location, kept to ${metro.state}).`,
      args_hint: { query: cs.address, state: metro.state, limit: 3 } });
    seq.push({ step: n + 1, tool: 'get_facility', depends_on: [n], estimated_calls: 1,
      why: `Full profile of the facility at ${cs.address} (operator, fiber carriers, power). With no facility row at that address the step is skipped and the answer says so.`,
      args_hint: { slug: facilitySlugFromStep(n) } });
  } else {
    seq.push({ step: seq.length + 1, tool: 'get_facility', depends_on: [2], estimated_calls: 1,
      why: 'Full profile of the first facility the metro search returned (fiber carriers, power, its market\'s DCPI). The slug comes from that search, never from the market name; with no facility row the step is skipped.',
      args_hint: { slug: facilitySlugFromStep(2) } });
  }
  if (cs.compare) {
    seq.push({ step: seq.length + 1, tool: 'get_facility', depends_on: [2], estimated_calls: 1,
      why: 'Full profile of the second facility the metro search returned, so two facilities can be set side by side.',
      args_hint: { slug: facilitySlugFromStep(2, 2) } });
  }
  return seq;
}

/** The metro search args for a facility_search plan that names a metro (the same table): {query, state} or null. */
export function facilityMetroArgs(text, market) {
  const m = resolveColoMetro(text, market);
  return m ? { query: m.metro.query, state: m.metro.state } : null;
}

/** pricing_out_of_scope: the drivers DC Hub does cover, for the metro asked (or the state when no metro binds). */
export function coloPricingSequence(d) {
  const cs = d && d.__colo;
  const metro = cs && cs.metro;
  const state = metro ? metro.state : (d && (d.state || d.stateFromPlace)) || null;
  const iso = metro ? metro.iso : (d && d.iso) || null;
  const seq = [];
  if (metro) seq.push({ step: 1, tool: 'get_market_dcpi_rank', depends_on: [], estimated_calls: 1,
    why: `DCPI verdict for ${metro.label}: power availability and grid constraint, the drivers behind colocation supply there.`,
    args_hint: { market_slug: metro.dcpi_slug } });
  seq.push({ step: seq.length + 1, tool: 'get_energy_prices', depends_on: [], estimated_calls: 1,
    why: 'Electricity and gas prices for the grid or state: the power-cost input to any colocation rate.',
    args_hint: iso ? { iso } : (state ? { state } : {}) });
  if (iso) seq.push({ step: seq.length + 1, tool: 'get_grid_intelligence', depends_on: [], estimated_calls: 1,
    why: `Grid stress and time to power on ${iso}.`, args_hint: { iso } });
  if (state) seq.push({ step: seq.length + 1, tool: 'get_tax_incentives', depends_on: [], estimated_calls: 1,
    why: `Data-center tax incentives in ${state}.`, args_hint: { state } });
  return seq;
}

// Owner 2026-11-17: "doesn't publish" (DC Hub does not publish colocation rates), not "doesn't quote".
export const COLO_PRICING_NOTE = 'DC Hub doesn\'t publish colocation prices. It covers the drivers behind them: power availability (DCPI), grid stress and time to power, energy prices and tax incentives.';
