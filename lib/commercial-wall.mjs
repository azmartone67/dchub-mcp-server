// lib/commercial-wall.mjs — the commercial wall `access` block and its handoff link (Agent Handoff P0-2, owner brief
// 2026-11-22, session 85b470). DRAFT: every flag below defaults OFF; the owner flips them.
//
// WHAT. A walled or partly withheld answer carries ONE extra key, after everything the answer already shows (its
// figures, as_of and citation stay first):
//   {"access": {"status": "partial", "completed": "<what was answered>", "withheld": "<the shape of what is missing>",
//               "unlocks_with": "credit_pack|developer|pro", "for_your_human": "<25 words max, with the link>",
//               "handoff_url": "https://dchub.cloud/h/<sealed id>", "retry_after_unlock": true}}
// The handoff link is minted by the backend (POST /api/v1/handoff/mint, X-Internal-Key, 800 ms); any failure attaches
// nothing and today's wall stands. One link per session (#1594): later walls in the same session carry `access`
// without a link or a human line.
//
// RULES (owner, non-negotiable):
//   * Agent-facing text names what is withheld and gives a link. It never names a price or a plan. `unlocks_with` is
//     a machine code and the ONLY field that may name a tier; AGENT_TEXT_BANNED is the guard every other field passes.
//   * The SHAPE of what is missing ("all 12 sites with time to power"), never a withheld value.
//   * A Pro-only tool is never sold the credit pack (unlocksWith checks Pro first, before any other rule).
//   * /mcp/chatgpt and every ChatGPT / OpenAI client are excluded (clientAllowed + the server's own skips).
//   * No email and no key leave in the mint body (sanitizeArgs) and none can come back in the link (validHandoffUrl).
// Pure apart from mintHandoff / fetchJson, whose fetch is injected. No ctx.
import { createHash } from 'node:crypto';
import { isGrokPlatform } from './paywall-contract.mjs';
import { withheldFields, withheldFieldLabel, DETAIL_ROWS_FALLBACK } from './withheld-copy.mjs';
import { previewScope } from './preview-scope.mjs';
import { headlineOf } from './wall-value-first.mjs';

const ON = /^(1|true|yes|on)$/i;
const flag = (env, k) => ON.test(String((env && env[k]) || '').trim());

// ── flags ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The access block is Test A's treatment (lib/monetization-experiments.mjs exp_upgrade_block), so it shares its flag.
export const COMMERCIAL_WALL_FLAG = 'DCHUB_EXP_UPGRADE_BLOCK';
export const COMMERCIAL_WALL_CLIENTS_ENV = 'DCHUB_COMMERCIAL_WALL_CLIENTS';
export const COMMERCIAL_WALL_CLIENTS_DEFAULT = 'grok,claude';
export const ACCESS_STATUS_FLAG = 'DCHUB_ACCESS_STATUS_TOOL';
export const HANDOFF_ELICIT_FLAG = 'DCHUB_HANDOFF_ELICIT';
export const HANDOFF_RESOLVE_FLAG = 'DCHUB_AGENT_HANDOFF_RESOLVE';
export const commercialWallOn = (env = process.env) => flag(env, COMMERCIAL_WALL_FLAG);
export const accessStatusOn = (env = process.env) => flag(env, ACCESS_STATUS_FLAG);
export const handoffElicitOn = (env = process.env) => flag(env, HANDOFF_ELICIT_FLAG)
  && String((env && env.DCHUB_URL_ELICIT_DISABLE) || '') !== '1';
export const handoffResolveOn = (env = process.env) => flag(env, HANDOFF_RESOLVE_FLAG);

// ── backend contract ─────────────────────────────────────────────────────────────────────────────────────────────────
export const MINT_PATH = '/api/v1/handoff/mint';
export const IDENTITY_PATH = '/api/v1/handoff/identity';
export const ENTITLEMENTS_ME_PATH = '/api/v1/entitlements/me';
export const MINT_TIMEOUT_MS = 800;
export const HANDOFF_VIA = 'upgrade_block';
export const ACCESS_STATUS_TOOL = 'get_access_status';

// ── clients ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const CHATGPT_RE = /chatgpt|openai/i;
export function isClaudeClient(c) {
  const x = (c && typeof c === 'object') ? c : {};
  return /claude/i.test(String(x.platform || '')) || /claude/i.test(String(x.client_name_raw || ''));
}
// Which clients get the block: DCHUB_COMMERCIAL_WALL_CLIENTS (comma list, default "grok,claude"; "all" = every client
// but ChatGPT). A ChatGPT / OpenAI client is never allowed, whatever the list says.
export function clientAllowed(c, env = process.env) {
  const x = (c && typeof c === 'object') ? c : {};
  const platform = String(x.platform || '').toLowerCase();
  if (CHATGPT_RE.test(platform) || CHATGPT_RE.test(String(x.client_name_raw || ''))) return false;
  const raw = String((env && env[COMMERCIAL_WALL_CLIENTS_ENV]) || COMMERCIAL_WALL_CLIENTS_DEFAULT).toLowerCase();
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('all')) return true;
  for (const t of list) {
    if (t === 'grok' && isGrokPlatform(platform)) return true;
    if (t === 'claude' && isClaudeClient(x)) return true;
    if (t !== 'grok' && t !== 'claude' && platform && platform === t) return true;
  }
  return false;
}

// ── what finishes this task ──────────────────────────────────────────────────────────────────────────────────────────
export const UNLOCK_CODES = Object.freeze(['credit_pack', 'developer', 'pro']);
// Wall statuses that mean "the caller's daily / monthly allowance ran out" (lib/keyless-wall.mjs QUOTA_WALL_STATUSES,
// minus the Pro / Land & Power walls, which are about the tool, not the allowance).
export const ALLOWANCE_STATUSES = Object.freeze(new Set(['trial_used', 'trial_cap_exceeded', 'anon_daily_cap',
  'anon_hard_wall', 'monthly_quota_blocked', 'credits_depleted', 'metered_enforced']));
const ALLOWANCE_ERRORS = new Set(['quota_exceeded', 'daily_limit', 'metered_enforced', 'anon_hard_wall']);
const PRO_STATUSES = new Set(['pro_wall', 'lp_wall', 'lp_free_spent', 'blocked_paid_only']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// True when the answer itself says the missing part is Pro-only (a Pro required_plan, pro_required, a *_in_pro marker).
export function resultNeedsPro(sc) {
  if (!isObj(sc)) return false;
  if (typeof sc.required_plan === 'string' && /^(pro|founding)$/i.test(sc.required_plan)) return true;
  if (sc.error === 'pro_required') return true;
  for (const k of Object.keys(sc)) {
    if (/_in_pro$/.test(k) && sc[k] === true) return true;
    if (/_total_in_pro$/.test(k) && sc[k] != null) return true;
  }
  return false;
}

// The cheapest code that finishes THIS task. ctx: { proOnlyTools: Set, keyed, freeKeyed, creditHeavyTools: Set,
// wallStatus, sc }. Order matters: Pro first, so nothing below can sell the pack for a Pro-only tool.
//   pro          a Pro-only tool, a Pro / Land & Power wall, or a result whose missing part is Pro-only
//   developer    the caller's allowance ran out (the tier lacks it only because of the daily / monthly cap)
//   credit_pack  a keyed free / identified caller on a heavy, credit-eligible single answer
//   developer    anything else (when unsure)
export function unlocksWith(tool, ctx = {}) {
  const t = String(tool || '');
  const pro = ctx.proOnlyTools instanceof Set ? ctx.proOnlyTools : new Set(ctx.proOnlyTools || []);
  if (pro.has(t) || ctx.proOnly === true) return 'pro';
  if (PRO_STATUSES.has(String(ctx.wallStatus || ''))) return 'pro';
  if (resultNeedsPro(ctx.sc)) return 'pro';
  if (ALLOWANCE_STATUSES.has(String(ctx.wallStatus || ''))) return 'developer';
  if (isObj(ctx.sc) && ALLOWANCE_ERRORS.has(String(ctx.sc.error || ''))) return 'developer';
  const heavy = ctx.creditHeavyTools instanceof Set ? ctx.creditHeavyTools : new Set(ctx.creditHeavyTools || []);
  if (ctx.keyed && ctx.freeKeyed && heavy.has(t)) return 'credit_pack';
  return 'developer';
}

// ── the agent-facing text guard ──────────────────────────────────────────────────────────────────────────────────────
// No price, no plan name, no pack, no offer words. Every agent-facing field but unlocks_with passes it.
export const AGENT_TEXT_BANNED = /\$|credits? for\b|\d[\d,.]*\s*(?:\/\s*(?:month|mo)\b|per month|a month)|\b(?:developer|pro|starter|enterprise|founding|founder)\b|credit[\s_-]*pack|\bpacks?\b|\bpric(?:e|es|ing)\b|\bplans?\b|\bpaid\b|\btrials?\b|\bupgrade\b|\bunlock\b|\bfree\b|\btier\b|\bsubscription\b|\bcheckout\b/i;
export const textClean = (s) => typeof s === 'string' && !AGENT_TEXT_BANNED.test(s);

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const cutWords = (s, n) => { const w = words(s); return w.length <= n ? w.join(' ') : w.slice(0, Math.max(1, n)).join(' '); };
const cap = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const fmt = (n) => Number(n).toLocaleString('en-US');

const GENERIC_COMPLETED = 'DC Hub answered part of this question';
const GENERIC_WITHHELD = 'the rest of this answer';

// The field nouns the answer withholds: withheld-copy's list (preview_scope, _locked_fields, sections ...), plus the
// *_in_pro and *_withheld markers a Pro wall carries. Plain nouns, never values, each passing the text guard.
export function withheldNouns(sc) {
  if (!isObj(sc)) return [];
  let out = [];
  try { out = withheldFields(sc).filter((f) => f !== DETAIL_ROWS_FALLBACK); } catch (_) { out = []; }
  for (const k of Object.keys(sc)) {
    let m = /^_?([a-z][a-z0-9_]{1,40}?)_in_pro$/.exec(k);
    if (m && sc[k] === true) { out.push(withheldFieldLabel(m[1]) || m[1].replace(/_/g, ' ')); continue; }
    m = /^_?([a-z][a-z0-9_]{1,40}?)_withheld$/.exec(k);
    if (m && sc[k]) out.push(withheldFieldLabel(m[1]) || m[1].replace(/_/g, ' '));
  }
  return out.filter((x) => typeof x === 'string' && x && textClean(x)).filter((x, i, a) => a.indexOf(x) === i);
}
// The list the answer cut: { shown, total, list } or null (the answer's own counts, never a registry total).
export function listCut(sc) {
  if (!isObj(sc)) return null;
  try {
    const ps = isObj(sc.preview_scope) && Number.isInteger(sc.preview_scope.total) ? sc.preview_scope : previewScope(sc);
    if (ps && Number.isInteger(ps.shown) && Number.isInteger(ps.total) && ps.total > ps.shown) {
      return { shown: ps.shown, total: ps.total, list: typeof ps.list === 'string' && /^[a-z][a-z0-9_]{0,30}$/.test(ps.list) ? ps.list.replace(/_/g, ' ') : 'rows' };
    }
  } catch (_) { /* no counts */ }
  for (const k of Object.keys(sc)) {
    const m = /^_([a-z][a-z0-9_]{0,30})_total_in_pro$/.exec(k);
    const list = m && Array.isArray(sc[m[1]]) ? sc[m[1]] : null;
    if (list && Number.isInteger(sc[k]) && sc[k] > list.length) return { shown: list.length, total: sc[k], list: m[1].replace(/_/g, ' ') };
  }
  return null;
}
// "<what was answered>": the list cut, else the answer's own dated headline, else a generic line.
export function completedFrom(sc, { iso = '' } = {}) {
  const cut = listCut(sc);
  if (cut) {
    const s = 'DC Hub answered with ' + fmt(cut.shown) + ' of ' + fmt(cut.total) + ' ' + cut.list;
    if (textClean(s)) return s;
  }
  let h = null;
  try { h = headlineOf(sc, { iso }); } catch (_) { h = null; }
  if (h && h.text && h.when) {
    const s = cap('DC Hub found ' + h.text + ' (' + h.when + ')', 160);
    if (textClean(s)) return s;
  }
  return GENERIC_COMPLETED;
}
// "<the shape of what is missing>": the full list and up to two of its withheld fields, else up to three fields.
export function withheldShape(sc) {
  const cut = listCut(sc);
  const nouns = withheldNouns(sc);
  let s = '';
  if (cut) s = 'all ' + fmt(cut.total) + ' ' + cut.list + (nouns.length ? ' with ' + joinWords(nouns.slice(0, 2)) : '');
  else if (nouns.length) s = joinWords(nouns.slice(0, 3));
  s = cutWords(s, 9);
  return s && textClean(s) ? s : GENERIC_WITHHELD;
}
function joinWords(xs) {
  if (xs.length <= 1) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

export const HUMAN_LINE_MAX_WORDS = 25;
export const HUMAN_OPEN = 'Open this link to see';
// for_your_human: the concrete finding, then "Open this link to see <shape>: <link>", at most 25 words.
export function humanLine({ completed = '', withheld = '', url = '' } = {}) {
  const w = cutWords(withheld || GENERIC_WITHHELD, 9);
  const tail = HUMAN_OPEN + ' ' + w + ': ' + url;
  const room = HUMAN_LINE_MAX_WORDS - words(tail).length;
  let lead = cutWords(String(completed || GENERIC_COMPLETED).replace(/[.\s]+$/, ''), Math.max(1, room));
  if (!textClean(lead)) lead = cutWords(GENERIC_COMPLETED, room);
  return lead.replace(/[.,;:\s]+$/, '') + '. ' + tail;
}

// The block. Without a link (a later wall in the same session) it carries no human line and no URL.
export function buildAccess({ completed, withheld, unlocks_with, handoff_url = '' } = {}) {
  const code = UNLOCK_CODES.includes(unlocks_with) ? unlocks_with : 'developer';
  const comp = textClean(completed) ? cap(completed, 200) : GENERIC_COMPLETED;
  const wh = textClean(withheld) ? cap(withheld, 160) : GENERIC_WITHHELD;
  const access = { status: 'partial', completed: comp, withheld: wh, unlocks_with: code };
  if (validHandoffUrl(handoff_url)) {
    access.for_your_human = humanLine({ completed: comp, withheld: wh, url: handoff_url });
    access.handoff_url = handoff_url;
  }
  access.retry_after_unlock = true;
  return { access };
}
// The agent-facing strings of a block (everything but unlocks_with), for the guard.
export function agentFacingText(block) {
  const a = block && block.access ? block.access : block;
  if (!isObj(a)) return '';
  return Object.entries(a).filter(([k]) => k !== 'unlocks_with').map(([, v]) => (typeof v === 'string' ? v : '')).join('\n');
}

// The short text block that rides after the answer (the same channel for_your_human uses today).
export function accessText(block) {
  const a = block && block.access;
  if (!isObj(a)) return '';
  const head = 'Access: partial. Answered: ' + a.completed + '. Withheld: ' + a.withheld + '.';
  if (a.for_your_human) return head + ' For your human, as written: ' + a.for_your_human;
  return head + ' Retry this call once your human has finished on the page from earlier in this session.';
}
// result + access: structuredContent.access (when the answer has structuredContent) and one text block appended AFTER
// every existing block, so the visible part (figures, as_of, citation) stays first. Never twice.
export function withAccess(result, block) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !block || !block.access) return result;
  // An `access` the answer already states: our object (never twice), or the top-metro stamp. 'full' is never contradicted;
  // the stamp 'partial' is replaced by the block, whose status says the same thing.
  const prior = isObj(result.structuredContent) ? result.structuredContent.access : undefined;
  if (isObj(prior) || (prior !== undefined && prior !== 'partial')) return result;
  const out = { ...result, content: [...result.content, { type: 'text', text: accessText(block) }] };
  if (isObj(result.structuredContent)) out.structuredContent = { ...result.structuredContent, access: block.access };
  return out;
}

// ── handoff link ─────────────────────────────────────────────────────────────────────────────────────────────────────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const KEY_RE = /\b(?:dch_[A-Za-z]+_[A-Za-z0-9_-]{6,}|sk[-_][A-Za-z0-9_-]{16,}|pk[-_][A-Za-z0-9_-]{16,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9_-]{40,})\b/;
const SECRET_KEY_NAME = /e-?mail|api_?key|^key$|token|secret|password|passwd|credential|auth|cookie|session|mpp_|x402|payment/i;
// The call's arguments without anything that identifies a person or carries a credential.
export function sanitizeArgs(args, depth = 0) {
  if (depth > 3) return undefined;
  if (Array.isArray(args)) return args.slice(0, 20).map((v) => sanitizeArgs(v, depth + 1)).filter((v) => v !== undefined);
  if (isObj(args)) {
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      if (SECRET_KEY_NAME.test(k)) continue;
      const s = sanitizeArgs(v, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  if (typeof args === 'string') return (EMAIL_RE.test(args) || KEY_RE.test(args)) ? undefined : args.slice(0, 300);
  if (typeof args === 'number' || typeof args === 'boolean') return args;
  return undefined;
}
export const sessionRef = (sid) => {
  const s = String(sid || '').trim();
  return s && s !== 'no-session' ? createHash('sha256').update(s).digest('hex') : '';   // backend: [A-Za-z0-9_-]{8,128}
};
// A link the backend minted: https://dchub.cloud/h/<sealed id>, no email, no key-shaped query value.
const HANDOFF_URL_RE = /^https:\/\/dchub\.cloud\/h\/[A-Za-z0-9._~-]{8,600}(?:\?[A-Za-z0-9=&_.-]{0,200})?$/;
export function validHandoffUrl(u) {
  if (typeof u !== 'string' || !HANDOFF_URL_RE.test(u) || EMAIL_RE.test(u) || /%40/i.test(u)) return false;
  const q = u.includes('?') ? u.slice(u.indexOf('?') + 1) : '';
  return !/dch_[a-z]+_/i.test(u) && !q.split('&').some((p) => KEY_RE.test(p.split('=')[1] || ''));
}
export function withVia(u) {
  if (!validHandoffUrl(u) || /[?&]via=/.test(u)) return u;
  return u + (u.includes('?') ? '&' : '?') + 'via=' + HANDOFF_VIA;
}
// The label a human recognises: the market, site or region the call was about.
export function labelFrom(args) {
  const a = isObj(args) ? args : {};
  for (const k of ['market', 'metro', 'market_slug', 'slug', 'location', 'site', 'iso', 'region_id', 'region', 'state', 'country', 'intent', 'query']) {
    if (typeof a[k] === 'string' && a[k].trim() && !EMAIL_RE.test(a[k]) && !KEY_RE.test(a[k])) return cap(a[k], 80);
  }
  return '';
}
// The visible part, small: the headline, as_of and source.
export function visibleSummary(sc, { completed = '' } = {}) {
  const s = isObj(sc) ? sc : {};
  const pv = isObj(s.provenance) ? s.provenance : {};
  let h = null;
  try { h = headlineOf(s); } catch (_) { h = null; }
  const asOf = day(s.as_of) || day(pv.as_of) || day(s.computed_at) || (h && day(String(h.when || '').replace(/^\D+/, ''))) || '';
  const source = typeof s.cite_as === 'string' ? s.cite_as : (typeof s.citation === 'string' ? s.citation : 'DC Hub (dchub.cloud)');
  return { headline: cap(completed || (h ? h.text : ''), 200), as_of: asOf, source: cap(source, 200) };
}
// POST the mint; {handoff_url, token_id, expires_at} or null on ANY failure (timeout, non-200, a link that fails
// validHandoffUrl). Never throws.
export async function mintHandoff(body, { apiBase, internalKey, fetchImpl = fetch, timeoutMs = MINT_TIMEOUT_MS } = {}) {
  if (!apiBase || !internalKey) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(String(apiBase).replace(/\/+$/, '') + MINT_PATH, { method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey }, body: JSON.stringify(body) });
    if (!r || r.status !== 200) return null;
    const j = await r.json();
    if (!isObj(j) || !validHandoffUrl(j.handoff_url)) return null;
    return { handoff_url: withVia(j.handoff_url), token_id: typeof j.token_id === 'string' ? cap(j.token_id, 80) : '',
      expires_at: typeof j.expires_at === 'string' ? cap(j.expires_at, 40) : '' };
  } catch (_) { return null; } finally { clearTimeout(t); }
}

// ── get_access_status ────────────────────────────────────────────────────────────────────────────────────────────────
export const ACCESS_STATUS_DESCRIPTION = 'Use this when a DC Hub result carried `access` and your user says they finished on '
  + 'the linked page: returns what this connection can see now (tier code, allowance, credits, excluded tools, and '
  + 'whether access changed since the link). Retry the original call once it shows the change.';
const CODE_RE = /^[a-z][a-z0-9_]{0,23}$/;
const TOOL_RE = /^[a-z][a-z0-9_]{1,63}$/;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// The backend's GET /api/v1/entitlements/me, reduced to codes and numbers: no price, no plan display name, no email.
export function shapeAccessStatus(raw, { keyed = false, now = new Date() } = {}) {
  const r = isObj(raw) ? raw : {};
  const allowance = {};
  if (isObj(r.allowance)) {
    for (const [k, v] of Object.entries(r.allowance)) if (CODE_RE.test(k) && num(v) !== null) allowance[k] = v;
  }
  if (num(r.full_answers_per_tool_per_day) !== null) allowance.full_answers_per_tool_per_day = r.full_answers_per_tool_per_day;
  const tier = typeof r.tier === 'string' && CODE_RE.test(r.tier.toLowerCase()) ? r.tier.toLowerCase() : 'unknown';
  // The backend (be#9213/9214) says a handoff link applies with linked_via (and base_tier, the caller's own tier).
  const linkedVia = typeof r.linked_via === 'string' && r.linked_via.trim() !== '';
  const baseTier = typeof r.base_tier === 'string' ? r.base_tier.toLowerCase() : '';
  return {
    tier,
    keyed: r.keyed === true || r.keyed === false ? r.keyed : !!keyed,
    allowance,
    credits: num(r.credits) !== null ? r.credits : (isObj(r.credits) && num(r.credits.remaining) !== null ? r.credits.remaining : null),
    excluded_tools: Array.isArray(r.excluded_tools) ? r.excluded_tools.filter((t) => typeof t === 'string' && TOOL_RE.test(t)).slice(0, 200) : [],
    upgraded_since_handoff: r.upgraded_since_handoff === true || (linkedVia && (!baseTier || baseTier !== tier)),
    as_of: day(r.as_of) ? String(r.as_of).slice(0, 25) : now.toISOString(),
  };
}
// GET JSON with a timeout; null on any failure. Never throws.
export async function fetchJson(url, { headers = {}, fetchImpl = fetch, timeoutMs = MINT_TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'GET', headers, signal: ctl.signal });
    if (!r || r.status !== 200) return null;
    const j = await r.json();
    return isObj(j) ? j : null;
  } catch (_) { return null; } finally { clearTimeout(t); }
}

// The tier a handoff-linked keyless call is lifted to, from GET /api/v1/handoff/identity's `tier` (be#9214: keyless |
// free_key | email_key | credit_pack | developer | pro). Only a recurring paid tier lifts a keyless call: the pack's
// credits sit on the buyer's key, which the lookup never returns (api_key_hash only), so 'credit_pack' lifts nothing.
export function liftTierFor(tier) {
  const t = String(tier || '').toLowerCase();
  return t === 'developer' || t === 'pro' ? t : '';
}

// A small TTL cache (the linked-identity lookup: 60 s per identity, misses included).
export function createTtlCache({ ttlMs = 60_000, max = 20_000 } = {}) {
  const m = new Map();
  return {
    get(k, now = Date.now()) { const e = m.get(k); if (!e) return undefined; if (now - e.at > ttlMs) { m.delete(k); return undefined; } return e.v; },
    set(k, v, now = Date.now()) { if (m.size >= max) m.clear(); m.set(k, { v, at: now }); },
    clear() { m.clear(); },
  };
}
