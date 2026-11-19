// facility-names.mjs -- planner 5.43: a facility row is said as provider + name, and a city-only row ranks last.
//
// WHY. Grok's daily MCP leadership note (2026-11-18, item 10; Nov 17 item 4): the Ashburn colocation lead read "Level 3
// Ashburn, Ashburn II, VA, United States, Ashburn III, VA, United States" (Vantage's campuses with no operator and the
// directory's address tail), and the Atlanta lead's first row was "Atlanta, GA" (slug flexential-atlanta-ga-...), which
// displaced the QTS and Flexential rows with real names and was the one get_facility read.
//
// WHAT.
//   * facilityDisplayName(row): provider + name ("Vantage Ashburn II", the provider's corporate tail dropped), with a
//     trailing ", <ST>, United States" removed; the provider is not repeated when the name already starts with it.
//   * cityOnlyName(row): the row's own name is only a place ("Atlanta, GA", "Ashburn"), not a facility name.
//   * namedFirst(rows): rows with a facility name first, city-only rows after, each group in its original order.
// Pure; nothing here throws.

const one = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

const US_TAIL_RE = /,\s*(?:[A-Z]{2},\s*)?(?:United States(?: of America)?|USA|US)\s*$/;
// "Atlanta, GA", "Ashburn, Virginia", "Atlanta": a place and nothing else.
const PLACE_ONLY_RE = /^[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}(?:,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?))?$/;

// "Vantage Data Centers" -> "Vantage", "Lumen Technologies" -> "Lumen": the name a reader knows the operator by.
const PROVIDER_TAIL_RE = /(?:,?\s+(?:Data\s+Cent(?:er|re)s?|Technologies|Holdings|Group|Inc\.?|LLC|L\.L\.C\.|Corp(?:oration)?\.?|Ltd\.?|Co\.?))+$/i;
export function shortProvider(name) {
  const n = one(name);
  const s = n.replace(PROVIDER_TAIL_RE, '').trim();
  return s || n;
}

function baseName(r) {
  return one(r && r.name).replace(US_TAIL_RE, '').trim();
}

/** True when the row's name is only a city (and state), the same as its city field or with no facility word. */
export function cityOnlyName(r) {
  try {
    const n = baseName(r);
    if (!n) return false;
    const city = one(r.city);
    if (city && (n.toLowerCase() === city.toLowerCase() || n.toLowerCase().startsWith(`${city.toLowerCase()},`))) {
      return PLACE_ONLY_RE.test(n) && !/\d/.test(n);
    }
    // No city field: a "City, ST" shape is a place.
    return /^[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3},\s*[A-Z]{2}$/.test(n);
  } catch (_e) { return false; }
}

/** "Vantage Ashburn II": provider + name, the address tail removed; the slug when the row has no name. */
export function facilityDisplayName(r) {
  try {
    const n = baseName(r);
    if (!n) return one(r && r.slug);
    const pv = shortProvider(one(r.provider) || one(r.operator) || one(r.provider_name));
    if (!pv) return n;
    const head = pv.toLowerCase().split(/\s+/)[0];
    return n.toLowerCase().startsWith(head) ? n : `${pv} ${n}`;
  } catch (_e) { return one(r && (r.name || r.slug)); }
}

/** Named rows first, city-only rows after (a stable partition). */
export function namedFirst(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return [...list.filter((r) => !cityOnlyName(r)), ...list.filter((r) => cityOnlyName(r))];
}
