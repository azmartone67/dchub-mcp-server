// answer-markers.mjs — what a gated call's FINAL result gave the caller, for the session-ordered log
// (guided first query, owner 2026-11-02: "add the markers to #1245").
//
// The brief's measure is emails captured AFTER a first answer. mcp_call_log already has one row per
// call with session_id, a ms timestamp and an id, and a bind_email / claim_free_key row is the capture.
// What it could not say is whether a gated response gave an answer, and whether it showed the email
// ask. A wall row is parked until the outer wrapper has the final result (lib/wall-link-track.mjs), so
// the markers are read from that result and ride in the logged params, as `_via_next_ask` does:
//   _answer     'figure'  the answer-first line (grid / queue free figure)
//               'verdict' a verdict string (get_market_dcpi_rank)
//               'rows'    free rows in a row array (rank_markets, list_transactions, get_fiber_intel ...)
//               'partial' a partial preview with no rows or verdict (some free fields)
//               'none'    a gated answer with nothing free in it
//   _email_ask  'after_answer'  the in-chat email ask, after the answer-first line
//               'shown'         the in-chat email ask with no answer-first line before it
//               (absent: no email ask)
// Short values, put FIRST in params: the backend cuts params at 4000 characters. Pure: no ctx, no
// network. Kill switch DCHUB_ANSWER_MARKERS=0.
import { EMAIL_ASK, ANSWER_FIRST_LEAD } from './claim-handoff.mjs';

const ROW_KEYS = ['results', 'transactions', 'features', 'facilities', 'markets', 'data', 'sites', 'candidates', 'projects'];

export function answerMarkersOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_ANSWER_MARKERS) || '').trim());
}

const _prose = (result) => (Array.isArray(result && result.content) ? result.content : [])
  .filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');

export function answerMarkers(result) {
  try {
    if (!result || typeof result !== 'object') return null;
    const sc = result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)
      ? result.structuredContent : {};
    const text = _prose(result);
    const lead = text.indexOf(ANSWER_FIRST_LEAD);
    const ask = text.indexOf(EMAIL_ASK);
    let answer = 'none';
    if (lead >= 0) answer = 'figure';
    else if (typeof sc.verdict === 'string' && sc.verdict.trim()) answer = 'verdict';
    else if (ROW_KEYS.some((k) => Array.isArray(sc[k]) && sc[k].some((r) => r && typeof r === 'object'))) answer = 'rows';
    else if (sc.preview_is_partial === true || sc.trial_preview === true) answer = 'partial';
    const out = { _answer: answer };
    if (ask >= 0) out._email_ask = lead >= 0 && lead < ask ? 'after_answer' : 'shown';
    return out;
  } catch (_) { return null; }
}

// The logged params with the markers first. Leaves `params` alone when there is nothing to add.
export function withAnswerMarkers(params, marks) {
  if (!marks || typeof marks !== 'object') return params;
  const rest = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const { _via_next_ask: via, ...others } = rest;
  return { ...(via !== undefined ? { _via_next_ask: via } : {}), ...marks, ...others };
}
