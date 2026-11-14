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
  return NON_US_COUNTRIES.some((c) => c.re.test(t));
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

// A step whose arguments name a country as if it were a US market slug or place
// (get_market_dcpi_rank market_slug=germany): it would be fuzzy-matched to some other market.
function stepTreatsCountryAsMarket(s) {
  const a = s && s.args_hint && typeof s.args_hint === 'object' ? s.args_hint : {};
  return Object.values(a).some((v) => typeof v === 'string' && isCountryValue(v));
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
export function countryScopedPlan(text, signals, seq, intentClass) {
  const countries = namedNonUsCountries(text);
  if (!countries.length) return null;
  const mixed = namesUsGeography(text, signals);
  const orig = (Array.isArray(seq) ? seq : []).filter(Boolean);
  // The planner bound a tracked market in one of the named countries: keep its plan. Only when
  // that plan holds US-only steps (EIA, US queues) are they swapped for the country steps.
  const o = signals && signals.__outlook && signals.__outlook.slug ? signals.__outlook : null;
  const bound = !mixed && o && countries.some((c) => c.iso2 === o.state) ? o : null;
  if (bound && !orig.some((s) => US_ONLY_TOOLS.has(s.tool))) return null;
  const dropped = mixed ? [] : bound ? [...new Set(orig.filter((s) => US_ONLY_TOOLS.has(s.tool)).map((s) => s.tool))] : [...new Set(orig.filter((s) => US_ONLY_TOOLS.has(s.tool) || stepTreatsCountryAsMarket(s)).map((s) => s.tool))];
  const mw = signals && Number.isFinite(signals.mw) && signals.mw > 0 ? signals.mw : null;
  // Mixed: keep the US steps for the US place, minus any step that reads a country as a market.
  const kept = mixed ? orig.filter((s) => !stepTreatsCountryAsMarket(s))
    : bound ? orig.filter((s) => !US_ONLY_TOOLS.has(s.tool)) : [];
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
  for (const c of countries) {
    add('search_facilities', { country: c.iso2, limit: 25 },
      `The data centers DC Hub tracks in ${c.name} (country=${c.iso2}), not a US market standing in for it.`);
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
  const names = countries.map((c) => c.name);
  const name = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  const notCovered = 'grid headroom, interconnection queues and time-to-power';
  const scope = {
    countries: countries.map((c) => ({ country: c.iso2, name: c.name, grid: c.grid })),
    name,
    mixed_with_us: mixed,
    ...(bound ? { bound_market: bound.slug } : {}),
    steps_dropped: dropped,
    ...(countryAsMarket.length ? { country_as_market_steps_dropped: [...new Set(countryAsMarket)] } : {}),
    not_covered: notCovered,
    next_calls: countries.map((c) => ({ tool: 'get_global_power', args: { country: c.name, pipeline: true },
      why: `Power plants and the generation pipeline in ${c.name} (Global Energy Monitor). Call it directly; execute_plan does not run it.` })),
    note: `${name} ${countries.length > 1 ? 'are' : 'is'} outside DC Hub's US grid and queue coverage. This plan reads ${name} ${countries.length > 1 ? 'themselves' : 'itself'}`
      + (dropped.length ? ` and does not run the steps that would answer from US data or read a country as a market (${dropped.join(', ')})` : '')
      + (mixed ? '; its US steps answer only for the US place named' : '')
      + `, so no US market or ISO is reported for ${name}. DC Hub does not hold ${notCovered} for ${name}: report them as not covered, never estimated`
      + (mw ? `, and do not describe ${mw} MW as available there` : '') + '.',
  };
  scope.answer_line = `GEOGRAPHY — ${scope.note}`;
  return { seq: out, scope };
}
