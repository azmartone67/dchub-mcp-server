// lib/wall-to-key.mjs: "wall -> signed-in key" (Brain spec 2026-11-22, 5:20 PM MST, owner Jonathan Martone).
//
// WHY. /api/v1/mcp/funnel, 11-22: 2,394 wall hits this month from 459 identities, 451 of them keyless. Where the email
// ask is shown it works (mcp-wall: 8 visits -> 2 keys), but about a quarter of walled calls get no path to a key (the
// "licence, not with an email" and digest-only walls), the light tool lists coding clients get do not list get_api_key,
// and a key a human claims on the wall page is restored server-side on the session's next call without the agent ever
// being told it (so the next session is keyless again: 0 of 28 mature trial keys returned).
//
// EVERYTHING HERE IS OFF BY DEFAULT. Each piece needs the master flag AND its own sub-flag (1 / true / yes / on):
//   DCHUB_WALL_TO_KEY_V1            master
//   DCHUB_W2K_EMAIL_ASK_ALL         3.1  an email ask on the licence-only / digest-only walls, naming what it opens
//   DCHUB_W2K_SIGNIN_URL            3.2  one copyable sign_in_url per walled result (the wall's own human link)
//   DCHUB_W2K_NEXT_CALL_KEY         3.3  the key a human claimed on the wall page, handed to the agent once
//   DCHUB_W2K_ELICITATION           3.4  one native email ask (elicitation/create, form mode) per session
//   DCHUB_W2K_LEAN_KEY_TOOLS        3.5  get_api_key + recover_my_key on the light / slim tool lists
//   DCHUB_W2K_COPY_NEUTRAL          3.6  neutral access words beside the old "free" values (old keys kept)
// 3.1-3.3 run in the treatment arm only: a salted hash of the keyless caller (DCHUB_W2K_TREATMENT_PCT, default 50), so
// the rollout's 14-day comparison has a control. The arm rides the quota_wall_hit event as `wall_to_key`.
//
// Copy rules (spec): never "free", no prices or plan names, no competitor names, "Data Center Power Index (DCPI)" in
// full, capacity teaser-only. Keyless gating, tiers and quotas are untouched: copy and one key hand-back only.
import { createHash } from 'node:crypto';
import { capWallIdentity } from './keyless-wall.mjs';

export const MASTER_FLAG = 'DCHUB_WALL_TO_KEY_V1';
export const SUB_FLAGS = Object.freeze({
  EMAIL_ASK_ALL: 'DCHUB_W2K_EMAIL_ASK_ALL',
  SIGNIN_URL: 'DCHUB_W2K_SIGNIN_URL',
  NEXT_CALL_KEY: 'DCHUB_W2K_NEXT_CALL_KEY',
  ELICITATION: 'DCHUB_W2K_ELICITATION',
  LEAN_KEY_TOOLS: 'DCHUB_W2K_LEAN_KEY_TOOLS',
  COPY_NEUTRAL: 'DCHUB_W2K_COPY_NEUTRAL',
});
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
export function wallToKeyOn(env = process.env) { return truthy(env && env[MASTER_FLAG]); }
export function subOn(sub, env = process.env) {
  const f = SUB_FLAGS[sub];
  return !!f && wallToKeyOn(env) && truthy(env && env[f]);
}

// ── the A/B arm (3.1-3.3) ───────────────────────────────────────────────────────────────────────────────────────────
export const ARM_TREATMENT = 'w2k';
export const ARM_CONTROL = 'control';
export const EVENT_FIELD = 'wall_to_key';
const ARM_SALT = 'dchub:wall-to-key:v1|';
// The KEYLESS identity on purpose (the cap wall's IP hash, else the session), never the key: the call that hands the
// claimed key back (3.3) arrives with the restored key on ctx, and must land in the same arm as the wall before it.
export function armCallerId(c) {
  try { return capWallIdentity((c && typeof c === 'object') ? c : {}) || ''; } catch (_) { return ''; }
}
export function treatmentPct(env = process.env) {
  const n = Number.parseInt(String((env && env.DCHUB_W2K_TREATMENT_PCT) || '50'), 10);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
}
export function arm(id, env = process.env) {
  if (!id) return null;
  const h = createHash('sha256').update(ARM_SALT + id).digest();
  return (h.readUInt16BE(0) % 100) < treatmentPct(env) ? ARM_TREATMENT : ARM_CONTROL;
}
export function withArmEvent(body, a) {
  if (!body || typeof body !== 'object' || (a !== ARM_TREATMENT && a !== ARM_CONTROL)) return body;
  return { ...body, [EVENT_FIELD]: a };
}

// ── shared result helpers ───────────────────────────────────────────────────────────────────────────────────────────
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (b) => b && b.type === 'text' && typeof b.text === 'string';
const isJsonText = (b) => isText(b) && /^\s*\{/.test(b.text);
// Merge `fields` into structuredContent and the first JSON text block (the two copies an agent reads).
export function withFields(result, fields) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content) || !isObj(fields)) return result;
  let done = false;
  const content = result.content.map((b) => {
    if (done || !isJsonText(b)) return b;
    try {
      const o = JSON.parse(b.text);
      if (!isObj(o)) return b;
      done = true;
      return { ...b, text: JSON.stringify({ ...o, ...fields }) };
    } catch (_) { return b; }
  });
  const sc = isObj(result.structuredContent) ? { ...result.structuredContent, ...fields } : result.structuredContent;
  return { ...result, content, ...(sc !== undefined ? { structuredContent: sc } : {}) };
}
// Every string in the result (content text, JSON values, structuredContent), through f.
function deepStr(v, f, d = 0) {
  if (typeof v === 'string') return f(v);
  if (d > 8 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => deepStr(x, f, d + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = deepStr(x, f, d + 1);
  return o;
}
export function mapStrings(result, f) {
  if (!result || !Array.isArray(result.content)) return result;
  const content = result.content.map((b) => {
    if (!isText(b)) return b;
    if (isJsonText(b)) { try { return { ...b, text: JSON.stringify(deepStr(JSON.parse(b.text), f)) }; } catch (_) { /* prose */ } }
    return { ...b, text: f(b.text) };
  });
  const sc = isObj(result.structuredContent) ? deepStr(result.structuredContent, f) : result.structuredContent;
  return { ...result, content, ...(sc !== undefined ? { structuredContent: sc } : {}) };
}
export const humanLinkOf = (result) => {
  const sc = result && isObj(result.structuredContent) ? result.structuredContent : {};
  const fy = isObj(sc.for_your_human) ? sc.for_your_human : {};
  const u = (typeof sc.human_url === 'string' && sc.human_url) || (typeof fy.url === 'string' && fy.url) || '';
  return /^https:\/\/dchub\.cloud\//.test(u) ? u : '';
};

// ── 3.1 the email ask on every Depth/Pro wall ───────────────────────────────────────────────────────────────────────
// What an email opens, per tool, stated exactly. Only tools whose email-key answer was checked against the server are
// here (see the PR for the check); a tool not listed gets no new promise. `opens` finishes "Add your email ... to open".
// Measured 2026-11-22 against the code (server.mjs applyTierGate, _keyedFreeFacilityResult, lib/siting-email-seat.mjs):
//   search_facilities  keyless: 3 rows. Any DC Hub key: the backend's full list (default 50, up to 100 per call), the
//                      same basic fields; power and capacity figures stay withheld below a licence.
//   site_selection_canvas  an email key: one full answer per UTC month, then the preview again.
//   get_facility, get_pipeline  an email opens no extra row or field; only what a key keeps (KEEP_ONLY).
export const KEEP_ONLY = '';
export const EMAIL_OPENS = Object.freeze({
  search_facilities: 'the full list of matching facilities (up to 100 per call, not the first 3; power and capacity figures stay withheld)',
  site_selection_canvas: 'one full site_selection_canvas answer this month',
  get_facility: KEEP_ONLY,
  get_pipeline: KEEP_ONLY,
});
export const KEEPS = 'keep your saved sites, alerts and tracked changes across sessions';
export const EMAIL_ASK = Object.freeze({ tool: 'get_api_key', arguments: { email: "<your human's email>" } });
// The pre-2026-11-25 licence-only sentence (still matched: a cached or older answer may carry it).
const LICENCE_ONLY_RE = /(?:The withheld fields come with a DC Hub licence, not with an email\.\s*|;\s*the withheld fields come with a DC Hub licence, not with an email)/g;
const TOOL_LABEL_RE = /^[a-z][a-z0-9_]{1,60}$/;
export function emailAskMessage({ tool = '', opens = '', link = '', sessionBound = false } = {}) {
  const label = TOOL_LABEL_RE.test(tool) ? tool : 'this answer';
  const tail = link ? `: ${link}` : '.';
  if (!opens) {
    // Nothing more opens on this tool with an email: say what it keeps, and that the withheld fields need a licence.
    return `Your AI assistant got a preview of ${label} from DC Hub. Add your email on this page to ${KEEPS}; `
      + `the withheld fields need a DC Hub licence${tail}`;
  }
  const next = sessionBound && TOOL_LABEL_RE.test(tool) ? `; your assistant's next ${tool} call returns it` : '';
  return `Your AI assistant got a preview of ${label} from DC Hub. Add your email on this page to open ${opens}${next}${tail}`;
}
// The keep line for a licence-only field: what the email keeps (and opens, where it opens something); the licence
// sentence is no longer the ONLY next step.
// Worded as the wall page words it (dchub-backend routes/wall_relay_page: one key that keeps saved sites, alerts and
// tracked changes); a key does not save a search by itself, so the line never says it does.
export const KEEP_LINE = 'An email keeps your saved sites, alerts and tracked changes';
export function withEmailAskAll(result, { tool, opens = KEEP_ONLY, link, sessionBound = false } = {}) {
  if (!result || !Array.isArray(result.content) || typeof opens !== 'string') return result;
  const message = emailAskMessage({ tool, opens, link, sessionBound });
  const clause = opens ? ' and opens ' + opens : '; the withheld fields need a DC Hub licence';
  let out = mapStrings(result, (s) => s.replace(LICENCE_ONLY_RE, (m) => (m.startsWith(';') ? '; ' + KEEP_LINE.toLowerCase() + clause
    : KEEP_LINE + clause + '. ')));
  out = withFields(out, { human_message: message, email_ask: EMAIL_ASK, email_opens: opens || null });
  const sc = isObj(out.structuredContent) ? out.structuredContent : null;
  if (sc && isObj(sc.for_your_human)) {
    out = { ...out, structuredContent: { ...sc, for_your_human: { ...sc.for_your_human, message } } };
  }
  return out;
}

// ── 3.2 one copyable sign-in URL ────────────────────────────────────────────────────────────────────────────────────
// sign_in_url IS the wall's own human link (the signed /u/ relay link carries via=mcp-wall, tool and the session in its
// token), so there is still exactly one link: no second URL competes with it.
export const RENDER_VERBATIM = 'verbatim_link_required';
export function withSignInUrl(result, link) {
  if (!result || !Array.isArray(result.content) || typeof link !== 'string' || !/^https:\/\/dchub\.cloud\//.test(link)) return result;
  let out = withFields(result, { sign_in_url: link });
  const sc = isObj(out.structuredContent) ? out.structuredContent : null;
  if (sc) {
    const fy = isObj(sc.for_your_human) ? sc.for_your_human : {};
    const fy2 = { ...fy, url: link, render: RENDER_VERBATIM,
      markdown: typeof fy.markdown === 'string' && fy.markdown.includes(link) ? fy.markdown : `[Open DC Hub](${link})` };
    out = { ...out, structuredContent: { ...sc, for_your_human: fy2 } };
  }
  return out;
}
export function linksIn(result) {
  const seen = new Set();
  const re = /https:\/\/dchub\.cloud\/[^\s"'`)<>\]]+/g;
  for (const b of (result && result.content) || []) if (isText(b)) for (const m of b.text.match(re) || []) seen.add(m.replace(/[.,;:]+$/, ''));
  return [...seen];
}

// ── 3.3 the key returns on the very next call ───────────────────────────────────────────────────────────────────────
// The wall page binds the claimed key to the MCP session (backend metadata.session_id); the session's next call restores
// it server-side (auth_source 'session_restore'). Today that call is served under the key but the agent is never told
// the key, so a new session is keyless again. This tells the agent once per session, masked, with where the full key is (per replica: a second replica can
// repeat it once, which is harmless). Only a durable dch_live_ key, never a trial seat.
export const SAVE_LINE = 'Save this key; never re-mint.';
// Never the raw key in a tool answer (Grok 11-22 item 4c): answers are logged, cached and pasted. The block names the
// key by prefix + last 4 and says where the full key is: the wall page emailed it to the human, recover_my_key re-sends it.
export const RETRIEVE_LINE = 'The full key was emailed to your human from the DC Hub page; recover_my_key with their email re-sends it.';
export const RETRIEVE = Object.freeze({ tool: 'recover_my_key', arguments: { email: "<your human's email>" } });
export const RAW_KEY_RE = /\bdch(?:ub)?_(?:live|trial|test|pk|sk|key)?_?[A-Za-z0-9]{12,}/;
export function maskKey(key) {
  const k = String(key || '');
  const m = /^(dch(?:ub)?_[a-z]+_)/.exec(k);
  if (!m || k.length < m[1].length + 8) return '';
  return m[1] + '…' + k.slice(-4);
}
const _issued = new Map();   // session id -> ms
const ISSUED_MAX = 5000;
export function shouldIssue(c) {
  const x = isObj(c) ? c : {};
  const sid = String(x.session_id || '');
  if (!sid || sid === 'no-session' || x.auth_source !== 'session_restore') return false;
  if (!/^dch_live_/.test(String(x.api_key || ''))) return false;
  return !_issued.has(sid);
}
export function markIssued(c, now = Date.now()) {
  const sid = String((c && c.session_id) || '');
  if (!sid) return;
  if (_issued.size >= ISSUED_MAX) _issued.clear();
  _issued.set(sid, now);
}
export function keyIssuedBlock(key) {
  const masked = maskKey(key);
  if (!masked) return null;
  return { api_key_masked: masked, retrieve: RETRIEVE, retrieve_note: RETRIEVE_LINE, note: SAVE_LINE };
}
export function withKeyIssued(result, block) {
  if (!result || !Array.isArray(result.content) || !isObj(block) || !block.api_key_masked) return result;
  const line = '🔑 Your human added their email on the DC Hub page, so this answer is served under their key ('
    + block.api_key_masked + '). ' + RETRIEVE_LINE + ' ' + SAVE_LINE;
  const sc = isObj(result.structuredContent) ? { api_key_issued: block, ...result.structuredContent } : result.structuredContent;
  return { ...result, content: [...result.content, { type: 'text', text: line }], ...(sc !== undefined ? { structuredContent: sc } : {}) };
}

// ── 3.4 native email ask (elicitation, form mode) ───────────────────────────────────────────────────────────────────
export const ELICIT_MESSAGE = 'DC Hub can open the full answer and keep your saved sites and alerts. Share an email?';
export const ELICIT_SCHEMA = Object.freeze({
  type: 'object',
  properties: { email: { type: 'string', format: 'email', title: 'Email' } },
  required: ['email'],
});
export const ELICIT_VIA = 'mcp-elicit';
export const DECLINE_QUIET_MS = 7 * 24 * 3600 * 1000;
const _elicitSessions = new Set();
const _declined = new Map();   // arm id -> ms of the decline
export function elicitDue({ sid, id, caps, userCall = true, now = Date.now() } = {}) {
  if (!sid || sid === 'no-session' || !userCall) return false;
  if (!caps || !caps.elicitation) return false;
  if (_elicitSessions.has(sid)) return false;
  const d = id ? _declined.get(id) : undefined;
  if (d && now - d < DECLINE_QUIET_MS) return false;
  return true;
}
export function markElicited(sid) { if (sid) { if (_elicitSessions.size > ISSUED_MAX) _elicitSessions.clear(); _elicitSessions.add(sid); } }
export function markDeclined(id, now = Date.now()) { if (id) { if (_declined.size > ISSUED_MAX) _declined.clear(); _declined.set(id, now); } }
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[A-Za-z]{2,24}$/;
export function acceptedEmail(r) {
  const e = r && r.action === 'accept' && isObj(r.content) ? String(r.content.email || '').trim() : '';
  return EMAIL_RE.test(e) ? e.slice(0, 200) : '';
}

// ── 3.5 key tools on the light / slim lists ─────────────────────────────────────────────────────────────────────────
export const KEY_TOOLS = Object.freeze(['get_api_key', 'recover_my_key']);
// `names`: the catalog's own names (server.mjs passes the key tool's REGISTERED name, claim_free_key, which the listing
// step renames to get_api_key; a catalog lookup by the listed name finds nothing).
export function withKeyTools(def, names = KEY_TOOLS) {
  if (!def || !Array.isArray(def.tools)) return def;
  const add = names.filter((n) => !def.tools.includes(n));
  return add.length ? Object.freeze({ ...def, tools: Object.freeze([...def.tools, ...add]), keyTools: true }) : def;
}

// ── 3.6 neutral access words ────────────────────────────────────────────────────────────────────────────────────────
// New neutral keys beside the old ones (kept one release for existing consumers): annotations.access_level
// open | preview | keyed next to access free | free_preview | ..., and preview_only next to free_preview_only.
export function neutralAccess(access) {
  const a = String(access || '');
  if (a === 'free') return 'open';
  if (a === 'free_preview' || a === 'preview') return 'preview';
  return a ? 'keyed' : '';
}
export function withNeutralPreviewKey(result) {
  const sc = result && isObj(result.structuredContent) ? result.structuredContent : null;
  if (!sc || typeof sc.free_preview_only !== 'boolean' || Object.prototype.hasOwnProperty.call(sc, 'preview_only')) return result;
  return withFields(result, { preview_only: sc.free_preview_only });
}

export function _resetForTests() { _issued.clear(); _elicitSessions.clear(); _declined.clear(); }
