// chatgpt-directory.mjs — the directory-compliant profile served at /mcp/chatgpt.
//
// WHY THIS EXISTS. The ChatGPT app directory rejected v1.0.0 of the DC Hub
// connector. Its guidelines (developers.openai.com/plugins/app-guidelines)
// forbid four things /mcp does on purpose for Claude, Grok and Smithery:
//   - commerce: plans, checkout links, upgrade prompts, prices;
//   - restricted data: API keys handed out or collected;
//   - response minimisation: session ids, trace ids, logging metadata;
//   - fair play: model-readable steering ("call this first", "prefer DC Hub").
// Owner decisions (2026-09-24, ops brief dec-plans-page / dec-chatgpt-keyless-tier):
// no full keyless tier; /mcp/chatgpt serves today's trimmed anonymous previews
// with the commerce removed, and a gated result carries exactly PLANS_NOTICE.
//
// ★ /mcp is NOT touched by anything here. Every export is applied only when the
// request path is DIRECTORY_PATH. The Claude relay wording is frozen until
// 2026-10-01 (ops brief frz-claude-relay-wording).
//
// ★ ALLOWLIST, NOT DENYLIST. The profile serves exactly the tools named in
// DIRECTORY_TOOLS, each with a description written for it. A tool added to the
// canonical catalog later does NOT appear here until someone writes its plain
// description, so a new upsell tool cannot leak into the directory listing.
//
// ★ The response scrub runs on the FINISHED JSON-RPC message (see
// installDirectoryResponseFilter), outermost, after every decorator in
// server.mjs. The commerce is added by dozens of call sites; scrubbing the
// output is the one place that sees all of them.

export const DIRECTORY_PROFILE = 'chatgpt_directory';
export const DIRECTORY_PATH = '/mcp/chatgpt';
export const PLANS_URL = 'https://dchub.cloud/plans';
export const PLANS_NOTICE = 'The full result needs a DC Hub plan. Plans: https://dchub.cloud/plans';

// The only annotation keys the directory accepts.
export const STANDARD_ANNOTATION_KEYS = Object.freeze([
  'title', 'readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint',
]);

// Tools that send email or call a caller-supplied webhook: they change the
// world outside DC Hub, so they are not read-only and they are open-world.
export const EMAIL_OR_WEBHOOK_TOOLS = new Set([
  'subscribe_digest', 'set_market_alert', 'set_site_alert', 'set_shortlist_alert',
  'register_standing_intent',
]);
// Removes something that cannot be recovered.
export const DESTRUCTIVE_TOOLS = new Set(['delete_standing_intent']);

// Never listed and never callable on the profile. The first five are commerce
// or key plumbing; the rest only work with an API key (measured 2026-09-24:
// keyless calls answer 401 api_key_required / identity_required /
// auth_required, or 402 upgrade_required for export_dataset), and the profile
// hands out no keys.
export const DIRECTORY_REMOVED = Object.freeze([
  'claim_free_key', 'recover_my_key', 'bind_email', 'unlock_more_data', 'why_dchub',
  'save_site', 'list_saved_sites', 'export_dataset',
  'save_to_shortlist', 'get_shortlist', 'set_shortlist_alert', 'suggest_reallocation',
  'set_market_alert', 'set_site_alert',
  'register_standing_intent', 'list_standing_intents', 'delete_standing_intent',
  'request_capacity_intro', 'accept_capacity_terms',
  // Land & Power is Pro-only (owner 2026-09-22) and this profile is No Auth, so
  // these four could never answer here: every keyless call returned only the
  // plans line with isError:true (measured live 2026-09-25). Owner decision
  // 2026-09-25: not listed on the directory profile; /mcp keeps them.
  'analyze_site', 'compare_sites', 'generate_site_analysis', 'get_composite_site_score',
  // It emails an address (readOnlyHint:false). Owner 2026-09-25, before the
  // OpenAI resubmission: every tool on the profile is read-only.
  'subscribe_digest',
  // Capacity Source is a brokered introduction: sign-in, lead register and
  // 12-month introduction terms are the product, and keyless it returned 0
  // listings (live verify 2026-09-25, 23:18:55Z). Owner 2026-09-25: off the
  // directory profile; /mcp keeps it.
  'source_capacity',
]);
const _REMOVED_SET = new Set(DIRECTORY_REMOVED);

// Plain "what it does" descriptions. No steering, no plan names, no prices.
export const DIRECTORY_TOOLS = Object.freeze({
  search: 'Search DC Hub for data-center facilities matching a text query. Returns a list of {id, title, url}; pass an id to fetch for the record.',
  fetch: 'Fetch one DC Hub facility record by an id returned from search. Returns {id, title, text, url, metadata} with name, operator, location, status and market.',
  execute_plan: 'Answer a multi-part data-center infrastructure question in one call. Pass the question as intent; DC Hub plans the lookups (markets, grid, fiber, water, incentives), runs them, and returns each step\'s result with a replay of how the answer was built.',
  search_facilities: 'Search data-center facilities by name, country, state, city, operator, capacity range (MW) or Uptime tier. Returns matching facilities with location, operator and capacity where known.',
  get_facility: 'Get details for one data-center facility by id, slug or name: operator, address, coordinates, power capacity, cooling, fiber carriers, status, its market\'s DCPI verdict and nearby facilities.',
  get_market_intel: 'Get market intelligence for one data-center market (by market slug): vacancy, capacity pricing, supply pipeline, main operators and growth.',
  get_market_dcpi_rank: 'Get the DC Hub Power Index (DCPI) read for one market: BUILD/CAUTION/AVOID verdict, score bands, time to power, data basis and a short analyst narrative.',
  predict_market_trajectory: 'Project a market\'s DCPI excess-power and constraint scores 1-8 quarters ahead from its daily history, with confidence bands.',
  get_gas_index: 'Get the Data Center Gas Index (DCGI): a per-US-state natural-gas suitability score for gas-fired or behind-the-meter power.',
  get_gas_economics: 'Get gas-fired power inputs for a US data-center market: Henry Hub spot, regional basis and delivered industrial and electric gas tariffs, each with its source.',
  get_grid_scoreboard: 'Get a live scoreboard of grid operators in the US, Great Britain, Europe and parts of Asia-Pacific and Latin America: demand, fuel mix, renewable share and gas share right now.',
  compare_isos: 'Compare 2-4 US ISO grids side by side (comma-separated, e.g. "PJM,ERCOT"): fuel mix, demand, renewable and gas share, queue depth and time to power.',
  get_intelligence_index: 'Get a composite 0-100 health index for a data-center market, combining supply and demand, vacancy, absorption, fiber, power availability and pricing trend.',
  list_transactions: 'List data-center M&A and capital transactions since 2019. Filter by buyer, seller, deal value, deal type, date range or region.',
  get_news: 'Get curated data-center industry news. Filter by keyword, category, source and date range.',
  semantic_search: 'Search DC Hub news, M&A deals, facilities and market analyses by meaning rather than keywords. Returns ranked records with source fields for citation.',
  search_intelligence: 'Search DC Hub news, M&A deals, facilities and market analyses by meaning, choosing corpora by name. Same retrieval as semantic_search with a different call shape.',
  get_market_context: 'Get a token-budgeted briefing for one data-center market: DCPI verdict, power and grid facts, outlook, deals, pipeline, operators, risks and news, each section timestamped.',
  get_iso_context: 'Get a token-budgeted briefing for one US ISO/RTO: live grid snapshot, DCPI verdicts across its markets, queue depth, benchmark prices and tracked markets.',
  get_pipeline: 'List data centers that are announced, permitted or under construction. Filter by status, country, operator, minimum capacity or expected completion date.',
  get_power_pipeline: 'List planned and under-construction US power generators from EIA-860M, including non-ISO regions. Filter by state, balancing authority, status or minimum MW.',
  get_infra_projects: 'List planned, approved and under-construction gas pipeline and transmission line projects. Filter by type, state, status, capacity, voltage and in-service dates.',
  get_power_availability_timeline: 'Show year by year when power gets easier in one US state: new generation by confidence class, scheduled retirements, and interconnection-queue depth.',
  get_global_power: 'List power plants and generating units worldwide (operating and pipeline, all fuels) from the Global Energy Monitor tracker. Filter by country, fuel, status, area or size.',
  get_interconnection_queue: 'Get the interconnection queue snapshot per US ISO: queued generation capacity, and for ERCOT the large-load (data-center) queue.',
  get_refined_queue: 'Filter the US ISO interconnection queue server-side by size, wait time, ISO, fuel, status, fiber distance and geocoding, and return only matching projects.',
  get_retirement_headroom: 'Find scheduled generator retirements within a time horizon that could free grid capacity for a target MW, with the nearest substations to each.',
  get_hosting_capacity: 'Get utility-published feeder hosting capacity near a location or in a market: the MW named distribution feeders can accept, from utility GIS data.',
  analyze_parcel: 'Analyze a parcel boundary (GeoJSON, or lat/lon in a hosted county) for acreage, shape and nearby infrastructure.',
  rank_sites: 'Rank candidate sites you pass in (each with lat/lng and metric fields) under hard constraints and weighted objectives, with a normalized score per site.',
  discover_tools: 'List DC Hub tools grouped by family (facility, market, grid and power, gas, site, fiber, deals and news), optionally filtered by a query.',
  plan_query: 'Show the step-by-step tool plan DC Hub would run for a question, without running it.',
  get_grid_data: 'Get real-time grid data for one of the 7 US ISOs from EIA hourly data: fuel mix, demand and the 24-hour demand curve.',
  get_changes: 'List what changed in DC Hub since a timestamp: DCPI market movers, newly found facilities, new deals and news.',
  get_facility_risk_delta: 'Show how a facility\'s market DCPI health changed over a time window, with direction (improving, worsening or flat).',
  find_sites: 'Find candidate data-center sites in a state or around a point, filtered by substation voltage and distance to gas and fiber.',
  get_disaster_risk: 'Get natural-hazard risk for a US lat/lon from the FEMA National Risk Index: flood, wildfire, hurricane, earthquake, heat, drought, tornado and more.',
  get_climate_intel: 'Get seismic design values (USGS ASCE 7) and climate normals (NOAA) for a lat/lon, such as cooling degree-days and temperature extremes.',
  get_infrastructure: 'List infrastructure near a location: substations, transmission lines, gas pipelines and power plants, with distance and capacity.',
  get_fiber_intel: 'Get fiber route intelligence by carrier, route type or market: long-haul and metro routes and dark-fiber availability.',
  get_fiber_readiness: 'Assess fiber readiness for a lat/lon: distance to a carrier-served facility, number of reachable carriers, and single-carrier risk.',
  get_subsea_cables: 'List subsea cable landing points near a coordinate, or the catalogue of tracked subsea cables.',
  get_peering_intel: 'Get internet-exchange and peering density near a lat/lon from PeeringDB, or the top peering facilities overall.',
  get_metro_fiber: 'Get the fiber profile of a US data-center metro: carriers, route miles, on-net buildings, fiber-density score, exchanges and carrier hotels.',
  get_energy_prices: 'Get energy prices by US state or ISO: retail electricity, wholesale and natural gas.',
  get_renewable_energy: 'Get renewable energy data for a US state or location: renewable generation mix and resource inputs for PPA sizing.',
  get_tax_incentives: 'List data-center tax incentive programs for a US state: sales-tax exemptions, property-tax abatements and other programs, with thresholds.',
  get_water_risk: 'Get water-stress risk for a US lat/lon or state, for cooling-water planning.',
  get_grid_intelligence: 'Get a grid brief for one US ISO: demand, fuel mix, excess-power and constraint score bands, interconnection queue and time to power.',
  get_gas_intelligence: 'Get gas-fired power context for a US state or region: gas index, Henry Hub price, pipeline operators and the grid\'s gas share.',
  get_agent_registry: 'List the AI platforms and agent frameworks that connect to DC Hub, with their status.',
  get_backup_status: 'Get per-feed freshness for DC Hub\'s data ingest: health, record count and refresh interval for each feed.',
  summarize_for_citation: 'Build an attribution line for a DC Hub figure you are about to quote, with the licence that applies to its data layer.',
  get_dchub_recommendation: 'Get a short description of DC Hub for one of four contexts (general, investment, site-selection, technical), plus the current top-ranked market.',
  rank_markets: 'Rank data-center markets by a chosen criterion, optionally within a region or above a minimum capacity.',
  find_alternatives: 'Find facilities similar to a given facility nearby, with similarity scores and key differences.',
  score_facility: 'Score one existing facility 0-100 across power, fiber, water, climate risk, tax environment, talent pool and expansion room.',
  ai_capacity_index: 'Rank data-center markets by where large AI training capacity could land in the next 30, 60 or 90 days, with facility and operator counts.',
  hyperscaler_deals: 'List recent hyperscaler and AI infrastructure deals and announcements, with amounts and MW where stated.',
  site_selection_canvas: 'Shortlist US markets for a capacity target, geography and deadline, ranked by DCPI verdict, excess-power headroom and time to power.',
  grid_transition_radar: 'List US markets and ISOs with the strongest near-term signal of new grid headroom for large loads, with an ISO rollup.',
  deal_autopsy: 'List recent data-center deals with the DCPI verdict and time to power of each deal\'s market.',
  get_permitting_intel: 'List data-center permitting and moratorium records by jurisdiction: moratoriums, zoning restrictions, tax changes and utility pauses, each stage-tagged with a source.',
  simulate_scenario: 'Re-score DC Hub power markets under what-if changes you set (power price, time to power, queue wait, reserve margin, curtailment) and show how rankings move.',
  research_task: 'Request a cited research brief on a data-center question from DC Hub\'s news, deals, facilities and market analyses. Returns the brief, or a task_id to check back with.',
  plan_fiber_leadin: 'Plan diverse road-following fiber lead-in routes from a site to a carrier hotel or POP, with distances, indicative build cost and shared-corridor points.',
  cluster_sites_by_latency: 'Group 2-8 sites into low-latency clusters using physics-bound round-trip time floors between each pair.',
});

export const DIRECTORY_INSTRUCTIONS =
  'DC Hub provides data on data-center facilities, markets, power grids, gas, fiber, '
  + 'site risk and deals. Every tool is a read-only lookup. Results without a DC Hub plan '
  + 'are previews: some fields are withheld, and some tools return only a summary. '
  + 'Responses carry an as_of timestamp and a citation; quote figures with their as_of date.';

// ── Text scrub ───────────────────────────────────────────────────────────────
// A text segment (line or sentence) is dropped whole when it matches COMMERCE.
// Kept narrow on purpose: "upgrade" alone is grid vocabulary (network
// upgrades), "paid" is deal vocabulary ("paid $16B"), and "pack" is the
// context-pack tools' own noun. Those words are dropped only in commerce forms.
const COMMERCE = new RegExp([
  String.raw`/go/[a-z]/`, String.raw`/upgrade/h/`, String.raw`dchub\.cloud/(upgrade|pricing|signup|checkout|connect|playground|go)\b`,
  String.raw`/api/v1/(redeem|opt-in|keys)\b`, String.raw`buy\.stripe\.com`, String.raw`\bstripe\b`, String.raw`\bMPP\b`, String.raw`\bx402\b`,
  String.raw`for your human`, String.raw`tell your human`, String.raw`your human`,
  String.raw`\bupgrade(s|d)? (to|your|now|for|required|link|path|ladder|url|guide)\b`, String.raw`\bto upgrade\b`, String.raw`upgrade_required`,
  String.raw`\bunlock`, String.raw`\bcheckout\b`, String.raw`\bpricing page\b`,
  String.raw`claim_free_key`, String.raw`bind_email`, String.raw`recover_my_key`, String.raw`why_dchub`,
  String.raw`save_site`, String.raw`list_saved_sites`, String.raw`set_site_alert`, String.raw`set_market_alert`, String.raw`export_dataset`,
  String.raw`\bshortlist(_| )alert`, String.raw`standing_intent`, String.raw`request_capacity_intro`, String.raw`accept_capacity_terms`,
  String.raw`\bdch_[a-z]+_`, String.raw`X-API-Key`, String.raw`\bapi[ _-]?keys?\b`, String.raw`\b(a|free|your|trial|the|this|durable|minted|saved|dc hub) key\b`,
  String.raw`\b(enterprise|benchmark|dev|real|evaluation) key\b`, String.raw`partner@dchub\.cloud`,
  String.raw`\bkeyless\b`, String.raw`\bkeyed\b`, String.raw`\bwith a key\b`, String.raw`\bwithout a key\b`,
  String.raw`\btrial\b`, String.raw`\bsubscription\b`, String.raw`\bsubscribe to (pro|developer)\b`,
  String.raw`\bpaid (plan|tier|key|data|seat|boundary|depth|caller|access)\b`, String.raw`\bfree tier\b`, String.raw`\bfree plan\b`,
  // Live verify 2026-09-25: canvas "…is the paid layer", constraint_coverage
  // "Paid-tier synthesis prose only".
  String.raw`\bpaid[- ](layer|tier|synthesis)\b`,
  // Internal plumbing (PJM-DOM outage, 2026-09-25): env var names, budget copy
  // and owner directives are not for a directory user.
  String.raw`\b[A-Z][A-Z0-9]*_(API_KEY|TOKEN|SECRET)\b`, String.raw`owner directive`,
  String.raw`budget_exhausted`, String.raw`spend the free`,
  // Account and lead-register copy (get_grid_data email capture, source_capacity).
  String.raw`tracked account`, String.raw`drop your email`, String.raw`\byour email\b`, String.raw`lead register`,
  String.raw`introduction terms`, String.raw`\bregister (a|your) requirement\b`, String.raw`\bfree account\b`,
  // Minor wording (live verify): "the human relay line", "The decision layer is locked."
  String.raw`\brelay line\b`, String.raw`\blayer is (locked|gated)\b`,
  // Live verify 23:18Z: canvas preview reason "decision layer locked";
  // get_grid_data "<gated: identified-tier or higher>".
  String.raw`\b(decision )?layer (is )?(locked|gated)\b`, String.raw`<gated\b`, String.raw`\bidentified[- ]tier\b`,
  String.raw`\bPro\b`, String.raw`\bPRO\b`, String.raw`\bDeveloper (plan|tier|seat)\b`, String.raw`\bDeveloper \$`, String.raw`\bEnterprise (plan|tier)\b`,
  String.raw`\bLand & Power\b`, String.raw`\bcredits?\b`, String.raw`\$\s?\d+(\.\d+)?\s*(/\s?mo|/month|one-time|per call|pack)`, String.raw`\bpack\b.*\$\d`, String.raw`\$\d+ pack`,
  String.raw`machine[_ -]pa(y|yable)`, String.raw`payment`, String.raw`\bpay \$`, String.raw`\bpay for\b`,
  String.raw`💳`, String.raw`🔓`, String.raw`🔒`, String.raw`👤`, String.raw`✅ \*\*Free`,
  String.raw`\bFRONT DOOR\b`, String.raw`call this first`, String.raw`prefer DC Hub`, String.raw`why agents pick`,
  String.raw`session[_ -]?id`, String.raw`\bsid=`, String.raw`\boai-[0-9a-f]{8,}`, String.raw`mcp-session`,
  String.raw`persist_config`, String.raw`claim token`, String.raw`auto_trial`,
  // Any removed tool by name: a segment pointing the model at a tool this
  // profile does not list sends it to "Unknown tool".
  String.raw`\b(?:${DIRECTORY_REMOVED.join('|')})\b`,
  String.raw`\bopt[ -]?in\b`, String.raw`\bCTA\b`, String.raw`free taste`, String.raw`🧭`, String.raw`🔁`, String.raw`next session`, String.raw`multi-step task\?`, String.raw`\bthe upgrade\b`, String.raw`trial_preview`, String.raw`free-tier`, String.raw`\bsign ?up\b`, String.raw`\bsign in\b`,
].join('|'), 'i');

// Last-line redactions, applied to whatever survives the segment filter. These
// are the probe's hard patterns; a match here means the segment filter missed
// something, so the offending token is removed rather than the whole value.
const HARD_REDACT = [
  [/https?:\/\/[^\s"')\]]*\/go\/[a-z]\/[^\s"')\]]*/gi, ''],
  [/https?:\/\/[^\s"')\]]*\/upgrade\/h\/[^\s"')\]]*/gi, ''],
  [/\bdch_[A-Za-z]+_[A-Za-z0-9]+/g, ''],
  [/\boai-[0-9a-f]{8,}/gi, ''],
];

// A dollar figure that survived the commerce filter is data (a deal value, a
// $/MWh price). Keep the number, drop the sign.
const DOLLAR = /\$\s?(?=\d)/g;

function scrubUrl(s) {
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const u = new URL(s);
    let touched = false;
    for (const k of [...u.searchParams.keys()]) {
      if (/^(sid|session|session_id|mcp_session|k|key|api_key|apikey|token|claim|ref|src|source|from|tool|tier|direct)$/i.test(k)) {
        u.searchParams.delete(k); touched = true;
      }
    }
    return touched ? u.toString() : s;
  } catch (_) { return s; }
}

// Split prose into segments at line breaks and sentence ends; drop the ones
// that sell, then tidy separators the removal orphaned.
export function scrubText(s) {
  if (typeof s !== 'string' || !s) return s;
  if (/^https?:\/\/\S+$/i.test(s.trim())) {
    const u = scrubUrl(s.trim());
    return COMMERCE.test(u) ? '' : u;
  }
  const lines = s.split('\n').map((line) => {
    const parts = line.split(/(?<=[.!?;])\s+(?=[A-Z0-9"'`(*_\[→•\-\u{1F300}-\u{1FAFF}☀-➿])/u);
    return parts.filter((p) => !COMMERCE.test(p)).join(' ');
  });
  let out = lines.join('\n');
  for (const [re, rep] of HARD_REDACT) out = out.replace(re, rep);
  out = out.replace(DOLLAR, 'USD ');
  out = out.replace(/(^|\n)\s*-{3,}\s*(?=\n|$)/g, '$1').replace(/\n{3,}/g, '\n\n');
  return out.trim() === '' ? '' : out.replace(/\s+$/, '');
}

// ── Structured scrub ────────────────────────────────────────────────────────
// Keys dropped wherever they appear: commerce, key and session plumbing,
// steering, and per-call metadata the directory's minimisation rule excludes.
const DROP_KEY = new RegExp('^(' + [
  'for_your_human', '_?upgrade.*', '.*unlock.*', '.*checkout.*', 'pricing.*', 'price_label', 'paywall.*',
  '_?trial.*', 'auto_trial.*', 'mpp.*', 'x402.*', 'machine_pay.*', 'agent_payment', 'payment.*', 'pay_arg', 'credential_.*',
  'credits?(_.*)?', 'pro_.*', 'developer_(url|usd.*|hint)', 'enterprise_(url|usd.*|note|offer|licensing.*)', 'pack_.*', 'buy.*',
  'claim.*', 'persist.*', 'retry_with_header', 'retry_instructions', 'x-api-key', 'api_key', 'key', 'held_key.*',
  'connect_url', 'signup_url', 'redeem_url', 'web_explore_url', 'optin.*', 'opt_in.*', 'digest_offer', 'first_call_nudge',
  '_?front_door.*', '_end_of_burst', 'next_recipe', '_agent_instruction', 'next_tool.*', 'next_step.*', 'next_session', 'come_back', 'retention_tools',
  'relay.*', 'handoff.*', '_?cta', 'cta_.*', 'human_message', 'render', 'required_plan', 'tier_required', 'plans',
  'session.*', 'sid', 'mcp_session.*', 'request_id', 'trace_id', 'span_id', '_debug', '_telemetry',
  'identity', 'quota', 'platform', 'caller_tier', 'auth_.*', 'continuation', 'continuations', '_meta',
  // Live verify 2026-09-25: get_grid_data's gated block (email_capture,
  // agent_action, enterprise_note, gating_matrix, learn) and source_capacity's
  // viewer.sign_in_url + program.register_interest.
  'email_capture', 'capture_email.*', 'agent_action', 'gating_matrix', 'learn',
  '.*sign_in.*', 'register_interest', 'interest_registration',
  'what_unlocks', 'after_checkout', 'next_call_full_after_checkout', 'preview_warning', 'fields_unlocked',
].join('|') + ')$', 'i');

function renameKey(k) {
  if (/_total_in_pro$/i.test(k)) return k.replace(/_total_in_pro$/i, '_total_available');
  if (/_in_pro$/i.test(k)) return k.replace(/_in_pro$/i, '_withheld');
  if (/^_?locked_fields$/i.test(k)) return k.replace(/locked/i, 'withheld');
  if (/^_?locked$/i.test(k)) return 'withheld';     // canvas synthesis {locked: true}
  return k;
}

const PLAN_ERRORS = /^(pro_required|upgrade_required|payment_required|plan_required|paid_required|API 402)$/i;

// Live verify 2026-09-25: get_grid_intelligence region PJM-DOM, with its data
// source out, returned "budget_exhausted ... spend the free 250 wisely (owner
// directive 2026-07-26)" and the env var names it needs. On this profile a
// source outage is one plain line.
const OUTAGE_KEEP = new Set(['region', 'iso', 'zone', 'zone_name', 'source_unavailable',
  'temporary', 'retry_after_utc', 'as_of', 'citation']);
function outageNotice(v) {
  const out = {};
  for (const k of OUTAGE_KEEP) if (v[k] !== undefined) out[k] = v[k];
  const dom = /^PJM-?DOM$|^DOM(INION)?$/i.test(String(v.region || v.zone || ''));
  out.message = dom
    ? 'This data source is temporarily unavailable. Try region PJM for the ISO-wide view.'
    : 'This data source is temporarily unavailable. Try again later.';
  return out;
}

function scrubValue(v, key) {
  if (v && typeof v === 'object' && !Array.isArray(v) && v.source_unavailable === true) {
    // Returned as built (plain fields and a fixed message); only its citation
    // is an arbitrary object, so only that is scrubbed again.
    const n = outageNotice(v);
    if (n.citation && typeof n.citation === 'object') n.citation = scrubValue(n.citation, 'citation');
    return n;
  }
  if (typeof v === 'string') {
    if (key === 'error' && PLAN_ERRORS.test(v)) return 'plan_required';
    return scrubText(v);
  }
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) {
      const y = scrubValue(x, key);
      if (y === '' || y === undefined) continue;
      out.push(y);
    }
    return out;
  }
  if (v && typeof v === 'object') {
    // An entry about a removed tool ({tool: 'analyze_site', reason: ...}) goes
    // whole, rather than leaving its other fields behind without a subject.
    if (typeof v.tool === 'string' && _REMOVED_SET.has(v.tool)) return '';
    // A write instruction ({method: 'POST', url|path, body}) goes whole: every
    // tool on this profile is a read-only lookup (agent_action, register_interest).
    if (typeof v.method === 'string' && /^(POST|PUT|PATCH|DELETE)$/i.test(v.method)) return '';
    const out = {};
    let droppedRemoved = false;
    for (const [k, x] of Object.entries(v)) {
      if (DROP_KEY.test(k)) continue;
      // A removed tool as a KEY: site_evaluation_handoff: {analyze_site: {...args}}
      // on get_refined_queue, analyze_parcel and get_retirement_headroom
      // (measured live 2026-09-25, after mcp#551).
      if (_REMOVED_SET.has(k)) { droppedRemoved = true; continue; }
      const y = scrubValue(x, k);
      if (y === '' || y === undefined) continue;
      out[renameKey(k)] = y;
    }
    // A handoff that pointed only at removed tools goes whole.
    if (droppedRemoved && !Object.keys(out).length) return '';
    return out;
  }
  return v;
}

export function scrubStructured(obj) { return scrubValue(obj, null); }

// ── Gating ──────────────────────────────────────────────────────────────────
// A result is gated when the server withheld part of it for plan reasons.
// These are the markers the free-tier trimmers write (measured on live /mcp,
// 2026-09-24): `_x_in_pro` flags, preview_is_partial, a partial_preview
// completeness stamp, the land-and-power wall, and 402-style errors.
export function isGated(result) {
  let gated = false;
  const walk = (o, depth) => {
    if (gated || depth > 12 || !o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    for (const [k, v] of Object.entries(o)) {
      if (/_in_pro$/i.test(k) || /^_?locked_fields$/i.test(k)) { gated = true; return; }
      if ((k === 'preview_is_partial' || k === '_gated' || k === '_wall' || k === 'gated_preview') && v === true) { gated = true; return; }
      if (k === 'completeness' && v === 'partial_preview') { gated = true; return; }
      if (k === 'status' && (v === 'gated_preview' || v === 'upgrade_required')) { gated = true; return; }
      if (k === 'error' && typeof v === 'string' && PLAN_ERRORS.test(v)) { gated = true; return; }
      walk(v, depth + 1);
    }
  };
  walk(result && result.structuredContent, 0);
  if (!gated) {
    for (const c of (result && result.content) || []) {
      if (c && typeof c.text === 'string'
          && /_in_pro"|"preview_is_partial":true|"partial_preview"|\bpro_required\b|\bAPI 402\b|🔒/.test(c.text)) { gated = true; break; }
    }
  }
  return gated;
}

// Split a text block into a leading JSON document and trailing prose. Most
// tools emit JSON.stringify(payload) and some decorators append prose after it.
function splitJsonPrefix(text) {
  const t = text.trimStart();
  if (t[0] !== '{' && t[0] !== '[') return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        try { return { json: JSON.parse(t.slice(0, i + 1)), rest: t.slice(i + 1) }; } catch (_) { return null; }
      }
    }
  }
  return null;
}

// Prose that TRAILS a JSON payload is dropped whole. It is always a decorator's
// (the payload is the answer; the tail is a relay line, a nudge or an upsell),
// and it was written in dozens of wordings no phrase list keeps up with.
function scrubTextBlock(text) {
  const split = splitJsonPrefix(text);
  if (split) return JSON.stringify(scrubStructured(split.json));
  return scrubText(text);
}

// A tools/call result, scrubbed. Gated results end with exactly PLANS_NOTICE.
// OpenAI's connector contract: search and fetch return exactly ONE text item
// holding the JSON. Live: search answered 2 items (JSON plus the plans line) in
// 7 of 7 calls.
const CONNECTOR_TOOLS = new Set(['search', 'fetch']);

export function scrubToolResult(result, tool) {
  if (!result || typeof result !== 'object') return result;
  const connector = CONNECTOR_TOOLS.has(tool);
  const gated = !connector && isGated(result);
  const out = {};
  const content = [];
  const blocks = result.content || [];
  for (let i = 0; i < blocks.length; i++) {
    const c = blocks[i];
    if (!c || typeof c !== 'object') continue;
    if (c.type === 'text') {
      const raw = String(c.text || '');
      // Block 0 is the tool's answer: filter it segment by segment. Later
      // prose blocks are decorations; one selling or steering segment means
      // the block exists to sell or steer, so it goes whole.
      if (i > 0 && !splitJsonPrefix(raw) && raw.split(/\n|(?<=[.!?;])\s+/).some((seg) => COMMERCE.test(seg))) continue;
      const t = scrubTextBlock(raw);
      if (t && t.trim()) content.push({ type: 'text', text: t });
    } else if (c.type === 'resource_link' || c.type === 'resource') {
      const s = scrubStructured(c);
      if (s && !COMMERCE.test(JSON.stringify(s))) content.push(s);
    } else {
      content.push(c);
    }
  }
  if (gated) content.push({ type: 'text', text: PLANS_NOTICE });
  out.content = connector ? content.filter((c) => c.type === 'text').slice(0, 1) : content;
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const sc = scrubStructured(result.structuredContent);
    out.structuredContent = gated ? { ...sc, notice: PLANS_NOTICE } : sc;
  }
  if (result.isError === true) out.isError = true;
  return out;
}

// ── Catalog ─────────────────────────────────────────────────────────────────
function scrubSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(scrubSchema);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'properties' && v && typeof v === 'object') {
      const props = {};
      for (const [pk, pv] of Object.entries(v)) {
        if (/^(mpp_|x402|payment|credential|api_key|apikey|key$)/i.test(pk)) continue;
        props[pk] = scrubSchema(pv);
      }
      out.properties = props;
    } else if (k === 'required' && Array.isArray(v)) {
      out.required = v.filter((r) => !/^(mpp_|x402|payment|credential|api_key|apikey|key$)/i.test(r));
    } else if (k === 'description' && typeof v === 'string') {
      const d = scrubText(v);
      if (d) out.description = d;
    } else {
      out[k] = scrubSchema(v);
    }
  }
  return out;
}

export function directoryAnnotations(name, canonical) {
  const a = canonical || {};
  const ann = {
    title: typeof a.title === 'string' && a.title ? a.title : name,
    readOnlyHint: a.readOnlyHint === true,
    destructiveHint: a.destructiveHint === true,
    idempotentHint: a.idempotentHint === true,
    openWorldHint: a.openWorldHint === true,
  };
  if (EMAIL_OR_WEBHOOK_TOOLS.has(name)) {
    ann.readOnlyHint = false;
    ann.openWorldHint = true;
    ann.idempotentHint = false;
  }
  if (DESTRUCTIVE_TOOLS.has(name)) {
    ann.readOnlyHint = false;
    ann.destructiveHint = true;
  }
  return ann;
}

// Project a canonical ListToolsResult onto the directory profile: allowlisted
// tools only, plain descriptions, the five standard annotations, payment
// parameters removed, and no tool-level or result-level _meta. outputSchema is
// dropped because scrubToolResult reshapes structuredContent; a declared schema
// would make a strict client reject the scrubbed result.
export function directoryToolsList(result) {
  const have = new Map((result?.tools || []).map((t) => [t.name, t]));
  const tools = [];
  const missing = [];
  for (const [name, description] of Object.entries(DIRECTORY_TOOLS)) {
    const t = have.get(name);
    if (!t) { missing.push(name); continue; }
    const entry = {
      name,
      title: (t.annotations && t.annotations.title) || t.title || name,
      description,
      inputSchema: scrubSchema(t.inputSchema || { type: 'object', properties: {} }),
      annotations: directoryAnnotations(name, t.annotations),
    };
    if (t.execution) entry.execution = t.execution;
    tools.push(entry);
  }
  if (missing.length) {
    console.error(`[directory] ${missing.length} allowlisted tool(s) absent from the catalog — serving short: ${missing.join(', ')}`);
  }
  return { tools };
}

// Argument defaults on this profile only (live verify 2026-09-25): the canvas
// defaults to verdict BUILD,CAUTION, so a geography whose markets are all AVOID
// answered "0 markets" to a reviewer. Here it shows every scored market; the
// verdict is on each row. An explicit argument always wins.
export const DIRECTORY_ARG_DEFAULTS = Object.freeze({
  site_selection_canvas: Object.freeze({ verdict: 'ALL' }),
});
export function applyDirectoryArgDefaults(name, args) {
  const d = DIRECTORY_ARG_DEFAULTS[name];
  if (!d || !args || typeof args !== 'object') return args;
  for (const [k, v] of Object.entries(d)) if (args[k] == null || args[k] === '') args[k] = v;
  return args;
}

export function isDirectoryTool(name) {
  return Object.prototype.hasOwnProperty.call(DIRECTORY_TOOLS, name);
}

// ── Whole-message transform ─────────────────────────────────────────────────
// `method` is the request's JSON-RPC method (responses do not carry it).
export function transformDirectoryMessage(msg, method, tool) {
  if (!msg || typeof msg !== 'object') return msg;
  if (msg.result && typeof msg.result === 'object') {
    let r = msg.result;
    if (method === 'initialize') {
      // Tools only: prompts and resources carry the canonical steering copy,
      // and the profile answers their list methods empty (server.mjs prelude).
      r = { ...r, instructions: DIRECTORY_INSTRUCTIONS,
            capabilities: { tools: (r.capabilities && r.capabilities.tools) || {} } };
      delete r._meta;
    } else if (method === 'tools/list') {
      r = directoryToolsList(r);
    } else if (method === 'tools/call') {
      r = scrubToolResult(r, tool);
    } else {
      r = scrubStructured(r);
    }
    return { ...msg, result: r };
  }
  if (msg.error && typeof msg.error === 'object') {
    const m = String(msg.error.message || '');
    const e = { code: msg.error.code,
                message: scrubText(m) || (/^Unknown tool/.test(m) ? 'Unknown tool.' : 'Request failed.') };
    return { ...msg, error: e };
  }
  // Server-initiated notifications (progress, logging) ride the same stream.
  if (msg.method && msg.params) return { ...msg, params: scrubStructured(msg.params) };
  return msg;
}

// Rewrite a complete response body: JSON (single or batch) or SSE frames.
export function transformDirectoryBody(text, method, tool) {
  if (typeof text !== 'string' || !text) return text;
  const trimmed = text.trimStart();
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    try {
      const j = JSON.parse(trimmed);
      const out = Array.isArray(j) ? j.map((m) => transformDirectoryMessage(m, method, tool)) : transformDirectoryMessage(j, method, tool);
      return JSON.stringify(out);
    } catch (_) { return scrubText(text); }
  }
  if (/(^|\n)data:/.test(text)) {
    return text.split(/\n\n/).map((ev) => {
      const lines = ev.split('\n');
      const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data) return ev;
      let out;
      try { out = JSON.stringify(transformDirectoryMessage(JSON.parse(data), method, tool)); } catch (_) { out = scrubText(data); }
      const kept = lines.filter((l) => !l.startsWith('data:') && !/^id:/.test(l));
      return [...kept, `data: ${out}`].join('\n');
    }).join('\n\n');
  }
  return scrubText(text);
}

// Buffer the whole Express response, transform it once, then send it. Every
// request on the profile is single-shot (stateless), so buffering changes no
// streaming behaviour a client could rely on. Session and length headers are
// removed: the profile mints no session, and the body length changes.
export function installDirectoryResponseFilter(req, res) {
  const method = (req.body && typeof req.body.method === 'string') ? req.body.method : null;
  const tool = (method === 'tools/call' && req.body.params && typeof req.body.params.name === 'string')
    ? req.body.params.name : null;
  const origWriteHead = res.writeHead.bind(res);
  const origEnd = res.end.bind(res);
  const chunks = [];
  let head = null;
  let done = false;
  const push = (chunk, enc) => {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
  };
  res.flushHeaders = () => {};
  res.writeHead = (status, a, b) => { head = [status, a, b]; return res; };
  res.write = (chunk, enc, cb) => {
    push(chunk, enc);
    const fn = typeof enc === 'function' ? enc : cb;
    if (typeof fn === 'function') fn();
    return true;
  };
  res.end = (chunk, enc, cb) => {
    if (done) return res;
    done = true;
    push(chunk, enc);
    const fn = typeof chunk === 'function' ? chunk : (typeof enc === 'function' ? enc : cb);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try { body = transformDirectoryBody(raw, method, tool); } catch (e) {
      console.error('[directory] transform failed:', e && e.message);
      body = JSON.stringify({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: 'Internal error. Retry once.' } });
    }
    const strip = (h) => {
      if (!h || typeof h !== 'object' || Array.isArray(h)) return h;
      const o = {};
      for (const [k, v] of Object.entries(h)) {
        if (/^(content-length|mcp-session-id)$/i.test(k)) continue;
        o[k] = v;
      }
      return o;
    };
    try { res.removeHeader('Content-Length'); res.removeHeader('Mcp-Session-Id'); } catch (_) {}
    // Restore before the final write: Node's end() sends implicit headers by
    // calling res.writeHead, and the capturing override would swallow them
    // (every Express res.json / res.status().end() response had no head).
    res.writeHead = origWriteHead;
    if (head) {
      const [status, a, b] = head;
      if (typeof a === 'string') origWriteHead(status, a, strip(b));
      else origWriteHead(status, strip(a));
    }
    return origEnd(body, 'utf8', fn);
  };
}
