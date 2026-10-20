// top-metros.mjs -- the full market briefing is open to every caller for the 20 largest US markets.
//
// OWNER DECISION (2026-10-20, verbatim): "make the full market briefing (grid, risk, time-to-power)
// free for the top 20 metros."
//
// WHICH 20. The 20 US markets with the most tracked capacity in DC Hub: stats.total_power_mw from
// GET /api/v1/markets/<slug>, read 2026-10-20 for 33 candidate US metros (MW in brackets). Capacity
// is the measure because it is what the briefing is about (power, grid, time to power), and it is
// read from the same facility registry the briefing describes. Facility count would rank
// metros with many small colocation sites (New York, Miami) above large campus markets.
//   northern-virginia [11,072]  phoenix [4,025]  dallas [3,610]  las-vegas [2,056]
//   columbus [1,579]  silicon-valley [1,438]  atlanta [1,417]  quincy [1,402]  chicago [1,210]
//   kansas-city [1,026]  reno [986]  council-bluffs [910]  san-antonio [897]  houston [883]
//   denver [459]  los-angeles [377]  new-jersey [363]  portland (incl. Hillsboro) [338]
//   des-moines [323]  seattle [304]
// Next below the line: salt-lake-city [289], new-york [249], sacramento [183], richmond [110],
// austin [107], charlotte [16]. The MW is the sum over rows that report a capacity (coverage is
// partial, e.g. Dallas 54 of 249 rows), so the ranking is re-read when the list is next revised;
// this array is the one place it lives.
//
// WHAT OPENS, for get_market_context, get_market_intel and get_market_dcpi_rank on these markets:
// the full answer every paid caller gets (grid, risk, time to power, detailed DCPI scores), to every
// caller, keyless included. Broker lease rates (CBRE / JLL market reports) stay withheld: they are
// licensed. No plan name or price appears in what this adds.
//
// Kill switch: DCHUB_TOP_METROS_FREE=0 (both Railway services).

export const TOP_METROS = Object.freeze([
  { slug: 'northern-virginia', aliases: ['nova', 'n-virginia', 'northern-va', 'ashburn', 'loudoun', 'loudoun-county', 'sterling', 'manassas'] },
  { slug: 'phoenix', aliases: ['phoenix-az', 'mesa', 'chandler', 'goodyear'] },
  { slug: 'dallas', aliases: ['dfw', 'dallas-fort-worth', 'dallas-tx', 'fort-worth'] },
  { slug: 'las-vegas', aliases: ['vegas', 'las-vegas-nv'] },
  { slug: 'columbus', aliases: ['columbus-oh', 'new-albany'] },
  { slug: 'silicon-valley', aliases: ['santa-clara', 'san-jose', 'bay-area'] },
  { slug: 'atlanta', aliases: ['atlanta-ga'] },
  { slug: 'quincy', aliases: ['quincy-wa'] },
  { slug: 'chicago', aliases: ['chicago-il'] },
  { slug: 'kansas-city', aliases: ['kansas-city-mo'] },
  { slug: 'reno', aliases: ['reno-nv', 'tahoe-reno'] },
  { slug: 'council-bluffs', aliases: ['council-bluffs-ia', 'omaha-council-bluffs'] },
  { slug: 'san-antonio', aliases: ['san-antonio-tx'] },
  { slug: 'houston', aliases: ['houston-tx'] },
  { slug: 'denver', aliases: ['denver-co'] },
  { slug: 'los-angeles', aliases: ['la', 'los-angeles-ca'] },
  { slug: 'new-jersey', aliases: ['nj', 'northern-new-jersey'] },
  { slug: 'portland', aliases: ['portland-or', 'hillsboro', 'hillsboro-or'] },
  { slug: 'des-moines', aliases: ['des-moines-ia'] },
  { slug: 'seattle', aliases: ['seattle-wa'] },
]);

export const TOP_METRO_FREE_TOOLS = Object.freeze(new Set(['get_market_context', 'get_market_intel', 'get_market_dcpi_rank']));

const _INDEX = new Map();
for (const m of TOP_METROS) {
  _INDEX.set(m.slug, m.slug);
  for (const a of m.aliases) _INDEX.set(a, m.slug);
}

export function normalizeMarket(input) {
  return String(input == null ? '' : input).trim().toLowerCase()
    .replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// The canonical top-metro slug for a market argument, or null.
export function topMetroSlug(input) {
  const k = normalizeMarket(input);
  return k ? (_INDEX.get(k) || null) : null;
}

export function topMetrosFreeOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_TOP_METROS_FREE) || ''));
}

// The market this call names, when the call is a top-metro briefing call; else null.
export function topMetroFreeCall(name, args, env = process.env) {
  if (!TOP_METRO_FREE_TOOLS.has(name) || !topMetrosFreeOn(env) || !args || typeof args !== 'object') return null;
  return topMetroSlug(args.market != null ? args.market : args.market_slug);
}

export const TOP_METRO_ACCESS_BASIS = 'Open to every caller: this is one of the 20 largest US data-center '
  + 'markets by tracked capacity, and its full market briefing (grid, risk, time to power, detailed '
  + 'scores) is free. Broker lease rates (CBRE/JLL): available on paid plans.';

// get_market_context: the full pack, every section dated. A section whose source carries no date of
// its own takes the pack's date, and says so; the free-shape copy the backend attaches for the
// teasing paths (`_free_preview`) is dropped, since nothing here is a preview.
export function datePackSections(pack) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return pack;
  const { _free_preview: _fp, ...out } = pack;
  if (Array.isArray(out.sections)) {
    const packAsOf = out.as_of || null;
    out.sections = out.sections.map((s) => {
      if (!s || typeof s !== 'object' || s.as_of) return s;
      return packAsOf
        ? { ...s, as_of: packAsOf, as_of_basis: 'the market briefing build date; this section\'s source carries no date of its own' }
        : { ...s, as_of: null, as_of_basis: 'undated: neither this section nor the briefing carries a source date' };
    });
  }
  return out;
}
