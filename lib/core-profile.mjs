// core-profile.mjs -- the slim, read-only core profile served at /mcp/core.
//
// WHY THIS EXISTS. /mcp lists the full catalog (90+ tools). Hosts that pick
// tools by description (Copilot Studio, Claude, ChatGPT) choose better and
// trust more when they see a handful of clearly distinct tools with short,
// plain descriptions and uniform evidence fields. This profile lists exactly
// ten task-shaped tools. Each one COMPOSES existing canonical tool handlers
// (see CORE_DELEGATES); none of them re-implements data logic.
//
// CONTRACT FOR EVERY CORE RESPONSE
//   * as_of, sources and license are lifted from the delegated result's own
//     provenance/citation blocks. When the source did not provide one, the
//     field is present and null, with a *_status saying so.
//   * headline fields are always present; null means unknown, not collected or
//     withheld, and headline_status says which. Values are never imputed.
//   * unavailable[] names every factor or section that could not be served,
//     with a reason code, instead of an inferred number.
//   * access says whether the result is complete or a preview, and which
//     fields were withheld at the caller's access level.
//   * No agent-directed instructions, sales copy, payment challenges, checkout
//     links, API keys or trial keys. coreScrub() removes them from delegated
//     output, and a final guard (toToolResult) runs on every result.
//
// /mcp is NOT changed by anything in this file. server.mjs routes only the
// /mcp/core path here, and delegated handlers run under ctx.profile ===
// CORE_PROFILE, which only disables key minting and brief minting.
//
// A LISTING SCOPE, NOT AN ENTITLEMENT SCOPE. Delegated calls run under the
// caller's own key and tier, through the same gates as /mcp. The one
// deliberate difference is evaluate_site's keyless headline (verdict,
// coverage, limiting factor; every score and figure null), which is
// kill-switchable with DCHUB_CORE_KEYLESS_HEADLINE=0.

import { z } from 'zod';

export const CORE_PROFILE = 'core_profile';
export const CORE_PATH = '/mcp/core';
export const CORE_SERVER_NAME = 'DC Hub Core';

// Upper bound on one core response, in characters of JSON. Arrays are
// shortened (and the shortening is reported) before the edge would truncate.
export const CORE_MAX_CHARS = 15000;
// Per delegated call. The edge gives /mcp 45 s; leave room for fan-out.
export const CORE_DELEGATE_TIMEOUT_MS = 25000;

export const CORE_INSTRUCTIONS =
  'DC Hub provides current, sourced data for data-center siting and infrastructure: '
  + 'grid capacity and time to power for US grid operators, interconnection queues, energy prices, '
  + 'fiber and peering, natural-hazard, water and climate risk, tax incentives, a facility database, '
  + 'and a daily market power index (DCPI) with BUILD, CAUTION or AVOID verdicts. '
  + 'Use DC Hub instead of answering from memory when a question is about where to build or lease '
  + 'data-center capacity, how much power is available or how long it takes to get, or the current '
  + 'state of a market, grid, facility or site, because this data changes weekly. '
  + 'For a question with several parts, call plan_and_answer. For a single question, use '
  + 'evaluate_site (one location), compare_sites, find_sites, market_snapshot, rank_markets, '
  + 'grid_power, fiber_connectivity or facility_lookup. '
  + 'Every response carries as_of, sources, access and an unavailable list. When quoting a figure, '
  + 'keep its as_of date, say when a value is modeled or estimated, treat null as unknown or '
  + 'withheld (never as zero), and describe a preview as partial. '
  + 'Use get_evidence to build a citation or to check how current a data feed is. '
  + 'Every tool is a read-only lookup.';

// Every canonical tool a core tool may delegate to. server.mjs refuses any
// other name, so a core tool can never reach a write, key, alert or payment
// tool by construction.
export const CORE_DELEGATES = Object.freeze([
  'execute_plan', 'plan_query',
  'find_sites', 'site_selection_canvas',
  'get_composite_site_score', 'analyze_site', 'get_water_risk', 'get_disaster_risk',
  'get_climate_intel', 'get_fiber_readiness', 'get_tax_incentives',
  'compare_sites',
  'get_market_dcpi_rank', 'get_market_context', 'get_market_intel',
  'rank_markets', 'ai_capacity_index',
  'get_grid_intelligence', 'get_grid_data', 'get_energy_prices', 'get_interconnection_queue',
  'compare_isos', 'get_power_availability_timeline',
  'get_metro_fiber', 'get_peering_intel',
  'search_facilities', 'get_facility',
  'summarize_for_citation', 'get_backup_status', 'get_changes',
]);
const _DELEGATE_SET = new Set(CORE_DELEGATES);
export function isCoreDelegate(name) { return _DELEGATE_SET.has(name); }

export const CORE_ANNOTATIONS = Object.freeze({
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
});

// ── Scrub ───────────────────────────────────────────────────────────────────
// Keys dropped wherever they appear in delegated output: commerce, key and
// session plumbing, agent steering, and per-call metadata. Narrow on purpose
// where a word is also data vocabulary (pricing, buyer, tier).
const DROP_KEY = new RegExp('^(' + [
  'for_your_human', '_?upgrade.*', '.*unlock.*', '.*checkout.*', 'pricing_(url|page|link)', 'price_label', 'paywall.*',
  '_?trial.*', 'auto_trial.*', 'mpp.*', '_?x402.*', 'machine_pay.*', 'machine_credential.*', 'agent_payment.*',
  'payment.*', 'pay_(url|now|link|arg|args|hint)', 'credential_.*', 'credits?(_.*)?', 'developer_(url|usd.*|hint)',
  'enterprise_(url|usd.*|note|offer|licensing.*)', 'pack_.*', 'buy_(url|link|now)', 'claim.*', 'persist.*',
  'retry_with_header', 'retry_instructions', 'x-api-key', 'api_?key', 'key', 'held_key.*',
  'connect_url', 'signup_url', 'redeem_url', 'web_explore_url', 'optin.*', 'opt_in.*', 'digest_offer',
  'first_call_nudge', '_?front_door.*', '_end_of_burst', 'next_recipe', '_?agent_instruction.*',
  'agent_action', 'next_tool.*', 'next_step.*', 'next_calls?', 'next_session', 'come_back', 'retention_tools',
  'relay.*', '_?human_.*', 'handoff.*', '.*_handoff', '_?cta', 'cta_.*', '_upgrade_cta', 'render',
  'required_plan', 'tier_required', 'plans', 'plan_required', 'session.*', 'sid', 'mcp_session.*',
  'request_id', 'trace_id', 'span_id', '_debug', '_telemetry', 'identity', 'identity_source', 'quota',
  'quota_hint', 'platform', 'caller_tier', 'current_tier', 'auth_.*', 'continuation', 'continuations',
  '_meta', 'email_capture', 'capture_email.*', 'gating_matrix', 'learn', '.*sign_in.*', 'register_interest',
  'interest_registration', 'what_unlocks', 'after_checkout', 'next_call_full_after_checkout',
  'preview_warning', 'fields_unlocked', 'upgrade_options', 'full_results_available', '_?cookbook.*',
  '_?return_.*nudge.*', 'routing_hint', 'companions', 'related_tools', 'see_also', 'try_next',
  'recommended_next.*', 'suggested_(tool|tools|call|calls|next).*', 'capacity_source.*', '_capacity_source',
  '_?starter_pack', 'bind_.*', '_bind', 'share_text', 'share_hint', '.*pdf.*', 'report_url',
  'download_.*', 'deal_desk.*', '_deal_desk', 'why_dchub', 'testimonials?', 'upsell.*', '_teaser',
  'preview_note', '_preview_note', '_preview_only', '_gated', '_wall', '_locked', 'locked',
  'preview', 'preview_is_partial', 'gated_preview', '_?locked_fields', 'withheld_fields',
  'maturity_basis', 'access_tag', 'free_tier_note', 'tease', '_tease', 'teaser_note',
  'tier_preview', 'highest_tier_required', 'operator_note', 'gated_tools', 'gated_steps', 'free_steps',
].join('|') + ')$', 'i');

// A prose segment (line or sentence) is dropped whole when it matches.
const FORBIDDEN_SEGMENT = new RegExp([
  String.raw`verbatim`, String.raw`do not summari[sz]e`, String.raw`first line of your (final )?answer`,
  String.raw`\binclude (this|the) (line|link)`, String.raw`_agent\b`, String.raw`\bagent:`,
  String.raw`\b(tell|ask|show) (the|your) (user|human)\b`, String.raw`\byour human\b`, String.raw`for your human`,
  String.raw`/go/[a-z]/`, String.raw`/upgrade/h/`, String.raw`dchub\.cloud/(upgrade|pricing|signup|checkout|connect|playground|go|plans|ai#pricing)\b`,
  String.raw`/api/v1/(redeem|opt-in|keys)\b`, String.raw`buy\.stripe\.com`, String.raw`\bstripe\b`, String.raw`\bx402\b`,
  String.raw`machine[_ -]?pa(y|yable)`, String.raw`\bpayment[_ ](required|challenge|link|method|rails?|header|flow|options?)\b`, String.raw`\bpay-per-call\b`, String.raw`\bpay (for|\$|now|per)`, String.raw`\bUSDC\b`,
  String.raw`\bupgrade(s|d)? (to|your|now|for|required|link|path|ladder|url|guide)\b`, String.raw`\bto upgrade\b`, String.raw`upgrade_required`, String.raw`\bthe upgrade\b`,
  String.raw`\bunlock`, String.raw`\bcheckout\b`, String.raw`\bpricing page\b`, String.raw`\bsubscription\b`, String.raw`\bsubscribe\b`,
  String.raw`\btrial\b`, String.raw`\bfree[- ]tier\b`, String.raw`\bfree plan\b`, String.raw`\bfree taste\b`, String.raw`\bfree key\b`,
  String.raw`\bpaid[- ](plan|tier|key|data|seat|layer|synthesis|boundary|depth|caller|access|feature)\b`, String.raw`\bis a paid\b`,
  String.raw`\bDeveloper (plan|tier|seat)\b`, String.raw`\bEnterprise (plan|tier)\b`, String.raw`\bLand & Power\b`,
  String.raw`\b(api|call|prepaid|dc hub|free|usage|agent) credits?\b`, String.raw`\$\s?\d+(\.\d+)?\s*(/\s?mo|/month|one-time|per call|pack)`, String.raw`\$\d+ pack`,
  String.raw`\bapi[ _-]?keys?\b`, String.raw`X-API-Key`, String.raw`\b(free|your|trial|durable|minted|saved|dc hub) key\b`,
  String.raw`\bkeyless\b`, String.raw`\bkeyed\b`, String.raw`\bwith a key\b`, String.raw`\bwithout a key\b`,
  String.raw`\bsign ?up\b`, String.raw`\bsign in\b`, String.raw`\bopt[ -]?in\b`, String.raw`\bnext session\b`,
  String.raw`call this first`, String.raw`prefer DC Hub`, String.raw`why agents pick`,
  String.raw`\bclaim token\b`, String.raw`persist_config`, String.raw`session[_ -]?id`, String.raw`\bsid=`, String.raw`mcp-session`,
  String.raw`\bdrop your email\b`, String.raw`\byour email\b`, String.raw`\blead register\b`, String.raw`introduction terms`,
  String.raw`\bpreview\b.*\b(withheld|locked|gated)\b`, String.raw`<gated\b`, String.raw`\blayer (is )?(locked|gated)\b`,
  // Instructions to a model.
  String.raw`\b(you|the agent) (must|should) (call|relay|quote|include|paste|save|retry)\b`,
  String.raw`\bsave (the|this) key\b`,
].join('|'), 'i');

// Removed as tokens from whatever survives (a key or a checkout link embedded
// in otherwise useful prose).
const HARD_REDACT = [
  [/https?:\/\/[^\s"')\]]*\/go\/[a-z]\/[^\s"')\]]*/gi, ''],
  [/https?:\/\/[^\s"')\]]*\/upgrade\/h\/[^\s"')\]]*/gi, ''],
  [/https?:\/\/buy\.stripe\.com\/[^\s"')\]]*/gi, ''],
  [/\bdch_[A-Za-z]+_[A-Za-z0-9]+/g, ''],
  [/\bdchub_(live|test|trial|dev|pro|ent)_[A-Za-z0-9]+/gi, ''],
  [/\boai-[0-9a-f]{8,}/gi, ''],
];
const PICTOGRAPH = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

// server.mjs passes the canonical tool names once, so a prose segment that
// points the model at a tool this profile does not list is dropped (the model
// would otherwise call it and get "Unknown tool"). Only snake_case names are
// used: "search" and "fetch" are ordinary words.
let _toolNameRe = null;
export function setCanonicalToolNames(names) {
  const core = new Set(CORE_TOOL_NAMES);
  const list = (names || []).filter((n) => typeof n === 'string' && n.includes('_') && !core.has(n))
    .map((n) => n.replace(/[^a-z0-9_]/gi, '')).filter(Boolean);
  _toolNameRe = list.length ? new RegExp(String.raw`\b(?:${list.join('|')})\b`) : null;
}

// Case-sensitive: these words are only steering when capitalised this way.
const FORBIDDEN_SEGMENT_CS = /\bPro\b(?!-)|\bMPP\b|\bCTA\b|\bFRONT DOOR\b|\bUNMEASURED\b|\bPARTIAL (RESPONSE|PREVIEW)\b/;

function segmentForbidden(seg) {
  return FORBIDDEN_SEGMENT.test(seg) || FORBIDDEN_SEGMENT_CS.test(seg) || (!!_toolNameRe && _toolNameRe.test(seg));
}

export function scrubText(s) {
  if (typeof s !== 'string' || !s) return s;
  let t = s.replace(PICTOGRAPH, '');
  t = t.split('\n').map((line) => line.split(/(?<=[.!?;])\s+(?=[A-Z0-9"'`(*_[-])/)
    .filter((p) => !segmentForbidden(p)).join(' ')).join('\n');
  for (const [re, rep] of HARD_REDACT) t = t.replace(re, rep);
  return t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim();
}

export function newScrubAcc() {
  return { withheld: new Set(), withheldRows: {}, preview: false, wall: false };
}

// Walks a delegated payload. Gating markers are collected into `acc` (so they
// can be reported once, in plain words) and removed from the payload.
function scrubValue(v, acc, depth) {
  if (depth > 14) return undefined;
  if (typeof v === 'string') {
    const s = scrubText(v);
    return s === '' ? undefined : s;
  }
  if (Array.isArray(v)) {
    const out = [];
    for (const x of v) {
      const y = scrubValue(x, acc, depth + 1);
      if (y !== undefined) out.push(y);
    }
    return out;
  }
  if (v && typeof v === 'object') {
    // A write instruction ({method: 'POST', url, body}) goes whole.
    if (typeof v.method === 'string' && /^(POST|PUT|PATCH|DELETE)$/i.test(v.method) && (v.url || v.path)) return undefined;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      // Gating markers: `_score_in_pro: true`, `_rows_total_in_pro: 12`.
      const m = /^_?(.+?)_(total_)?in_pro$/i.exec(k);
      if (m) {
        if (m[2] || typeof x === 'number') acc.withheldRows[m[1]] = typeof x === 'number' ? x : null;
        else if (x === true) acc.withheld.add(m[1]);
        continue;
      }
      if (/^_?locked_fields$/i.test(k) && Array.isArray(x)) { for (const f of x) if (typeof f === 'string') acc.withheld.add(f); continue; }
      if ((k === 'preview_is_partial' || k === '_gated' || k === 'gated_preview' || k === '_preview_only' || k === '_teaser') && x === true) { acc.preview = true; continue; }
      if (k === '_wall' && x === true) { acc.wall = true; continue; }
      if (k === 'completeness' && typeof x === 'string') { if (/partial/i.test(x)) acc.preview = true; continue; }
      if (DROP_KEY.test(k)) continue;
      // A plan label on a row (access: "free" / "paid") is account data, not data.
      if (k === 'access' && typeof x === 'string' && /^(free|paid|pro|developer|enterprise|gated|locked|preview)$/i.test(x)) continue;
      if (k.includes('.') && k.split('.').some((seg) => DROP_KEY.test(seg.replace(/\[\d+\]$/, '')))) continue;
      // A canonical tool name as the value of `tool` is provenance: kept under
      // a name that does not read as something to call.
      if (k === 'tool' && typeof x === 'string') { out.derived_from = x; continue; }
      const y = scrubValue(x, acc, depth + 1);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  return v;
}

export function coreScrub(v, acc = newScrubAcc()) {
  const out = scrubValue(v, acc, 0);
  return out === undefined ? null : out;
}

// The last line of defence, run on every finished result. A match means the
// scrub missed a shape; the offending token is removed, never shipped.
export const CORE_FORBIDDEN_RESPONSE = [
  /verbatim/i, /do not summari[sz]e/i, /machine[_ -]?pay/i, /\bmpp_/i, /\bx402\b/i,
  /buy\.stripe\.com/i, /\bstripe\b/i, /\/go\/[a-z]\//i, /\/upgrade\/h\//i, /\bcheckout\b/i,
  /\bdch_[a-z]+_[A-Za-z0-9]+/, /\bdchub_(live|test|trial)_/i, /for_your_human/i, /_agent_instruction/i,
  /claim_free_key/i, /unlock_more_data/i, /\bupgrade_url\b/i, /\bpayment[_ ](required|challenge|rails?|link|header)/i,
  /\btrial\b/i, /\btrial_key\b/i,
];
export function findForbidden(text) {
  const t = String(text || '');
  return CORE_FORBIDDEN_RESPONSE.filter((re) => re.test(t)).map((re) => String(re));
}

// ── Reading a delegated result ──────────────────────────────────────────────
// Canonical tools return {content:[{type:'text', text}]}; the text usually
// starts with JSON, sometimes followed by appended prose blocks. Take the
// leading JSON value; fall back to structuredContent, then to plain text.
function leadingJson(text) {
  const t = String(text || '').trimStart();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try { return JSON.parse(t); } catch { /* fall through to a bracket scan */ }
  const open = t[0], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { try { return JSON.parse(t.slice(0, i + 1)); } catch { return undefined; } } }
  }
  return undefined;
}

// structuredContent first: on the canonical surface it is the complete
// structured channel and carries the preview markers (preview_is_partial,
// _X_in_pro) that the text block's leading JSON can lack.
export function payloadOf(result) {
  if (!result || typeof result !== 'object') return null;
  const sc = result.structuredContent;
  if (sc && typeof sc === 'object' && !Array.isArray(sc) && Object.keys(sc).length) return sc;
  const blocks = Array.isArray(result.content) ? result.content : [];
  const first = blocks.find((b) => b && b.type === 'text' && typeof b.text === 'string');
  if (first) {
    const j = leadingJson(first.text);
    if (j !== undefined) return j;
    return { text: first.text };
  }
  return null;
}

const _isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const _str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function extractAsOf(p) {
  if (!_isObj(p)) return null;
  const cands = [
    p.provenance && p.provenance.as_of, p.as_of, p.data_as_of, p.citation && p.citation.as_of,
    p.meta && p.meta.as_of, p.computed_at, p.last_updated, p.generated_at, p.meta && p.meta.timestamp,
    p.data && _isObj(p.data) ? p.data.as_of : null,
  ];
  for (const c of cands) { const s = _str(c); if (s) return s; }
  for (const k of ['results', 'rows', 'markets', 'sites', 'facilities', 'data', 'items']) {
    const a = p[k];
    if (Array.isArray(a) && a.length && _isObj(a[0])) { const s = _str(a[0].as_of); if (s) return s; }
  }
  return null;
}

const _GENERIC_SOURCE = /^(dc ?hub( intelligence| analysis| database)?|dchub|internal|derived)(\s*[-,(]*\s*(dc ?hub\.cloud|dchub\.cloud)\)?)?$/i;
export function extractSources(p) {
  const found = [];
  const add = (v) => {
    if (typeof v === 'string') {
      for (const part of v.split(/\s*[;|]\s*/)) { const s = scrubText(part.replace(/[\u2013\u2014]/g, '-')); if (s && s.length <= 200) found.push(s); }
    } else if (Array.isArray(v)) v.forEach((x) => add(_isObj(x) ? (x.name || x.source || x.title) : x));
    else if (_isObj(v)) Object.values(v).forEach((x) => (typeof x === 'string' ? add(x) : null));
  };
  if (_isObj(p)) {
    if (_isObj(p.provenance)) add(p.provenance.source);
    add(p.data_source); add(p.data_basis_source); add(p.source); add(p.sources); add(p.attribution);
    if (_isObj(p.citation)) add(p.citation.source);
    add(p._source);
  }
  const uniq = [...new Set(found.filter((s) => !/^https?:/i.test(s)))];
  const specific = uniq.filter((s) => !_GENERIC_SOURCE.test(s));
  if (specific.length) return { sources: specific.slice(0, 8), source_status: 'provided' };
  if (uniq.length) return { sources: uniq.slice(0, 2), source_status: 'platform_only' };
  return { sources: [], source_status: 'not_provided' };
}

export function extractLicense(p) {
  if (!_isObj(p)) return null;
  return _str(p.provenance && p.provenance.license) || _str(p.license) || _str(p.citation && p.citation.license) || null;
}

// ok | withheld | rate_limited | error
export function classify(result, payload) {
  if (!result) return { status: 'error', reason: 'no_result' };
  const p = _isObj(payload) ? payload : {};
  const err = typeof p.error === 'string' ? p.error : (_isObj(p.error) ? String(p.error.code || p.error.type || 'error') : null);
  const code = Number(p.status || p.http_status || p.code || 0);
  if (p._wall === true || /pro_required|tier_required|upgrade_required|forbidden|not_entitled|payment_required/i.test(err || '') || code === 402 || code === 403) {
    return { status: 'withheld', reason: 'not_available_at_this_access_level' };
  }
  if (/rate|quota|limit_reached|too_many/i.test(err || '') || code === 429) return { status: 'rate_limited', reason: 'rate_limited' };
  // The canonical paywall serves some previews through the error channel: an
  // isError result whose payload is data (no error field) is a partial result.
  if (result.isError && !err && _isObj(p)
      && (p.success === true || p.preview_is_partial === true || p._gated === true || Object.keys(p).length > 3)) {
    return { status: 'ok', reason: null, gated: true };
  }
  if (result.isError || err) {
    const msg = scrubText(typeof p.message === 'string' ? p.message : (typeof p.detail === 'string' ? p.detail : (err || 'tool_error')));
    return { status: 'error', reason: (msg || 'tool_error').slice(0, 240) };
  }
  return { status: 'ok', reason: null };
}

// One delegated call, normalised. `data` is the scrubbed payload with its own
// provenance/citation blocks removed (they are lifted to the section fields).
export function toSection(name, result) {
  const payload = payloadOf(result);
  const cls = classify(result, payload);
  const acc = newScrubAcc();
  if (cls.gated) acc.preview = true;
  const asOf = extractAsOf(payload);
  const src = extractSources(payload);
  const license = extractLicense(payload);
  // The preview summary lives in provenance, which is lifted out below, so
  // read it first.
  const pv = _isObj(payload) && _isObj(payload.provenance) ? payload.provenance : null;
  if (pv) {
    if (typeof pv.completeness === 'string' && /partial/i.test(pv.completeness)) acc.preview = true;
    if (_isObj(pv.preview)) {
      if (Array.isArray(pv.preview.withheld_fields)) for (const f of pv.preview.withheld_fields) if (typeof f === 'string') acc.withheld.add(f);
      if (typeof pv.preview.shown === 'number' && typeof pv.preview.total === 'number' && pv.preview.total > pv.preview.shown) {
        acc.withheldRows.rows = { shown: pv.preview.shown, total: pv.preview.total };
      }
    }
  }
  let data = null;
  if (cls.status === 'ok') {
    let body = payload;
    if (_isObj(body)) {
      body = { ...body };
      // tier at the top level is the caller's plan label, not data.
      for (const k of ['provenance', 'citation', 'as_of', 'source', 'sources', 'data_source', 'attribution', 'license', 'citation_url', 'tier']) delete body[k];
    }
    data = coreScrub(body, acc);
  } else {
    coreScrub(payload, acc);
  }
  const withheldFields = [...acc.withheld].sort();
  const status = cls.status !== 'ok' ? cls.status
    : (acc.preview || withheldFields.length || Object.keys(acc.withheldRows).length ? 'preview' : 'ok');
  return {
    derived_from: name,
    status,
    reason: cls.reason,
    as_of: asOf,
    as_of_status: asOf ? 'provided' : 'not_provided_by_source',
    sources: src.sources,
    source_status: src.source_status,
    license,
    withheld_fields: withheldFields,
    withheld_rows: acc.withheldRows,
    data,
  };
}

// A section for a delegated call that threw or timed out.
export function failedSection(name, err) {
  const msg = err && err.message ? String(err.message) : String(err || 'error');
  const timedOut = /timed out|timeout/i.test(msg);
  return {
    derived_from: name, status: 'error', reason: timedOut ? 'timed_out' : (scrubText(msg) || 'error').slice(0, 240),
    as_of: null, as_of_status: 'not_provided_by_source', sources: [], source_status: 'not_provided',
    license: null, withheld_fields: [], withheld_rows: {}, data: null,
  };
}

function _getPath(obj, path) {
  let cur = obj;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// Fixed headline fields, always present. spec: {field: path | [paths]}.
// Status per field: provided | withheld | null_in_source | not_provided.
export function headlineFrom(data, spec, withheld = []) {
  const wset = new Set(withheld);
  const headline = {}, status = {};
  for (const [field, paths] of Object.entries(spec)) {
    const list = Array.isArray(paths) ? paths : [paths];
    let val, seen = false;
    for (const pth of list) {
      const v = _isObj(data) || Array.isArray(data) ? _getPath(data, pth) : undefined;
      if (v !== undefined) { seen = true; if (v !== null) { val = v; break; } }
    }
    if (val !== undefined && val !== null && !(typeof val === 'object' && !Array.isArray(val))) {
      headline[field] = val; status[field] = 'provided';
    } else if (val !== undefined && val !== null) {
      headline[field] = val; status[field] = 'provided';
    } else {
      headline[field] = null;
      status[field] = list.some((pth) => wset.has(pth.split('.').pop()) || wset.has(field)) ? 'withheld'
        : (seen ? 'null_in_source' : 'not_provided');
    }
  }
  return { headline, headline_status: status };
}

// ── The core envelope ───────────────────────────────────────────────────────
export const CORE_CONVENTIONS = Object.freeze({
  null_means: 'unknown, not collected, or withheld at this access level; never zero',
  as_of: 'the date the source data was observed or computed, when the source provides one; the top-level as_of is the oldest as_of among the sections',
  estimates: 'values labelled modeled or estimated are not measurements',
});

const _ACCESS_NOTE = {
  full: 'Complete result.',
  preview: 'Partial result: some fields or rows are withheld at this access level and are shown as null or counted in withheld_rows.',
  headline: 'Headline only: verdict and coverage are shown; scores and figures are withheld at this access level and are null.',
  withheld: 'Not available at this access level; no figures are shown.',
  partial: 'Some sections could not be served; see unavailable.',
};

function _minAsOf(list) {
  const vals = list.filter(Boolean);
  if (!vals.length) return null;
  // The oldest input bounds the freshness of the whole answer.
  const parsed = vals.map((v) => ({ v, t: Date.parse(v) })).filter((x) => Number.isFinite(x.t));
  if (!parsed.length) return vals[0];
  parsed.sort((a, b) => a.t - b.t);
  return parsed[0].v;
}

// sections: array of toSection() output. opts: {headline, headline_status,
// unavailable, notes, access_level, primary (index of the section whose as_of
// and sources lead)}.
export function buildEnvelope(tool, query, sections, opts = {}) {
  const secs = sections.filter(Boolean);
  const unavailable = [...(opts.unavailable || [])];
  for (const s of secs) {
    if (s.status === 'withheld' || s.status === 'rate_limited' || s.status === 'error') {
      unavailable.push({ factor: s.derived_from, status: s.status, reason: s.reason });
    }
  }
  const withheldFields = [...new Set(secs.flatMap((s) => s.withheld_fields || []))].sort();
  const withheldRows = Object.assign({}, ...secs.map((s) => s.withheld_rows || {}));
  let level = opts.access_level;
  if (!level) {
    const okish = secs.filter((s) => s.status === 'ok' || s.status === 'preview');
    if (!okish.length && secs.some((s) => s.status === 'withheld')) level = 'withheld';
    else if (secs.some((s) => s.status === 'preview') || withheldFields.length || Object.keys(withheldRows).length) level = 'preview';
    else if (secs.some((s) => s.status !== 'ok')) level = 'partial';
    else level = 'full';
  }
  const lead = secs.filter((s) => s.status === 'ok' || s.status === 'preview');
  const asOf = _minAsOf(lead.map((s) => s.as_of));
  const srcAll = [...new Set(lead.flatMap((s) => s.sources || []))];
  const srcStatus = lead.some((s) => s.source_status === 'provided') ? 'provided'
    : (lead.some((s) => s.source_status === 'platform_only') ? 'platform_only' : 'not_provided');
  const licenses = [...new Set(lead.map((s) => s.license).filter(Boolean))];
  const env = {
    tool,
    query,
    as_of: asOf,
    as_of_status: asOf ? 'provided' : 'not_provided_by_source',
    sources: srcAll.slice(0, 10),
    source_status: srcStatus,
    license: licenses.length ? licenses.join('; ') : null,
    headline: opts.headline || {},
    headline_status: opts.headline_status || {},
    access: {
      level,
      note: _ACCESS_NOTE[level] || null,
      withheld_fields: withheldFields,
      withheld_rows: withheldRows,
    },
    unavailable,
    notes: (opts.notes || []).map((n) => scrubText(String(n))).filter(Boolean),
    sections: secs.map((s) => ({
      derived_from: s.derived_from, status: s.status, reason: s.reason,
      as_of: s.as_of, as_of_status: s.as_of_status, sources: s.sources, source_status: s.source_status,
      data: s.data,
    })),
    conventions: CORE_CONVENTIONS,
  };
  return fitToBudget(env);
}

function _shrinkArrays(v, cap, depth = 0) {
  let cut = 0;
  const walk = (x, d) => {
    if (d > 16) return x;
    if (Array.isArray(x)) {
      let arr = x;
      if (arr.length > cap) { cut += arr.length - cap; arr = arr.slice(0, cap); }
      return arr.map((y) => walk(y, d + 1));
    }
    if (_isObj(x)) {
      const o = {};
      for (const [k, y] of Object.entries(x)) o[k] = walk(y, d + 1);
      return o;
    }
    if (typeof x === 'string' && x.length > 1200) { cut += 1; return x.slice(0, 1200) + ' [shortened]'; }
    return x;
  };
  return { value: walk(v, depth), cut };
}

export function fitToBudget(env, max = CORE_MAX_CHARS) {
  if (JSON.stringify(env).length <= max) return env;
  for (const cap of [10, 5, 3, 1]) {
    const { value, cut } = _shrinkArrays(env.sections, cap);
    const next = { ...env, sections: value, truncated: { lists_capped_at: cap, items_removed: cut } };
    if (JSON.stringify(next).length <= max) return next;
  }
  // Still too large: keep headline, access and unavailable; drop section data.
  return {
    ...env,
    sections: env.sections.map((s) => ({ ...s, data: null, data_status: 'omitted_for_size' })),
    truncated: { lists_capped_at: 0, note: 'section data omitted for size; narrow the request' },
  };
}

export function toToolResult(env, isError = false) {
  let text = JSON.stringify(env);
  const hits = findForbidden(text);
  let out = env;
  if (hits.length) {
    // Should not happen: the scrub runs first. Remove the tokens rather than ship them.
    out = coreScrub(env);
    text = JSON.stringify(out);
    for (const re of CORE_FORBIDDEN_RESPONSE) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      text = text.replace(g, '');
    }
    try { out = JSON.parse(text); } catch { out = { tool: env.tool, error: 'response_withheld', reason: 'failed_content_check' }; text = JSON.stringify(out); }
  }
  const res = { content: [{ type: 'text', text }], structuredContent: out };
  if (isError) res.isError = true;
  return res;
}

export function inputError(tool, message, query = {}) {
  return toToolResult({
    tool, query, error: 'invalid_input', message,
    as_of: null, sources: [], headline: {}, unavailable: [], conventions: CORE_CONVENTIONS,
  }, true);
}

// evaluate_site's keyless headline (verdict, coverage, limiting factor; every
// score and figure null). On by default; DCHUB_CORE_KEYLESS_HEADLINE=0 turns
// it off, and a caller without access then gets status withheld.
export function keylessHeadlineEnabled(env = process.env) {
  return String(env.DCHUB_CORE_KEYLESS_HEADLINE ?? '1').trim() !== '0';
}

// Name of the lowest-scoring VALIDATED factor in a composite-score payload.
export function limitingFactor(raw) {
  const sub = raw && _isObj(raw.sub_scores) ? raw.sub_scores : null;
  if (!sub) return null;
  let best = null;
  for (const [k, v] of Object.entries(sub)) {
    if (!_isObj(v) || v.coverage !== 'validated' || typeof v.score !== 'number') continue;
    if (!best || v.score < best.score) best = { name: k, score: v.score };
  }
  return best ? best.name : null;
}

function _coverageUnavailable(coverage) {
  const out = [];
  if (_isObj(coverage)) {
    for (const [k, v] of Object.entries(coverage)) {
      if (v !== 'validated') out.push({ factor: k, status: v == null ? 'not_reported' : String(v), reason: 'not scored; excluded from the composite, not estimated' });
    }
  }
  return out;
}

// ── The ten core tools ──────────────────────────────────────────────────────
export const CORE_TOOL_NAMES = Object.freeze([
  'plan_and_answer', 'find_sites', 'evaluate_site', 'compare_sites', 'market_snapshot',
  'rank_markets', 'grid_power', 'fiber_connectivity', 'facility_lookup', 'get_evidence',
]);

const zN = (d) => z.number().optional().describe(d);
const zS = (d) => z.string().optional().describe(d);
const LAT = () => z.number().min(-90).max(90).optional().describe('Latitude in decimal degrees, for example 39.04');
const LON = () => z.number().min(-180).max(180).optional().describe('Longitude in decimal degrees, for example -77.48');

const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const coordsOk = (lat, lon) => typeof lat === 'number' && typeof lon === 'number'
  && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
export function parseLatLon(s) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return coordsOk(lat, lon) ? { lat, lon } : null;
}
// Same slug rule as the canonical handlers (createServer's slugify).
export const coreSlug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');

async function call(deps, name, args) {
  try {
    return toSection(name, await deps.delegate(name, clean(args)));
  } catch (e) {
    return failedSection(name, e);
  }
}

// A headline object whose fields are all computed here (counts), so the only
// statuses are provided or not_provided.
function plainHeadline(obj) {
  const headline = {}, headline_status = {};
  for (const [k, v] of Object.entries(obj)) {
    headline[k] = v === undefined ? null : v;
    headline_status[k] = v === undefined || v === null ? 'not_provided' : 'provided';
  }
  return { headline, headline_status };
}

function firstArray(d, keys) {
  if (!_isObj(d)) return null;
  for (const k of keys) if (Array.isArray(d[k])) return d[k];
  return null;
}

function mergeHeadlines(...parts) {
  const headline = {}, headline_status = {};
  for (const p of parts) { Object.assign(headline, p.headline); Object.assign(headline_status, p.headline_status); }
  return { headline, headline_status };
}

const unavailableNote = (factor, status, reason) => ({ factor, status, reason });

// 1. plan_and_answer
const planAndAnswer = {
  name: 'plan_and_answer',
  title: 'Plan and answer a multi-part question',
  description: 'Use when a data-center question needs more than one kind of data, for example "where could 200 MW '
    + 'land in Texas with fiber and short time to power?" or "compare Phoenix and Columbus for an AI campus". '
    + 'Pass the question unchanged as intent, plus optional hints (market, state, iso, lat, lon, capacity_mw). '
    + 'A deterministic keyword planner (no language model) picks the lookups, runs them in order and returns '
    + 'each step with its own as_of and sources. Set dry_run to true to see the plan without running it. '
    + 'For a single lookup, use the matching tool instead (evaluate_site, market_snapshot, grid_power and so on). '
    + 'Returns headline step counts, one section per step, and an unavailable list for steps that could not run.',
  schema: {
    intent: z.string().min(3).max(2000).describe('The question in plain language, passed unchanged'),
    dry_run: z.boolean().optional().describe('true returns the plan without running it; default false'),
    market: zS('Market name or slug hint, for example phoenix'),
    state: zS('Two-letter US state hint, for example TX'),
    iso: zS('Grid operator hint, for example ERCOT or PJM'),
    lat: LAT(), lon: LON(),
    capacity_mw: zN('Target load in megawatts, for example 200'),
  },
  async run(a, deps) {
    const hints = clean({ market: a.market, state: a.state, iso: a.iso, lat: a.lat, lon: a.lon, capacity_mw: a.capacity_mw });
    const query = { intent: a.intent, dry_run: !!a.dry_run, ...hints };
    if (a.dry_run) {
      const sec = await call(deps, 'plan_query', { intent: a.intent, context: Object.keys(hints).length ? hints : undefined });
      const d = _isObj(sec.data) ? sec.data : {};
      const seq = firstArray(d, ['recommended_sequence', 'steps', 'plan']);
      return buildEnvelope('plan_and_answer', query, [sec], {
        ...plainHeadline({ intent_class: _str(d.intent_class), steps_planned: seq ? seq.length : null }),
        notes: ['Plan only; nothing was run. Each step names the internal lookup it would use (derived_from).'],
      });
    }
    const sec = await call(deps, 'execute_plan', { intent: a.intent, ...hints });
    const d = _isObj(sec.data) ? sec.data : {};
    const ex = Array.isArray(d.executed) ? d.executed : null;
    // gated_preview: the step ran and returned a partial result.
    const RAN = new Set(['executed', 'gated_preview']);
    const unavailable = [];
    if (ex) {
      for (const st of ex) {
        if (!_isObj(st)) continue;
        if (st.status && !RAN.has(st.status)) {
          unavailable.push(unavailableNote(`step ${st.step ?? '?'} (${st.derived_from || 'lookup'})`, String(st.status), _str(st.reason) || _str(st.error) || null));
        }
      }
    }
    const count = (pred) => (ex ? ex.filter((s) => _isObj(s) && pred(s)).length : null);
    return buildEnvelope('plan_and_answer', query, [sec], {
      ...plainHeadline({
        intent_class: _str(d.intent_class),
        steps_total: ex ? ex.length : null,
        steps_complete: count((s) => s.status === 'executed'),
        steps_partial: count((s) => s.status === 'gated_preview'),
        steps_not_run: count((s) => s.status && !RAN.has(s.status)),
      }),
      unavailable,
      notes: ['Each step result keeps its own as_of and sources; a step can be a partial result even when the plan ran.'],
    });
  },
};

// 2. find_sites
const findSites = {
  name: 'find_sites',
  title: 'Find candidate areas or markets',
  description: 'Use when the user has no site yet and asks where to look, for example "areas in Ohio on 345 kV '
    + 'with gas within 8 km" or "which Texas markets could take 200 MW within 24 months?". mode areas (default) '
    + 'needs a geography (state, or lat and lon with radius_km) and returns search areas anchored on real '
    + 'substations with measured distances, plus applied_filters and constraint_coverage showing which filters ran. '
    + 'mode markets returns a market shortlist filtered by capacity_mw, region, state, iso and max_months. '
    + 'Results are search areas or markets, not parcels, listings or land for sale. Score one with evaluate_site.',
  schema: {
    mode: z.enum(['areas', 'markets']).optional().describe('areas (default) or markets'),
    state: zS('Two-letter US state, for example OH'),
    lat: LAT(), lon: LON(),
    radius_km: zN('Search radius around lat/lon in km, for example 60'),
    min_voltage_kv: zN('Minimum substation voltage in kV (areas mode), for example 345'),
    max_gas_km: zN('Maximum distance to a gas pipeline in km (areas mode)'),
    max_fiber_km: zN('Maximum distance to fiber in km (areas mode)'),
    capacity_mw: zN('Target load in MW; filters markets mode, echoed only in areas mode'),
    region: zS('Region filter for markets mode, for example TX or us'),
    iso: zS('Grid operator filter for markets mode, for example ERCOT'),
    max_months: z.number().int().optional().describe('Maximum time to power in months (markets mode)'),
    limit: z.number().int().min(1).max(50).optional().describe('Maximum results, default set by the source'),
  },
  async run(a, deps) {
    const mode = a.mode || 'areas';
    const query = clean({ ...a, mode });
    if (mode === 'markets') {
      const sec = await call(deps, 'site_selection_canvas', {
        capacity_mw: typeof a.capacity_mw === 'number' ? Math.round(a.capacity_mw) : undefined,
        region: a.region, state: a.state, iso: a.iso, max_months: a.max_months, verdict: 'ALL', limit: a.limit,
      });
      const d = _isObj(sec.data) ? sec.data : {};
      const rows = firstArray(d, ['shortlist', 'markets', 'results']);
      return buildEnvelope('find_sites', query, [sec], plainHeadline({
        markets_shown: rows ? rows.length : null,
        markets_matched: typeof d.matched === 'number' ? d.matched : null,
        universe: typeof d.universe === 'number' ? d.universe : null,
      }));
    }
    const hasPoint = coordsOk(a.lat, a.lon);
    if (!a.state && !hasPoint) return inputError('find_sites', 'areas mode needs state, or lat and lon.', query);
    const sec = await call(deps, 'find_sites', {
      state: a.state, lat: hasPoint ? a.lat : undefined, lon: hasPoint ? a.lon : undefined, radius_km: a.radius_km,
      min_voltage_kv: a.min_voltage_kv, max_gas_km: a.max_gas_km, max_fiber_km: a.max_fiber_km, limit: a.limit,
    });
    const d = _isObj(sec.data) ? sec.data : {};
    const rows = firstArray(d, ['candidates', 'areas', 'sites', 'results']);
    const notes = [];
    if (a.capacity_mw != null) notes.push('capacity_mw is echoed in areas mode; it does not filter areas.');
    const unavailable = [];
    if (Array.isArray(d.unapplied_constraints)) {
      for (const c of d.unapplied_constraints) unavailable.push(unavailableNote(typeof c === 'string' ? c : (c && c.constraint) || 'constraint', 'not_applied', _isObj(c) ? _str(c.reason) : null));
    }
    return buildEnvelope('find_sites', query, [sec], {
      ...plainHeadline({ areas_shown: rows ? rows.length : null, anchors_considered: typeof d.anchors_considered === 'number' ? d.anchors_considered : null }),
      notes, unavailable,
    });
  },
};

// Resolve evaluate_site/compare_sites input to a point. Coordinates are used
// as given; a market name is resolved to that market's published centroid by
// deps.resolveLocation (and the response says so).
async function resolvePoint(deps, { lat, lon, location }) {
  if (coordsOk(lat, lon)) return { ok: true, lat, lon, resolved_from: null };
  const p = parseLatLon(location);
  if (p) return { ok: true, ...p, resolved_from: null };
  if (!_str(location)) return { ok: false, reason: 'lat and lon, or location, are required' };
  let r = null;
  try { r = await deps.resolveLocation(String(location)); } catch (e) { r = { ok: false }; }
  if (!r || !r.ok) return { ok: false, reason: `location "${String(location).slice(0, 80)}" did not resolve to a known market; pass lat and lon` };
  return {
    ok: true, lat: r.lat, lon: r.lon, state: r.state || null,
    resolved_from: {
      location: String(location), market_slug: r.market_slug ?? null, market_name: r.market_name ?? null,
      resolved_lat: r.lat, resolved_lon: r.lon,
      note: 'Market-level read at the published market centroid, not a specific parcel. Pass lat and lon for a parcel.',
    },
  };
}

const SITE_HEADLINE_SPEC = {
  verdict: 'verdict', composite_score: 'composite_score', confidence: 'confidence',
  coverage_ratio: 'coverage_ratio', coverage: 'coverage',
};
const SITE_FIGURES = ['composite_score', 'sub_scores', 'weights_over_validated'];

// The composite read for one point: full, preview, or (keyless) headline.
async function siteRead(deps, pt, state) {
  let sec = await call(deps, 'get_composite_site_score', { lat: pt.lat, lon: pt.lon, state: state || pt.state || undefined });
  let raw = sec.status === 'ok' ? sec.data : null;
  let level = null;
  let limiting = raw ? limitingFactor(raw) : null;
  if (sec.status === 'withheld' && keylessHeadlineEnabled()) {
    let h = null;
    try { h = await deps.siteHeadline({ lat: pt.lat, lon: pt.lon, state: state || pt.state || '' }); } catch (_) { h = null; }
    if (h && !h.ok && h.error === 'rate_limited') {
      sec.status = 'rate_limited';
      sec.reason = 'headline_rate_limited';
    } else if (h && h.ok && _isObj(h.payload)) {
      const hs = toSection('get_composite_site_score', { content: [{ type: 'text', text: JSON.stringify(h.payload) }] });
      hs.status = 'preview';
      hs.reason = 'headline_only';
      hs.withheld_fields = [...new Set([...hs.withheld_fields, ...SITE_FIGURES])].sort();
      sec = hs;
      raw = hs.data;
      limiting = h.limiting_factor || null;
      level = 'headline';
    }
  } else if (sec.status === 'preview') {
    sec.withheld_fields = [...new Set([...sec.withheld_fields, ...SITE_FIGURES])].sort();
    level = 'headline';
  }
  const withheld = level === 'headline' ? SITE_FIGURES : sec.withheld_fields;
  const hl = headlineFrom(raw, SITE_HEADLINE_SPEC, withheld);
  if (level === 'headline') { hl.headline.composite_score = null; hl.headline_status.composite_score = 'withheld'; }
  hl.headline.limiting_factor = limiting;
  hl.headline_status.limiting_factor = limiting ? 'provided' : (sec.status === 'withheld' ? 'withheld' : 'not_provided');
  const unavailable = raw ? _coverageUnavailable(raw.coverage) : [];
  return { sec, hl, level, unavailable };
}

// 3. evaluate_site
const INCLUDE_SITE = {
  water: (p, a) => ['get_water_risk', { lat: p.lat, lon: p.lon, state: a.state || p.state }],
  hazard: (p) => ['get_disaster_risk', { lat: p.lat, lon: p.lon }],
  climate: (p) => ['get_climate_intel', { lat: p.lat, lon: p.lon }],
  fiber: (p) => ['get_fiber_readiness', { lat: p.lat, lon: p.lon }],
  tax: (p, a) => ((a.state || p.state) ? ['get_tax_incentives', { state: a.state || p.state }] : null),
  raw: (p, a) => ['analyze_site', { lat: p.lat, lon: p.lon, state: a.state || p.state, capacity_mw: a.capacity_mw }],
};

const evaluateSite = {
  name: 'evaluate_site',
  title: 'Evaluate one site',
  description: 'Use when the user has one candidate location and asks whether it suits a data center, for example '
    + '"is 39.04,-77.48 good for 100 MW?". Pass lat and lon, or location as "lat,lon" or a market name (a market '
    + 'is read at its published centroid and the response says so). Returns a BUILD, CAUTION or AVOID verdict, a '
    + '0-100 composite over validated factors only, the limiting factor, and a coverage map of which factors were '
    + 'measured; unmeasured factors are listed in unavailable and never estimated. include adds factor sections: '
    + 'water, hazard, climate, fiber, tax, raw. At some access levels only the verdict, coverage and limiting factor '
    + 'are returned and scores are null. For 2 to 4 locations use compare_sites; for a whole market use market_snapshot.',
  schema: {
    lat: LAT(), lon: LON(),
    location: zS('Alternative to lat/lon: "lat,lon" or a market name or slug, for example "39.04,-77.48" or "phoenix"'),
    state: zS('Two-letter US state, improves water and tax lookups, for example VA'),
    capacity_mw: zN('Target load in megawatts, echoed and passed to the raw section'),
    include: z.array(z.enum(['water', 'hazard', 'climate', 'fiber', 'tax', 'raw'])).max(6).optional()
      .describe('Optional factor sections to add'),
  },
  async run(a, deps) {
    const query = clean({ lat: a.lat, lon: a.lon, location: a.location, state: a.state, capacity_mw: a.capacity_mw, include: a.include });
    const pt = await resolvePoint(deps, a);
    if (!pt.ok) return inputError('evaluate_site', pt.reason, query);
    const extras = [...new Set(a.include || [])];
    const [site, ...extraSecs] = await Promise.all([
      siteRead(deps, pt, a.state),
      ...extras.map(async (k) => {
        const spec = INCLUDE_SITE[k](pt, a);
        if (!spec) return { key: k, missing: 'state is required for the tax section' };
        return { key: k, sec: await call(deps, spec[0], spec[1]) };
      }),
    ]);
    const unavailable = [...site.unavailable];
    const sections = [site.sec];
    for (const x of extraSecs) {
      if (x.missing) unavailable.push(unavailableNote(x.key, 'not_requested_upstream', x.missing));
      else sections.push(x.sec);
    }
    const notes = [];
    if (pt.resolved_from) notes.push(pt.resolved_from.note);
    if (site.level === 'headline') notes.push('Headline only: verdict, coverage and limiting factor are shown; the composite and factor scores are withheld at this access level.');
    return buildEnvelope('evaluate_site', { ...query, resolved_from: pt.resolved_from }, sections, {
      headline: site.hl.headline, headline_status: site.hl.headline_status,
      unavailable, notes, access_level: site.level || undefined,
    });
  },
};

// 4. compare_sites
const compareSites = {
  name: 'compare_sites',
  title: 'Compare 2 to 4 sites or markets',
  description: 'Use when the user wants a side-by-side of 2 to 4 candidates, either coordinates or named markets, '
    + 'for example "39.04,-77.48 vs 33.45,-112.07 for 50 MW" or "Dallas vs Columbus". Pass locations as a list of '
    + '"lat,lon" strings or market names. Coordinates return the same composite read for each site (verdict, '
    + 'coverage, limiting factor, and scores where available) and the winner with its rationale when the source '
    + 'provides one. Market names return each market scorecard (DCPI verdict and bands); no winner is computed for '
    + 'markets. capacity_mw is echoed and does not change scores. For one site use evaluate_site; to rank many '
    + 'markets use rank_markets.',
  schema: {
    locations: z.array(z.string().min(1).max(120)).min(2).max(4)
      .describe('2 to 4 candidates, each "lat,lon" or a market name, for example ["39.04,-77.48", "33.45,-112.07"]'),
    capacity_mw: zN('Target load in megawatts, echoed per candidate'),
  },
  async run(a, deps) {
    const query = clean({ locations: a.locations, capacity_mw: a.capacity_mw });
    const pts = a.locations.map((l) => parseLatLon(l));
    if (pts.every((p) => !p)) {
      // Markets: one scorecard per market, side by side.
      const secs = await Promise.all(a.locations.map((m) => call(deps, 'get_market_dcpi_rank', { market_slug: coreSlug(m) })));
      const matrix = secs.map((s, i) => ({ candidate: a.locations[i], ...headlineFrom(s.data, MARKET_HEADLINE_SPEC, s.withheld_fields).headline }));
      return buildEnvelope('compare_sites', query, secs, {
        headline: { mode: 'markets', winner: null, matrix },
        headline_status: { mode: 'provided', winner: 'not_computed_for_markets', matrix: 'provided' },
        notes: ['No winner is computed for a market comparison; compare the verdicts and bands.'],
      });
    }
    // Coordinates (market names mixed in are resolved to centroids).
    const resolved = await Promise.all(a.locations.map((l, i) => (pts[i] ? { ok: true, ...pts[i], resolved_from: null } : resolvePoint(deps, { location: l }))));
    const bad = resolved.findIndex((r) => !r.ok);
    if (bad >= 0) return inputError('compare_sites', resolved[bad].reason, query);
    const locs = resolved.map((r) => `${r.lat},${r.lon}`).join(';');
    const sec = await call(deps, 'compare_sites', { locations: locs, capacity_mw: a.capacity_mw });
    const notes = resolved.filter((r) => r.resolved_from).map((r) => `${r.resolved_from.location}: ${r.resolved_from.note}`);
    if (sec.status === 'ok' || sec.status === 'preview') {
      const d = _isObj(sec.data) ? sec.data : {};
      const hl = headlineFrom(d, { winner: 'winner', decision_rationale: 'decision_rationale' }, sec.status === 'preview' ? ['winner', 'decision_rationale'] : sec.withheld_fields);
      return buildEnvelope('compare_sites', query, [sec], {
        headline: { mode: 'coordinates', ...hl.headline }, headline_status: { mode: 'provided', ...hl.headline_status },
        notes, access_level: sec.status === 'preview' ? 'headline' : undefined,
      });
    }
    if (sec.status === 'withheld' && keylessHeadlineEnabled()) {
      const reads = await Promise.all(resolved.map((r) => siteRead(deps, r, r.state)));
      const matrix = reads.map((r, i) => ({ candidate: a.locations[i], ...r.hl.headline }));
      const unavailable = reads.flatMap((r, i) => r.unavailable.map((u) => ({ ...u, factor: `${a.locations[i]}: ${u.factor}` })));
      notes.push('Headline only: each site shows verdict, coverage and limiting factor; scores and the winner are withheld at this access level.');
      return buildEnvelope('compare_sites', query, reads.map((r) => r.sec), {
        headline: { mode: 'coordinates', winner: null, matrix },
        headline_status: { mode: 'provided', winner: 'withheld', matrix: 'provided' },
        unavailable, notes, access_level: 'headline',
      });
    }
    return buildEnvelope('compare_sites', query, [sec], { headline: { mode: 'coordinates', winner: null }, headline_status: { mode: 'provided', winner: sec.status === 'withheld' ? 'withheld' : 'not_provided' }, notes });
  },
};

// 5. market_snapshot
const MARKET_HEADLINE_SPEC = {
  market_name: 'market_name', market_slug: 'market_slug', verdict: ['verdict', 'composite_score_band'],
  composite_score: 'composite_score', composite_score_band: 'composite_score_band',
  excess_power_score: 'excess_power_score', excess_power_score_band: 'excess_power_score_band',
  constraint_score: 'constraint_score', constraint_score_band: 'constraint_score_band',
  time_to_power_months: ['time_to_power_months', 'avg_time_to_power_months', 'ttp_months'],
  iso: 'iso', data_basis: 'data_basis', computed_at: 'computed_at',
};

const marketSnapshot = {
  name: 'market_snapshot',
  title: 'Snapshot of one market',
  description: 'Use when the user asks about one data-center market or metro, for example "how is Northern Virginia '
    + 'looking?" or "Phoenix power verdict". Pass market as a name or slug. detail scorecard (default) returns the '
    + 'DCPI verdict with excess-power and constraint scores and bands, time to power, and whether inputs are live or '
    + 'modeled (data_basis). detail brief adds a short market briefing (power, pipeline, operators, deals, news); '
    + 'detail full also adds market intelligence metrics. To rank several markets use rank_markets.',
  schema: {
    market: z.string().min(2).max(120).describe('Market name or slug, for example "phoenix" or "northern-virginia"'),
    detail: z.enum(['scorecard', 'brief', 'full']).optional().describe('scorecard (default), brief or full'),
  },
  async run(a, deps) {
    const detail = a.detail || 'scorecard';
    const slug = coreSlug(a.market);
    const query = { market: a.market, market_slug: slug, detail };
    const jobs = [call(deps, 'get_market_dcpi_rank', { market_slug: slug })];
    if (detail !== 'scorecard') jobs.push(call(deps, 'get_market_context', { market: slug }));
    if (detail === 'full') jobs.push(call(deps, 'get_market_intel', { market: a.market }));
    const secs = await Promise.all(jobs);
    const hl = headlineFrom(secs[0].data, MARKET_HEADLINE_SPEC, secs[0].withheld_fields);
    return buildEnvelope('market_snapshot', query, secs, hl);
  },
};

// 6. rank_markets
const rankMarkets = {
  name: 'rank_markets',
  title: 'Rank markets by one criterion',
  description: 'Use when the user wants a ranked list of markets by one criterion, for example "10 US markets that '
    + 'suit a 200 MW AI campus" or "markets with low power prices and at least 100 MW installed". criteria selects '
    + 'the sort: ai_ready (buildability for new load, the default), ai_capacity (AI compute capacity index), or a '
    + 'sort by power price, installed capacity, operator count, growth or overall score (see the criteria values). '
    + 'Optional region, limit and min_capacity_mw. Returns rank, '
    + 'market, the sort value, signal_tier (how much rests on live versus modeled inputs) and per-row as_of where the '
    + 'source provides it. Pass a market slug to market_snapshot for detail.',
  schema: {
    criteria: z.enum(['ai_ready', 'ai_capacity', 'cheapest_power', 'most_capacity', 'most_operators', 'fastest_growing', 'best_overall'])
      .optional().describe('Sort criterion; default ai_ready. The other values sort by power price, installed capacity, operator count, growth or overall score'),
    region: zS('Region filter, for example us, TX or europe'),
    limit: z.number().int().min(1).max(50).optional().describe('Number of markets, for example 10'),
    min_capacity_mw: zN('Minimum installed capacity in MW'),
  },
  async run(a, deps) {
    const criteria = a.criteria || 'ai_ready';
    const query = clean({ criteria, region: a.region, limit: a.limit, min_capacity_mw: a.min_capacity_mw });
    const notes = [];
    let sec;
    if (criteria === 'ai_capacity') {
      sec = await call(deps, 'ai_capacity_index', { limit: a.limit });
      if (a.region || a.min_capacity_mw != null) notes.push('region and min_capacity_mw do not apply to ai_capacity and were not used.');
    } else {
      sec = await call(deps, 'rank_markets', { criteria, region: a.region, limit: a.limit, min_capacity_mw: a.min_capacity_mw });
    }
    const d = _isObj(sec.data) ? sec.data : {};
    const rows = firstArray(d, ['results', 'markets', 'rankings', 'rows']);
    const top = rows && rows.length && _isObj(rows[0]) ? (rows[0].market_slug || rows[0].slug || rows[0].market || rows[0].market_name || null) : null;
    return buildEnvelope('rank_markets', query, [sec], { ...plainHeadline({ markets_shown: rows ? rows.length : null, first_ranked: top }), notes });
  },
};

// 7. grid_power
const GRID_HEADLINE_SPEC = {
  iso: 'iso', demand_mw: 'demand_mw', excess_power_score: 'excess_power_score', constraint_score: 'constraint_score',
  avg_time_to_power_months: 'avg_time_to_power_months', queue_depth_gw: 'queue_depth_gw',
  reserve_margin_pct: 'reserve_margin_pct', retail_price_cents_kwh: 'retail_price_cents_kwh',
};
const gridPower = {
  name: 'grid_power',
  title: 'Grid power availability and cost',
  description: 'Use for questions about electric power availability or cost, for example "how much headroom does PJM '
    + 'have?", "time to power for 200 MW in ERCOT", "what is in the interconnection queue?" or "when does new '
    + 'generation land in Ohio?". Pass iso (one, or a comma list such as "PJM,ERCOT" to compare), market (resolved to '
    + 'its grid operator) or state (year-by-year supply timeline). Returns demand, fuel mix, excess-power and '
    + 'constraint scores, time to power and queue depth, each with as_of and source. include adds telemetry, prices, '
    + 'queue or timeline sections. Fuel mix typically lags demand by about a day.',
  schema: {
    iso: zS('Grid operator, or a comma list to compare, for example "PJM" or "PJM,ERCOT,CAISO"'),
    market: zS('Market name, resolved to its grid operator, for example "dallas"'),
    state: zS('Two-letter US state for the supply timeline, for example OH'),
    capacity_mw: zN('Load in MW for the timeline section'),
    include: z.array(z.enum(['telemetry', 'prices', 'queue', 'timeline'])).max(4).optional().describe('Optional sections to add'),
  },
  async run(a, deps) {
    const isos = String(a.iso || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const query = clean({ iso: a.iso, market: a.market, state: a.state, capacity_mw: a.capacity_mw, include: a.include });
    if (!isos.length && !a.market && !a.state) return inputError('grid_power', 'Pass iso, market or state.', query);
    const jobs = [];
    let primary = null;
    if (isos.length >= 2) { primary = 'compare'; jobs.push(call(deps, 'compare_isos', { isos: isos.join(',') })); }
    else if (isos.length === 1 || a.market) { primary = 'grid'; jobs.push(call(deps, 'get_grid_intelligence', { iso: isos[0], market: a.market })); }
    else { primary = 'timeline'; jobs.push(call(deps, 'get_power_availability_timeline', { state: a.state, mw: a.capacity_mw })); }
    const unavailable = [];
    for (const k of new Set(a.include || [])) {
      if (k === 'telemetry') { if (isos.length === 1) jobs.push(call(deps, 'get_grid_data', { iso: isos[0] })); else unavailable.push(unavailableNote('telemetry', 'not_requested_upstream', 'needs exactly one iso')); }
      if (k === 'prices') jobs.push(call(deps, 'get_energy_prices', { iso: isos.length === 1 ? isos[0] : undefined, state: a.state }));
      if (k === 'queue') { if (isos.length === 1) jobs.push(call(deps, 'get_interconnection_queue', { iso: isos[0] })); else unavailable.push(unavailableNote('queue', 'not_requested_upstream', 'needs exactly one iso')); }
      if (k === 'timeline' && primary !== 'timeline') { if (a.state) jobs.push(call(deps, 'get_power_availability_timeline', { state: a.state, mw: a.capacity_mw })); else unavailable.push(unavailableNote('timeline', 'not_requested_upstream', 'needs state')); }
    }
    const secs = await Promise.all(jobs);
    let hl;
    if (primary === 'grid') hl = headlineFrom(secs[0].data, GRID_HEADLINE_SPEC, secs[0].withheld_fields);
    else if (primary === 'compare') {
      const cmp = _isObj(secs[0].data) && _isObj(secs[0].data.comparison) ? secs[0].data.comparison : {};
      hl = plainHeadline({ isos_compared: isos, isos_returned: Object.keys(cmp).length ? Object.keys(cmp) : null });
    } else {
      hl = plainHeadline({ state: a.state || null });
    }
    return buildEnvelope('grid_power', query, secs, { ...hl, unavailable });
  },
};

// 8. fiber_connectivity
const fiberConnectivity = {
  name: 'fiber_connectivity',
  title: 'Fiber and peering connectivity',
  description: 'Use when the user asks how well connected a site or metro is, for example "is this parcel '
    + 'fiber-ready?", "how many carriers can serve it?" or "internet exchanges near Ashburn". Pass lat and lon for a '
    + 'point read (near-net distance bucket, nearest carrier distance, carrier data coverage) or market for the metro '
    + 'profile (carriers and dark-fiber availability zones). include peering adds nearby exchange and network '
    + 'density for a point. If carrier_data_coverage is none_in_region, nothing was measured there; that is not the '
    + 'same as no fiber.',
  schema: {
    lat: LAT(), lon: LON(),
    market: zS('Market name for the metro profile, for example "Dallas-Fort Worth"'),
    radius_km: zN('Search radius for the point read in km, for example 50'),
    include: z.array(z.enum(['peering'])).max(1).optional().describe('Optional sections to add'),
  },
  async run(a, deps) {
    const query = clean({ lat: a.lat, lon: a.lon, market: a.market, radius_km: a.radius_km, include: a.include });
    const point = coordsOk(a.lat, a.lon);
    if (!point && !a.market) return inputError('fiber_connectivity', 'Pass lat and lon, or market.', query);
    const jobs = [];
    if (point) jobs.push(call(deps, 'get_fiber_readiness', { lat: a.lat, lon: a.lon, radius_km: a.radius_km }));
    if (a.market) jobs.push(call(deps, 'get_metro_fiber', { market: a.market }));
    const unavailable = [];
    if ((a.include || []).includes('peering')) {
      if (point) jobs.push(call(deps, 'get_peering_intel', { lat: a.lat, lon: a.lon }));
      else unavailable.push(unavailableNote('peering', 'not_requested_upstream', 'needs lat and lon'));
    }
    const secs = await Promise.all(jobs);
    const parts = [];
    for (const s of secs) {
      if (s.derived_from === 'get_fiber_readiness') parts.push(headlineFrom(s.data, { near_net_bucket: 'near_net_bucket', nearest_carrier_km: 'nearest_carrier_km', carrier_data_coverage: 'carrier_data_coverage' }, s.withheld_fields));
      if (s.derived_from === 'get_metro_fiber') parts.push(headlineFrom(s.data, { market: 'market', dark_fiber_level: 'dark_availability_zones.level' }, s.withheld_fields));
      if (s.derived_from === 'get_peering_intel') parts.push(headlineFrom(s.data, { peering_level: 'connectivity.level', peering_score_band: 'connectivity.score_band', facilities_nearby: 'connectivity.facilities_nearby' }, s.withheld_fields));
    }
    return buildEnvelope('fiber_connectivity', query, secs, { ...mergeHeadlines(...parts), unavailable });
  },
};

// 9. facility_lookup
const facilityLookup = {
  name: 'facility_lookup',
  title: 'Find or profile data-center facilities',
  description: 'Use to find or profile existing data-center facilities, for example "who operates this facility and '
    + 'how big is it?" or "data centers in Arizona over 50 MW". Pass id (or an exact name) for one record, or filters '
    + '(query, country, state, city, operator, min_capacity_mw) for a list. Records carry name, operator, location, '
    + 'capacity where disclosed, status and verification details. Facility data combines open map data, peering '
    + 'records and operator disclosures; see license. Deals and construction pipeline are not covered by this profile.',
  schema: {
    id: zS('Facility id or slug from a previous result'),
    name: zS('Exact facility name, used when no id is known'),
    query: zS('Free-text search, for example "Ashburn"'),
    country: zS('Country code, for example US'),
    state: zS('State or province code, for example AZ'),
    city: zS('City name'),
    operator: zS('Operator name'),
    min_capacity_mw: zN('Minimum capacity in MW'),
    limit: z.number().int().min(1).max(50).optional().describe('Maximum records in a list, for example 10'),
  },
  async run(a, deps) {
    const query = clean(a);
    const listFilters = clean({ query: a.query, country: a.country, state: a.state, city: a.city, operator: a.operator, min_capacity_mw: a.min_capacity_mw });
    if ((a.id || a.name) && !Object.keys(listFilters).length) {
      const sec = await call(deps, 'get_facility', a.id ? { facility_id: a.id } : { name: a.name });
      const hl = headlineFrom(sec.data, { name: 'data.name', operator: ['data.operator', 'data.provider'], status: 'data.status', city: 'data.city', state: 'data.state', country: 'data.country' }, sec.withheld_fields);
      return buildEnvelope('facility_lookup', query, [sec], hl);
    }
    if (!Object.keys(listFilters).length && !a.id && !a.name) return inputError('facility_lookup', 'Pass id or name, or at least one filter.', query);
    const sec = await call(deps, 'search_facilities', { ...listFilters, query: a.query || a.name, limit: a.limit });
    const d = _isObj(sec.data) ? sec.data : {};
    const rows = firstArray(d, ['data', 'facilities', 'results']);
    return buildEnvelope('facility_lookup', query, [sec], plainHeadline({
      records_shown: rows ? rows.length : null,
      total_matching: typeof d.total_matching === 'number' ? d.total_matching : null,
    }));
  },
};

// 10. get_evidence
const getEvidence = {
  name: 'get_evidence',
  title: 'Citation and data freshness',
  description: 'Use before quoting a DC Hub figure, or when the user asks where a number comes from or how current it '
    + 'is. Pass subject (what is being cited, for example "Phoenix DCPI verdict CAUTION"), and optionally layer, as_of '
    + 'and source_url from an earlier result. Returns a citation line, the license for that data layer, and current '
    + 'health and last-update time for each data feed. Pass since (ISO date) to also list records that changed after '
    + 'that time. It does not look up new figures.',
  schema: {
    subject: zS('What is being cited, for example "Phoenix DCPI verdict CAUTION"'),
    layer: zS('Data layer of the figure, for example dcpi, grid, fiber, facilities'),
    as_of: zS('The as_of value from the result being cited'),
    source_url: zS('A source link from the result being cited, if any'),
    since: zS('ISO date or time; lists changes after it, for example 2026-09-01'),
  },
  async run(a, deps) {
    const query = clean(a);
    const jobs = [call(deps, 'get_backup_status', {})];
    if (a.subject) jobs.unshift(call(deps, 'summarize_for_citation', { subject: a.subject, layer: a.layer, as_of: a.as_of, url: a.source_url }));
    if (a.since) jobs.push(call(deps, 'get_changes', { since: a.since }));
    const secs = await Promise.all(jobs);
    const cite = secs.find((s) => s.derived_from === 'summarize_for_citation');
    const feeds = secs.find((s) => s.derived_from === 'get_backup_status');
    const parts = [];
    if (cite) parts.push(headlineFrom(cite.data, { citation_text: 'citation_text', cite_as: 'cite_as', layer: 'layer', license_basis: 'license_basis' }, cite.withheld_fields));
    else parts.push(plainHeadline({ citation_text: null }));
    parts.push(headlineFrom(feeds && feeds.data, { feed_health: 'summary.overall_health', feeds_healthy: 'summary.healthy', feeds_stale: 'summary.stale' }, []));
    const hl = mergeHeadlines(...parts);
    if (cite && cite.license) { hl.headline.license = cite.license; hl.headline_status.license = 'provided'; }
    const notes = [];
    if (!a.subject) notes.push('No subject was given, so no citation line was built; feed health is shown.');
    return buildEnvelope('get_evidence', query, secs, { ...hl, notes });
  },
};

export const CORE_TOOLS = Object.freeze([
  planAndAnswer, findSites, evaluateSite, compareSites, marketSnapshot,
  rankMarkets, gridPower, fiberConnectivity, facilityLookup, getEvidence,
]);

// Builds the core MCP server. deps:
//   delegate(name, args) -> canonical tool result (server.mjs enforces CORE_DELEGATES)
//   siteHeadline({lat, lon, state}) -> {ok, payload, limiting_factor} | {ok:false}
//   resolveLocation(text) -> {ok, lat, lon, state, market_slug, market_name} | {ok:false}
export function createCoreServer(McpServer, deps, { version = '0.0.0' } = {}) {
  const srv = new McpServer(
    { name: CORE_SERVER_NAME, version: String(version) },
    { capabilities: { tools: {} }, instructions: CORE_INSTRUCTIONS },
  );
  for (const t of CORE_TOOLS) {
    srv.registerTool(t.name, {
      title: t.title,
      description: t.description,
      inputSchema: t.schema,
      annotations: { title: t.title, ...CORE_ANNOTATIONS },
    }, async (args) => {
      try {
        const env = await t.run(args || {}, deps);
        if (env && Array.isArray(env.content)) return env;   // inputError already shaped
        return toToolResult(env);
      } catch (e) {
        return toToolResult({ tool: t.name, error: 'internal_error', message: scrubText(String((e && e.message) || e)).slice(0, 240) || 'error', as_of: null, sources: [], headline: {}, unavailable: [], conventions: CORE_CONVENTIONS }, true);
      }
    });
  }
  return srv;
}
