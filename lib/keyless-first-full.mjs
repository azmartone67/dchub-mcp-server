// keyless-first-full.mjs -- one full answer per day on the core energy tools before any wall
// (owner-approved 2026-11-14, Grok to Brain).
//
// WHY. /api/v1/mcp/funnel, 7 days to 2026-11-14: the most-walled tools were get_interconnection_queue
// (80 walled calls, 25 identities), get_grid_intelligence (78, 24), get_grid_data (41, 28) and
// execute_plan (17, 2). Keyless full answers over 14 days went mostly to get_market_dcpi_rank. None of
// 640 mature trial keys came back in a later week, and new agents are the bottleneck. A keyless agent's
// first call on the energy questions met a preview, so it left with nothing it could cite.
//
// WHAT. A keyless caller's FIRST call per UTC day to each tool in KEYLESS_FIRST_FULL_TOOLS is served
// the answer an email-bound free key gets, dated and cited, instead of a preview or a wall. After that
// first call the caller is on today's path with today's per-IP caps, unchanged. Nothing is served above
// email-key depth: the dispatch promotes the call to the email-bound free key's gate, and the masks that
// gate's answer passes through below it (facility fields, DCPI sub-scores, broker rates) stay in place.
//
// execute_plan's steps (owner 2026-11-15, Grok note G): every step of a plan served as its caller's first
// full answer runs at FULL depth (KEYLESS_FIRST_FULL_STEP_TIER), decision layer included, not at email-key
// depth: Grok's re-test on 2.12.57 got 3 of 4 steps at preview and a 110-character answer. The step's gate,
// masks and the backend's caller-tier header read that tier; its telemetry row keeps the caller's own.
// The direct calls above stay at email-key depth.
//
// execute_plan: the plan's one charge covers its steps. The plan hands each loopback step a single-use,
// in-process token (KEYLESS_FIRST_FULL_PLAN_HEADER, same shape as lib/plan-caller-ip.mjs), and a step
// holding it takes the same email-key gate without charging a bucket of its own. A step never charges
// the per-tool lane itself (ctx.loopback_step), so a plan does not spend the caller's direct calls.
// Its answer leads with a direct sentence and its as_of date and stays near FIRST_PLAN_BUDGET_BYTES
// (compactFirstPlan), with a pointer to the full rows.
//
// Who (keylessFirstFullSeat), the same caller rules as the keyless trial (lib/keyless-full-trial.mjs):
// keyless only; /mcp, /mcp/claude and /mcp/core, never /mcp/chatgpt (frozen in OpenAI review); not a
// bot or one of our own callers; a QA caller sees it only with the test-only ctx override and is then
// charged and tagged nothing; a usable, non-loopback caller IP (the counter is per IP).
//
// Switches (read per call):
//   DCHUB_KEYLESS_FIRST_FULL       ON unless 0/false/no/off. Off = today's path, byte for byte.
//   DCHUB_KEYLESS_FIRST_FULL_CAP   full answers per tool per caller IP per UTC day, default 1, 0 = none.
import { randomUUID } from 'node:crypto';
import { keylessCallerSeat } from './keyless-full-trial.mjs';
import { compactAnswerGuide } from './compact-guide.mjs';

export const KEYLESS_FIRST_FULL_TOOLS = Object.freeze([
  'execute_plan', 'get_grid_intelligence', 'get_interconnection_queue', 'get_grid_data', 'get_energy_prices',
]);
export const KEYLESS_FIRST_FULL_CAP_DEFAULT = 1;
const _CAP_MAX = 1000;   // routes/mcp_full_cap.py accepts caps 0-1000
// mcp_call_log.status / mcp_tool_calls.gate_status of a charged first full answer (the funnel reads it).
export const KEYLESS_FIRST_FULL_STATUS = 'keyless_first_full_answer';
// Counter identity prefix (mcp_full_answer_counts.identity): its own buckets, apart from the trial's 'kft:'.
export const KEYLESS_FIRST_FULL_ID_PREFIX = 'kff:';
export const KEYLESS_FIRST_FULL_PLAN_HEADER = 'x-dchub-plan-first-full';
// The tier a first-full plan's step is served at (server.mjs trackedTool, _callerTierFor).
export const KEYLESS_FIRST_FULL_STEP_TIER = 'pro';
// The plan answer's size target, per copy (structuredContent and block 0).
export const FIRST_PLAN_BUDGET_BYTES = 12_500;   // the outer citation stamps add ~1.5 KB; the target is ~15 KB delivered

export function keylessFirstFullOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_KEYLESS_FIRST_FULL) || '').trim());
}

export function keylessFirstFullCap(env = process.env) {
  const raw = String((env && env.DCHUB_KEYLESS_FIRST_FULL_CAP) || '').trim();
  if (!raw) return KEYLESS_FIRST_FULL_CAP_DEFAULT;
  const v = parseInt(raw, 10);
  if (!Number.isFinite(v)) return KEYLESS_FIRST_FULL_CAP_DEFAULT;
  return Math.min(_CAP_MAX, Math.max(0, v));
}

// 'charge' = serve the email key's answer and charge (IP, tool, day); 'observe' = a QA caller with the
// test-only override: serve it, charge and tag nothing; null = today's path.
// deps: { env, directoryProfile, allowedProfiles: [..], isQa(c), isBot(c) }.
export function keylessFirstFullSeat(name, c, deps = {}) {
  const env = deps.env || process.env;
  if (!keylessFirstFullOn(env)) return null;
  if (!KEYLESS_FIRST_FULL_TOOLS.includes(String(name || ''))) return null;
  if (!(keylessFirstFullCap(env) > 0)) return null;
  if (!c || typeof c !== 'object' || c.api_key) return null;
  // A plan step is covered by its plan's charge (planStepSeat), never by a bucket of its own.
  if (c.loopback_step === true) return null;
  return keylessCallerSeat(c, deps);
}

// A loopback step of a plan that was served as its caller's first full answer. Land & Power tools keep
// their own lanes (the daily site run, the siting seat), so they are not promoted here.
export function planStepSeat(name, c, deps = {}) {
  const env = deps.env || process.env;
  if (!keylessFirstFullOn(env)) return null;
  if (!c || typeof c !== 'object' || c.api_key) return null;
  if (c.loopback_step !== true || c.plan_first_full !== true) return null;
  if (deps.lpTools && deps.lpTools.has(String(name || ''))) return null;
  return 'step';
}

// ── the plan's step token (single-use, in-process; same shape as lib/plan-caller-ip.mjs) ─────────
const TTL_MS = 120_000;
const MAX_TOKENS = 5000;
const _tokens = new Map();   // token -> exp
const _arms = new Map();     // token -> the plan's depth-test arm (M2.2, lib/first-plan-depth-test.mjs), when it has one

export function mintPlanFirstFullToken(now = Date.now(), arm = null) {
  if (_tokens.size > MAX_TOKENS) {
    for (const [t, exp] of _tokens) if (exp < now) { _tokens.delete(t); _arms.delete(t); }
  }
  const tok = randomUUID() + randomUUID();
  _tokens.set(tok, now + TTL_MS);
  if (arm) _arms.set(tok, arm);
  return tok;
}

// The depth-test arm a live token was minted with, or null. Read before consumePlanFirstFullToken.
export function planFirstFullTokenArm(tok) {
  return (typeof tok === 'string' && _arms.get(tok)) || null;
}

// true once for a live token minted here; a missing, expired, reused or foreign token is false.
export function consumePlanFirstFullToken(tok, now = Date.now()) {
  if (typeof tok !== 'string' || !tok) return false;
  const exp = _tokens.get(tok);
  if (exp === undefined) return false;
  _tokens.delete(tok);
  _arms.delete(tok);
  return exp >= now;
}

// ── did the plan answer anything? (Grok note K, items 2 and 3, 2026-11-15) ───────────────────────
// Claude saw "used 1 of 1" on a plan that ran no step: the seat was charged before the plan ran, and a
// plan whose every step was skipped spent the caller's one full answer of the day on nothing. A plan
// consumes the seat only when at least one DATA step came back executed with a result. The tool
// navigator (discover_tools) and the planner itself answer no question, so they do not count.
const _NOT_DATA_STEPS = new Set(['discover_tools', 'plan_query', 'execute_plan']);
export function planDataStepsRan(executed) {
  return (Array.isArray(executed) ? executed : []).filter((e) => e && e.status === 'executed'
    && e.result !== undefined && e.result !== null && !_NOT_DATA_STEPS.has(String(e.tool || ''))).length;
}

// Grok daily note 2026-11-20 (4th report, "the keyless full-depth plan is not served at the UTC reset"): a plan
// served as its caller's first full answer promotes its steps, but a step can still come back held back: at
// preview depth (its gate or the relay cut it) or carrying the data API's own keyless stub (`gated: true`,
// the shape #1581 found on get_grid_data). Which data steps came back at full depth, and which did not.
// `fullOf(e)` (optional) returns the step's unslimmed result. Pure.
export function planStepDepths(executed, fullOf = null) {
  const full = [];
  const held = [];
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || !e.tool || _NOT_DATA_STEPS.has(String(e.tool))) continue;
    if (e.status === 'gated_preview') { held.push(e.tool); continue; }
    if (e.status !== 'executed' || e.result === undefined || e.result === null) continue;
    let r = null;
    try { r = typeof fullOf === 'function' ? fullOf(e) : null; } catch (_e) { r = null; }
    if (r === undefined || r === null) r = e.result;
    const stub = (_isObj(r) && r.gated === true) || (_isObj(e.result) && e.result.gated === true);
    if (e.depth === 'preview' || stub) held.push(e.tool); else full.push(e.tool);
  }
  return { full, held };
}

// "HH:MM UTC" of an epoch-ms instant, or null.
export function utcClock(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(11, 16) + ' UTC';
}

// The calls an agent can make by hand for the steps that did not return data: the step's own arguments
// when it had concrete ones (failed, timed out, not run), or its planned arguments with `fill` naming the
// one value no earlier step produced (skipped_unresolved). `extra` (concrete calls the server can name,
// e.g. find_sites for each named state) follows, without repeating a call already listed. `hintOf(e)`
// (optional) returns the planned args_hint of an entry that carries no arguments of its own. Pure.
export function manualNextCalls(executed, extra = [], hintOf = null) {
  const out = [];
  const seen = new Set();
  const add = (c) => {
    if (!c || !c.tool) return;
    const k = c.tool + '|' + JSON.stringify(c.args || {});
    if (seen.has(k)) return;
    seen.add(k); out.push(c);
  };
  for (const e of Array.isArray(executed) ? executed : []) {
    if (!e || !e.tool || _NOT_DATA_STEPS.has(String(e.tool))) continue;
    if (e.status === 'executed' && e.result != null) continue;
    if (e.status === 'skipped_meta' || e.status === 'not_allowed') continue;
    let hint = e.args_hint;
    if (!(hint && typeof hint === 'object') && typeof hintOf === 'function') { try { hint = hintOf(e); } catch (_e) { hint = null; } }
    const args = (e.args && typeof e.args === 'object') ? e.args : ((hint && typeof hint === 'object') ? hint : {});
    add({ tool: e.tool, args, status: e.status || null, ...(e.missing ? { fill: e.missing } : {}) });
  }
  for (const c of Array.isArray(extra) ? extra : []) add({ tool: c.tool, args: c.args || {} });
  return out;
}

// ── what the answer says about itself ────────────────────────────────────────────────────────────
// No plan name, no price. `emailCap` is the email allowance on this tool (0 = say nothing about it).
export function firstFullBlock(tool, cap = KEYLESS_FIRST_FULL_CAP_DEFAULT, emailCap = 0) {
  const what = tool === 'execute_plan' ? 'plan answer' : '`' + tool + '` answer';
  return {
    used: 1,
    limit: cap,
    resets: '00:00 UTC',
    basis: 'per caller network (IP) and per session, per tool, per UTC day, without a key',
    note: 'This is today’s full ' + what + ' without a key. Later ' + (tool || 'calls')
      + ' calls today return the preview'
      + (emailCap > 0 ? '; an email gets a free key with ' + emailCap + ' full answers a day on it.' : '; a free key (claim_free_key) adds more.'),
  };
}

// Grok daily note 2026-11-19, item 11: a direct answer whose payload is the data API's own keyless stub
// (`gated: true`, e.g. /api/v1/grid/intelligence/<iso> with "<gated: identified-tier or higher>" fields)
// is not a full answer, whatever gate this server applied, so it never carries firstFullBlock and its
// charge is given back. Reads JSON block 0 and structuredContent; anything unreadable is not held back.
export function resultHeldBack(result) {
  try {
    if (!_isObj(result) || result.isError === true) return false;
    if (_isObj(result.structuredContent) && result.structuredContent.gated === true) return true;
    const b0 = Array.isArray(result.content) ? result.content[0] : null;
    if (!b0 || b0.type !== 'text' || typeof b0.text !== 'string' || !b0.text.trimStart().startsWith('{')) return false;
    const p = JSON.parse(b0.text);
    return _isObj(p) && p.gated === true;
  } catch (_e) { return false; }
}

// ── the compact first plan answer ────────────────────────────────────────────────────────────────
const _NOISE = new Set([
  'identity', 'citation', 'provenance', 'quota', 'upgrade', '_upgrade', 'continuation', 'human_url',
  'for_your_human', 'user_message', 'human_message', 'agent_message', 'agent_instruction', 'next_tool',
  'next_tool_hint', 'show_to_user', 'platform', 'capacity_source', 'related_intel', 'next_ask', 'cite_as',
  '_metered_trial', 'trial_preview', 'tool', '_entity', 'ok',
]);
const _isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const _bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');

// A step's key figures: its scalar fields, one level of small scalar maps, and the first rows of its
// largest row array. Rows are never edited or reordered; `rows_shown` / `rows_total` say what was cut.
export function stepFigures(res, rowsKeep = 3) {
  if (!_isObj(res)) return res === undefined ? null : res;
  const out = {};
  let rowsKey = null;
  let rowsLen = 0;
  for (const [k, v] of Object.entries(res)) {
    if (_NOISE.has(k) || k.startsWith('_')) continue;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v === 'string') { if (v.length <= 240) out[k] = v; continue; }
    if (Array.isArray(v)) {
      if (v.length && v.every(_isObj) && v.length > rowsLen) { rowsKey = k; rowsLen = v.length; }
      else if (v.length <= 12 && v.every((x) => x === null || typeof x !== 'object')) out[k] = v;
      continue;
    }
    if (_isObj(v)) {
      const flat = Object.entries(v).filter(([, x]) => x === null || typeof x !== 'object');
      if (flat.length && flat.length <= 16) out[k] = Object.fromEntries(flat);
    }
  }
  if (rowsKey) {
    out[rowsKey] = res[rowsKey].slice(0, rowsKeep).map((r) => Object.fromEntries(
      Object.entries(r).filter(([k, x]) => !k.startsWith('_') && (x === null || typeof x !== 'object'))));
    out.rows_shown = Math.min(rowsKeep, rowsLen);
    out.rows_total = rowsLen;
    out.rows_field = rowsKey;
  }
  return out;
}

const _n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const _fmt = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });

// One sentence of what the grid read says about getting power there: queue depth, the latest capacity
// auction, demand against peak. Only figures the step returned; null when it returned none of them.
export function gridPowerSentence(g) {
  if (!_isObj(g)) return null;
  const iso = typeof g.iso === 'string' ? g.iso : 'This grid';
  const parts = [];
  const q = _n(g.queue_depth_gw);
  if (q != null) parts.push(_fmt(q) + ' GW waiting in the interconnection queue');
  const px = _n(g.capacity_auction_price_usd_mw_day);
  if (px != null) {
    parts.push('the ' + (g.capacity_auction_delivery_year ? g.capacity_auction_delivery_year + ' ' : '')
      + 'capacity auction cleared at $' + px.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '/MW-day'
      + (typeof g.capacity_auction_source === 'string' && g.capacity_auction_source.length <= 140
        ? ' (' + g.capacity_auction_source + ')' : ''));
  }
  const d = _n(g.demand_mw), pk = _n(g.peak_mw);
  if (d != null && pk != null) parts.push('demand is ' + _fmt(d) + ' MW against a 24-hour peak of ' + _fmt(pk) + ' MW');
  if (!parts.length) return null;
  return iso + ': ' + parts.join('; ') + '.';
}

// The direct sentence the answer leads with. An intent answer that could not measure the thing asked
// leads with the strongest figure it did read, and keeps its own sentence in not_established.
// grid: the plan's full get_grid_intelligence result, when it ran.
export function directAnswer(ia, fallback, grid) {
  if (!_isObj(ia)) return gridPowerSentence(grid) || fallback || null;
  const headline = typeof ia.headline === 'string' ? ia.headline : '';
  const ev = Array.isArray(ia.evidence) ? ia.evidence.filter((x) => typeof x === 'string') : [];
  const notMeasurable = _notMeasurable(headline);
  if (!notMeasurable && headline) return headline;
  const ttp = ev.find((e) => /time-to-power/i.test(e));
  const scope = ia.geography ? String(ia.geography) : '';
  const mw = Number.isFinite(ia.requested_mw) ? ia.requested_mw + ' MW in ' : '';
  if (ttp) return 'Time to power for ' + mw + (scope || 'the requested area') + ': ' + ttp;
  const gs = gridPowerSentence(grid);
  if (gs) return gs;
  if (ia.verdict && ia.verdict.value) {
    // 5.34: a site read's band (scope 'site', analyze_site) is said as the site's, never as a DCPI verdict.
    if (ia.verdict.scope === 'site') return 'Site read at ' + (ia.verdict.subject || scope || 'the site') + ': ' + ia.verdict.value
      + ' (analyze_site, site-level).' + (ev[0] ? ' ' + ev[0] : '');
    return (ia.verdict.subject || scope || 'The requested area') + ': DCPI ' + ia.verdict.value
      + (ia.verdict.scope === 'iso' ? ' (ISO-level)' : '') + '.' + (ev[0] ? ' ' + ev[0] : '');
  }
  if (ev.length) return ev[0];
  return headline || fallback || null;
}

// 5.40 (Grok round 2, gap 5): the price the question asked for (price words, a get_energy_prices step with a figure)
// and the market's DCPI verdict (a market step read one), each appended once and only when the answer does not
// already state it. Pure; returns the answer unchanged on any doubt.
const _PRICE_WORDS = /\b(?:prices?|costs?|rates?|cents|kwh|tariffs?)\b/i;
export function withPriceAndDcpi(answer, executed, full, intent) {
  try {
    if (typeof answer !== 'string' || !answer) return answer;
    let out = answer;
    const ran = (tool) => (Array.isArray(executed) ? executed : []).find((e) => e && e.tool === tool && e.status === 'executed');
    if (_PRICE_WORDS.test(String(intent || '')) && !/cents\/kWh|\$\/MWh/i.test(out)) {
      const ep = full(ran('get_energy_prices'));
      const h = _isObj(ep) && _isObj(ep.taste) && _isObj(ep.taste.headline) ? ep.taste.headline : null;
      if (h && _n(h.value) != null) {
        const st = _isObj(ep.filter) && typeof ep.filter.state === 'string' ? ep.filter.state + ' ' : '';
        const d = _firstDay(h.as_of) || _firstDay(ep.as_of);
        out = out.replace(/\s*$/, '') + ' Power price: ' + st + 'retail rate ' + h.value + ' ' + (h.unit || 'cents/kWh')
          + ' (EIA' + (h.window ? ' ' + h.window + ' average' : '') + (d ? ', as of ' + d : '') + '; not real-time LMP).';
      }
    }
    if (!/\bDCPI\b/.test(out)) {
      const rank = full(ran('get_market_dcpi_rank'));
      const intel = full(ran('get_market_intel'));
      let v = null; let name = ''; let d = null;
      if (_isObj(rank) && typeof rank.verdict === 'string') {
        v = rank.verdict;
        name = typeof rank.market_name === 'string' ? rank.market_name : '';
        d = _firstDay(rank.computed_at) || _firstDay(rank.as_of);
      }
      if (!v && _isObj(intel) && _isObj(intel.siting) && _isObj(intel.siting.dcpi) && typeof intel.siting.dcpi.verdict === 'string') {
        v = intel.siting.dcpi.verdict; d = _firstDay(intel.siting.dcpi.as_of);
        name = String((_isObj(intel.market) && intel.market.name) || '');
      }
      if (v && /^(BUILD|CAUTION|AVOID)$/i.test(v.trim())) {
        out = out.replace(/\s*$/, '') + ' ' + (name ? name + ' ' : '') + 'Data Center Power Index (DCPI) verdict: ' + v.trim().toUpperCase() + (d ? ' (as of ' + d + ')' : '') + '.';
      }
    }
    return out;
  } catch (_e) { return answer; }
}

// No headline, verdict or grid figure to lead with: say which reads ran and where their figures are.
export function stepsSentence(executed) {
  const done = (Array.isArray(executed) ? executed : []).filter((e) => e && e.tool && e.status === 'executed');
  if (!done.length) return null;
  // 5.39 (Grok cross-domain head-to-head): no answer starts "DC Hub ran".
  return done.length + ' read' + (done.length > 1 ? 's' : '') + ' ran for this question: '
    + done.map((e) => e.tool + (e.depth === 'preview' ? ' (preview)' : '')).join(', ')
    + '. Each one’s key figures are in executed[].';
}

function _notMeasurable(h) { return typeof h === 'string' && /not measurable|see the time-to-power figures below/i.test(h); }

const _firstDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// The plan answer `out` (server.mjs execute_plan) as the compact first answer: the direct answer and its
// as_of first, the intent answer, each step's key figures, and a pointer to the full rows. `fullByEntry`
// maps an executed entry to its unslimmed result. opts: { budget, cap, pageUrl, hintOf }.
export function compactFirstPlan(out, fullByEntry, opts = {}) {
  if (!_isObj(out)) return out;
  const budget = Number.isFinite(opts.budget) && opts.budget > 0 ? opts.budget : FIRST_PLAN_BUDGET_BYTES;
  const ia = _isObj(out.intent_answer) ? out.intent_answer : null;
  const ranked = _isObj(out.ranked_answer) ? out.ranked_answer : null;
  const executed = Array.isArray(out.executed) ? out.executed : [];
  const evidenceDates = (Array.isArray(out.power_evidence) ? out.power_evidence : [])
    .map((p) => _firstDay(p && (p.as_of || p.collected_at))).filter(Boolean).sort();
  const asOf = _firstDay(ia && ia.as_of) || evidenceDates[0] || null;
  const gridEntry = executed.find((e) => e && e.tool === 'get_grid_intelligence' && e.status === 'executed');
  const _full = (e) => (e ? ((fullByEntry && fullByEntry.get && fullByEntry.get(e)) || e.result) : null);
  let grid = _full(gridEntry);
  // No queue total on the grid read: the queue step's generation-queue total is the same figure.
  const queue = _full(executed.find((e) => e && e.tool === 'get_interconnection_queue' && e.status === 'executed'));
  if (_isObj(queue) && _n(queue.queued_generation_gw) != null && !(_isObj(grid) && _n(grid.queue_depth_gw) != null)) {
    grid = { ...(_isObj(grid) ? grid : { iso: queue.iso }), queue_depth_gw: queue.queued_generation_gw };
  }
  // A market question leads with its DCPI verdict sentence (server.mjs _planDcpiLead: market-scoped only).
  const verdictText = _isObj(out.dcpi_verdict) && typeof out.dcpi_verdict.text === 'string' ? out.dcpi_verdict.text : null;
  // answer_guide's first sentence is prose only when it is not the instruction to the agent ("Compose the
  // answer from executed[].result ..."): that one led a live first plan as its whole answer (2026-11-15).
  const guideFirst = typeof out.answer_guide === 'string' ? out.answer_guide.split(/(?<=\.)\s/)[0] : null;
  const answer0 = verdictText || directAnswer(ia, ranked && typeof ranked.headline === 'string' ? ranked.headline
    : ((guideFirst && !/^compose\b/i.test(guideFirst) ? guideFirst : null) || stepsSentence(executed)), grid);
  // 5.40 (Grok round 2, gap 5): a time-to-power answer for a market kept neither the state's price the question asked
  // for nor the market's DCPI verdict (Dallas: TX 7.68 cents/kWh and CAUTION were read, then dropped).
  const answer = withPriceAndDcpi(answer0, executed, _full, out.intent);
  const notEst = ia && Array.isArray(ia.not_established) ? ia.not_established.slice() : [];
  if (ia && answer !== ia.headline && _notMeasurable(ia.headline)) {
    // Said as what this answer does not include, not as a tier wall.
    notEst.push('DC Hub’s month estimate of time to power'
      + (Number.isFinite(ia.requested_mw) ? ' for ' + ia.requested_mw + ' MW' : '')
      + (ia.geography ? ' in ' + ia.geography : '') + ' is not part of this answer.');
  }
  const steps = (rowsKeep) => executed.map((e) => {
    const full = (fullByEntry && fullByEntry.get && fullByEntry.get(e)) || (e && e.result);
    return {
      step: e && e.step, tool: e && e.tool, args: e && e.args, status: e && e.status,
      ...(e && e.depth ? { depth: e.depth } : {}),
      // 5.38: the pairing step stays marked (lib/plan-pairs.mjs).
      ...(e && e.pair_side ? { pair_side: e.pair_side } : {}),
      figures: stepFigures(full, rowsKeep),
    };
  });
  const calls = executed.filter((e) => e && e.tool && (e.status === 'executed' || e.status === 'gated_preview'))
    .map((e) => ({ tool: e.tool, args: e.args || {} }));
  // Note K item 3: the steps that did not run are named as calls too, with their arguments.
  const manual = manualNextCalls(executed.filter((e) => e && e.status !== 'gated_preview'), [], opts.hintOf || null);
  const pageUrl = opts.pageUrl || (ia && typeof ia.source === 'string'
    ? ((ia.source.match(/dchub\.cloud\/[^\s)]*/) || [])[0] || null) : null);
  const compact = {
    answer,
    as_of: asOf,
    ...(out.dcpi_verdict ? { dcpi_verdict: out.dcpi_verdict } : {}),
    // A headline that could not measure the thing asked is replaced by the direct answer (its gap is the
    // not_established line above), so no "withheld at this tier" sentence rides a full answer.
    ...(ia ? { intent_answer: { ...ia, ...(_notMeasurable(ia.headline) && answer ? { headline: answer } : {}),
      not_established: notEst } } : {}),
    ...(ranked ? { ranked_answer: ranked } : {}),
    first_full_answer: firstFullBlock('execute_plan', opts.cap),
    _entity: out._entity, ok: out.ok, intent: out.intent, intent_class: out.intent_class,
    planner_version: out.planner_version,
    ...(out.constraint_iso ? { constraint_iso: out.constraint_iso } : {}),
    ...(out.power_evidence ? { power_evidence: out.power_evidence } : {}),
    ...(out.dropped_filters ? { dropped_filters: out.dropped_filters } : {}),
    ...(out.geography_scope ? { geography_scope: out.geography_scope } : {}),
    ...(out.unresolved ? { unresolved: out.unresolved } : {}),
    executed: steps(3),
    answer_guide: out.answer_guide,
    more_detail: {
      note: 'This is the compact answer: each step shows its key figures and first rows. For every row, call the step’s tool with the same arguments'
        + (pageUrl ? ', or open https://' + pageUrl.replace(/^https?:\/\//, '') : '') + '.',
      calls,
      ...(manual.length ? { manual_calls: manual,
        manual_note: 'These steps did not return data in this run. Call each tool directly with these arguments; `fill` names the one value no earlier step produced.' } : {}),
      ...(pageUrl ? { url: 'https://' + pageUrl.replace(/^https?:\/\//, '') } : {}),
    },
    totals: out.totals,
    ...(out.next_recipe ? { next_recipe: out.next_recipe } : {}),
    _source: out._source,
  };
  // Over the target: fewer rows per step, then figures only, then the replay-free minimum.
  if (_bytes(compact) > budget) compact.executed = steps(1);
  if (_bytes(compact) > budget) compact.executed = compact.executed.map((s) => ({ ...s, figures: _scalarsOnly(s.figures) }));
  if (_bytes(compact) > budget) delete compact.power_evidence;
  // Each step here carries figures, not its result: the guide names what this answer holds (lib/compact-guide.mjs).
  if (typeof compact.answer_guide === 'string') compact.answer_guide = compactAnswerGuide(compact.answer_guide, compact);
  return compact;
}

function _scalarsOnly(f) {
  if (!_isObj(f)) return f;
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v === null || typeof v !== 'object'));
}

// The wall step puts a relay link (human_url) first in block 0 (lib/short-wall-link.mjs). A first full plan
// answer still leads with its direct answer and as_of; the link follows them.
export function leadWithAnswer(result) {
  try {
    const c0 = result && Array.isArray(result.content) ? result.content[0] : null;
    if (!c0 || typeof c0.text !== 'string') return result;
    const d = JSON.parse(c0.text);
    if (!_isObj(d) || !('answer' in d)) return result;
    const keys = Object.keys(d);
    if (keys[0] === 'answer') return result;
    const head = { answer: d.answer, ...('as_of' in d ? { as_of: d.as_of } : {}) };
    const text = JSON.stringify({ ...head, ...d }, null, c0.text.startsWith('{\n') ? 2 : undefined);
    return { ...result, content: [{ ...c0, text }, ...result.content.slice(1)] };
  } catch (_) { return result; }
}

// ── the plan preview after the day's first full plan (Grok proof run 2026-11-16, item 9) ────────────────────────
// A keyless caller's second execute_plan of the UTC day is the preview, as intended (owner canon: the first call
// each UTC day to each core energy tool is a full answer; after that, previews). Live, that preview said only
// "This answer is partial; the full answer is at <link>" and "N returned previews at your access level": it did
// not say WHY (the day's full plan answer was used) or WHAT each step held back, so the agent could not tell
// its user. This block says both, on block 0's JSON and structuredContent beside where the first plan carries
// `first_full_answer`, and `line` is the closing sentence lib/lean-response.mjs prints. Read only from the
// plan's own executed[] (each step's `withheld` sections and `_<field>_withheld` markers). No plan name, no
// price, no upgrade wording (lib/keyless-plan-wording.mjs BANNED_WORDING; pinned in the test).
const _WITHHELD_MARK = /^_(.+)_withheld$/;
const _MAX_FIELDS_PER_STEP = 8;
export function planStepsHeldBack(executed) {
  if (!Array.isArray(executed)) return [];
  const out = [];
  for (const e of executed) {
    if (!e || !e.tool) continue;
    const preview = e.status === 'gated_preview' || e.depth === 'preview';
    if (!preview) continue;
    const r = _isObj(e.result) ? e.result : {};
    const fields = [];
    if (Array.isArray(r.withheld)) {
      for (const w of r.withheld) {
        const s = _isObj(w) ? w.section || w.field : (typeof w === 'string' ? w : null);
        if (typeof s === 'string' && s && !fields.includes(s)) fields.push(s);
      }
    }
    for (const k of Object.keys(r)) {
      const m = k.match(_WITHHELD_MARK);
      if (m && !fields.includes(m[1])) fields.push(m[1]);
    }
    out.push({ step: e.step, tool: e.tool, fields: fields.slice(0, _MAX_FIELDS_PER_STEP),
      ...(fields.length > _MAX_FIELDS_PER_STEP ? { more_fields: fields.length - _MAX_FIELDS_PER_STEP } : {}) });
  }
  return out;
}
export function firstFullUsedBlock(executed, cap = KEYLESS_FIRST_FULL_CAP_DEFAULT) {
  const held = planStepsHeldBack(executed);
  if (!held.length) return null;
  const what = held.map((h) => 'step ' + h.step + ' ' + h.tool
    + (h.fields.length ? ' (' + h.fields.join(', ') + (h.more_fields ? ', +' + h.more_fields + ' more' : '') + ')'
      : ' (rows and figures cut to a preview)')).join('; ');
  const line = 'This answer is partial: today’s full `execute_plan` answer without a key on this network (IP) or '
    + 'in this session was used, so these steps came back as previews. Held back: ' + what
    + '. The next full `execute_plan` answer without a key is after 00:00 UTC.';
  return { used: cap, limit: cap, resets: '00:00 UTC',
    basis: 'per caller network (IP) and per session, per UTC day, without a key',
    held_back: held, line };
}
// Adds `first_full_answer_used` to block 0's JSON and structuredContent of a keyless plan preview. Never throws.
export function withFirstFullUsedBlock(result, cap = KEYLESS_FIRST_FULL_CAP_DEFAULT) {
  try {
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    const sc = result.structuredContent;
    const c0 = result.content[0];
    let p = null;
    try { p = c0 && c0.type === 'text' && typeof c0.text === 'string' ? JSON.parse(c0.text) : null; } catch (_) { p = null; }
    const executed = (_isObj(sc) && Array.isArray(sc.executed)) ? sc.executed : (_isObj(p) ? p.executed : null);
    const blk = firstFullUsedBlock(executed, cap);
    if (!blk) return result;
    const out = { ...result };
    if (_isObj(p) && !p.first_full_answer_used) {
      const text = JSON.stringify({ ...p, first_full_answer_used: blk }, null, c0.text.startsWith('{\n') ? 2 : undefined);
      out.content = [{ ...c0, text }, ...result.content.slice(1)];
    }
    if (_isObj(sc) && !sc.first_full_answer_used) out.structuredContent = { ...sc, first_full_answer_used: blk };
    return out;
  } catch (_) { return result; }
}
