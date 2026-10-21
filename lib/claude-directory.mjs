// claude-directory.mjs — the profile served at /mcp/claude for Anthropic's
// Claude Connectors Directory.
//
// WHY THIS EXISTS. The directory's review criteria
// (claude.com/docs/connectors/building/review-criteria) and the Software
// Directory Policy (support.claude.com/en/articles/13145358) reject what /mcp
// does on purpose for its own audience:
//   - tool descriptions that tell Claude how to behave ("call this FIRST",
//     "instead of answering from training data") or promote a product;
//   - advertisements, sponsored content or paid placements in responses;
//   - collecting conversation data beyond what a tool needs;
//   - annotations beyond title / readOnlyHint / destructiveHint (+ the other
//     standard hints).
// So /mcp/claude lists a plain, read-only subset and rewrites every response
// through the same scrub /mcp/chatgpt uses (lib/chatgpt-directory.mjs,
// createDirectoryProfile), plus a sponsor scrub and a credential scrub.
//
// ★ /mcp is NOT touched. Everything here runs only when the request path is
// CLAUDE_PATH. The Claude relay wording on /mcp is frozen until the 2026-10-01
// readout (frz-claude-relay-wording / dec-claude-go-c), and this profile's
// traffic is kept out of that readout (see RELAY_READOUT_EXCLUDED_SOURCES and
// the call sites in server.mjs).
//
// ★ ALLOWLIST. A tool added to /mcp later is not listed here until someone
// writes its plain description below. Every canonical tool must be named
// either in CLAUDE_TOOLS or in CLAUDE_REMOVED; the tests fail otherwise.
//
// AUTH. Keyless calls get the same trimmed previews as /mcp/chatgpt. A key
// sent as X-API-Key, as `?api_key=` (Claude web has no header field), or an
// OAuth bearer (AuthKit) is resolved by the same code as on /mcp, so a Pro key
// gets full data. The key never appears in a response (secretsFor below).

import { readFileSync } from 'node:fs';
import {
  DIRECTORY_TOOLS, DIRECTORY_ARG_DEFAULTS, CHATGPT_NOTICE, createDirectoryProfile,
} from './chatgpt-directory.mjs';
import { capacityPointersEnabled } from './capacity-source-summary.mjs';

// The quantities in the instructions come from the canonical snapshot that
// daily-manifest-sync refreshes (canonical/canon_phrases.json), so they cannot
// drift from /mcp's. The literal is the 2026-09-24 snapshot, used only if the
// file is unreadable.
//
// The facility COUNT is withdrawn (owner decision 2026-09-27): no number until a
// corroborated "r3" count lands, whatever the snapshot's numeric `facilities`
// says. The wording matches the r2 comparison brief.
const _CANON = (() => {
  try { return JSON.parse(readFileSync(new URL('../canonical/canon_phrases.json', import.meta.url), 'utf8')); }
  catch (_) { return {}; }
})();
const _FACILITIES = 'a global data-center facility map';
const _MARKETS = typeof _CANON.markets === 'string' ? _CANON.markets : '300+';

export const CLAUDE_PROFILE = 'claude_directory';
export const CLAUDE_PATH = '/mcp/claude';
export const CLAUDE_SOURCE = 'claude-directory';
export const CLAUDE_RESOURCE = 'https://dchub.cloud/mcp/claude';
// RFC 9728 §3.1: the metadata URL for resource https://dchub.cloud/mcp/claude.
export const CLAUDE_PRM_URL = 'https://dchub.cloud/.well-known/oauth-protected-resource/mcp/claude';
// Grok 2026-10-16 (pack section 4, option B): agent-facing text names no plan, price or link. A gated
// result ends with the same neutral partial-result line as /mcp/chatgpt. The pricing link is for
// people, on the listing and the site, not in a tool result. The export name is kept: tests and
// callers already import it.
export const CLAUDE_PLANS_NOTICE = CHATGPT_NOTICE;

// Arrival sources whose traffic is never counted in the relay / 10-01 readout:
// no paywall signal, no high-intent hit, no claim, no OAuth-challenge counter.
// The profile shows no relay line, so counting its gated calls would add
// "relay shown" rows that no human could ever act on.
export const RELAY_READOUT_EXCLUDED_SOURCES = Object.freeze(new Set([CLAUDE_SOURCE]));
export function excludedFromRelayReadout(c) {
  return !!c && (c.profile === CLAUDE_PROFILE || RELAY_READOUT_EXCLUDED_SOURCES.has(c.source));
}

// Withdrawn capabilities are not listed (also enforced from the canonical
// `withdrawn` annotation by listFilter, so a later withdrawal drops out too).
export const CLAUDE_WITHDRAWN = Object.freeze(['get_gas_economics', 'get_gas_intelligence']);

// Not listed and not callable ("Unknown tool").
export const CLAUDE_REMOVED = Object.freeze([
  // Commerce, keys and identity.
  'claim_free_key', 'recover_my_key', 'bind_email', 'unlock_more_data', 'why_dchub',
  // Write tools (saved sites, shortlists, alerts, digests, standing intents)
  // and the read halves that only return what those tools wrote.
  'save_site', 'list_saved_sites', 'save_to_shortlist', 'get_shortlist', 'set_shortlist_alert',
  'suggest_reallocation', 'set_market_alert', 'set_site_alert', 'subscribe_digest',
  'register_standing_intent', 'list_standing_intents', 'delete_standing_intent',
  // The Capacity Source WRITES stay off: accepting the introduction terms and
  // registering a deal are a sign-in, a lead register and a contract, not a
  // lookup. Browsing the listings (source_capacity) is listed below since
  // 2026-09-29 (owner decision); /mcp keeps all three. export_dataset is a
  // bulk download.
  'request_capacity_intro', 'accept_capacity_terms', 'export_dataset',
  // Descriptions of DC Hub itself and of who integrates it: promotional, and
  // no user question needs them.
  'get_dchub_recommendation', 'get_agent_registry',
  // 2026-10-08: the partner tools answer only a key issued under a partner slug
  // (the owner's auditor); no directory user has one. /mcp keeps them.
  'read_inbox', 'report_finding',
  // 2026-10-09: research_task queues a job row and may answer {task_id}; it is
  // not a read-only lookup (same fix as /mcp/chatgpt). /mcp keeps it.
  'research_task',
  ...CLAUDE_WITHDRAWN,
]);
const _REMOVED = new Set(CLAUDE_REMOVED);

// execute_plan on this profile says what happens to the question (item 7).
// Measured in server.mjs, 2026-09-26:
//   - the planner is rule-based (_planQuery: keyword routing, no model call);
//   - trackedTool's telemetry sends the call's arguments, `intent` included, to
//     DC Hub's /api/v1/mcp/track, which stores them in mcp_tool_calls.params
//     (truncated to 4,000 characters) with the tool, time, client name, caller
//     IP, user agent and API key if one was used;
//   - the recipe_lifecycle events store the first 500 characters of `intent`
//     in the plan-run record;
//   - no job deletes either record (no purge in dchub-backend, 2026-09-26).
export const EXECUTE_PLAN_DESCRIPTION =
  'Use this when a data center question spans several topics; answers it in one call. Pass the question as intent; '
  + 'a rule-based planner (no AI model) uses the text to choose the lookups (markets, grid, fiber, water, '
  + 'incentives), runs them, and returns each step\'s result with a replay of how the answer was built. '
  + 'Logging: the intent text is stored in DC Hub\'s usage log with the call (up to 4,000 characters, with '
  + 'the time, client name, IP address and API key if one is used) and in a plan-run record (first 500 '
  + 'characters). These records have no automatic deletion date. Privacy policy: https://dchub.cloud/privacy';

const _LAND_AND_POWER_NOTE = ' Needs a DC Hub account with site-analysis access; without one it returns only a notice.';
// Capacity Source browse, listed on this profile since 2026-09-29 (owner
// decision). Read-only on /mcp too (not in server.mjs WRITE_TOOLS). The two
// write halves stay in CLAUDE_REMOVED, so this says what a result carries and
// no more: the teaser cards, never the provider.
export const SOURCE_CAPACITY_DESCRIPTION =
  'Use this when the user needs data center or colocation capacity to buy or lease (powered land, powered shells, turnkey). Search DC Hub Capacity Source by size (min_kw or min_mw), region, location (country, state or metro), market, delivery_type or available_by. Size is matched against what a listing can deliver (contiguous_kw and min_contract_kw), not only its headline total. Returns listing cards with market, state, capacity, delivery type, availability and last update; no provider identity.';

const _CLAUDE_OWN = {
  analyze_site: 'Use this when the user asks if one site suits a data center (lat/lon, candidate_id or market): 0-100 score with power, gas, fiber, market and risk sub-scores.' + _LAND_AND_POWER_NOTE,
  compare_sites: 'Use this when the user compares 2-4 data center sites ("lat,lon;lat,lon"): analyze_site scores side by side and the top site with the reason.' + _LAND_AND_POWER_NOTE,
  get_composite_site_score: 'Use this when the user wants one 0-100 data center site verdict from measured factors only (power, fiber, hazard, water), with coverage map.' + _LAND_AND_POWER_NOTE,
  generate_site_analysis: 'Use this when the user wants a Site Analysis PDF for one lat/lon (power, gas, water, permitting, fiber, latency, market, tax), link valid about 7 days.' + _LAND_AND_POWER_NOTE,
};

// Tool search (owner GO 2026-10-20): Claude defers connector tools and searches their names and
// descriptions, so each description here opens "Use this when ..." with the domain words a user
// types (data center, power, grid, energy, interconnection queue, fiber, gas, site selection,
// colocation). /mcp/chatgpt keeps its reviewed DIRECTORY_TOOLS text (frozen for OpenAI review);
// this profile overrides it by name. Total length is below the 2026-10-19 text (10,447 chars).
export const CLAUDE_SEARCH_DESCRIPTIONS = Object.freeze({
  search: 'Use this when you need a text search of data center facilities (search/fetch format). Returns {id, title, url}; pass an id to fetch.',
  fetch: 'Use this when you have an id from search and need that data center facility: {id, title, text, url, metadata} with operator, location, status, market.',
  search_facilities: 'Use this when the user asks which data centers exist or who operates where: filter by name, country, state, city, operator, MW range or Uptime tier.',
  get_facility: 'Use this when the user asks about one data center facility (id, slug or name): operator, address, power capacity, cooling, fiber carriers, status, market DCPI verdict.',
  get_market_intel: 'Use this when the user asks about one data center market (slug): vacancy, capacity pricing, supply pipeline, main operators and growth.',
  get_market_dcpi_rank: 'Use this when the user asks whether a market has power for a data center: DCPI BUILD/CAUTION/AVOID verdict, score bands, time to power, data basis, narrative.',
  predict_market_trajectory: 'Use this when the user asks where a market\'s data center power outlook is heading: DCPI scores 1-8 quarters ahead, with confidence bands.',
  get_gas_index: 'Use this when the user asks which US states suit gas-fired data center power: the Data Center Gas Index (DCGI), per state.',
  get_grid_scoreboard: 'Use this when the user asks how power grids compare right now (US, GB, Europe, parts of Asia-Pacific and Latin America): demand, fuel mix, renewable and gas share.',
  compare_isos: 'Use this when the user wants 2-4 power grids side by side, e.g. "PJM,ERCOT" or "ERCOT,AESO,EU_DE_LU": fuel mix, demand, renewable and gas share; queue depth and time to power for the US ISOs.',
  get_intelligence_index: 'Use this when the user asks how healthy a data center market is: a 0-100 index of supply and demand, vacancy, absorption, fiber, power and pricing trend.',
  list_transactions: 'Use this when the user asks about data center M&A or capital deals since 2019: filter by buyer, seller, value, type, date or region.',
  get_news: 'Use this when the user asks for data center industry news: filter by keyword, category, source and date.',
  semantic_search: 'Use this when a data center or energy question is fuzzy: meaning-based search over news, deals, facilities and market analyses, with source fields.',
  search_intelligence: 'Use this when you need meaning-based search over DC Hub news, deals, facilities and analyses, choosing corpora by name (same retrieval as semantic_search).',
  get_market_context: 'Use this when you need a token-budgeted briefing on one data center market: DCPI verdict, power and grid, outlook, deals, pipeline, operators, risks, news.',
  get_iso_context: 'Use this when you need a token-budgeted briefing on one US power grid (ISO/RTO): live grid, DCPI verdicts, queue depth, benchmark prices, markets.',
  get_pipeline: 'Use this when the user asks what data centers are announced, permitted or under construction: filter by status, country, operator, MW or completion date.',
  get_power_pipeline: 'Use this when the user asks where new US power generation is coming (EIA-860M, incl. non-ISO): filter by state, balancing authority, status or MW.',
  get_infra_projects: 'Use this when the user asks about planned gas pipeline or transmission line projects: filter by type, state, status, capacity, voltage, in-service date.',
  get_power_availability_timeline: 'Use this when the user asks when power gets easier in a US state (time to power): new generation by confidence, retirements, queue depth, year by year.',
  get_global_power: 'Use this when the user asks about power plants worldwide (Global Energy Monitor, all fuels, operating and pipeline): filter by country, fuel, status, size.',
  get_interconnection_queue: 'Use this when the user asks about interconnection queues: queued generation per US ISO, and ERCOT\'s large-load (data center) queue.',
  get_refined_queue: 'Use this when you need interconnection queue projects filtered server-side by size, wait, ISO, fuel, status, fiber distance or geography.',
  get_retirement_headroom: 'Use this when the user asks where retiring power plants free grid capacity for a target MW, with the nearest substations.',
  get_hosting_capacity: 'Use this when the user asks how many MW a distribution feeder can take near a site or market: utility-published hosting capacity.',
  analyze_parcel: 'Use this when the user has a land parcel (GeoJSON, or lat/lon in a hosted county): acreage, shape and nearby power infrastructure.',
  rank_sites: 'Use this when you have candidate data center sites (lat/lng plus metrics) to rank under hard constraints and weighted objectives.',
  discover_tools: 'Use this when you are unsure which DC Hub tool fits: tools by family (facility, market, grid and power, gas, site, fiber, deals and news).',
  plan_query: 'Use this when you want the tool plan for a data center question without running it.',
  get_grid_data: 'Use this when the user asks for live electricity grid data for one grid: a US ISO, TVA, BPA, a US utility BA, Canada (IESO, AESO, HYDROQUEBEC), GB (NGESO), an ENTSO-E zone (EU_DE_LU), Taiwan, Japan, South Korea, Brazil, Australia or Singapore: fuel mix and demand.',
  get_changes: 'Use this when the user asks what changed since a date: DCPI market movers, new data center facilities, deals and news.',
  get_facility_risk_delta: 'Use this when the user asks how a facility\'s market power risk (DCPI) changed over a window: improving, worsening or flat.',
  find_sites: 'Use this when the user has no site yet: candidate data center search areas in a state or near a point, by substation voltage and gas and fiber distance.',
  get_disaster_risk: 'Use this when the user asks about natural-hazard risk at a US site (FEMA National Risk Index): flood, wildfire, hurricane, earthquake, heat, drought, tornado.',
  get_climate_intel: 'Use this when the user asks for seismic (USGS ASCE 7) or climate (NOAA) design inputs at a lat/lon, e.g. cooling degree-days.',
  get_infrastructure: 'Use this when the user asks what power infrastructure is near a site: substations, transmission lines, gas pipelines, power plants.',
  get_fiber_intel: 'Use this when the user asks about fiber routes or carriers for a market: long-haul, metro and dark fiber, by carrier or route type.',
  get_fiber_readiness: 'Use this when the user asks if a site (lat/lon) is fiber-ready: distance to a carrier-served facility, reachable carriers, single-carrier risk.',
  get_subsea_cables: 'Use this when the user asks about subsea cable landings near a point, or the subsea cable catalogue.',
  get_peering_intel: 'Use this when the user asks about internet exchange and peering density near a lat/lon (PeeringDB), or top peering facilities.',
  get_metro_fiber: 'Use this when the user asks about a US metro\'s fiber: carriers, route miles, on-net buildings, density score, exchanges, carrier hotels.',
  get_energy_prices: 'Use this when the user asks about electricity or gas prices by US state or ISO: retail, wholesale, natural gas.',
  get_renewable_energy: 'Use this when the user asks about renewable energy for a US state or site: generation mix and PPA sizing inputs.',
  get_tax_incentives: 'Use this when the user asks about data center tax incentives in a US state: exemptions, abatements, thresholds.',
  get_water_risk: 'Use this when the user asks about water stress at a US site or state, for data center cooling.',
  get_grid_intelligence: 'Use this when the user asks about grid capacity or time to power in one US ISO: demand, fuel mix, excess-power and constraint bands, queue.',
  get_backup_status: 'Use this when the user asks how current DC Hub\'s data feeds are: health, record count and refresh interval per feed.',
  summarize_for_citation: 'Use this when you quote a DC Hub figure: an attribution line with the licence for its data layer.',
  rank_markets: 'Use this when the user wants data center markets ranked by one criterion (e.g. ai_ready for power), by region or minimum MW.',
  find_alternatives: 'Use this when the user wants data center facilities similar to one they name, with similarity scores and differences.',
  score_facility: 'Use this when the user wants one data center facility graded 0-100: power, fiber, water, climate, tax, talent, expansion.',
  ai_capacity_index: 'Use this when the user asks where large AI compute capacity could land in 30, 60 or 90 days, by data center market.',
  hyperscaler_deals: 'Use this when the user asks about hyperscaler or AI data center deals and announcements, with amounts and MW.',
  site_selection_canvas: 'Use this when the user wants a data center market shortlist for a MW target, geography and deadline: DCPI verdict, headroom, time to power.',
  grid_transition_radar: 'Use this when the user asks where new grid headroom for large data center loads is emerging, by US market and ISO.',
  deal_autopsy: 'Use this when the user asks what recent data center deals mean for power: each market\'s DCPI verdict and time to power.',
  get_permitting_intel: 'Use this when the user asks about data center permitting or moratoriums by jurisdiction: zoning, tax changes, utility pauses, stage-tagged with sources.',
  simulate_scenario: 'Use this when the user asks how data center power market rankings move under what-if changes (power price, time to power, queue wait, reserve margin).',
  plan_fiber_leadin: 'Use this when the user asks how to get diverse fiber into a data center site: road-following lead-in routes, distances, indicative cost, shared corridors.',
  cluster_sites_by_latency: 'Use this when the user asks which of 2-8 data center sites can form low-latency clusters (round-trip time floors).',
});
// The five common tools the instructions name load upfront in Claude Code; the rest stay deferred.
export const CLAUDE_ALWAYS_LOAD = Object.freeze(new Set(['execute_plan', 'search_facilities', 'get_market_intel', 'get_grid_data', 'source_capacity']));

// ChatGPT's plain descriptions, less what this profile removes, plus its own.
export const CLAUDE_TOOLS = Object.freeze((() => {
  const out = {};
  for (const [name, d] of Object.entries(DIRECTORY_TOOLS)) {
    if (_REMOVED.has(name)) continue;
    out[name] = name === 'execute_plan' ? EXECUTE_PLAN_DESCRIPTION : (CLAUDE_SEARCH_DESCRIPTIONS[name] || d);
    // The site-scoring tools sit beside find_sites, their natural neighbour.
    if (name === 'find_sites') Object.assign(out, _CLAUDE_OWN);
    // Capacity Source sits beside the development pipeline.
    if (name === 'get_pipeline') out.source_capacity = SOURCE_CAPACITY_DESCRIPTION;
  }
  return out;
})());

export const CLAUDE_INSTRUCTIONS =
  'DC Hub (dchub.cloud) is a data service about the physical infrastructure behind data centers: '
  + `${_FACILITIES}, ${_MARKETS} scored markets (the Data Center Power Index, DCPI), power grids and `
  + 'interconnection queues, power plants, gas pipelines, fiber routes and subsea cables, water and '
  + 'natural-hazard risk, tax incentives, permitting, data-center deals and news, and data-center '
  + 'capacity listed for sale or lease (Capacity Source). '
  + 'Every tool here is a read-only lookup against DC Hub\'s own database and the public grid feeds '
  + 'it ingests. execute_plan answers a question that spans several of these areas in one call; the '
  + 'other tools each answer one kind of question. '
  + 'Without a DC Hub plan some results are previews: withheld fields are marked with a _withheld '
  + 'suffix and the result ends with one line saying so. '
  + 'Results carry an as_of timestamp and a citation. When quoting a figure, attribute it to DC Hub '
  + '(dchub.cloud) and give its as_of date.';

// ── Sponsor content ─────────────────────────────────────────────────────────
// The DCPI score API attaches a sponsor block (dchub-backend
// routes/sponsor_render.py sponsor_block_payload: {is_paid_placement: true,
// disclosure: "This is a PAID ADVERTISEMENT…", sponsor_name, message,
// url: …/api/v1/sponsorships/<id>/click}) and llms.txt carries a fenced text
// block ("## SPONSORED - PAID PLACEMENT" … "## END SPONSORED - PAID PLACEMENT").
// The directory policy prohibits advertisements, sponsored content and paid
// placements, so on this profile they are removed three ways:
//   1. by key name (sponsor*, advert*, paid_placement*, promoted*, ad/ads);
//   2. by content, whatever the key: an object flagged as paid/sponsored/ad, or
//      carrying the disclosure wording or a sponsorship click URL, goes whole;
//   3. by text: the fenced block, and any sentence naming sponsored or paid
//      placement content.
// A result that still matches SPONSOR_HARD after all three is replaced whole
// (resultGuard) rather than sent.
// Flags only: a deal row's {sponsor: "Blackstone"} is a fact about the deal,
// so a plain `sponsor` key is dropped by name (CLAUDE_DROP_KEY_EXTRA) without
// taking its row with it.
const SPONSOR_FLAG_KEY = /^(is_)?(paid_placement|sponsored|ad|advert|advertisement|promoted|paid_promotion)$/i;
const SPONSOR_TEXT = /paid[\s_-]*(advertisement|placement|promotion)|sponsored[\s_-]*(content|message|placement|listing|link|result)|\/sponsorships?\/|\bADVERTISEMENT\b/i;
export const SPONSOR_HARD = /paid[\s_-]*placement|paid[\s_-]*advertisement|sponsored[\s_-]*(content|message|placement|listing|link)|\/sponsorships?\/|"sponsor(ship|_name|_url|_id)?"\s*:/i;

// The object's own label fields decide; a long prose field that merely
// CONTAINS a sponsor passage is left to the text scrub, which removes the
// passage and keeps the object (a market note with a fenced block in it).
const SPONSOR_LABEL_FIELD = /^(disclosure|url|href|link|click_url|cta_url|label|type|kind|category|badge|tag)$/i;
function _isSponsorObject(v) {
  for (const [k, x] of Object.entries(v)) {
    if (SPONSOR_FLAG_KEY.test(k) && (x === true || x === 1 || /^(true|yes|1)$/i.test(String(x)))) return true;
    if (typeof x !== 'string' || !SPONSOR_LABEL_FIELD.test(k)) continue;
    if (SPONSOR_TEXT.test(x)) return true;
    if (/^(ad|ads|advert|advertisement|sponsor|sponsored|promoted|promotion|paid placement)$/i.test(x.trim())) return true;
  }
  return false;
}

function _stripSponsorBlocks(s) {
  if (!/SPONSOR/i.test(s)) return s;
  // A fenced block, to its END marker or, if the end was cut off, to the end.
  return s.replace(/^[ \t]*#+[ \t]*SPONSORED\b[^\n]*(?:\n[\s\S]*?)?(?:\n[ \t]*#+[ \t]*END[ \t]+SPONSORED\b[^\n]*|$(?![\s\S]))/gim, '');
}

const CLAUDE_COMMERCE_EXTRA = [
  // Sponsor and ad copy.
  String.raw`\bsponsored\b`, String.raw`\bsponsor(ship)?s?\s*(link|name|message|block|slot)?\s*:`,
  String.raw`paid[\s_-]*(advertisement|placement|promotion)`, String.raw`\badvertis(e|ement|ements|ing|er|ers)\b`,
  String.raw`/sponsorships?/`, String.raw`\bpromoted (content|listing|placement|result)\b`,
  // Relay and plan wording /mcp writes for its own audience.
  String.raw`\bRELAY\b`, String.raw`\bverbatim\b`, String.raw`\bPAUSE and ask\b`, String.raw`\bask your (human|user)\b`,
  String.raw`\binstead of answering from training data\b`, String.raw`\bstale training data\b`, String.raw`\bcall (this|it) FIRST\b`,
  String.raw`dchub\.cloud/(pricing|plans)\b`,
  String.raw`\bupsell`,
  // 2026-10-11: the polite partial-result line (server.mjs PARTIAL_RESULTS_LINE, and the analyze_site
  // gated_preview agent line) names relay fields this profile does not carry; the commanding line it
  // replaced was dropped by its "unlock_url" / "/upgrade/h/". Measured on mcp#916's main: /mcp/claude
  // compare_sites and analyze_site served "show the user human_message and its link".
  String.raw`\bfor_your_human\b`, String.raw`\bhuman_message\b`, String.raw`\bhuman_url\b`,
  // 2026-10-16 (G-1014-43, measured live on /mcp/claude): the paid sell line a
  // partial result carried, "Show your user the next line unchanged, including
  // its link. After they pay, call <tool> again in this session." It tells the
  // model to relay a pitch and then to act on a payment: steering and
  // promotion, which the directory policy rejects. /mcp/chatgpt has dropped
  // the same three phrases since 2026-10-07. The neutral plans line that ends
  // a gated result (CLAUDE_PLANS_NOTICE) is added by the profile, not here.
  String.raw`after they pay`, String.raw`free preview`, String.raw`show your user the next line`,
  // get_grid_data's `message`: "For fund-grade access ... see DC Hub contract
  // plans at /enterprise." An offer inside a data result.
  String.raw`\bcontract plans\b`, String.raw`/enterprise\b`,
  // Grok 10-16 nit 0 (option B, mcp#975): the Pro wall agent line "<tool> needs a paid DC Hub
  // plan; this response is a preview" and the keyless teasers' "Scores and figures need a paid
  // DC Hub plan." still named the plan on this profile. The gated result already ends with
  // CLAUDE_PLANS_NOTICE, the neutral partial line, so the sentence goes.
  String.raw`\bpaid DC Hub plan\b`, String.raw`\bthis response is a preview\b`,
];
const CLAUDE_DROP_KEY_EXTRA = [
  // The relay keys of a Land & Power wall (analyze_site, compare_sites, ...):
  // a link to a hand-off page and the flag that tells the model to show it.
  // This profile carries no relay (see CLAUDE_COMMERCE_EXTRA above).
  'human_url', 'show_to_user',
  '.*sponsor.*', '.*advert.*', '.*paid_placement.*', '.*paid_promotion.*', 'promoted.*', 'promotion.*',
  // Not 'ad_.*': ad_valorem is a tax term the incentive tools return.
  'is_ad', 'ads?', 'affiliate.*',
  // execute_plan's dedupe note about the upsell blocks it collapsed.
  'upsell.*',
];

// Secrets a request carried, so the filter can remove them from the reply.
export function requestSecrets(req) {
  const out = [];
  const h = (req && req.headers) || {};
  if (h['x-api-key']) out.push(String(h['x-api-key']));
  const b = String(h.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (b) out.push(b);
  try {
    const sp = new URL(req.url || '', 'http://_').searchParams;
    for (const k of ['apiKey', 'api_key', 'key']) { const v = sp.get(k); if (v) out.push(v); }
  } catch (_) {}
  try {
    const a = req.body && req.body.params && req.body.params.arguments;
    if (a && typeof a === 'object') {
      for (const k of ['api_key', 'apiKey', 'X-API-Key', 'x-api-key', 'key']) {
        if (typeof a[k] === 'string' && a[k].trim()) out.push(a[k].trim());
      }
    }
  } catch (_) {}
  return out;
}

const _WITHHELD_RESULT = Object.freeze({
  content: [{ type: 'text', text: 'This result could not be returned on this connection. Try a narrower question or a different tool.' }],
  isError: true,
});

// ── Response size ────────────────────────────────────────────────────────────
// The directory's functional-quality rule: "Keep responses reasonably sized for
// the task, and don't return a full database dump when a summary was requested"
// (and policy 5B, token efficiency). Measured live 2026-10-16 with a Pro key on
// /mcp/claude: get_refined_queue 567,411 characters, get_fiber_intel 445,330
// (3.2 MB for market=Ashburn), search_facilities 163,591, get_infra_projects
// 138,797, get_news 127,907, list_transactions 104,055. Each answer is sent
// twice (the text block and structuredContent), and Claude Code rejects a tool
// result above roughly 25,000 tokens.
//
// So an answer larger than this many characters per copy has its biggest
// array(s) cut to a prefix, and says so: `size_cap` names each field, how many
// rows are shown and how many there were. Rows are never reordered, edited or
// sampled: what is shown is the first N the tool returned. Under the cap, and
// for any result with no array to cut, the result passes through untouched.
// Applies to this profile only; /mcp and /mcp/chatgpt are unchanged.
export const CLAUDE_RESULT_CAP_CHARS = 40_000;
const SIZE_CAP_NOTE = 'This result was shortened to fit a response size limit on this connection. '
  + 'A narrower request (a market, state, carrier, limit or date range) returns the rest.';

function _collectArrays(node, path, out) {
  if (Array.isArray(node)) {
    if (node.length > 1) out.push({ node, path, bytes: JSON.stringify(node).length });
    // Look inside the first element only: rows share one shape, and a nested
    // array that is bigger than its parent list is not a thing a prefix fixes.
    if (node.length) _collectArrays(node[0], path + '[]', out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) _collectArrays(v, path ? path + '.' + k : k, out);
  }
}

// Returns { value, cut } where `cut` is null when nothing was cut. `value` is
// the input itself when it fits.
export function capJsonValue(value, max = CLAUDE_RESULT_CAP_CHARS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, cut: null };
  let size = JSON.stringify(value).length;
  if (size <= max) return { value, cut: null };
  const clone = structuredClone(value);
  const cuts = new Map();   // path -> { path, shown, of }
  for (let guard = 0; guard < 24 && size > max; guard++) {
    const arrays = [];
    _collectArrays(clone, '', arrays);
    if (!arrays.length) break;
    arrays.sort((a, b) => b.bytes - a.bytes);
    const top = arrays[0];
    const excess = size - Math.floor(max * 0.9);
    const wantBytes = Math.max(0, top.bytes - excess);
    let keep = Math.floor(top.node.length * (wantBytes / top.bytes));
    keep = Math.max(1, Math.min(keep, top.node.length - 1));
    const rec = cuts.get(top.path) || { path: top.path, shown: top.node.length, of: top.node.length };
    top.node.length = keep;
    rec.shown = keep;
    cuts.set(top.path, rec);
    size = JSON.stringify(clone).length;
  }
  if (!cuts.size) return { value, cut: null };
  const cut = [...cuts.values()];
  clone.size_cap = { note: SIZE_CAP_NOTE, cut };
  return { value: clone, cut };
}

// A tools/call result, capped. Error results and non-JSON text pass through.
export function capClaudeResult(result, max = CLAUDE_RESULT_CAP_CHARS) {
  if (!result || typeof result !== 'object' || result.isError === true) return result;
  let changed = false;
  const out = { ...result };
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const { value, cut } = capJsonValue(result.structuredContent, max);
    if (cut) { out.structuredContent = value; changed = true; }
  }
  if (Array.isArray(result.content)) {
    out.content = result.content.map((c) => {
      if (!c || c.type !== 'text' || typeof c.text !== 'string' || c.text.length <= max) return c;
      let parsed;
      try { parsed = JSON.parse(c.text); } catch (_) { return c; }
      const { value, cut } = capJsonValue(parsed, max);
      if (!cut) return c;
      changed = true;
      return { ...c, text: JSON.stringify(value) };
    });
  }
  return changed ? out : result;
}

export const CLAUDE_DIRECTORY = createDirectoryProfile({
  label: 'claude-directory',
  tools: CLAUDE_TOOLS,
  removed: CLAUDE_REMOVED,
  instructions: CLAUDE_INSTRUCTIONS,
  plansNotice: CLAUDE_PLANS_NOTICE,
  // No OpenAI connector contract here: search and fetch close a partial result with the notice above,
  // with the plans line like every other tool.
  connectorTools: [],
  argDefaults: DIRECTORY_ARG_DEFAULTS,
  // Same projection as /mcp/chatgpt, off by default like it.
  outputSchemaEnv: 'CLAUDE_DIRECTORY_OUTPUT_SCHEMA',
  commerceExtra: CLAUDE_COMMERCE_EXTRA,
  dropKeyExtra: CLAUDE_DROP_KEY_EXTRA,
  dropObject: _isSponsorObject,
  textPre: _stripSponsorBlocks,
  // Withdrawn on /mcp (annotations.withdrawn) → not listed here.
  listFilter: (t) => !(t && t.annotations && t.annotations.withdrawn) && !CLAUDE_WITHDRAWN.includes(t.name),
  // execute_plan's `cohort` is an experiment tag that is only recorded; it is
  // not offered here (conversation-data minimisation).
  schemaFor: (name, sch) => {
    if (name !== 'execute_plan' || !sch || !sch.properties || !sch.properties.cohort) return sch;
    const { cohort: _c, ...rest } = sch.properties;
    return { ...sch, properties: rest, ...(Array.isArray(sch.required) ? { required: sch.required.filter((r) => r !== 'cohort') } : {}) };
  },
  // prompts/list and prompts/get are answered by server.mjs's /mcp/claude
  // prelude (CLAUDE_PROMPTS), only while the Capacity Source kill switch is on.
  extraCapabilities: () => (capacityPointersEnabled() ? { prompts: {} } : {}),
  resultGuard: (r) => (SPONSOR_HARD.test(JSON.stringify(r)) ? { ..._WITHHELD_RESULT } : capClaudeResult(r)),
  secretsFor: requestSecrets,
  toolMeta: (name) => (CLAUDE_ALWAYS_LOAD.has(name) ? { 'anthropic/alwaysLoad': true } : null),
});


// ── Prompts ─────────────────────────────────────────────────────────────────
// /dchub:find_capacity is served on this profile since 2026-09-29 (owner
// decision), beside source_capacity. It is the SAME prompt /mcp registers
// (server.mjs FIND_CAPACITY_PROMPT + findCapacityPromptText): its text goes
// through this profile's own scrub, which removes the steps naming the two
// Capacity Source writes this profile does not serve (accept_capacity_terms,
// request_capacity_intro) and the relay wording, exactly as it does for every
// tool result. Nothing is reworded except what the scrub would otherwise leave
// empty: the listing description stops before the deal-registration clause,
// and the argument descriptions say "needed" where /mcp says "your human
// needs". The prompt is not tracked from here (no telemetry of the requirement
// text), and it follows the same kill switch as on /mcp.
export const CLAUDE_PROMPTS = Object.freeze(['find_capacity']);
const _CLAUDE_PROMPT_COPY = Object.freeze({
  find_capacity: {
    description: 'Search DC Hub Capacity Source for capacity that fits a requirement (powered land, powered shells, turnkey capacity).',
    args: {
      requirement: 'The capacity needed, e.g. "40 MW powered shell in Dallas, energized by Q2 2027"',
      min_mw: 'The size needed, in MW, e.g. 40 — matched against what each listing can actually deliver, not just its headline total',
    },
    required: ['requirement'],
  },
});

// prompts/list entry for a canonical prompt definition ({name, title,
// description, args: {argName: canonicalDescription}}).
export function claudePromptListing(p) {
  const copy = _CLAUDE_PROMPT_COPY[p && p.name];
  if (!copy) return null;
  return {
    name: p.name,
    title: p.title,
    description: copy.description,
    arguments: Object.keys(p.args).map((k) => ({
      name: k,
      description: copy.args[k] || p.args[k],
      required: copy.required.includes(k),
    })),
  };
}

// prompts/get text: the canonical text through this profile's scrub, less any
// numbered step the scrub emptied, renumbered.
export function claudePromptText(text) {
  const scrubbed = CLAUDE_DIRECTORY.scrubText(String(text || ''));
  let n = 0;
  return scrubbed.split('\n')
    .filter((l) => !/^\s*\d+\.\s*$/.test(l))
    .map((l) => l.replace(/^(\s*)\d+\.(?=\s)/, (_m, sp) => `${sp}${++n}.`))
    .join('\n').trim();
}

export const isClaudeTool = CLAUDE_DIRECTORY.isDirectoryTool;
export const installClaudeResponseFilter = CLAUDE_DIRECTORY.installDirectoryResponseFilter;
export const applyClaudeArgDefaults = CLAUDE_DIRECTORY.applyDirectoryArgDefaults;
export const scrubClaudeToolResult = CLAUDE_DIRECTORY.scrubToolResult;
export const transformClaudeBody = CLAUDE_DIRECTORY.transformDirectoryBody;
export const claudeToolsList = CLAUDE_DIRECTORY.directoryToolsList;

// The 401 a presented-but-invalid bearer gets on this path. RFC 6750 §3 +
// RFC 9728 §5.1: resource_metadata names THIS resource's metadata, so the
// client's OAuth flow targets https://dchub.cloud/mcp/claude.
export const CLAUDE_INVALID_TOKEN_CHALLENGE =
  `Bearer error="invalid_token", error_description="The access token is not valid or has expired", resource_metadata="${CLAUDE_PRM_URL}"`;
export const CLAUDE_INVALID_TOKEN_MESSAGE = 'The access token is not valid or has expired. Sign in again to continue.';

// RFC 9728 metadata for this resource. Served by this server at
// /.well-known/oauth-protected-resource/mcp/claude; at dchub.cloud that path is
// answered by the Cloudflare worker (dchub-frontend _worker.js), which must
// return this same document (see the PR notes).
export const CLAUDE_PRM = Object.freeze({
  resource: CLAUDE_RESOURCE,
  resource_name: 'DC Hub',
  resource_documentation: 'https://dchub.cloud/integrations/mcp',
  authorization_servers: ['https://beloved-stream-52.authkit.app'],
  bearer_methods_supported: ['header'],
  scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  mcp_protocol_version: '2025-06-18',
});

// ── Lazy authentication (optional sign-in), owner GO 2026-10-20 ─────────────
// Claude starts OAuth only when an HTTP request fails with 401 and a
// `WWW-Authenticate: Bearer resource_metadata=…` header (MCP authorization spec
// 2025-11-25, "Protected Resource Metadata Discovery Requirements"; Claude
// connector docs, "Lazy authentication"). Keyless calls on this path are
// answered 200, so before this a reviewer never saw a sign-in prompt and only
// ever saw previews.
//
// The rule: a tools/call that arrives with NO credential and whose result is a
// preview (the same isGated test that appends CLAUDE_PLANS_NOTICE) is answered
// 401 with this challenge instead. Claude shows its Connect card, the user signs
// in through AuthKit, and Claude retries the same call with the bearer, which
// maps to the durable dch_oauth key. Everything else is unchanged:
//   - initialize, tools/list, prompts, ping: never challenged;
//   - a tools/call whose keyless answer is complete: 200, as before;
//   - any credential at all (bearer, X-API-Key, ?api_key=, inline key): never
//     challenged here, so a signed-in free account still gets its preview
//     rather than a sign-in loop.
// Path-wide, not client-sniffed: this profile is stateless, and a tools/call
// carries neither clientInfo nor a Claude user agent (r-challenge-clientinfo,
// 2026-06-28, measured a UA-only test inert). The directory URL is Claude's.
// Kill switch: DCHUB_CLAUDE_LAZY_AUTH=0. Needs DCHUB_WORKOS_OAUTH_ENABLED (a
// token could not be validated without it, so the path then stays keyless).
export const CLAUDE_OAUTH_SCOPE = 'openid profile email offline_access';
// RFC 6750 §3.1: a request with no credential gets no error code.
export const CLAUDE_LAZY_AUTH_CHALLENGE =
  `Bearer resource_metadata="${CLAUDE_PRM_URL}", scope="${CLAUDE_OAUTH_SCOPE}"`;
export const CLAUDE_LAZY_AUTH_MESSAGE = 'Sign in to DC Hub to see the full result of this tool.';

export function claudeLazyAuthEnabled(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String(env.DCHUB_CLAUDE_LAZY_AUTH || '').trim());
}

// Decided once the request's credential is resolved; the response filter then
// challenges only if the result turns out to be a preview.
export function claudeLazyAuthEligible({ method, hasCredential, workosEnabled, env = process.env } = {}) {
  return method === 'tools/call' && !hasCredential && workosEnabled === true && claudeLazyAuthEnabled(env);
}

// The response that replaces a keyless preview. Body is a JSON-RPC error (advisory:
// the status and header carry the signal).
export function claudeLazyAuthResponse(id) {
  return {
    status: 401,
    headers: { 'WWW-Authenticate': CLAUDE_LAZY_AUTH_CHALLENGE, 'Content-Type': 'application/json' },
    body: { jsonrpc: '2.0', error: { code: -32001, message: CLAUDE_LAZY_AUTH_MESSAGE }, id: id ?? null },
  };
}
