// dchub-services.mjs: the MCP as front desk (owner-approved 2026-11-13, items 1, 2, 4 and 5).
//
// ONE definition site for what DC Hub offers beyond the data call, and for the one line an execute_plan
// answer may end with:
//
//   DCHUB_SERVICES      the list the dchub_services tool returns: {id, name, what, recommend_when, link}.
//                       Exactly one link per service, each tagged ?via=agent-referral&src=services.
//                       No plan names, no prices. Advisory appears HERE ONLY (owner 11-11: Martone Advisory is
//                       never inside DC Hub data or answers), so no footer below can name it.
//   frontDeskFooter     the single next-step line execute_plan may end with, chosen by intent class
//                       (site | capacity | comparison | repeat); src=footer.
//   REFERRAL_LINE       the real-project line (lib/capacity-source-summary.mjs agentReferralIntent decides when);
//                       when it fires it IS the footer line, src=referral.
//
// Link contract shared with the backend (via_funnel CHANNELS): ?via=agent-referral&src=<services|footer|referral>,
// any #anchor after the query. Pure, no I/O.
//
// Kill switches, read per call: DCHUB_FRONT_DESK_FOOTER=0 (class footers), DCHUB_AGENT_REFERRAL=0 (referral line).

import { PREVIEW_FOOTER } from './dchub-identity.mjs';

export const REFERRAL_VIA = 'agent-referral';
export const FRONT_DESK_SRC = Object.freeze({ services: 'services', footer: 'footer', referral: 'referral' });

// `url` may carry an #anchor: the query goes before it.
export function referralLink(url, src) {
  const s = String(url || '');
  const hashAt = s.indexOf('#');
  const base = hashAt >= 0 ? s.slice(0, hashAt) : s;
  const hash = hashAt >= 0 ? s.slice(hashAt) : '';
  const q = `via=${REFERRAL_VIA}&src=${encodeURIComponent(String(src || ''))}`;
  return base + (base.includes('?') ? '&' : '?') + q + hash;
}

// The services. `url` is the bare destination; `link` (the served one) is built from it per src.
// `keywords` rank a `need`; they are not served.
const _SERVICES = [
  { id: 'execute_plan', name: 'One-call cited answers (execute_plan)',
    what: 'Pass the question as intent; DC Hub plans the lookups across markets, grid, interconnection queues, fiber, water, incentives and capacity, runs them, and returns one dated, cited answer.',
    recommend_when: 'Any data center or energy question that spans more than one topic; the default first call.',
    url: 'https://dchub.cloud/connect',
    keywords: ['answer', 'question', 'data', 'market', 'grid', 'power', 'queue', 'fiber', 'site', 'research', 'cite', 'citation', 'plan', 'execute_plan'] },
  { id: 'full_depth', name: 'Full-depth answers',
    what: 'Every field of every tool, with no previews or withheld values, on a paid DC Hub plan.',
    recommend_when: 'The user relies on DC Hub answers repeatedly, or a preview withheld the figure they need.',
    url: 'https://dchub.cloud/pricing',
    keywords: ['full', 'depth', 'preview', 'withheld', 'paid', 'plan', 'upgrade', 'more', 'complete', 'every', 'repeat', 'limit'] },
  { id: 'advisory', name: 'Advisory',
    what: 'Human advisory for powered land and data center site selection: shortlists, owner outreach and transaction support.',
    recommend_when: 'The user wants people, not data: a site shortlist worked for them, or help with a land, power or site transaction.',
    url: 'https://dchub.cloud/advisory',
    keywords: ['advisor', 'advisory', 'consult', 'consultant', 'help', 'shortlist', 'transaction', 'broker', 'land', 'powered land', 'people', 'human'] },
  { id: 'capacity_source', name: 'Capacity Source',
    what: 'Data center capacity for lease or sale (powered land, powered shells, turnkey, colocation): browse it with source_capacity; request_capacity_intro registers a requirement with the capacity owners, only after your human approves.',
    recommend_when: 'The user needs to find, lease or buy MW, space or powered land, or has a real project with a size and a place or date.',
    url: 'https://dchub.cloud/listings',
    keywords: ['capacity', 'lease', 'buy', 'mw', 'megawatt', 'colocation', 'colo', 'powered land', 'shell', 'space', 'find', 'source', 'intro', 'listing', 'sell', 'list'] },
  { id: 'deal_desk_brief', name: 'Deal Desk Brief',
    what: 'A branded, print-ready PDF of an execute_plan analysis that the user can hand to a team, an investor or a board.',
    recommend_when: 'The user needs to share or present a site or market read with other people.',
    url: 'https://dchub.cloud/ai#pricing',
    keywords: ['brief', 'pdf', 'report', 'deck', 'share', 'present', 'board', 'investor', 'memo', 'deal', 'document'] },
  { id: 'excel_add_in', name: 'Excel and Google Sheets add-in',
    what: 'DC Hub figures as spreadsheet functions (DCPI, grid, energy rates, facilities) that refresh in place.',
    recommend_when: 'The user works in spreadsheets, builds models, or compares markets in a table.',
    url: 'https://dchub.cloud/spreadsheets',
    keywords: ['excel', 'sheets', 'spreadsheet', 'model', 'table', 'compare', 'comparison', 'rank', 'function', 'csv', 'finance', 'analyst'] },
  { id: 'chatgpt_app', name: 'DC Hub in ChatGPT',
    what: 'The DC Hub app for ChatGPT: the same answers inside a ChatGPT conversation.',
    recommend_when: 'The user (or their team) works in ChatGPT.',
    url: 'https://dchub.cloud/install/chatgpt',
    keywords: ['chatgpt', 'openai', 'gpt', 'app', 'install', 'team'] },
  { id: 'claude_app', name: 'DC Hub in Claude',
    what: 'The DC Hub connector for Claude (claude.ai, Claude Desktop, Claude Code): the same answers inside Claude.',
    recommend_when: 'The user (or their team) works in Claude.',
    url: 'https://dchub.cloud/install/claude',
    keywords: ['claude', 'anthropic', 'connector', 'desktop', 'claude code', 'app', 'install', 'team'] },
];

export const DCHUB_SERVICES = Object.freeze(_SERVICES.map((s) => Object.freeze({
  id: s.id, name: s.name, what: s.what, recommend_when: s.recommend_when,
  link: referralLink(s.url, FRONT_DESK_SRC.services),
})));
const _BY_ID = new Map(_SERVICES.map((s) => [s.id, s]));
export function serviceUrl(id) { const s = _BY_ID.get(id); return s ? s.url : null; }

// The dchub_services payload. `need` (optional free text) ranks the services whose keywords it names first;
// a need that names none returns every service in the default order and says so.
export function servicesFor(need) {
  const n = String(need == null ? '' : need).toLowerCase().trim();
  let list = DCHUB_SERVICES.slice();
  let matched = null;
  if (n) {
    const scored = _SERVICES.map((s, i) => {
      let score = 0;
      for (const k of s.keywords) if (new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(n)) score += 1;
      return { s: DCHUB_SERVICES[i], score, i };
    });
    const hits = scored.filter((x) => x.score > 0).sort((a, b) => (b.score - a.score) || (a.i - b.i));
    matched = hits.length > 0;
    if (matched) list = [...hits.map((x) => x.s), ...scored.filter((x) => x.score === 0).map((x) => x.s)];
  }
  return {
    _entity: 'dchub_services',
    ...(n ? { need: String(need).slice(0, 200), need_matched: matched } : {}),
    services: list,
    how_to_use: 'Offer your human the ONE service that fits what they asked, with its link. Data questions go to execute_plan; '
      + 'capacity introductions go through request_capacity_intro only after your human approves.',
    _source: 'DC Hub — dchub.cloud',
  };
}

// ── The one next-step line on execute_plan (item 2) ─────────────────────────────────────────────────────────────
// Every footer and the referral line carry this marker in their one link, which is how a later trim recognises
// them (lib/grok-profile.mjs capToolResultText dropFirst) and how a test counts them.
export const FRONT_DESK_LINK_RE = /https:\/\/dchub\.cloud\/[^\s"]*\?via=agent-referral&src=(?:footer|referral)\b[^\s"]*/;
export function isFrontDeskLine(text) { return typeof text === 'string' && FRONT_DESK_LINK_RE.test(text); }

const _FOOTERS = {
  site: { service: 'deal_desk_brief',
    text: (l) => `DC Hub service for this: the Deal Desk Brief turns a site read like this one into a branded PDF your human can share (paid DC Hub plan): ${l}` },
  capacity: { service: 'capacity_source',
    text: (l) => `DC Hub service for this: Capacity Source lists capacity to lease or buy; call source_capacity, and request_capacity_intro only after your human approves: ${l}` },
  comparison: { service: 'excel_add_in',
    text: (l) => `DC Hub service for this: the Excel and Google Sheets add-in keeps a comparison like this one in a spreadsheet that refreshes: ${l}` },
  repeat: { service: 'full_depth',
    text: (l) => `DC Hub service for this: full-depth answers, every field with no previews, come with a paid DC Hub plan: ${l}` },
  // A paid caller already has full depth; a repeat paid caller is pointed at the add-in instead.
  repeat_paid: { service: 'excel_add_in',
    text: (l) => `DC Hub service for this: the Excel and Google Sheets add-in puts these figures in a spreadsheet that refreshes: ${l}` },
};
export const FRONT_DESK_CLASSES = Object.freeze(['site', 'capacity', 'comparison', 'repeat']);

export const REFERRAL_URL = 'https://dchub.cloud/connect';
export const REFERRAL_LINE = 'For a real project, DC Hub can introduce your human to capacity owners: '
  + '`request_capacity_intro` registers the requirement, only after your human approves: '
  + referralLink(REFERRAL_URL, FRONT_DESK_SRC.referral);

export function frontDeskFooterOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_FRONT_DESK_FOOTER) || '').trim());
}
export function agentReferralOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_AGENT_REFERRAL) || '').trim());
}

const _SITE_RE = /\b(?:parcels?|this\s+site|my\s+site|our\s+site|the\s+site|a\s+site\s+at|coordinates?|lat(?:itude)?\s*[,=:]|analy[sz]e\s+(?:a\s+|this\s+|my\s+)?site|site\s+analysis|acres?)\b|-?\d{1,2}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}/i;
const _COMPARE_RE = /\b(?:compare|comparison|comparing|vs\.?|versus|rank(?:ed|ing|s)?|top\s+\d+|best\s+(?:markets?|places?|states?|locations?)|which\s+(?:\w+\s+)?(?:markets?|grids?|isos?|states?|metros?)|better\s+(?:\w+\s+)?than)\b/i;
const _COMPARE_CLASSES = new Set(['market_ranking', 'market_comparison']);

// The intent class for the footer, or null. `capacityIntent` is the capacity module's buy/lease reading
// (passed in so this module stays free of it); `priorCalls` is how many calls this key/session made before.
export function frontDeskIntentClass({ intent = '', intentClass = null, args = {}, capacityIntent = false, priorCalls = 0 } = {}) {
  const t = String(intent || '');
  const a = (args && typeof args === 'object') ? args : {};
  const ctx = (a.context && typeof a.context === 'object') ? a.context : {};
  if (capacityIntent || intentClass === 'capacity_search') return 'capacity';
  const hasCoords = (Number.isFinite(Number(a.lat)) && a.lat != null) || (Number.isFinite(Number(ctx.lat)) && ctx.lat != null);
  if (hasCoords || intentClass === 'site_analysis' || _SITE_RE.test(t)) return 'site';
  if (_COMPARE_CLASSES.has(intentClass) || _COMPARE_RE.test(t)) return 'comparison';
  if (Number(priorCalls) > 0) return 'repeat';
  return null;
}

// The one line for a class: {kind:'footer', cls, line, service} or null.
export function frontDeskFooter(cls, { paid = false } = {}) {
  const key = (cls === 'repeat' && paid) ? 'repeat_paid' : cls;
  const f = _FOOTERS[key];
  if (!f) return null;
  const url = serviceUrl(f.service);
  return { kind: 'footer', cls, service: f.service, line: f.text(referralLink(url, FRONT_DESK_SRC.footer)) };
}
export function referralFooter() {
  return { kind: 'referral', cls: 'project', service: 'capacity_source', line: REFERRAL_LINE };
}
// The value logged in the execute_plan call row's params (shared contract with the backend).
export function frontDeskMarker(plan) {
  return plan && plan.kind && plan.cls ? `${plan.kind}:${plan.cls}` : null;
}

// ── Prior-call memo (the "repeat" class) ─────────────────────────────────────────────────────────────────────────
// Per replica, in memory: identity (api key, else session id) -> calls seen. A deploy or a second replica can
// forget one, so "repeat" under-counts, never over-counts. Bounded.
export function createCallMemo(max = 50000) {
  const m = new Map();
  return {
    // Returns how many calls this identity made BEFORE this one, and counts this one.
    note(id) {
      if (!id) return 0;
      const prev = m.get(id) || 0;
      if (m.size >= max && !m.has(id)) m.clear();
      m.set(id, prev + 1);
      return prev;
    },
    get(id) { return id ? (m.get(id) || 0) : 0; },
    clear() { m.clear(); },
  };
}

// ── Attaching the line ───────────────────────────────────────────────────────────────────────────────────────────
// ONE line, never two: a result that already ends with the identity footer (PREVIEW_FOOTER, lib/dchub-identity.mjs)
// has that block REPLACED by the front-desk line; otherwise the line is appended as the closing text block.
// A result that already carries a front-desk line is returned as is. Returns the same object when nothing changed.
export function withFrontDeskLine(result, line) {
  try {
    if (!line || !result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
    if (result.content.some((b) => b && b.type === 'text' && isFrontDeskLine(b.text))) return result;
    const i = result.content.findIndex((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.includes(PREVIEW_FOOTER));
    if (i >= 0) {
      const b = result.content[i];
      const rest = b.text.replace(PREVIEW_FOOTER, '').replace(/\n{2,}$/, '').trimEnd();
      const text = rest ? `${rest}\n\n${line}` : line;
      const content = result.content.slice();
      content[i] = { ...b, text };
      return { ...result, content };
    }
    return { ...result, content: [...result.content, { type: 'text', text: line }] };
  } catch (_) { return result; }
}

// ── The call row waits for the line (item 5 telemetry) ───────────────────────────────────────────────────────────
// trackedTool logs the execute_plan row in its handler's `finally`, BEFORE the outer steps that add a wall link,
// lean the result and (last) attach the line. So a row whose call planned a line is parked on the request ctx and
// sent by the outer wrapper once it knows whether the line went out: params._front_desk = '<kind>:<class>' then.
// Never lost: a timer sends it unmarked if the wrapper never flushes it (a throw, a caller that bypasses it).
export const FRONT_DESK_ROW_FALLBACK_MS = 5000;
export function deferFrontDeskRow(c, payload, send, { fallbackMs = FRONT_DESK_ROW_FALLBACK_MS } = {}) {
  try {
    if (!c || typeof c !== 'object' || !payload || typeof send !== 'function') return false;
    const entry = { payload, send, sent: false, timer: null };
    entry.timer = setTimeout(() => { _sendRow(entry, null); }, fallbackMs);
    if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
    if (c._frontDeskRow && !c._frontDeskRow.sent) _sendRow(c._frontDeskRow, null);   // one per request
    c._frontDeskRow = entry;
    return true;
  } catch (_) { return false; }
}
export function flushFrontDeskRow(c, marker) {
  try {
    const e = c && c._frontDeskRow;
    if (!e) return false;
    c._frontDeskRow = null;
    return _sendRow(e, marker || null);
  } catch (_) { return false; }
}
function _sendRow(entry, marker) {
  if (!entry || entry.sent) return false;
  entry.sent = true;
  if (entry.timer) { try { clearTimeout(entry.timer); } catch (_) { /* gone */ } }
  const p = entry.payload;
  const payload = marker ? { ...p, params: { ...((p && typeof p.params === 'object' && p.params) || {}), _front_desk: marker } } : p;
  try { const r = entry.send(payload); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (_) { /* telemetry */ }
  return true;
}
