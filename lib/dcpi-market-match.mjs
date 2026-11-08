// Which tracked DCPI market does a question name? (planner 5.17, owner priority
// 1 of 2026-11-08, after Grok #118011.)
//
// "What is the power outlook for Midland–Odessa?" must read Midland–Odessa and
// nothing else. _CITY_ISO_META (server.mjs) holds ~40 metros, is matched as a
// plain substring and feeds the ISO constraint for every intent class, so it is
// the wrong place for 336 names like "Enterprise", "Mason" or "Dublin". This
// table is consulted for the one-market class only, matched on word
// boundaries, and honest about what it cannot tell apart:
//
//   hit        one market, e.g. "Portland, ME" → portland-me
//   conflict   the name is tracked, but in another state ("Columbus, GA": the
//              index tracks Columbus, OH) — never answered as the tracked one
//   ambiguous  two tracked markets share the bare name ("Portland": OR and ME)
//   multiple   two different tracked markets named — not a one-market question
//   null       nothing tracked is named
//
// PURE: no I/O, never throws.
import { DCPI_MARKETS, DCPI_MARKETS_AS_OF } from './dcpi-markets.data.mjs';
import { normPlace } from './dcpi-market-norm.mjs';

export { DCPI_MARKETS, DCPI_MARKETS_AS_OF };

const US = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  'puerto rico': 'PR', guam: 'GU',
};
// Country names, to the codes the index files that country's markets under.
const COUNTRY = {
  'united kingdom': ['UK'], uk: ['UK'], england: ['UK'], scotland: ['UK'], britain: ['UK'],
  ireland: ['IE'], netherlands: ['NL'], holland: ['NL'], germany: ['DE'], france: ['FR'],
  spain: ['ES'], italy: ['IT'], portugal: ['PT'], greece: ['GR'], belgium: ['BE'], austria: ['AT'],
  switzerland: ['CH'], czechia: ['CZ'], 'czech republic': ['CZ'], poland: ['PL'], denmark: ['DK'],
  finland: ['FI'], norway: ['NO'], sweden: ['SE'], canada: ['AB', 'ON', 'QC', 'BC', 'MB'],
  australia: ['AU', 'QL', 'WA'], 'new zealand': ['NZ'], india: ['IN'], thailand: ['TH'],
  brazil: ['BR'], indonesia: ['ID'], korea: ['KR'], 'south korea': ['KR'], chile: ['CL'],
  colombia: ['CO'], vietnam: ['VN'], malaysia: ['MY'], 'south africa': ['GP'], japan: ['JP'],
  mexico: ['MX'], philippines: ['PH'], taiwan: ['TW'],
};
const CODES = new Set([...Object.values(US), ...DCPI_MARKETS.flatMap((r) => r[2])]);
// Two-letter codes that are also English words: a qualifier only after a comma
// or at the very end ("Portland, OR" / "Portland OR", never "Portland or Seattle").
const WORD_CODES = new Set(['in', 'or', 'me', 'ok', 'oh', 'hi', 'de', 'la', 'co', 'id', 'al', 'ma', 'pa']);
// Names that are ordinary words in a data-center question, or shared by bigger
// places in other states. They name a market only with a state after them.
const QUALIFIER_REQUIRED = new Set([
  'enterprise', 'mason', 'allen', 'monroe', 'chester', 'troy', 'lebanon', 'laurel', 'canton',
  'edison', 'maiden', 'sheridan', 'somerset', 'bend', 'franklin', 'salem', 'hammond', 'garland',
  'clifton', 'centennial', 'luckey', 'brandon', 'quincy', 'springfield', 'fayetteville',
  'lafayette', 'elk grove', 'altoona', 'west chester',
]);
// Regions, not metros: they give way when a metro inside them is also named
// ("Midland, West Texas" is Midland).
const REGIONS = new Set(['west-texas', 'rural-spp', 'pacific-nw-rural', 'central-washington',
  'upper-michigan', 'appalachia-coal']);

const BY_SLUG = new Map();
const ENTRIES = [];
const ALIAS_USES = new Map();
for (const [slug, name, states, iso, rto, aliases] of DCPI_MARKETS) {
  const m = { slug, name, states, iso, rto, aliases };
  BY_SLUG.set(slug, m);
  for (const alias of aliases) {
    ENTRIES.push({ alias, m });
    ALIAS_USES.set(alias, (ALIAS_USES.get(alias) || 0) + 1);
  }
}
ENTRIES.sort((a, b) => b.alias.length - a.alias.length);

export function dcpiMarketBySlug(slug) {
  return BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}

const isWordChar = (c) => !!c && /[a-z0-9]/.test(c);
const titled = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const brief = (m) => ({ slug: m.slug, name: m.name, state: m.states[0] });

// The state or country written right after a name, if any.
function qualifierAt(nt, end) {
  const rest = nt.slice(end);
  const m = rest.match(/^(,)? ?(?:(?:in|of) (?=[a-z]{3}))?([a-z]+(?: [a-z]+){0,2})/);
  if (!m) return null;
  const words = m[2].split(' ');
  for (let n = words.length; n >= 1; n--) {
    const w = words.slice(0, n).join(' ');
    if (US[w]) return { codes: [US[w]], label: titled(w) };
    if (COUNTRY[w]) return { codes: COUNTRY[w], label: titled(w) };
  }
  const c = words[0];
  if (c.length === 2 && CODES.has(c.toUpperCase())) {
    const atEnd = words.length === 1 && rest.slice(m[0].length).trim() === '';
    if (m[1] || !WORD_CODES.has(c) || atEnd) return { codes: [c.toUpperCase()], label: c.toUpperCase() };
  }
  return null;
}

export function matchDcpiMarket(text) {
  try {
    const nt = normPlace(text);
    if (!nt) return null;
    const claimed = [];
    const hits = [];
    for (const { alias, m } of ENTRIES) {
      for (let i = nt.indexOf(alias); i !== -1; i = nt.indexOf(alias, i + 1)) {
        const end = i + alias.length;
        if (isWordChar(nt[i - 1]) || isWordChar(nt[end])) continue;
        const same = hits.find((h) => h.start === i && h.end === end);
        if (same) { same.markets.push(m); continue; }
        if (claimed.some(([s, e]) => i < e && end > s)) continue;   // inside a longer name
        claimed.push([i, end]);
        hits.push({ start: i, end, alias, markets: [m] });
      }
    }
    const read = [];
    for (const h of hits.sort((a, b) => a.start - b.start)) {
      const q = qualifierAt(nt, h.end);
      const phrase = titled(h.alias) + (q ? ', ' + q.label : '');
      if (q) {
        const inState = h.markets.filter((m) => m.states.some((s) => q.codes.includes(s)));
        read.push(inState.length
          ? { kind: 'hit', m: inState[0], phrase }
          : { kind: 'conflict', phrase, tracked: h.markets.map(brief) });
      } else if (QUALIFIER_REQUIRED.has(h.alias)) {
        continue;
      } else if (h.markets.length > 1) {
        read.push({ kind: 'ambiguous', phrase, candidates: h.markets.map(brief) });
      } else {
        read.push({ kind: 'hit', m: h.markets[0], phrase });
      }
    }
    if (!read.length) return null;
    const metros = read.filter((r) => !(r.kind === 'hit' && REGIONS.has(r.m.slug)));
    const named = metros.length ? metros : read;
    const slugs = new Set(named.map((r) => (r.kind === 'hit' ? r.m.slug : r.phrase)));
    if (slugs.size > 1) {
      return { kind: 'multiple', markets: named.map((r) => (r.kind === 'hit' ? brief(r.m) : { phrase: r.phrase })) };
    }
    const r = named[0];
    if (r.kind !== 'hit') return r;
    const { slug, name, states, iso, rto } = r.m;
    return { kind: 'hit', slug, name, state: states[0], iso, rto, phrase: r.phrase };
  } catch (_e) {
    return null;
  }
}

// Does `subject` (a slug or display name a tool returned) name this market?
// A name two markets share ("Aurora": IL and CO) names neither. null when the
// slug is not in the index (the caller falls back to its own check).
export function namesDcpiMarket(subject, slug) {
  const m = dcpiMarketBySlug(slug);
  if (!m) return null;
  const flat = (s) => normPlace(s).replace(/,/g, '');
  const got = flat(subject);
  if (!got) return true;
  const forms = new Set([flat(m.slug), flat(m.name),
    ...m.aliases.filter((a) => ALIAS_USES.get(a) === 1).map(flat)]);
  return forms.has(got);
}
