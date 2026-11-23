// plan-report.mjs -- a shareable report link on every execute_plan answer (2026-11-22, flag DCHUB_PLAN_REPORT_LINK).
//
// WHY. An agent takes DC Hub's answer and the human never meets DC Hub: 223 agents a week, 0 MCP-attributed paid.
// A report link gives the agent one thing to hand its human: https://dchub.cloud/r/a/<id>, a dated, cited memo of
// this exact answer (the question, the headline, the dated facts, the sources, as_of) that the human can open and
// forward. The full detail, the PDF and alerts sit behind sign-in on that page (dchub-backend routes/plan_report.py).
//
// WHAT. planReportStep runs LAST on an execute_plan result (after every trim and wall rewrite), so the payload it
// sends is the answer AS THIS CALLER SAW IT: a keyless caller's report can hold no figure its answer withheld.
// buildReportPayload reads only a whitelist (the backend applies the same whitelist again); step bodies never leave.
// The id is drawn here (18 random bytes, base64url = 24 chars), so the mint is idempotent and the URL carries
// nothing else. The mint waits at most PLAN_REPORT_TIMEOUT_MS; a slow, failed or refused mint (503 while the
// owner-applied table is missing) means no report_url, never a broken answer and never a dead link.
//
// Where: canonical /mcp and /mcp/core (core keeps report_url, lib/core-profile.mjs). Not /mcp/chatgpt or
// /mcp/claude (their reviewed copy is frozen), not a clean platform, not a loopback step, not a plan with no data.
// Off (the default): the result is returned unchanged, by reference.

import { randomBytes } from 'node:crypto';

export const PLAN_REPORT_FLAG = 'DCHUB_PLAN_REPORT_LINK';
export const PLAN_REPORT_TIMEOUT_MS = 700;
export const PLAN_REPORT_URL_RE = /^https:\/\/dchub\.cloud\/r\/a\/[A-Za-z0-9_-]{24,48}$/;
const DATA_STATUSES = new Set(['executed', 'gated_preview']);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const str = (v, cap = 600) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, cap) : null);

export function planReportOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[PLAN_REPORT_FLAG]) || '').trim());
}

// DCHUB_PLAN_REPORT_LINK_PROFILES (owner 2026-11-23, default empty = unchanged): the directory profiles and
// ChatGPT-identified platforms skipped the link at launch. `claude` opens it on the Claude directory profile,
// `chatgpt` on the ChatGPT directory profile and on clean (ChatGPT/OpenAI) platforms. Comma-separated.
export const PLAN_REPORT_PROFILES_FLAG = 'DCHUB_PLAN_REPORT_LINK_PROFILES';
export function planReportProfileOn(kind, env = process.env) {
  const v = String((env && env[PLAN_REPORT_PROFILES_FLAG]) || '').toLowerCase();
  return v.split(',').map((x) => x.trim()).filter(Boolean).includes(kind);
}

/** A report URL this server minted (the only report_url /mcp/core keeps). Pure. */
export function isPlanReportUrl(v, env = process.env) {
  return planReportOn(env) && typeof v === 'string' && PLAN_REPORT_URL_RE.test(v);
}

export function newReportId() {
  return randomBytes(18).toString('base64url');
}

// Block 0 is the plain-language lead (lib/plan-lead-text.mjs) on most surfaces, but a walled answer can open with
// wall copy instead: a link (a session-bound relay or sign-in URL must never reach a page anyone can forward), an
// email or key ask. Such a block is not the answer's lead, so it is not used; the headline and facts carry the page.
const NOT_A_LEAD = /https?:\/\/|www\.|\bemail\b|\bsign[ -]?in\b|\bapi[ _-]?key\b|\b(free|your|get a) key\b|\bwithheld\b|\bunlock|\bupgrade\b|\btrial\b/i;
function leadText(result) {
  const b = Array.isArray(result && result.content) ? result.content[0] : null;
  const t = b && b.type === 'text' && typeof b.text === 'string' ? b.text.trim() : '';
  if (!t || t[0] === '{' || t[0] === '[' || NOT_A_LEAD.test(t)) return null;
  return str(t, 1200);
}

function verdictOf(sc) {
  const v = sc.dcpi_verdict;
  if (!isObj(v)) return null;
  const word = str(v.verdict, 40) || str(v.dcpi_verdict, 40);
  if (!word) return null;
  const out = { verdict: word };
  const market = str(v.market, 120) || str(v.market_name, 120) || str(v.market_slug, 120);
  if (market) out.market = market;
  const score = v.score ?? v.dcpi_score ?? v.composite;
  if (typeof score === 'number' && Number.isFinite(score)) out.score = score;
  const asOf = str(v.as_of, 40);
  if (asOf) out.as_of = asOf;
  const cite = str(v.cite_as, 300);
  if (cite) out.cite_as = cite;
  return out;
}

function citationsOf(sc) {
  if (Array.isArray(sc.citations)) {
    return sc.citations.filter(isObj).slice(0, 24).map((c) => ({
      ...(str(c.cite_as, 300) ? { cite_as: str(c.cite_as, 300) } : {}),
      ...(str(c.source, 200) ? { source: str(c.source, 200) } : {}),
      ...(str(c.url, 400) ? { url: str(c.url, 400) } : {}),
      ...(str(c.as_of, 40) ? { as_of: str(c.as_of, 40) } : {}),
    })).filter((c) => c.cite_as || c.source);
  }
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(sc.executed) ? sc.executed : []) {
    const r = isObj(e) && isObj(e.result) ? e.result : null;
    if (!r) continue;
    const cit = isObj(r.citation) ? r.citation : {};
    const cite = str(cit.cite_as, 300) || str(r.cite_as, 300) || (typeof r.citation === 'string' ? str(r.citation, 300) : null);
    if (!cite || seen.has(cite)) continue;
    seen.add(cite);
    const asOf = str(cit.as_of, 40) || str(r.as_of, 40);
    out.push({ cite_as: cite, ...(asOf ? { as_of: asOf } : {}) });
    if (out.length >= 24) break;
  }
  return out;
}

function factsOf(sc) {
  const own = isObj(sc.intent_answer) && Array.isArray(sc.intent_answer.facts) ? sc.intent_answer.facts : [];
  const facts = [...(Array.isArray(sc.facts) ? sc.facts : []), ...own];
  const out = [];
  const seen = new Set();
  for (const f of facts) {
    if (!isObj(f)) continue;
    const text = str(f.text, 500);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, ...(str(f.as_of, 40) ? { as_of: str(f.as_of, 40) } : {}), ...(str(f.tool, 64) ? { tool: str(f.tool, 64) } : {}) });
    if (out.length >= 24) break;
  }
  return out;
}

function asOfOf(sc) {
  const m = /AS_OF:\s*(\d{4}-\d{2}-\d{2}[0-9T:Z]*)/.exec(String(sc.fact_header || ''));
  if (m) return m[1];
  return (isObj(sc.provenance) && str(sc.provenance.as_of, 40)) || null;
}

/** The whitelisted copy of a finished execute_plan result, or null when it is not one. Pure. */
export function buildReportPayload(result) {
  const sc = result && result.structuredContent;
  if (!isObj(sc) || sc._entity !== 'plan_execution' || !Array.isArray(sc.executed)) return null;
  const question = str(sc.intent, 1000);
  if (!question) return null;
  const steps = sc.executed.filter(isObj).slice(0, 16).map((e) => ({
    tool: e.tool, status: e.status, ...(e.depth === 'preview' ? { depth: 'preview' } : {}),
  })).filter((s) => typeof s.tool === 'string');
  const p = { question, steps };
  const lead = leadText(result);
  if (lead) p.lead = lead;
  const headline = isObj(sc.intent_answer) ? str(sc.intent_answer.headline, 600) : null;
  if (headline) p.headline = headline;
  if (str(sc.intent_class, 64)) p.intent_class = str(sc.intent_class, 64);
  if (typeof sc.fact_header === 'string') p.fact_header = sc.fact_header.slice(0, 1600);
  const asOf = asOfOf(sc);
  if (asOf) p.as_of = asOf;
  const v = verdictOf(sc);
  if (v) p.verdict = v;
  const facts = factsOf(sc);
  if (facts.length) p.facts = facts;
  const cites = citationsOf(sc);
  if (cites.length) p.citations = cites;
  p.held_back = steps.some((s) => s.depth === 'preview' || s.status === 'gated_preview')
    || (isObj(sc.first_full_answer_used) && Array.isArray(sc.first_full_answer_used.held_back_steps)
      && sc.first_full_answer_used.held_back_steps.length > 0);
  return p;
}

/** Did any data step come back (executed or a gated preview)? A plan with no data gets no report. Pure. */
export function planHasData(result) {
  const sc = result && result.structuredContent;
  return isObj(sc) && Array.isArray(sc.executed) && sc.executed.some((e) => isObj(e) && DATA_STATUSES.has(e.status));
}

export const REPORT_LINE = (url) => `Shareable report of this answer for your user: ${url} (the question, dated facts and sources; opens in a browser).`;

/**
 * The result with structuredContent.report_url and one closing text line, or the result unchanged.
 * opts: { skip, mint(body) -> Promise<{ok, report_url}>, client, callerClass, isQa, env, timeoutMs }
 */
export async function planReportStep(result, name, opts = {}) {
  try {
    const env = opts.env || process.env;
    if (opts.skip || name !== 'execute_plan' || !planReportOn(env) || typeof opts.mint !== 'function') return result;
    if (!result || result.isError || !Array.isArray(result.content) || !planHasData(result)) return result;
    const payload = buildReportPayload(result);
    if (!payload) return result;
    const id = newReportId();
    const body = { id, payload, client: opts.client || 'unknown', caller_class: opts.callerClass || 'keyless',
      is_qa: !!opts.isQa };
    const ms = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : PLAN_REPORT_TIMEOUT_MS;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
    let got;
    try { got = await Promise.race([Promise.resolve().then(() => opts.mint(body)), timeout]); } finally { clearTimeout(timer); }
    const url = got && got.ok !== false && typeof got.report_url === 'string' ? got.report_url : null;
    // Only a URL that names the id we drew: a mint answering anything else gives no link.
    if (!url || !PLAN_REPORT_URL_RE.test(url) || !url.endsWith('/r/a/' + id)) return result;
    return {
      ...result,
      structuredContent: { ...result.structuredContent, report_url: url },
      content: [...result.content, { type: 'text', text: REPORT_LINE(url) }],
    };
  } catch (_) {
    return result;   // a link is never worth losing the answer
  }
}
