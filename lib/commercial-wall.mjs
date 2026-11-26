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
import { offersShown } from './offers-shown.mjs';
import { DIGEST_ASK_KINDS } from './keyless-wall.mjs';

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
// Wider reach (owner brief 2026-11-25), each default OFF and read only inside commercialWallStep, after every existing
// gate (the experiment arm, the client list, the QA / bot / ChatGPT / frozen-profile skips):
//   DCHUB_HANDOFF_WITH_EMAIL_ASK  a keyless wall an email would finish keeps its email ask AND gains the block.
//   DCHUB_HANDOFF_OVER_DIGEST     a wall whose only free offer is the weekly digest (no email unlock ask) and for which
//                                 a handoff link was minted on THIS call leaves without the digest paragraph.
export const HANDOFF_WITH_EMAIL_ASK_FLAG = 'DCHUB_HANDOFF_WITH_EMAIL_ASK';
export const HANDOFF_OVER_DIGEST_FLAG = 'DCHUB_HANDOFF_OVER_DIGEST';
export const handoffWithEmailAskOn = (env = process.env) => flag(env, HANDOFF_WITH_EMAIL_ASK_FLAG);
export const handoffOverDigestOn = (env = process.env) => flag(env, HANDOFF_OVER_DIGEST_FLAG);

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

// The purchase rule, in every block and (where the handshake budget allows) in the instructions (server.mjs
// ACCESS_INSTR_LINE is this sentence). Passes AGENT_TEXT_BANNED.
export const ACCESS_AGENT_NOTE = 'Never claim a purchase until get_access_status confirms it.';
// The handshake line (server.mjs ACCESS_INSTR_LINE = ACCESS_AGENT_NOTE), with DCHUB_EXP_UPGRADE_BLOCK or
// DCHUB_ACCESS_STATUS_TOOL on: one sentence right after the relay contract. Only the purchase rule is new; the text
// already says to show a partial result's human_message / for_your_human and its link. Never on /mcp/chatgpt's
// directory text (no relay contract there). accessFit serves it only when the whole served text stays inside the
// path's budget (ACCESS_INSTR_BUDGET; the compact Grok paths keep 48 characters of headroom, so 2,000); otherwise
// the text without it, byte for byte, and the access block's agent_note carries the rule. Flags off: the text itself.
export const ACCESS_INSTR_BUDGET = 2048;
export const ACCESS_INSTR_BUDGET_COMPACT = 2000;
export function accessInstr(text, relayContract, env = process.env) {
  try {
    if (typeof text !== 'string' || !(commercialWallOn(env) || accessStatusOn(env)) || text.includes(ACCESS_AGENT_NOTE)) return text;
    const i = relayContract ? text.indexOf(relayContract) : -1;
    if (i < 0) return text;
    const j = i + relayContract.length;
    return text.slice(0, j) + ' ' + ACCESS_AGENT_NOTE + text.slice(j);
  } catch (_) { return text; }
}
export function accessFit(text, relayContract, budget, env = process.env) {
  const withLine = accessInstr(text, relayContract, env);
  if (withLine === text) return text;
  return withLine.length <= (Number.isFinite(budget) ? budget : ACCESS_INSTR_BUDGET) ? withLine : text;
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
  access.agent_note = ACCESS_AGENT_NOTE;
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

// ── the digest offer (DCHUB_HANDOFF_OVER_DIGEST) ─────────────────────────────────────────────────────────────────────
// Every builder writes the weekly-digest offer as ONE prose paragraph naming `subscribe_digest` in backticks: its own
// text block (lib/wall-offer-floor.mjs, the plan's digest paragraph) or a paragraph ahead of the human line
// (lib/depth-digest-ask.mjs). A paragraph that opens as JSON is the answer's data and is never touched.
const DIGEST_PARA_RE = /`subscribe_digest`/;
const isDigestPara = (p) => DIGEST_PARA_RE.test(p) && !/^\s*[{[]/.test(p);
// True when the answer's free offer is the digest alone: it carries the digest offer in prose and no email unlock ask
// (lib/offers-shown.mjs, the reader the funnel's offers_shown uses).
export function digestOnlyOffer(result, emailAsk) {
  try {
    if (!result || !Array.isArray(result.content)) return false;
    const o = offersShown(result, emailAsk);
    if (!Array.isArray(o) || !o.includes('digest') || o.includes('email_unlock')) return false;
    return result.content.some((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.split('\n\n').some(isDigestPara));
  } catch (_) { return false; }
}
// The result without its digest paragraphs; every other paragraph, block and byte stays. The same object back when
// there is nothing to cut.
export function withoutDigestOffer(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  let cut = false;
  const content = [];
  for (const b of result.content) {
    if (!b || b.type !== 'text' || typeof b.text !== 'string' || !DIGEST_PARA_RE.test(b.text)) { content.push(b); continue; }
    const paras = b.text.split('\n\n');
    const kept = paras.filter((p) => !isDigestPara(p));
    if (kept.length === paras.length) { content.push(b); continue; }
    cut = true;
    if (kept.join('').trim()) content.push({ ...b, text: kept.join('\n\n') });
  }
  return cut ? { ...result, content } : result;
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
// The backend's /api/v1/entitlements/me, reduced to codes and numbers: no price, no plan display name, no email.
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
// GET JSON with a timeout, or POST when `json` is given (its body as JSON); null on any failure. Never throws.
// The identity lookups POST: identity_ref / session_ref never ride in a query string, where the edge could key a cache
// on a credential-shaped arg (the backend's check_credential_channel_coverage guard).
export async function fetchJson(url, { headers = {}, fetchImpl = fetch, timeoutMs = MINT_TIMEOUT_MS, json } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const init = json === undefined ? { method: 'GET', headers, signal: ctl.signal }
      : { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(json), signal: ctl.signal };
    const r = await fetchImpl(url, init);
    if (!r || r.status !== 200) return null;
    const j = await r.json();
    return isObj(j) ? j : null;
  } catch (_) { return null; } finally { clearTimeout(t); }
}

// The tier a handoff-linked keyless call is lifted to, from POST /api/v1/handoff/identity's `tier` (be#9214: keyless |
// free_key | email_key | credit_pack | developer | pro). Only a recurring paid tier lifts a keyless call: the pack's
// credits sit on the buyer's key, which the lookup never returns (api_key_hash only), so 'credit_pack' lifts nothing.
export function liftTierFor(tier) {
  const t = String(tier || '').toLowerCase();
  return t === 'developer' || t === 'pro' ? t : '';
}

// The linked token POST /api/v1/handoff/identity adds with DCHUB_AGENT_HANDOFF_RESOLVE on (be#9214 util/linked_key):
// "dchl1." + sealed payload + "." + 32-hex signature, naming the buyer key's HASH, valid 600 s. This server only
// forwards it, as LINKED_KEY_HEADER (never as X-API-Key); the backend honours it next to X-Internal-Key alone.
export const LINKED_KEY_HEADER = 'X-DCHub-Linked-Key';
const LINKED_TOKEN_RE = /^dchl1\.x1[A-Za-z0-9_-]{16,900}\.[0-9a-f]{32}$/;
export function linkedTokenOf(j) {
  const t = j && typeof j.linked_token === 'string' ? j.linked_token.trim() : '';
  return LINKED_TOKEN_RE.test(t) ? t : '';
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

// ── server runtime (moved out of server.mjs to keep it under the 3 MB scan cap) ─────────────────────────────────────
// createRuntime(d) returns the server steps; `d` holds closures over server.mjs internals, read at call time (never at
// creation, so a server constant declared further down the module is never touched early). Every flag defaults OFF.
//
// commercialWallStep: Test A's treatment (DCHUB_EXP_UPGRADE_BLOCK, lib/monetization-experiments.mjs exp_upgrade_block,
// 80/20). On a walled answer, for an audience the client tests may touch (d.mxAudience) on a client
// DCHUB_COMMERCIAL_WALL_CLIENTS allows (default grok,claude; never ChatGPT): `exposure` is recorded in BOTH arms at the
// point the block would show, once per session; the treatment arm's answer gains `access` with a backend-minted
// handoff link (POST /api/v1/handoff/mint, 800 ms; any failure attaches nothing and today's wall stands). One link per
// session (#1594): a later wall in the same session carries `access` without a link or a human line. A keyless caller
// whose task an email would finish (not a Pro-only tool) keeps the identity ask and gets no block, unless
// DCHUB_HANDOFF_WITH_EMAIL_ASK is on (then it keeps the ask and gets the block too). DCHUB_HANDOFF_OVER_DIGEST: a
// digest-only wall that got a link leaves without its digest paragraph. execute_plan steps
// are skipped; the outer plan carries it once. Flag off: the same object back, untouched.
//
// handoffElicit (DCHUB_HANDOFF_ELICIT): the same human line and link as a URL elicitation, for a client that declared
// the capability: once per session, fire-and-forget, never after the claim elicitation already went out.
//
// handoffResolveEnter (DCHUB_AGENT_HANDOFF_RESOLVE): a KEYLESS call whose identity or session the backend linked to a
// buyer after a handoff checkout (POST /api/v1/handoff/identity, X-Internal-Key, cached 60 s per identity, misses
// included, 800 ms) is served at the buyer's tier (developer / pro only, liftTierFor). Never lowers a tier. Not on
// ChatGPT surfaces, a plan step, QA or bot traffic. With the backend's flag on too the lookup adds linked_token (a signed
// 10-minute token naming the key HASH, never the key): the call holds it as c.linked_token, callAPI / callAPIWrite
// forward it as X-DCHub-Linked-Key (forwardLinkedKey; never X-API-Key), which the backend reads next to X-Internal-Key
// only, as the buyer's key; the caller-tier header and the keyless caps read the call at the lifted tier (handoffLinked).
//
// accessStatusTool (DCHUB_ACCESS_STATUS_TOOL): callable by name, never listed. A keyed caller is read with its own key;
// a keyless / OAuth caller with the internal key plus its identity_ref and session_ref, so a handoff-linked identity
// reports its upgrade. Codes and numbers only.
export function handoffLinked(c) {
  return !!(c && !c.api_key && c.handoff_linked === true && typeof c.linked_token === 'string' && c.linked_token);
}
export function forwardLinkedKey(headers, c) {
  if (handoffLinked(c)) headers[LINKED_KEY_HEADER] = c.linked_token;
}
export function createRuntime(d) {
  let mint = (body) => mintHandoff(body, { apiBase: d.apiBase(), internalKey: d.internalKey() });
  let post = (path, body) => d.post(path, body);
  let lookup = async (identity, sref) => fetchJson(new URL(IDENTITY_PATH, d.apiBase()).toString(),
    { headers: { 'X-Internal-Key': d.internalKey() }, json: { identity_ref: identity || '', session_ref: sref || '' } });
  const resolveCache = createTtlCache({ ttlMs: 60_000 });
  const elicitSent = new Set();
  const scOf = (r) => ((r.structuredContent && typeof r.structuredContent === 'object' && !Array.isArray(r.structuredContent))
    ? r.structuredContent : null);
  const walled = (result, name, c) => {
    const sc = scOf(result);
    if (sc && d.isRelayWall(sc, c)) return true;
    if (d.wallIsWalled(result, name, c)) return true;
    if (name === 'execute_plan') {
      try { const id = c._planWallSinkId; return !!id && d.planWallRows(id).length > 0; } catch (_) { return false; }
    }
    return false;
  };
  const wallStatus = (c, name) => {
    try {
      const e = (Array.isArray(c._pendingWallHits) ? c._pendingWallHits : []).find((x) => x && x.name === name);
      return e ? String(e.status || '') : '';
    } catch (_) { return ''; }
  };
  const rt = {
    setSeams({ mint: m, post: p } = {}) { if (m) mint = m; if (p) post = p; },
    setLookup(fn) { lookup = fn || lookup; resolveCache.clear(); },
    handoffElicit(access, toolName, c) {
      try {
        if (!handoffElicitOn() || !access || !access.handoff_url || !access.for_your_human) return false;
        const sid = (c && c.session_id) || '';
        if (!sid || elicitSent.has(sid) || d.urlElicitSent(sid)) return false;
        const srv = d.sessionServer(sid);
        if (!srv || !srv.server) return false;
        const caps = srv.server.getClientCapabilities ? srv.server.getClientCapabilities() : null;
        if (!caps || !caps.elicitation) return false;
        if (elicitSent.size >= 20000) elicitSent.clear();
        elicitSent.add(sid);
        Promise.resolve().then(() => srv.server.elicitInput({ mode: 'url', elicitationId: d.uuid(), url: access.handoff_url,
          message: access.for_your_human }, { timeout: 120000 }))
          .then((r) => console.log(`[handoff-elicit] result sid=${d.logId(sid)} tool=${toolName} action=${(r && r.action) || '?'}`))
          .catch((e) => console.log(`[handoff-elicit] failed sid=${d.logId(sid)} tool=${toolName}: ${String((e && e.message) || e).slice(0, 140)}`));
        return true;
      } catch (_) { return false; }
    },
    async commercialWallStep(result, name, args, c) {
      try {
        const MX = d.MX;
        if (!commercialWallOn() || !MX.expOn(MX.UPGRADE_BLOCK)) return result;
        if (!c || !result || typeof result !== 'object' || !Array.isArray(result.content) || d.isFailureEnvelope(result)) return result;
        if (!d.mxAudience(c, name) || !clientAllowed(c)) return result;
        if (d.tierRank(String(c.tier || '')) >= d.tierRank('pro')) return result;   // nothing left to sell a Pro seat
        if (!walled(result, name, c)) return result;
        const sc = scOf(result) || {};
        if (sc.access !== undefined && sc.access !== 'partial') return result;   // the answer already says it is full (top-metro stamp)
        const proOnlyTools = d.proOnlyTools();
        const proOnly = proOnlyTools.has(String(name || ''));
        // A keyless task an email finishes: the identity ask (lib/wall-identity-v2.mjs) stays, no commercial block.
        // DCHUB_HANDOFF_WITH_EMAIL_ASK (default OFF): the ask stays where it is and the block is added after it.
        if (!c.api_key && !proOnly && !handoffWithEmailAskOn() && d.emailFinishes(name, sc, c)) return result;
        const identity = MX.identityOf(c);
        if (!identity) return result;
        const test = MX.UPGRADE_BLOCK;
        const arm = MX.armFor(identity, test);
        const sid = c.session_id || '';
        if (!d.askOnceSeen(sid, 'handoff_exposure', 'session')) {
          MX.noteExposure(post, { test, identity, tool: name, session_id: sid, platform: c.platform || '' });
          c._mxExposureCall = true;
        }
        if (arm !== MX.TREATMENT) return result;
        const unlocks_with = unlocksWith(name, { proOnlyTools, keyed: !!c.api_key,
          freeKeyed: !!c.api_key && d.tierRank(String(c.tier || 'free')) <= d.tierRank('identified'),
          creditHeavyTools: d.creditHeavy(), wallStatus: wallStatus(c, name), sc });
        const iso = (args && typeof args === 'object' && typeof args.iso === 'string') ? args.iso : '';
        const completed = completedFrom(sc, { iso });
        const withheld = withheldShape(sc);
        if (d.askOnceHas(sid, 'handoff', 'session')) return withAccess(result, buildAccess({ completed, withheld, unlocks_with }));
        const minted = await mint({ tool: name, args: sanitizeArgs(args || {}) || {}, label: labelFrom(args),
          unlocks_with, completed, withheld, visible: visibleSummary(sc, { completed }), identity_ref: identity,
          session_ref: sessionRef(sid), client: String(c.platform || '').slice(0, 40), endpoint: String(c.path || '/mcp').slice(0, 40),
          is_qa: d.isQa(c), user_agent: String(c.user_agent || c.client_ua || '').slice(0, 200) });
        if (!minted || !validHandoffUrl(minted.handoff_url)) return result;
        d.askOnceSeen(sid, 'handoff', 'session');
        const block = buildAccess({ completed, withheld, unlocks_with, handoff_url: minted.handoff_url });
        rt.handoffElicit(block.access, name, c);
        // DCHUB_HANDOFF_OVER_DIGEST (default OFF): on a digest-only wall the handoff is the offer. Only here, where a
        // link was minted and the block is about to be attached; the wall row's digest mark goes with the paragraph.
        if (handoffOverDigestOn() && digestOnlyOffer(result, c._emailAsk)) {
          const bare = withoutDigestOffer(result);
          const out = bare === result ? bare : withAccess(bare, block);
          if (out !== bare) {   // the block was attached (withAccess refuses an answer that already states its access)
            if (DIGEST_ASK_KINDS.has(c._emailAsk)) c._emailAsk = undefined;
            return out;
          }
        }
        return withAccess(result, block);
      } catch (_) { return result; }
    },
    async handoffResolveEnter(c, name) {
      try {
        // 2026-11-25: an execute_plan step takes the lift its plan's call already got (lib/plan-handoff-link.mjs: a
        // single-use in-process token, honoured from the loopback peer only). No second lookup.
        if (handoffResolveOn() && c && !c.api_key && c.loopback_step && c.plan_handoff_link
            && typeof c.plan_handoff_link.tier === 'string' && c.plan_handoff_link.linked_token) {
          const lt = c.plan_handoff_link.tier;
          if (d.tierRank(lt) <= d.tierRank(String(c.tier || 'anonymous'))) return false;
          c.tier = lt; c.handoff_linked = true; c.linked_token = c.plan_handoff_link.linked_token;
          return true;
        }
        if (!handoffResolveOn() || !c || c.api_key || c.loopback_step || !d.internalKey()) return false;
        if (d.isDirectory(c) || d.isCleanPlatform() || /chatgpt|openai/i.test(String(c.platform || ''))) return false;
        if (d.isQa(c) || d.isBot(c)) return false;
        const identity = d.MX.identityOf(c);
        const sref = sessionRef(c.session_id);
        if (!identity && !sref) return false;
        const ck = identity + '|' + sref;
        let hit = resolveCache.get(ck);
        if (hit === undefined) {
          const j = await lookup(identity, sref);
          const t = (j && j.linked === true) ? liftTierFor(j.tier) : '';
          hit = { tier: t, token: t ? linkedTokenOf(j) : '' };
          resolveCache.set(ck, hit);
        }
        const tier = hit && hit.tier;
        if (!tier || d.tierRank(tier) <= d.tierRank(String(c.tier || 'anonymous'))) return false;
        c.tier = tier; c.handoff_linked = true;
        if (hit.token) c.linked_token = hit.token;
        return true;
      } catch (_) { return false; }
    },
    async accessStatusTool(c, { fetchImpl = fetch } = {}) {
      const keyed = !!(c && c.api_key);
      const base = new URL(ENTITLEMENTS_ME_PATH, d.apiBase());
      let headers, json;
      if (keyed) headers = { 'X-API-Key': c.api_key };
      else {
        json = { identity_ref: d.MX.identityOf(c || {}) || '', session_ref: sessionRef(c && c.session_id) };
        headers = { 'X-Internal-Key': d.internalKey() };
      }
      const raw = await fetchJson(base.toString(), { headers, fetchImpl, timeoutMs: 2500, json });
      const out = raw ? shapeAccessStatus(raw, { keyed }) : { ...shapeAccessStatus({}, { keyed }), status: 'unavailable' };
      return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
    },
  };
  return rt;
}
// get_access_status, registered only while DCHUB_ACCESS_STATUS_TOOL is on, straight on the SDK server (not trackedTool:
// no count, catalog or maturity row moves), and dropped from every tools/list, so it is callable by name and never listed.
export function registerAccessStatus(srv, { run, ctx, refused }, env = process.env) {
  if (!accessStatusOn(env)) return false;
  try {
    srv.registerTool(ACCESS_STATUS_TOOL, { title: 'Access status', description: ACCESS_STATUS_DESCRIPTION, inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    async () => {
      const c = ctx();
      if (refused(c)) return { content: [{ type: 'text', text: 'Unknown tool: ' + ACCESS_STATUS_TOOL }], isError: true };
      return run(c);
    });
    return true;
  } catch (e) { console.error('[access-status] register failed: ' + String((e && e.message) || e).slice(0, 120)); return false; }
}
