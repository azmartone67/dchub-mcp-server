// lib/resume-state.mjs — the resume line (owner priority 2, 2026-11-08: continuity between sessions).
//
// A key that comes back in a new chat session used to get nothing about what it left behind:
// the returning-key nudge (lib/retention.mjs) only ever asks for an email or reports a DCPI move,
// and personalizeNextSession needs a portfolio block the agent has to fetch first. So a returning
// agent started from zero, and its saved sites, shortlists and watches sat unused.
//
// This is the pure half: the decision and the copy, from what /api/v1/keys/standing reported
// (dchub-backend key_standing.saved_state / top_market / last_seen_at). server.mjs
// _resumeStateStep does the wiring: once per key per UTC day per replica, on a keyed,
// non-directory caller, it appends ONE agent line to the response, and records resume_shown,
// then resume_taken when the same key later calls a tool the line named.
//
// The line is for the agent, never a `Tell the user:` line, so it never competes with the one
// human line a response may carry. It names counts the backend measured and tools that exist,
// nothing else: no plan, no price, no ask.
//
// Kill switch DCHUB_RESUME_STATE=0.

export function resumeStateOn(env = process.env) {
  return !/^(0|off|false|no)$/i.test(String((env && env.DCHUB_RESUME_STATE) || '').trim());
}

// The tools the line can name; a later call to one of them is a resume_taken.
// dchub-backend routes/mcp_funnel_events.RESUME_TOOLS pins the same set.
export const RESUME_TOOLS = Object.freeze(['list_saved_sites', 'get_shortlist', 'list_standing_intents', 'get_changes']);

function _count(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// A shortlist name as the agent will pass it back: the key's own text, so letters, digits, space,
// dot, dash and underscore only, at most 40 characters. Anything else drops the name (never a
// rewritten one the backend would not find).
function _shortlistName(v) {
  const t = typeof v === 'string' ? v.trim() : '';
  return t && t.length <= 40 && /^[A-Za-z0-9 ._-]+$/.test(t) ? t : '';
}

function _plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

// { kind, line, tools } or { kind: null, reason }. Every field it needs and does not get is a
// reason to stay quiet, never a guess:
//   standing.found          the key exists
//   standing.last_seen_at   the key's PREVIOUS session (null on its first): no previous
//                           session, nothing to resume
//   standing.saved_state    {saved_sites, shortlist_sites, watches, shortlist_names}; null = unknown
//   standing.top_market     {slug, name} the market it asked about most (30 days)
export function resumeDecision(standing) {
  const s = standing || {};
  if (s.found !== true) return { kind: null, reason: 'key_not_found' };
  const lastMs = s.last_seen_at ? Date.parse(s.last_seen_at) : NaN;
  if (!Number.isFinite(lastMs)) return { kind: null, reason: 'no_previous_session' };
  const since = new Date(lastMs).toISOString().slice(0, 10);
  const st = (s.saved_state && typeof s.saved_state === 'object') ? s.saved_state : null;
  const sites = st ? _count(st.saved_sites) : 0;
  const short = st ? _count(st.shortlist_sites) : 0;
  const watches = st ? _count(st.watches) : 0;
  if (sites || short || watches) {
    const parts = [];
    const tools = [];
    const calls = [];
    // get_shortlist needs a name; without a usable one the shortlist is counted but not offered.
    const names = (st && Array.isArray(st.shortlist_names) ? st.shortlist_names : []).map(_shortlistName).filter(Boolean);
    if (sites) { parts.push(_plural(sites, 'saved site', 'saved sites')); tools.push('list_saved_sites'); calls.push('list_saved_sites'); }
    if (short) {
      const named = names.length ? ' (' + names.map((n) => '"' + n + '"').join(', ') + ')' : '';
      parts.push(_plural(short, 'shortlisted site', 'shortlisted sites') + named);
      if (names.length) { tools.push('get_shortlist'); calls.push('get_shortlist name="' + names[0] + '"'); }
    }
    if (watches) { parts.push(_plural(watches, 'watch', 'watches')); tools.push('list_standing_intents'); calls.push('list_standing_intents'); }
    tools.push('get_changes');
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
    const pick = calls.length ? calls.join(', ') + ' pick' + (calls.length > 1 ? '' : 's') + ' up where it left off; ' : '';
    return { kind: 'saved', tools,
      line: '(agent: this key is returning; its last session was ' + since + '. From earlier sessions it has '
        + list + '. ' + pick + 'get_changes shows what moved since.)' };
  }
  const m = (s.top_market && typeof s.top_market === 'object') ? s.top_market : null;
  const name = m && typeof m.name === 'string' ? m.name.trim() : '';
  if (m && m.slug && name) {
    return { kind: 'last_market', tools: ['get_changes'],
      line: '(agent: this key is returning; its last session was ' + since + ' and the market it asked about most is '
        + name + ' (' + m.slug + '). get_changes shows what moved since.)' };
  }
  return { kind: null, reason: st ? 'nothing_saved' : 'saved_state_unknown' };
}

// Append the line as its own text block at the end. Never replaces or reorders anything.
export function appendAgentLine(result, line) {
  if (!result || !Array.isArray(result.content) || !line) return result;
  return { ...result, content: [...result.content, { type: 'text', text: line }] };
}

// The funnel event body (dchub-backend routes/mcp_funnel_events.resume_row). Pure.
export function resumeEventBody({ c = {}, event, tool, kind, sessionId = '', isQa = false, platform = '' }) {
  if (!c.api_key || (event !== 'resume_shown' && event !== 'resume_taken')) return null;
  if (kind !== 'saved' && kind !== 'last_market') return null;
  if (event === 'resume_taken' && !RESUME_TOOLS.includes(tool)) return null;
  return {
    event,
    tool: String(tool || ''),
    kind,
    session_id: String(sessionId || ''),
    api_key: c.api_key,
    platform: String(platform || c.platform || ''),
    user_agent: String(c.client_ua || c.user_agent || '').slice(0, 300),
    is_qa: !!isQa,
  };
}
