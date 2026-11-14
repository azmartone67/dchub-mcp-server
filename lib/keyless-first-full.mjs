// keyless-first-full.mjs -- one full answer a day before any wall, keyless (owner-approved 2026-11-14,
// Grok spec S1/S2). Ships OFF.
//
// With DCHUB_KEYLESS_FIRST_FULL on, the FIRST call of the UTC day from a keyless caller (per caller IP) on each
// of five tools is the full, dated, cited answer instead of the keyless preview:
//   execute_plan, get_grid_intelligence, get_interconnection_queue, get_grid_data, get_energy_prices.
// The second call of that tool that day gets today's preview, unchanged.
//
// "Full" means the answer the deepest free-class seat gets: what an email-bound free key gets on these tools
// (server.mjs applyTierGate email_full, maskBrokerRatesBelowPro). Nothing sold only to a paid plan is opened:
// the backend still sees the caller as anonymous (X-DCHub-Caller-Tier is unchanged), so its own masks on paid
// fields (DCPI sub-scores, Pro rows) stay exactly as they are for an email-bound key.
//
// execute_plan: the plan's one full answer for the day runs its steps on that same full seat. The plan hands
// each loopback step a single-use, in-process token (KEYLESS_FIRST_PLAN_HEADER, same shape as
// lib/plan-caller-ip.mjs); a step that carries one is served full on the four single tools above WITHOUT
// charging their own daily answer (the plan was charged once, on execute_plan). Then the plan answer is shaped
// for a first-time reader (firstPlanAnswer): it leads with a direct answer, never headlines "not measurable",
// and stays under FIRST_PLAN_BUDGET_BYTES for the whole tool result.
//
// Who is seated: the keyless-full-trial's caller rules (lib/keyless-full-trial.mjs keylessCallerSeat): keyless
// only; the main /mcp profile, /mcp/claude and /mcp/core, never /mcp/chatgpt (frozen) or a step started there;
// not a bot or one of our internal callers; not a QA caller (a QA caller sees it only through the test-only ctx
// override and is charged and tagged nothing); a usable, non-loopback caller IP. An execute_plan step without a
// first-plan token is never seated (a plan step never spends the caller's own daily answer on a tool).
//
// Counter: the per (identity, tool, UTC day) store the other full-answer counters use (in-process map, floored
// by the durable /api/v1/mcp/full-cap peek, mirrored by consume), identity 'kff:' + capWallIdentity (sha256 of
// the IP), cap 1. Funnel: mcp_tool_calls.gate_status 'keyless_first_full' (one row per first full answer) and
// 'keyless_first_full_step' (a plan step served full inside it); /api/v1/mcp/funnel keyless_first_full_answer.
//
// Switch (read per call, so a test can flip it): DCHUB_KEYLESS_FIRST_FULL, only 1/on/true/yes enable it.
// Off: no seat, no token, no counter read, no wording change: byte-identical to before.
import { randomUUID } from 'node:crypto';
import { keylessCallerSeat } from './keyless-full-trial.mjs';
import { capToBudget } from './answer-shape.mjs';

export const KEYLESS_FIRST_FULL_FLAG = 'DCHUB_KEYLESS_FIRST_FULL';
export const KEYLESS_FIRST_FULL_TOOLS = Object.freeze([
  'execute_plan', 'get_grid_intelligence', 'get_interconnection_queue', 'get_grid_data', 'get_energy_prices',
]);
// The tools a first-plan step is served full on (every lane tool but the plan itself).
export const KEYLESS_FIRST_PLAN_STEP_TOOLS = Object.freeze(KEYLESS_FIRST_FULL_TOOLS.filter((t) => t !== 'execute_plan'));
export const KEYLESS_FIRST_FULL_CAP = 1;
export const KEYLESS_FIRST_FULL_STATUS = 'keyless_first_full';
export const KEYLESS_FIRST_FULL_STEP_STATUS = 'keyless_first_full_step';
export const KEYLESS_FIRST_FULL_ID_PREFIX = 'kff:';
// The ctx field the request handler sets on a loopback step that carried a valid first-plan token.
export const KEYLESS_FIRST_PLAN_STEP = 'keyless_first_plan_step';
// The ctx field the request handler sets on ANY execute_plan step (one that carried the plan's caller-IP token,
// lib/plan-caller-ip.mjs). The socket peer cannot tell a step from a local caller, so the token is the marker.
export const KEYLESS_PLAN_STEP = 'keyless_plan_step';
export const KEYLESS_FIRST_PLAN_HEADER = 'x-dchub-keyless-first-plan';
// The whole tool result (every content block plus structuredContent), in bytes.
export const FIRST_PLAN_BUDGET_BYTES = 15_000;

export function keylessFirstFullOn(env = process.env) {
  return /^(1|on|true|yes)$/i.test(String((env && env[KEYLESS_FIRST_FULL_FLAG]) || '').trim());
}

export function keylessFirstFullTool(name) {
  return KEYLESS_FIRST_FULL_TOOLS.includes(String(name || ''));
}

// 'charge' = serve the first full answer and charge the (IP, tool, day) counter; 'observe' = a QA caller with
// the test-only override: serve it, charge nothing, tag nothing; 'step' = a first-plan step: serve it full,
// charge nothing, tag it as a step; null = today's path.
// deps: { env, directoryProfile, allowedProfiles, isQa(c), isBot(c) } (keylessCallerSeat's).
export function keylessFirstFullSeat(name, c, deps = {}) {
  const env = deps.env || process.env;
  if (!keylessFirstFullOn(env)) return null;
  if (!keylessFirstFullTool(name)) return null;
  if (!c || typeof c !== 'object' || c.api_key) return null;
  if (c[KEYLESS_FIRST_PLAN_STEP] === true) {
    return KEYLESS_FIRST_PLAN_STEP_TOOLS.includes(String(name)) ? 'step' : null;
  }
  // A plan step without the token: the caller's own daily answer is never spent by a plan.
  if (c[KEYLESS_PLAN_STEP] === true) return null;
  return keylessCallerSeat(c, deps);
}

// ── first-plan step tokens (single use, in process, short-lived) ──────────────────────────────────────────
const TTL_MS = 120_000;
const MAX_TOKENS = 5000;
const _tokens = new Map();   // token -> exp
export function mintKeylessFirstPlanToken(now = Date.now()) {
  if (_tokens.size > MAX_TOKENS) {
    for (const [t, exp] of _tokens) if (exp < now) _tokens.delete(t);
    if (_tokens.size > MAX_TOKENS) return null;   // fail closed: the step gets today's path
  }
  const tok = randomUUID() + randomUUID();
  _tokens.set(tok, now + TTL_MS);
  return tok;
}
export function consumeKeylessFirstPlanToken(tok, now = Date.now()) {
  if (typeof tok !== 'string' || !tok) return false;
  const exp = _tokens.get(tok);
  if (exp === undefined) return false;
  _tokens.delete(tok);
  return exp >= now;
}

// The meter on a first full answer. No "limit" wording: nothing was limited on this call.
export function firstFullMeter(tool) {
  return {
    call: 1, of: KEYLESS_FIRST_FULL_CAP, remaining_today: 0,
    counted: 'per caller network (IP), per UTC day, on this tool',
    allowance: KEYLESS_FIRST_FULL_STATUS,
    resets_at: 'next 00:00 UTC',
    note: 'This is today’s full `' + tool + '` answer without a key. The next `' + tool
      + '` call today returns the preview; a free key (claim_free_key) keeps answers coming.',
  };
}

// ── the first plan answer: direct answer first, under the budget ─────────────────────────────────────────
const NOT_MEASURABLE = /not\s+measurable/i;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bytesOf = (v) => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

// Short, dated facts read off the plan's own step results (only steps that ran in full; a preview step's
// figure is not quoted as the answer). Each names its unit; nothing is computed or inferred.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10));
export function stepFacts(executed) {
  const out = [];
  const full = (Array.isArray(executed) ? executed : [])
    .filter((e) => isObj(e) && e.status === 'executed' && e.depth !== 'preview' && isObj(e.result));
  const whereOf = (e) => String((e.args && (e.args.iso || e.args.region_id || e.args.state)) || e.result.iso || '').toUpperCase();
  // One region across the steps: the answer's geography already names it, so the facts do not repeat it.
  const many = new Set(full.map(whereOf).filter(Boolean)).size > 1;
  for (const e of full) {
    const r = e.result;
    const where = whereOf(e);
    const at = many && where ? where + ' ' : '';
    if (e.tool === 'get_grid_intelligence' || e.tool === 'get_grid_data') {
      if (num(r.avg_time_to_power_months) != null) out.push(`${at}average time to power ${fmt(r.avg_time_to_power_months)} months`);
      if (num(r.avg_queue_wait_months) != null) out.push(`${at}average queue wait ${fmt(r.avg_queue_wait_months)} months`);
      if (num(r.reserve_margin_pct) != null) out.push(`${at}reserve margin ${fmt(r.reserve_margin_pct)}%`);
      if (num(r.demand_mw) != null) out.push(`${at}live demand ${fmt(r.demand_mw)} MW`);
    } else if (e.tool === 'get_interconnection_queue') {
      const gw = num(r.queued_generation_gw) ?? num(r.total_gw);
      if (gw != null) out.push(`${at}${fmt(gw)} GW of generation in the interconnection queue${num(r.project_count) != null ? ` (${fmt(r.project_count)} projects)` : ''}`);
    } else if (e.tool === 'get_energy_prices') {
      const rr = isObj(r.retail_rates) ? r.retail_rates : {};
      const c = num(rr.avg_cents_kwh);
      if (c != null) out.push(`${at}average retail power price ${fmt(c)} cents/kWh${rr.latest_period ? ` (${rr.latest_period})` : ''}`);
    }
  }
  return [...new Set(out)];
}

// The one-sentence answer the plan leads with. Built only from what the plan's own answer blocks say
// (intent_answer, ranked_answer) and the figures its full steps returned; a "see ... below" pointer is replaced
// by the figures it points at, and a "not measurable" headline is never the lead: what WAS measured leads, and
// the gap stays in intent_answer.not_established.
export function directAnswer(sc) {
  if (!isObj(sc)) return '';
  const ia = isObj(sc.intent_answer) ? sc.intent_answer : null;
  const ra = isObj(sc.ranked_answer) ? sc.ranked_answer : null;
  const ev = ia && Array.isArray(ia.evidence) ? ia.evidence.filter((e) => typeof e === 'string' && e.trim()) : [];
  const facts = stepFacts(sc.executed);
  const figures = [...facts.slice(0, 3), ...ev].slice(0, 3);
  let head = ia && typeof ia.headline === 'string' ? ia.headline.trim() : '';
  if (!head && ra && typeof ra.headline === 'string') head = ra.headline.trim();
  const pointer = /:\s*see the [^.]*?below\.?/i;
  let lead;
  if (head && !NOT_MEASURABLE.test(head) && !pointer.test(head)) {
    lead = figures.length && head.length < 200 ? head.replace(/\.?$/, '.') + ' ' + figures.slice(0, 2).join('; ') + '.' : head;
  } else if (head && pointer.test(head) && figures.length) {
    lead = head.replace(pointer, ': ' + figures.join('; ') + '.');
  } else if (figures.length) {
    const geo = (ia && ia.geography) || (Array.isArray(sc.constraint_iso) ? sc.constraint_iso.join('/') : '');
    lead = (geo ? geo + ': ' : '') + figures.join('; ') + '.';
  } else {
    const ran = Array.isArray(sc.executed)
      ? [...new Set(sc.executed.filter((e) => isObj(e) && e.status === 'executed').map((e) => e.tool))]
      : [];
    lead = 'DC Hub ran ' + (ran.length ? ran.join(', ') : 'the plan') + ' for "' + clip(sc.intent || '', 120)
      + '"; the figures are in each step\u2019s result below.';
  }
  lead = lead.replace(/\.\.+/g, '.').replace(/\.(\s*\.)+/g, '.');
  const asOf = (ia && ia.as_of) || sc.as_of || null;
  const out = clip(lead, 600);
  return asOf && !out.includes(String(asOf).slice(0, 10)) ? out + ' (as of ' + String(asOf).slice(0, 10) + ')' : out;
}

// The keys a first plan answer keeps, in order (direct answer first). Everything else (the replay trace, the
// answer guide, recipes, the per-call identity / provenance / retention blocks) is a second-read aid and is
// dropped to keep the answer readable and under budget; `dropped` names them.
const KEEP_KEYS = Object.freeze([
  'answer', 'as_of', 'cite_as', '_entity', 'ok', 'intent', 'intent_class', 'planner_version',
  'intent_answer', 'ranked_answer', 'power_evidence', 'executed', 'constraint_iso', 'totals', 'first_full_answer',
  'citation', 'next_call', 'rerun',
]);
// Dropped first when still over budget, in this order.
const SHED_ORDER = Object.freeze(['power_evidence', 'rerun', 'next_call', 'totals', 'constraint_iso', 'planner_version']);

function slimStep(e) {
  if (!isObj(e)) return e;
  const out = {};
  for (const k of ['step', 'tool', 'args', 'status', 'depth', 'ms']) if (e[k] !== undefined) out[k] = e[k];
  const r = e.result;
  if (isObj(r)) {
    const keep = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === null || typeof v !== 'object') { if (typeof v !== 'string' || v.length <= 240) keep[k] = v; }
    }
    keep.result_trimmed_for_size = 'Call ' + (e.tool || 'this tool') + ' with these args for every row.';
    out.result = keep;
  }
  return out;
}

// Returns the reshaped tool result, or the input untouched when it is not a plan answer it can read.
// keepBlock(b): a text block of the input kept after the source line (server.mjs passes the front-desk line test).
export function firstPlanAnswer(result, { budget = FIRST_PLAN_BUDGET_BYTES, tool = 'execute_plan', keepBlock = null } = {}) {
  try {
    if (!result || typeof result !== 'object' || result.isError === true) return result;
    let sc = isObj(result.structuredContent) ? result.structuredContent : null;
    if (!sc && Array.isArray(result.content) && result.content[0] && typeof result.content[0].text === 'string') {
      try { const p = JSON.parse(result.content[0].text); if (isObj(p)) sc = p; } catch (_) { sc = null; }
    }
    if (!sc || !Array.isArray(sc.executed)) return result;
    const answer = directAnswer(sc);
    const ia = isObj(sc.intent_answer) ? { ...sc.intent_answer } : null;
    if (ia) {
      if (typeof ia.headline === 'string' && NOT_MEASURABLE.test(ia.headline)) ia.headline = answer;
      // A full answer carries no wall, so it has no relay to show.
      if (ia.relay == null) delete ia.relay;
    }
    const asOf = (ia && ia.as_of) || sc.as_of || (isObj(sc.citation) && sc.citation.as_of) || null;
    const cite = (typeof sc.cite_as === 'string' && sc.cite_as)
      || (isObj(sc.citation) && typeof sc.citation.cite_as === 'string' && sc.citation.cite_as)
      || ('DC Hub (dchub.cloud)' + (asOf ? ', as of ' + String(asOf).slice(0, 10) : ''));
    const src = { ...sc, answer, as_of: asOf, cite_as: cite, first_full_answer: firstFullMeter(tool),
      ...(ia ? { intent_answer: ia } : {}) };
    let obj = {};
    for (const k of KEEP_KEYS) if (src[k] !== undefined && src[k] !== null) obj[k] = src[k];
    const dropped = Object.keys(sc).filter((k) => !KEEP_KEYS.includes(k));
    // Text copy = the JSON + one short source line. The JSON rides twice (block 0 and structuredContent), so
    // each copy gets just under half of the budget.
    const sourceLine = 'Source: ' + cite + '. Data: CC-BY-4.0, cite "DC Hub, dchub.cloud".';
    const kept = (Array.isArray(result.content) ? result.content.slice(1) : [])
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string' && typeof keepBlock === 'function' && keepBlock(b) && b.text.length <= 800);
    const perCopy = Math.floor((budget - bytesOf(sourceLine) - bytesOf(kept) - 400) / 2);
    const fits = (o) => bytesOf(o) <= perCopy;
    if (!fits(obj)) obj = capToBudget(obj, perCopy).value;
    for (const k of SHED_ORDER) { if (fits(obj)) break; if (k in obj) { delete obj[k]; dropped.push(k); } }
    if (!fits(obj)) obj = { ...obj, executed: obj.executed.map(slimStep) };
    if (!fits(obj) && isObj(obj.intent_answer)) {
      const i2 = { ...obj.intent_answer };
      for (const k of ['evidence', 'not_established']) if (Array.isArray(i2[k])) i2[k] = i2[k].slice(0, 3).map((s) => clip(s, 300));
      obj = { ...obj, intent_answer: i2 };
    }
    if (!fits(obj)) { delete obj.ranked_answer; dropped.push('ranked_answer'); }
    if (dropped.length) obj.shaped_for_first_answer = { dropped: [...new Set(dropped)], note: 'A first answer keeps the answer, the steps and the citation. Ask again with a narrower intent, or call a step’s tool directly, for more.' };
    return {
      content: [{ type: 'text', text: JSON.stringify(obj) }, { type: 'text', text: sourceLine }, ...kept],
      structuredContent: obj,
      ...(result._meta ? { _meta: result._meta } : {}),
    };
  } catch (_) { return result; }
}

export function resultBytes(result) {
  try { return bytesOf(result); } catch (_) { return Infinity; }
}
