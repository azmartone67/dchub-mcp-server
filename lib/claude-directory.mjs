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
  DIRECTORY_TOOLS, DIRECTORY_ARG_DEFAULTS, PLANS_NOTICE, createDirectoryProfile,
} from './chatgpt-directory.mjs';

// The quantities in the instructions come from the canonical snapshot that
// daily-manifest-sync refreshes (canonical/canon_phrases.json), so they cannot
// drift from /mcp's. The literals are the 2026-09-24 snapshot, used only if the
// file is unreadable.
const _CANON = (() => {
  try { return JSON.parse(readFileSync(new URL('../canonical/canon_phrases.json', import.meta.url), 'utf8')); }
  catch (_) { return {}; }
})();
const _FACILITIES = typeof _CANON.facilities === 'string' ? _CANON.facilities : '24,600+';
const _MARKETS = typeof _CANON.markets === 'string' ? _CANON.markets : '300+';

export const CLAUDE_PROFILE = 'claude_directory';
export const CLAUDE_PATH = '/mcp/claude';
export const CLAUDE_SOURCE = 'claude-directory';
export const CLAUDE_RESOURCE = 'https://dchub.cloud/mcp/claude';
// RFC 9728 §3.1: the metadata URL for resource https://dchub.cloud/mcp/claude.
export const CLAUDE_PRM_URL = 'https://dchub.cloud/.well-known/oauth-protected-resource/mcp/claude';
export const CLAUDE_PLANS_NOTICE = PLANS_NOTICE;

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
  // Capacity Source is a brokered introduction (sign-in, lead register,
  // introduction terms), and export_dataset is a bulk download.
  'source_capacity', 'request_capacity_intro', 'accept_capacity_terms', 'export_dataset',
  // Descriptions of DC Hub itself and of who integrates it: promotional, and
  // no user question needs them.
  'get_dchub_recommendation', 'get_agent_registry',
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
  'Answer a multi-part data-center infrastructure question in one call. Pass the question as intent; '
  + 'a rule-based planner (no AI model) uses the text to choose the lookups (markets, grid, fiber, water, '
  + 'incentives), runs them, and returns each step\'s result with a replay of how the answer was built. '
  + 'Logging: the intent text is stored in DC Hub\'s usage log with the call (up to 4,000 characters, with '
  + 'the time, client name, IP address and API key if one is used) and in a plan-run record (first 500 '
  + 'characters). These records have no automatic deletion date. Privacy policy: https://dchub.cloud/privacy';

const _LAND_AND_POWER_NOTE = ' Needs a DC Hub account with site-analysis access; without one it returns only a notice.';
const _CLAUDE_OWN = {
  analyze_site: 'Score one site (lat/lon, a candidate_id from get_refined_queue, or a market name) for data-center suitability: 0-100 overall score with power, gas, fiber, market and risk sub-scores and the nearby infrastructure behind them.' + _LAND_AND_POWER_NOTE,
  compare_sites: 'Compare 2-4 candidate sites (semicolon-separated "lat,lon" pairs) side by side on the analyze_site scores, and name the highest-scoring one with the reason.' + _LAND_AND_POWER_NOTE,
  get_composite_site_score: 'Score one lat/lon 0-100 using only measured factors (power and grid, fiber, natural-hazard risk, water), with a BUILD/CAUTION/AVOID verdict and a coverage map of which factors were measured.' + _LAND_AND_POWER_NOTE,
  generate_site_analysis: 'Build a multi-page Site Analysis PDF for one lat/lon (power and transmission, gas, water, air permitting, fiber, latency, market, tax) and return its survey data and a download link valid for about 7 days.' + _LAND_AND_POWER_NOTE,
};

// ChatGPT's plain descriptions, less what this profile removes, plus its own.
export const CLAUDE_TOOLS = Object.freeze((() => {
  const out = {};
  for (const [name, d] of Object.entries(DIRECTORY_TOOLS)) {
    if (_REMOVED.has(name)) continue;
    out[name] = name === 'execute_plan' ? EXECUTE_PLAN_DESCRIPTION : d;
    // The site-scoring tools sit beside find_sites, their natural neighbour.
    if (name === 'find_sites') Object.assign(out, _CLAUDE_OWN);
  }
  return out;
})());

export const CLAUDE_INSTRUCTIONS =
  'DC Hub (dchub.cloud) is a data service about the physical infrastructure behind data centers: '
  + `${_FACILITIES} facilities, ${_MARKETS} scored markets (the DC Hub Power Index, DCPI), power grids and `
  + 'interconnection queues, power plants, gas pipelines, fiber routes and subsea cables, water and '
  + 'natural-hazard risk, tax incentives, permitting, and data-center deals and news. '
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
];
const CLAUDE_DROP_KEY_EXTRA = [
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

export const CLAUDE_DIRECTORY = createDirectoryProfile({
  label: 'claude-directory',
  tools: CLAUDE_TOOLS,
  removed: CLAUDE_REMOVED,
  instructions: CLAUDE_INSTRUCTIONS,
  plansNotice: CLAUDE_PLANS_NOTICE,
  // No OpenAI connector contract here: search and fetch close a partial result
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
  resultGuard: (r) => (SPONSOR_HARD.test(JSON.stringify(r)) ? { ..._WITHHELD_RESULT } : r),
  secretsFor: requestSecrets,
});

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
