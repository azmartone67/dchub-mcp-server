// street-address.mjs -- planner 5.48: a site screen at a street address reads the ADDRESS's point, never the market's.
//
// WHY. Grok's daily MCP note (2026-11-19, P1): execute_plan "Screen the site at 21571 Beaumeade Circle, Ashburn VA
// for a 60 MW data center: power, parcel, flood" ran analyze_site, analyze_parcel, get_disaster_risk, get_water_risk
// and get_composite_site_score at the Ashburn corridor point (39.0438, -77.4874; the address is about 39.022,
// -77.454) and led "Parcel: 0.4 acres, parcel 085165792000" as if that parcel were the site.
//
// WHAT.
//   * streetAddressOf(text): { query, number, street, city, state } when the text names a house number + street
//     (with a street-type word: "Circle", "Rd", "Pkwy"...), else null. `query` is what the geocoder reads
//     ("21571 Beaumeade Circle, Ashburn, VA").
//   * addressPointOk(label, address): the geocoder's label names the house number AND the street. The backend
//     geocoder (GET /api/v1/geocode: ArcGIS, then Nominatim, then Photon) answers an address it cannot find with
//     the TOWN's point ("99999 Nowhere Zzyzx Circle, Ashburn, VA" -> "Ashburn, Virginia", measured 2026-11-19),
//     which is the same wrong point as the market default; a town-level label is a miss.
//   * addressMissAnswer(address): the answer when the address could not be placed: no point read ran, so no
//     parcel, flood or site line is said.
// Pure; nothing here throws.

import { addressMatches } from './plan-step-facts.mjs';

const SUFFIX = 'street|st|avenue|ave|road|rd|drive|dr|circle|cir|boulevard|blvd|lane|ln|way|court|ct|parkway|pkwy|place|pl'
  + '|highway|hwy|pike|terrace|ter|trail|trl|square|sq|loop|plaza|plz|crossing|xing|turnpike|tpke|expressway|expy|freeway|fwy';
// Words that never sit inside a street name: sizes, units and the prepositions of a question ("100 MW at Main St").
const NOT_STREET = /^(?:mw|gw|kw|mwh|gwh|kv|acres?|miles?|mi|km|ft|feet|meters?|m|at|in|on|near|of|the|a|an|for|by|to|from|and|or|with|data|center|centre|site|sites|campus|load|mw-?scale)$/i;
const ADDRESS_RE = new RegExp(String.raw`(?<![\d.$,])\b(\d{1,6}[A-Za-z]?)\s+((?:[A-Za-z0-9][A-Za-z0-9.'-]*\s+){1,4}?)(${SUFFIX})\b\.?`, 'gi');

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE',
  nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const CODES = new Set(Object.values(STATE_NAMES));
const NAMES_LONGEST_FIRST = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);

// ", Ashburn VA", ", Ashburn, Virginia 20147", " in Ashburn, VA": the town and state written after the street.
function cityState(rest) {
  const r = String(rest || '').replace(/^\s*(?:,\s*|\s+in\s+)?/i, '');
  const words = r.split(/[\s,]+/).filter(Boolean).slice(0, 6);
  // A code first ("Washington DC" is DC, not the state of Washington), then a state name.
  for (let i = 0; i < Math.min(words.length, 4); i += 1) {
    const w = words[i].replace(/[.:;]$/, '');
    if (/^[A-Z]{2}$/.test(w) && CODES.has(w)) return { city: words.slice(0, i).join(' ') || null, state: w };
  }
  for (let i = 0; i < words.length; i += 1) {
    for (const nm of NAMES_LONGEST_FIRST) {
      const n = nm.split(' ').length;
      if (words.slice(i, i + n).join(' ').toLowerCase().replace(/[.:;]$/, '') === nm) {
        return { city: words.slice(0, i).join(' ') || null, state: STATE_NAMES[nm] };
      }
    }
    if (i >= 3) break;
  }
  return { city: null, state: null };
}

/** The street address the text names (house number + street + street-type word), or null. */
export function streetAddressOf(text) {
  try {
    const t = String(text || '').slice(0, 2000);
    ADDRESS_RE.lastIndex = 0;
    for (const m of t.matchAll(ADDRESS_RE)) {
      const nameWords = m[2].trim().split(/\s+/);
      if (nameWords.some((w) => NOT_STREET.test(w.replace(/[.,]$/, '')))) continue;
      const street = `${m[2].trim()} ${m[3]}`.replace(/\s+/g, ' ');
      const { city, state } = cityState(t.slice(m.index + m[0].length));
      const query = [`${m[1]} ${street}`, city, state].filter(Boolean).join(', ');
      return { query, number: m[1], street, city, state };
    }
    return null;
  } catch (_e) { return null; }
}

/** The geocoder placed the address itself (its label names the house number and the street), not the town. */
export function addressPointOk(label, address) {
  try {
    if (typeof label !== 'string' || !label) return false;
    const a = typeof address === 'string' ? address : (address && address.query) || '';
    const num = String(a).trim().split(/\s+/)[0];
    // addressMatches needs a 2-5 digit house number; a 1- or 6-digit one is checked here the same way.
    if (/^\d{2,5}$/.test(num)) return addressMatches(label, a);
    const h = ' ' + label.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    const street = String(a).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[1];
    return !!street && h.includes(' ' + num.toLowerCase() + ' ') && h.includes(' ' + street + ' ');
  } catch (_e) { return false; }
}

export const ADDRESS_MISS_HEADLINE = 'The address could not be located; give lat/lon.';

/** The intent answer when the address could not be placed: no point read ran, so nothing about the site is said. */
export function addressMissAnswer(query, base = null) {
  const b = base && typeof base === 'object' ? base : {};
  return {
    kind: b.kind || 'siting', requested_mw: b.requested_mw != null ? b.requested_mw : null, geography: query,
    headline: `${ADDRESS_MISS_HEADLINE} "${query}" did not resolve to a point at that address, so no parcel, flood, water or site read ran; the market's default point was not used in its place.`,
    verdict: null, evidence: [],
    not_established: ['No site-level figure: every point read needs the address located. Re-run execute_plan with context {lat, lon} for the site.'],
    as_of: null, relay: null, source: null,
  };
}
