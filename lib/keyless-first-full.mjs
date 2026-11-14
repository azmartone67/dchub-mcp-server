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

export function mintPlanFirstFullToken(now = Date.now()) {
  if (_tokens.size > MAX_TOKENS) {
    for (const [t, exp] of _tokens) if (exp < now) _tokens.delete(t);
  }
  const tok = randomUUID() + randomUUID();
  _tokens.set(tok, now + TTL_MS);
  return tok;
}

// true once for a live token minted here; a missing, expired, reused or foreign token is false.
export function consumePlanFirstFullToken(tok, now = Date.now()) {
  if (typeof tok !== 'string' || !tok) return false;
  const exp = _tokens.get(tok);
  if (exp === undefined) return false;
  _tokens.delete(tok);
  return exp >= now;
}

// ── what the answer says about itself ────────────────────────────────────────────────────────────
// No plan name, no price. `emailCap` is the email allowance on this tool (0 = say nothing about it).
export function firstFullBlock(tool, cap = KEYLESS_FIRST_FULL_CAP_DEFAULT, emailCap = 0) {
  const what = tool === 'execute_plan' ? 'plan answer' : '`' + tool + '` answer';
  return {
    used: 1,
    limit: cap,
    resets: '00:00 UTC',
    basis: 'per caller network (IP), per tool, per UTC day, without a key',
    note: 'This is today’s full ' + what + ' without a key. Later ' + (tool || 'calls')
      + ' calls today return the preview'
      + (emailCap > 0 ? '; an email gets a free key with ' + emailCap + ' full answers a day on it.' : '; a free key (claim_free_key) adds more.'),
  };
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
  const notMeasurable = /not measurable|see the time-to-power figures below/i.test(headline);
  if (!notMeasurable && headline) return headline;
  const ttp = ev.find((e) => /time-to-power/i.test(e));
  const scope = ia.geography ? String(ia.geography) : '';
  const mw = Number.isFinite(ia.requested_mw) ? ia.requested_mw + ' MW in ' : '';
  if (ttp) return 'Time to power for ' + mw + (scope || 'the requested area') + ': ' + ttp;
  const gs = gridPowerSentence(grid);
  if (gs) return gs;
  if (ia.verdict && ia.verdict.value) {
    return (ia.verdict.subject || scope || 'The requested area') + ': DCPI ' + ia.verdict.value
      + (ia.verdict.scope === 'iso' ? ' (ISO-level)' : '') + '.' + (ev[0] ? ' ' + ev[0] : '');
  }
  if (ev.length) return ev[0];
  return headline || fallback || null;
}

const _firstDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// The plan answer `out` (server.mjs execute_plan) as the compact first answer: the direct answer and its
// as_of first, the intent answer, each step's key figures, and a pointer to the full rows. `fullByEntry`
// maps an executed entry to its unslimmed result. opts: { budget, cap, pageUrl }.
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
  const grid = gridEntry ? ((fullByEntry && fullByEntry.get && fullByEntry.get(gridEntry)) || gridEntry.result) : null;
  // A market question leads with its DCPI verdict sentence (server.mjs _planDcpiLead: market-scoped only).
  const verdictText = _isObj(out.dcpi_verdict) && typeof out.dcpi_verdict.text === 'string' ? out.dcpi_verdict.text : null;
  const answer = verdictText || directAnswer(ia, ranked && typeof ranked.headline === 'string' ? ranked.headline
    : (typeof out.answer_guide === 'string' ? out.answer_guide.split(/(?<=\.)\s/)[0] : null), grid);
  const notEst = ia && Array.isArray(ia.not_established) ? ia.not_established.slice() : [];
  if (ia && typeof ia.headline === 'string' && answer !== ia.headline && /not measurable/i.test(ia.headline)) {
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
      figures: stepFigures(full, rowsKeep),
    };
  });
  const calls = executed.filter((e) => e && e.tool && (e.status === 'executed' || e.status === 'gated_preview'))
    .map((e) => ({ tool: e.tool, args: e.args || {} }));
  const pageUrl = opts.pageUrl || (ia && typeof ia.source === 'string'
    ? ((ia.source.match(/dchub\.cloud\/[^\s)]*/) || [])[0] || null) : null);
  const compact = {
    answer,
    as_of: asOf,
    ...(out.dcpi_verdict ? { dcpi_verdict: out.dcpi_verdict } : {}),
    ...(ia ? { intent_answer: { ...ia, not_established: notEst } } : {}),
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
