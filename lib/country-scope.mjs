// country-scope.mjs — a named non-US country is answered for that country, or not at all.
//
// Brain 2026-11-08 (owner priority 1, geography correctness): the planner had no notion of a
// country. Measured on main 67d274d, _planQuery with no context:
//   "rank markets for a 200 MW AI campus in Germany"   -> ai_capacity_index (US index, no scope)
//   "find 100 MW of buildable capacity in Ireland"     -> get_retirement_headroom + get_refined_queue
//                                                         (EIA-860M + US ISO queues, no scope)
//   "grid headroom for a 50 MW site in Japan"          -> get_grid_scoreboard, then an ISO "chosen
//                                                         from the step-1 scoreboard" (a US ISO)
//   "best data center markets in Brazil"               -> rank_markets region=us (its default)
// Every one of those answers a question about one country with data about another.
//
// Rule: when the intent names a non-US country and no US geography, the US-only steps are not
// run. The plan reads the country itself with the tools that take a country (search_facilities
// country=, source_capacity location=, get_grid_data for a grid DC Hub carries, rank_markets for
// a region that excludes the US), and says what it could not read: grid headroom, queues and
// time-to-power are US coverage. get_global_power takes a country too, but it is not on
// _EXEC_ALLOWED_TOOLS, so it is named as the next call instead of being run.
//
// A tracked DCPI market inside the named country is the more specific place and wins
// ("power outlook for Singapore", "Mexico City"): its plan is kept, and only US-only steps
// in it are swapped for the country steps. A tracked market slug is never read as a country.
//
// Pure: no network, no server state. server.mjs applies it inside _planQuery.

import { dcpiMarketBySlug } from './dcpi-market-match.mjs';

// Name patterns are matched case-insensitively on word boundaries. Left out on purpose, because
// the word is also a US place or a common word: Georgia, Jersey, Jordan, Chad, Turkey, Panama
// (Panama City, FL), Lebanon (PA/TN), Peru (IN), Canada's provinces.
// grid: a get_grid_data code DC Hub serves for the whole country (its tool description lists
// them); null when no single grid covers it. region: a rank_markets region that does NOT include
// the US (eu / apac / canada); null when the only region holding it is "americas" or "global",
// which would rank US markets beside it.
export const NON_US_COUNTRIES = Object.freeze([
  { iso2: 'DE', name: 'Germany',        re: /\b(germany|deutschland)\b/i,                         grid: 'EU_DE_LU', region: 'eu' },
  { iso2: 'FR', name: 'France',         re: /\bfrance\b/i,                                        grid: 'EU_FR',    region: 'eu' },
  { iso2: 'NL', name: 'Netherlands',    re: /\b(the netherlands|netherlands|holland)\b/i,         grid: 'EU_NL',    region: 'eu' },
  { iso2: 'IE', name: 'Ireland',        re: /(?<!northern )\b(republic of )?ireland\b/i,          grid: null,       region: 'eu' },
  { iso2: 'GB', name: 'United Kingdom', re: /\b(united kingdom|great britain|britain|(?<!new\s)england|scotland|wales|northern ireland|u\.k\.|uk)\b/i, grid: 'NGESO', region: null },
  //   ^ 5.26: not "New England" (ISO New England, the US grid; "new england" is a US region).
  { iso2: 'ES', name: 'Spain',          re: /\bspain\b/i,                                         grid: null,       region: 'eu' },
  { iso2: 'IT', name: 'Italy',          re: /\bitaly\b/i,                                         grid: null,       region: 'eu' },
  { iso2: 'SE', name: 'Sweden',         re: /\bsweden\b/i,                                        grid: null,       region: 'eu' },
  { iso2: 'NO', name: 'Norway',         re: /\bnorway\b/i,                                        grid: null,       region: null },
  { iso2: 'DK', name: 'Denmark',        re: /\bdenmark\b/i,                                       grid: null,       region: 'eu' },
  { iso2: 'PL', name: 'Poland',         re: /\bpoland\b/i,                                        grid: null,       region: 'eu' },
  { iso2: 'JP', name: 'Japan',          re: /\bjapan\b/i,                                         grid: 'OCCTO',    region: 'apac' },
  { iso2: 'KR', name: 'South Korea',    re: /(?<!north )\b(south korea|korea)\b/i,                grid: 'KEPCO-KR', region: 'apac' },
  { iso2: 'TW', name: 'Taiwan',         re: /\btaiwan\b/i,                                        grid: 'TAIPOWER', region: 'apac' },
  { iso2: 'SG', name: 'Singapore',      re: /\bsingapore\b/i,                                     grid: 'EMA',      region: 'apac' },
  { iso2: 'AU', name: 'Australia',      re: /\baustralia\b/i,                                     grid: 'AEMO',     region: 'apac' },
  { iso2: 'IN', name: 'India',          re: /\bindia\b/i,                                         grid: null,       region: 'apac' },
  { iso2: 'MY', name: 'Malaysia',       re: /\bmalaysia\b/i,                                      grid: null,       region: 'apac' },
  { iso2: 'BR', name: 'Brazil',         re: /\b(brazil|brasil)\b/i,                               grid: 'ONS',      region: null },
  { iso2: 'MX', name: 'Mexico',         re: /(?<!new )\bmexico\b/i,                               grid: null,       region: null },
  { iso2: 'CL', name: 'Chile',          re: /\bchile\b/i,                                         grid: null,       region: null },
  { iso2: 'CA', name: 'Canada',         re: /\bcanada\b/i,                                        grid: null,       region: 'canada' },
]);

// Grok Note V item 3 (2026-11-16): "Which European markets have grid capacity for a 40 MW data
// center by 2028?" named no country, so nothing above matched; the plan ran get_grid_intelligence and
// get_refined_queue four times each and answered with the CAISO queue. A non-US REGION is read the
// same way as a country: no US-only step. source_region is source_capacity's own region key;
// region is a rank_markets region that excludes the US (null where only americas/global holds it).
// "EU" counts only in capitals (the word, not a substring of another word).
export const NON_US_REGIONS = Object.freeze([
  { key: 'europe', name: 'Europe',       re: /\b(europe|european|emea)\b/i, re2: /\bEU\b/, region: 'eu',   source_region: 'europe' },
  { key: 'apac',   name: 'Asia-Pacific', re: /\b(apac|asia[-\s]?pacific|asia|asian)\b/i,       region: 'apac', source_region: 'asia_pacific' },
  { key: 'latam',  name: 'Latin America', re: /\b(latam|latin\s+america(?:n)?|south\s+america(?:n)?|central\s+america(?:n)?)\b/i, region: null, source_region: 'latin_america' },
  { key: 'mea',    name: 'the Middle East and Africa', re: /\b(middle\s+east(?:ern)?|africa|african)\b/i, region: null, source_region: 'middle_east_africa' },
]);
export function namedNonUsRegions(text) {
  const t = String(text || '');
  return NON_US_REGIONS.filter((r) => r.re.test(t) || (r.re2 && r.re2.test(t)));
}

// Grid labels a DCPI market carries inside the US (states, territories, US balancing areas). Any other
// label (ENTSOE-DE, NGESO, EMA, TEPCO, ...) is a market outside the US. A market's two-letter `state`
// cannot decide it: Frankfurt is DE, which is also Delaware.
const US_GRID_LABELS = new Set(['ERCOT', 'PJM', 'NYISO', 'MISO', 'SPP', 'CAISO', 'ISONE', 'ISO-NE', 'WECC', 'SERC',
  'SOCO', 'FRCC', 'TVA', 'AK', 'HECO', 'GPA', 'PREPA', 'WAPA', 'BPA']);
export function isNonUsMarket(o) {
  return !!(o && typeof o.slug === 'string' && o.slug && typeof o.iso === 'string' && o.iso
    && !US_GRID_LABELS.has(o.iso.toUpperCase()));
}

// Tools whose data is US-only (EIA, US ISO queues, US parcels/states) or that rank US markets
// when given no country. Run for a non-US country, they answer for somewhere else.
export const US_ONLY_TOOLS = Object.freeze(new Set([
  'ai_capacity_index', 'analyze_parcel', 'analyze_site', 'compare_isos', 'find_sites',
  'generate_site_analysis', 'get_composite_site_score', 'get_dchub_recommendation',
  'get_grid_intelligence', 'get_grid_scoreboard', 'get_hosting_capacity',
  'get_interconnection_queue', 'get_power_availability_timeline', 'get_power_pipeline',
  'get_refined_queue', 'get_retirement_headroom', 'get_tax_incentives', 'grid_transition_radar',
  'rank_markets', 'rank_sites', 'site_selection_canvas',
]));

// Signals _planSignals sets when the intent (or context) names a US place or grid.
const US_SIGNAL_KEYS = ['state', 'stateFromPlace', 'iso', 'isoFromPlace', 'coords', 'market',
  'comparePair', '__citySlug', 'placeScope', 'candidateId'];

const MAX_COUNTRIES = 3;

// A value (a slug, a place phrase) that is one of the countries in the table, not a US place.
function isCountryValue(v) {
  if (dcpiMarketBySlug(v)) return false;   // singapore, mexico-city: tracked markets, not countries
  const t = String(v || '').replace(/-/g, ' ');
  return NON_US_COUNTRIES.some((c) => c.re.test(t)) || NON_US_REGIONS.some((r) => r.re.test(t));
}

// True when the planner bound a US place or grid, or the text names the US outright. Bare "us"
// is the pronoun far more often than the country ("help us site 100 MW in Germany"), so it is not.
// A market / comparison slug that is itself a country ("germany") is not a US signal.
export function namesUsGeography(text, signals) {
  const d = signals && typeof signals === 'object' ? signals : {};
  for (const k of US_SIGNAL_KEYS) {
    const v = d[k];
    if (v == null || v === false || v === '') continue;
    if (k === 'market' && isCountryValue(v)) continue;
    if (k === 'comparePair' && v && typeof v === 'object' && isCountryValue(v.a) && isCountryValue(v.b)) continue;
    return true;
  }
  return /\b(united states|usa)\b|\bU\.S\.(A\.)?/i.test(String(text || ''));
}

// Signals with the non-US market's own traces removed: the planner binds Frankfurt as __citySlug /
// market too, and those keys would otherwise read as a US place.
function nonUsMarketIsNotUs(signals) {
  const d = signals && typeof signals === 'object' ? signals : {};
  const o = d.__outlook;
  if (!isNonUsMarket(o)) return d;
  const out = { ...d };
  for (const k of ['__citySlug', 'market', 'state', 'stateFromPlace', 'iso', 'isoFromPlace']) {
    const v = out[k];
    if (v != null && (String(v) === o.slug || String(v).toUpperCase() === String(o.state || '').toUpperCase()
      || String(v).toUpperCase() === String(o.iso || '').toUpperCase())) delete out[k];
  }
  return out;
}

// A step whose arguments name a country as if it were a US market slug or place
// (get_market_dcpi_rank market_slug=germany): it would be fuzzy-matched to some other market.
function stepTreatsCountryAsMarket(s) {
  const a = s && s.args_hint && typeof s.args_hint === 'object' ? s.args_hint : {};
  // A `region` argument is a region filter (source_capacity region=europe), never a market.
  return Object.entries(a).some(([k, v]) => k !== 'region' && typeof v === 'string' && isCountryValue(v));
}

// Grok 2026-11-28 (live check of cd5): "Which colocation providers operate in Frankfurt …" bound Frankfurt, but the
// colocation class has no non-US metro, so its one step was search_facilities {limit: 10} with no place at all: the
// first rows of the whole database (an Equinix site in Hampton). A facility search that names no place answers for
// everywhere, so beside a bound non-US market it is replaced by the country (and city) search, keeping its size filter.
const FACILITY_SCOPE_KEYS = ['country', 'state', 'city', 'query', 'name', 'operator', 'market', 'lat', 'lon'];
export function unscopedFacilitySearch(s) {
  if (!s || s.tool !== 'search_facilities') return false;
  const a = s.args_hint && typeof s.args_hint === 'object' ? s.args_hint : {};
  return !FACILITY_SCOPE_KEYS.some((k) => a[k] != null && a[k] !== '');
}

// The non-US countries an intent names, in the order the table lists them, at most three.
export function namedNonUsCountries(text) {
  const t = String(text || '');
  return NON_US_COUNTRIES.filter((c) => c.re.test(t)).slice(0, MAX_COUNTRIES);
}

// Rewrites a plan sequence for the non-US countries an intent names. Returns null when it names
// none, else { seq, scope }.
//  - Countries only: the US-only steps are dropped and each country gets the steps that read it.
//  - Countries AND a US place ("Texas vs Germany"): the US steps stay for the US place and the
//    country steps are appended, so neither half is answered with the other's data.
// scope says what was dropped and what DC Hub cannot read for those countries, so the answer
// can say so instead of estimating.
// Power-price wording ("day-ahead prices", "wholesale electricity prices", "power price", "LMP").
const NON_US_PRICE_RE = /\b(?:day[- ]ahead|spot|wholesale|power|electricity|energy|electric)\s+(?:(?:power|electricity|energy)\s+)?(?:prices?|costs?|rates?)\b|\blmps?\b/i;
export function nonUsPriceAsk(text) { return NON_US_PRICE_RE.test(String(text || '').slice(0, 2000)); }

// The city a tracked market is searched by: its name before any comma or parenthesis, else its slug in words.
export function marketCity(o) {
  const n = String((o && (o.name || o.slug)) || '').split(/[,(]/)[0].replace(/-/g, ' ').trim();
  return n ? n.replace(/\b\w/g, (ch) => ch.toUpperCase()) : '';
}

// A caller-typed market (context.market) binds __outlook as {slug, basis: 'caller'} with no grid or country, so it
// could not be told apart from a US market. Its tracked record fills them in when it is outside the US; the caller's own fields win.
function withTrackedMarket(signals) {
  const o = signals && signals.__outlook;
  if (!o || typeof o.slug !== 'string' || (o.iso && o.state)) return signals;
  const m = dcpiMarketBySlug(o.slug);
  // Only a market outside the US is filled in: a US market (a Delaware one is state DE, like Germany) stays as typed.
  if (!m || !m.iso || US_GRID_LABELS.has(String(m.iso).toUpperCase())) return signals;
  const filled = { name: m.name, iso: m.iso, ...(Array.isArray(m.states) && m.states[0] ? { state: m.states[0] } : {}) };
  for (const k of Object.keys(o)) if (o[k] != null && o[k] !== '') filled[k] = o[k];
  return { ...signals, __outlook: filled };
}

export function countryScopedPlan(text, signalsIn, seq, intentClass) {
  const signals = withTrackedMarket(signalsIn);
  const countries = namedNonUsCountries(text);
  let regions = namedNonUsRegions(text);
  // Note V: a tracked non-US market named alone ("power availability in Frankfurt by 2027") is read
  // as its country when the table has it, else as the market itself (source_capacity only).
  const om = signals && signals.__outlook;
  if (!countries.length && isNonUsMarket(om)) {
    const c = NON_US_COUNTRIES.find((x) => x.iso2 === String(om.state || '').toUpperCase());
    countries.push(c || { iso2: null, name: om.name || om.slug, grid: null, region: null });
  }
  if (!countries.length && !regions.length) return null;
  const mixed = namesUsGeography(text, nonUsMarketIsNotUs(signals));
  // Beside a US place, a region is read only when the two are compared ("Texas vs Europe"); otherwise
  // it describes someone ("grid headroom in Virginia for an EU customer") and the US plan stands.
  if (mixed && intentClass !== 'market_comparison') regions = [];
  if (!countries.length && !regions.length) return null;
  const regionOnly = !countries.length;
  const orig = (Array.isArray(seq) ? seq : []).filter(Boolean);
  // The planner bound a tracked market in one of the named countries: keep its plan. Only when
  // that plan holds US-only steps (EIA, US queues) are they swapped for the country steps.
  const o = signals && signals.__outlook && signals.__outlook.slug ? signals.__outlook : null;
  const bound = !mixed && o && (countries.some((c) => c.iso2 === o.state) || isNonUsMarket(o)) ? o : null;
  if (bound && !orig.some((s) => US_ONLY_TOOLS.has(s.tool) || unscopedFacilitySearch(s))) return null;
  const unscoped = bound ? orig.find(unscopedFacilitySearch) : null;
  const minCap = unscoped && unscoped.args_hint && Number(unscoped.args_hint.min_capacity_mw) > 0 ? Number(unscoped.args_hint.min_capacity_mw) : null;
  const dropped = mixed ? [] : bound ? [...new Set(orig.filter((s) => US_ONLY_TOOLS.has(s.tool)).map((s) => s.tool))] : [...new Set(orig.filter((s) => US_ONLY_TOOLS.has(s.tool) || stepTreatsCountryAsMarket(s)).map((s) => s.tool))];
  const mw = signals && Number.isFinite(signals.mw) && signals.mw > 0 ? signals.mw : null;
  // Mixed: keep the US steps for the US place, minus any step that reads a country as a market.
  // Region only: a plan with no US-only step is already about the region ("500 kW of colo in Europe"
  // keeps its facility search and its Capacity Source step); otherwise its other steps are kept too.
  if (regionOnly && !mixed && !orig.some((s) => US_ONLY_TOOLS.has(s.tool) || stepTreatsCountryAsMarket(s))) return null;
  const kept = mixed ? orig.filter((s) => !stepTreatsCountryAsMarket(s))
    : bound ? orig.filter((s) => !US_ONLY_TOOLS.has(s.tool) && !unscopedFacilitySearch(s))
      : regionOnly ? orig.filter((s) => !US_ONLY_TOOLS.has(s.tool) && !stepTreatsCountryAsMarket(s)) : [];
  const countryAsMarket = mixed ? orig.filter((s) => stepTreatsCountryAsMarket(s)).map((s) => s.tool) : [];
  // A kept market step still holding a "<the market named…>" placeholder is bound to the tracked
  // market, so the executor cannot mint some other slug into it.
  const bindArgs = (a) => {
    if (!bound || !a || typeof a !== 'object') return a;
    const ph = (v) => typeof v === 'string' && /^<.*>$/.test(v);
    return { ...a, ...(ph(a.market_slug) ? { market_slug: bound.slug } : {}), ...(ph(a.market) ? { market: bound.intel || bound.slug } : {}) };
  };
  const out = kept.map((s, i) => ({ ...s, step: i + 1, depends_on: [], ...(s.args_hint ? { args_hint: bindArgs(s.args_hint) } : {}) }));
  const add = (tool, args, why) => out.push({ step: out.length + 1, tool, depends_on: [], estimated_calls: 1, why, args_hint: args });
  // 5.41 (Grok 2026-11-18 e8): a power-price question about named countries only reads each country's grid; a
  // facility search or a capacity listing does not answer a price, and DC Hub holds no price for these zones.
  const priceOnly = !mixed && countries.length > 0 && !regions.length && nonUsPriceAsk(text);
  if (priceOnly) {
    for (const c of countries) {
      if (c.grid) add('get_grid_data', { iso: c.grid }, `${c.name}'s grid (${c.grid}): whatever reading DC Hub holds for it. DC Hub holds no day-ahead or wholesale price for this zone.`);
    }
    if (!out.length) return null;
  }
  // The colocation class leads with the asked market's DCPI card; a replaced unscoped search left the plan without one.
  if (unscoped && !out.some((x) => x.tool === 'get_market_dcpi_rank')) {
    add('get_market_dcpi_rank', { market_slug: bound.slug }, `DCPI verdict for ${marketCity(bound) || bound.slug}, the market asked about.`);
  }
  for (const c of priceOnly ? [] : countries) {
    if (c.iso2) {
      // Grok 2026-11-27 (cd5): a tracked market in this country ("Frankfurt data center market") reads that city, so
      // Düsseldorf, Munich or Jena rows are never reported as the market's (search_facilities city=, e.g. 229 rows).
      const city = bound && (String(bound.state || '').toUpperCase() === c.iso2 || (countries.length === 1 && isNonUsMarket(bound)))
        ? marketCity(bound) : '';
      add('search_facilities', { country: c.iso2, ...(city ? { city } : {}), limit: 25, ...(minCap ? { min_capacity_mw: minCap } : {}) },
        city ? `The data centers DC Hub tracks in ${city}, ${c.name} (country=${c.iso2}, city=${city}), not the whole country.`
          : `The data centers DC Hub tracks in ${c.name} (country=${c.iso2}), not a US market standing in for it.`);
    }
    if (c.grid) {
      add('get_grid_data', { iso: c.grid },
        `Live demand and fuel mix for ${c.name}'s grid (${c.grid}). Telemetry only: it is not headroom or available capacity.`);
    }
    if (intentClass === 'market_ranking' && c.region && !out.some((x) => x.tool === 'rank_markets' && x.args_hint && x.args_hint.region === c.region)) {
      add('rank_markets', { region: c.region, criteria: 'best_overall', limit: 10 },
        `Ranks markets in region=${c.region}, which excludes the US. Keep only rows in ${c.name} when you answer.`);
    }
    add('source_capacity', { location: c.name, ...(mw ? { min_mw: mw } : {}) },
      `Listed capacity for sale or lease in ${c.name}${mw ? `, sized to ${mw} MW deliverable` : ''}.`);
  }
  for (const r of regions) {
    if (r.region && !out.some((x) => x.tool === 'rank_markets' && x.args_hint && x.args_hint.region === r.region)) {
      add('rank_markets', { region: r.region, criteria: 'best_overall', limit: 10 },
        `Ranks DC Hub's tracked markets in region=${r.region}, which excludes the US.`);
    }
    if (out.some((x) => x.tool === 'source_capacity')) continue;
    add('source_capacity', { region: r.source_region, ...(mw ? { min_mw: mw } : {}) },
      `Listed capacity for sale or lease in ${r.name}${mw ? `, sized to ${mw} MW deliverable` : ''}.`);
  }
  const names = [...countries.map((c) => c.name), ...regions.map((r) => r.name)];
  const name = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  const notCovered = priceOnly ? 'day-ahead and wholesale power prices, grid headroom, interconnection queues and time-to-power'
    : 'grid headroom, interconnection queues and time-to-power';
  const scope = {
    countries: countries.map((c) => ({ country: c.iso2, name: c.name, grid: c.grid })),
    ...(regions.length ? { regions: regions.map((r) => ({ region: r.key, name: r.name })) } : {}),
    name,
    mixed_with_us: mixed,
    ...(priceOnly ? { price_not_covered: true } : {}),
    ...(bound ? { bound_market: bound.slug } : {}),
    steps_dropped: dropped,
    ...(countryAsMarket.length ? { country_as_market_steps_dropped: [...new Set(countryAsMarket)] } : {}),
    not_covered: notCovered,
    next_calls: [
      ...countries.filter((c) => c.iso2).map((c) => ({ tool: 'get_global_power', args: { country: c.name, pipeline: true },
        why: `Power plants and the generation pipeline in ${c.name} (Global Energy Monitor). Call it directly; execute_plan does not run it.` })),
      ...regions.map((r) => ({ tool: 'get_global_power', args: { country: '<a country in ' + r.name + '>', pipeline: true },
        why: `Power plants and the generation pipeline, one country in ${r.name} at a time (Global Energy Monitor). Call it directly; execute_plan does not run it.` })),
    ],
    note: `${name} ${countries.length > 1 ? 'are' : 'is'} outside DC Hub's US grid and queue coverage. This plan reads ${name} ${countries.length > 1 ? 'themselves' : 'itself'}`
      + (dropped.length ? ` and does not run the steps that would answer from US data or read a country as a market (${dropped.join(', ')})` : '')
      + (mixed ? '; its US steps answer only for the US place named' : '')
      + `, so no US market or ISO is reported for ${name}. DC Hub does not hold ${notCovered} for ${name}: report them as not covered, never estimated`
      + (mw ? `, and do not describe ${mw} MW as available there` : '') + '.',
  };
  scope.answer_line = `GEOGRAPHY — ${scope.note}`;
  return { seq: out, scope };
}
