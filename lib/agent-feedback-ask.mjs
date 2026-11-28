// Agent feedback ask (Grok -> Brain paste 2026-11-27, Change 5; owner added it 7:40 PM MST).
//
// Once per MCP session, after a successful FULL answer, the result gains ONE extra text content item inviting the
// agent to tell DC Hub, through report_finding, what was useful and what was missing. Nothing else in the result
// moves: the existing content items and structuredContent are the same objects, in the same order.
//
// Behind DCHUB_AGENT_FEEDBACK_ASK, default OFF, read per request: 1 / true / yes / on turns it on; unset, 0, false,
// no or off turns it off. Off, feedbackAskStep returns the result it was given.
//
// Never on: an error (isError, a failure envelope, an error field), a wall or preview (pro_wall, quota_wall,
// _wall, _gated, _preview_only, trial_preview, tease, partial_preview completeness, a non-empty withheld list or a
// *_withheld field), a gated answer as server.mjs judges it (the `gated` argument), our own probes and self-traffic
// (the `excluded` argument), a caller with no real MCP session (once per session cannot be kept without one), or
// the filing / key tools themselves (SKIP_TOOLS).
//
// Once per session: a session that was shown the line, or that filed an agent_feedback finding, is never shown it
// again. The replica's own memo answers first; a session this replica has not seen asks the shared daily counter
// (POST /api/v1/mcp/full-cap/consume, the counter the get_api_key nudge already uses) so the replicas agree. The
// counter only says "first" once per (session, UTC day); when it does not answer, the line is not shown (fail closed).
//
// The line names the tool and both fields, so a client whose tools/list never listed report_finding (the light
// list) can still call it by name: tools/call accepts every DC Hub tool on every listing.
// Copy rule: no prices, plan names, allowances, call counts or the word "free" (NOTE_F_WORDS in
// lib/continuity-ask.mjs; test/agent-feedback-ask.test.mjs runs the line through it).
import { createHash } from 'node:crypto';

export const FEEDBACK_ASK_FLAG = 'DCHUB_AGENT_FEEDBACK_ASK';
export const FEEDBACK_CLASS = 'agent_feedback';
// The params mark on the /api/v1/mcp/track row of the call whose answer carried the line (asks shown).
export const FEEDBACK_ASK_MARK = '_feedback_ask';
// The shared counter's bucket name (mcp_full_answer_counts.tool).
export const FEEDBACK_ASK_BUCKET = 'agent_feedback_ask';
export const FEEDBACK_ASK_MARKER = 'Feedback (optional):';

// The filing tools, the key and account tools, and the tools that describe DC Hub itself: an answer from one of
// them is not a data answer to give feedback on.
export const FEEDBACK_ASK_SKIP_TOOLS = Object.freeze(new Set([
  'report_finding', 'request_enhancement', 'read_inbox', 'discover_tools',
  'get_api_key', 'claim_free_key', 'recover_my_key', 'bind_email', 'unlock_more_data',
  'why_dchub', 'dchub_services', 'get_agent_registry', 'get_dchub_recommendation',
  'accept_capacity_terms', 'accept_capacity_intro', 'request_capacity_intro',
]));

export function feedbackAskOn(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String((env && env[FEEDBACK_ASK_FLAG]) || '').trim());
}

export function feedbackAskText(tool) {
  const t = /^[a-z][a-z0-9_]{1,63}$/.test(String(tool || '')) ? tool : 'this tool';
  return '(agent) ' + FEEDBACK_ASK_MARKER + ' if this ' + t + ' answer helped or fell short, tell DC Hub: call '
    + 'report_finding with class="agent_feedback", tool="' + t + '" and a summary (10 to 280 characters) of what was '
    + 'useful and what was missing. It works with or without a key, and this note is shown once per session.';
}

const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _WALL_KEYS = ['_wall', '_gated', '_preview_only', 'trial_preview', 'tease', 'preview_is_partial',
  'taste_bounded', 'pro_wall', 'quota_wall', 'site_teaser'];
const _WALL_STATUS_RE = /wall|preview|trial_cap|cap_exceeded|gated|withheld|partial/i;

// True when structuredContent marks the answer as anything but full. Pure.
export function scMarksPartial(sc) {
  const s = _obj(sc);
  if (!s) return false;
  if (typeof s.error === 'string' && s.error) return true;
  if (s.ok === false || s.success === false || s.source_unavailable === true || s._error_mitigation) return true;
  if (_WALL_KEYS.some((k) => s[k] === true || (_obj(s[k]) && k !== 'site_teaser') || (k === 'site_teaser' && s[k]))) return true;
  if (_obj(s._upgrade) || _obj(s.upgrade_required)) return true;
  if (typeof s.status === 'string' && _WALL_STATUS_RE.test(s.status)) return true;
  const prov = _obj(s.provenance) || {};
  const cit = _obj(s.citation) || {};
  const comp = s.completeness;
  if (prov.completeness === 'partial_preview' || cit.completeness === 'partial_preview' || comp === 'partial_preview') return true;
  if (_obj(comp) && (comp.status === 'partial' || comp.status === 'partial_preview')) return true;
  if (typeof s.cite_as === 'string' && /partial|preview/i.test(s.cite_as)) return true;
  const pv = _obj(prov.preview) || _obj(s.preview_scope);
  if (pv && Array.isArray(pv.withheld_fields) && pv.withheld_fields.length) return true;
  if (Array.isArray(s.withheld_fields) && s.withheld_fields.length) return true;
  if (Array.isArray(s._locked_fields) && s._locked_fields.length) return true;
  if (Object.keys(s).some((k) => /_withheld$/.test(k))) return true;
  return false;
}

// True when `result` is a successful full answer this step may append to. Pure.
export function isFullAnswer(result) {
  if (!result || typeof result !== 'object' || result.isError) return false;
  if (!Array.isArray(result.content) || !result.content.length) return false;
  if (!result.content.some((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim())) return false;
  if (scMarksPartial(result.structuredContent)) return false;
  // A text-only answer whose first block is a JSON error envelope.
  const t0 = result.content[0] && typeof result.content[0].text === 'string' ? result.content[0].text : '';
  if (!result.structuredContent && t0.charAt(0) === '{') {
    try { if (scMarksPartial(JSON.parse(t0))) return false; } catch (_) { /* prose that starts with a brace */ }
  }
  if (result.content.some((b) => b && typeof b.text === 'string' && b.text.includes(FEEDBACK_ASK_MARKER))) return false;
  return true;
}

// A copy of `result` with the line appended as one new content item. structuredContent and every existing item
// are the same objects; nothing else changes. Pure.
export function appendFeedbackAsk(result, tool) {
  return { ...result, content: [...result.content, { type: 'text', text: feedbackAskText(tool) }] };
}

// The per-replica memo: session id -> 'shown' | 'filed', with the tool whose answer carried the line. Bounded.
export function createFeedbackAskMemo({ cap = 50000, ttlMs = 2 * 86400000, now = () => Date.now() } = {}) {
  const m = new Map();
  const live = (k) => {
    const e = m.get(k);
    if (!e) return null;
    if (now() - e.at > ttlMs) { m.delete(k); return null; }
    return e;
  };
  const put = (k, v) => {
    if (!k) return;
    if (m.size >= cap && !m.has(k)) { const first = m.keys().next().value; m.delete(first); }
    m.set(k, { ...v, at: now() });
  };
  return {
    get: live,
    done: (k) => !!live(k),
    shown: (k, tool) => put(k, { state: 'shown', tool }),
    filed: (k) => { const e = live(k); put(k, { state: 'filed', tool: e ? e.tool : null }); },
    toolFor: (k) => { const e = live(k); return e ? e.tool || null : null; },
    size: () => m.size,
    clear: () => m.clear(),
  };
}

// The shared counter key for one session: a hash, so the counter table never holds a session id.
export function sharedAskKey(sessionId) {
  return 'fa:' + createHash('sha256').update(String(sessionId || '')).digest('hex').slice(0, 32);
}

// The step. opts: { env, memo, consume(key) -> Promise<n|null>, sessionId, gated, excluded, skipProfile }.
// Returns { result, shown } where shown is true only when the line was appended.
export async function feedbackAskStep(result, tool, opts = {}) {
  const o = opts || {};
  try {
    if (!feedbackAskOn(o.env || process.env)) return { result, shown: false };
    if (!tool || FEEDBACK_ASK_SKIP_TOOLS.has(tool)) return { result, shown: false };
    if (o.excluded || o.skipProfile || o.gated) return { result, shown: false };
    const sid = typeof o.sessionId === 'string' ? o.sessionId : '';
    if (!sid || !o.memo) return { result, shown: false };
    if (!isFullAnswer(result)) return { result, shown: false };
    if (o.memo.done(sid)) return { result, shown: false };
    if (typeof o.consume !== 'function') return { result, shown: false };
    let n = null;
    try { n = await o.consume(sharedAskKey(sid)); } catch (_) { n = null; }
    if (!Number.isInteger(n)) return { result, shown: false };   // fail closed: no counter, no line
    if (n > 1) { o.memo.filed(sid); return { result, shown: false }; }   // another replica showed it, or it was filed
    o.memo.shown(sid, tool);
    return { result: appendFeedbackAsk(result, tool), shown: true };
  } catch (_) { return { result, shown: false }; }
}

// After report_finding filed class agent_feedback for this session: never ask it again (this replica at once; the
// other replicas through the shared counter, which this bumps past 1).
export async function noteFeedbackFiled(sessionId, { memo, consume } = {}) {
  try {
    if (!sessionId || !memo) return false;
    const already = memo.done(sessionId);
    memo.filed(sessionId);
    if (!already && typeof consume === 'function') {
      try { await consume(sharedAskKey(sessionId)); } catch (_) { /* best effort */ }
    }
    return true;
  } catch (_) { return false; }
}

// Stamp the asks-shown mark on every held /api/v1/mcp/track row of `tool` (lib/agent-outreach.mjs holdTrackRow),
// before the flush. A row already sent (DCHUB_NEXT_ASK_SHOWN_LOG=0, or a profile that never holds) is not marked.
export function markHeldRowsAsked(c, tool) {
  try {
    if (!c || !Array.isArray(c._heldTrackRows)) return 0;
    let n = 0;
    for (const e of c._heldTrackRows) {
      if (!e || e.sent || !e.row || e.row.tool !== tool) continue;
      const p = _obj(e.row.params) || {};
      e.row = { ...e.row, params: { ...p, [FEEDBACK_ASK_MARK]: 1 } };
      n += 1;
    }
    return n;
  } catch (_) { return 0; }
}
