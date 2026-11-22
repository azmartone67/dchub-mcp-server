// lib/save-key-prompt.mjs — Test B of the Nov 22 monetization tests: the repeat-caller save-key prompt (DRAFT, OFF).
//
// Flag DCHUB_EXP_SAVE_KEY_PROMPT (default OFF; also the kill switch). Keyless callers only. On a keyless identity's
// 3rd successful (non-walled) call in a rolling 24 h, server.mjs _expSaveKeyStep asks the backend
// (POST /api/v1/mcp/experiments/decide), which applies "at most once per identity per 7 days" in BOTH arms and records
// the exposure; the treatment arm's answer gains SAVE_KEY_LINE after the answer, the holdout's is unchanged.
// Skipped (no decide, no exposure, either arm) when: the answer carries a wall or already asks for a key, or the
// session already had an ask (#1594's once-per-session key entry, or any human line): one ask per session in total.
// Never: /mcp/chatgpt or any ChatGPT / OpenAI client, the directory / Claude / core profiles, a clean platform, an
// execute_plan step, a device-matched caller, a gateway, QA or internal traffic, the key / account tools.
// Copy: no price, plan name or allowance. The relay's text said "Save a free key"; "free" is left out under the
// owner's standing no-"free" rule for agent-facing wall copy (2026-11-21 sweep).

export const SAVE_KEY_LINE = "You've used DC Hub a few times today. Save a key with get_api_key so your shortlists "
  + 'and get_changes follow you to the next session.';
export const THRESHOLD = 3;
export const WINDOW_MS = 24 * 3600 * 1000;
export const LOCAL_ONCE_MS = 7 * 24 * 3600 * 1000;

const MAX = 50000;
const _calls = new Map();     // identity -> [ts, ...] of successful calls in the window
const _decided = new Map();   // identity -> ts of the last decide (the backend owns the 7-day rule; this saves calls)

function _trim(map) {
  if (map.size < MAX) return;
  let i = 0; const drop = MAX / 10;
  for (const k of map.keys()) { map.delete(k); if (++i >= drop) break; }
}

// Count one successful call; true when this identity is at THRESHOLD or more in the window and has not been decided
// on this replica in 7 days (so the backend is asked at most once per identity per week per replica).
export function countAndDue(identity, now = Date.now()) {
  if (!identity) return false;
  const list = (_calls.get(identity) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  _trim(_calls);
  _calls.set(identity, list);
  if (list.length < THRESHOLD) return false;
  const d = _decided.get(identity);
  return !(d && now - d < LOCAL_ONCE_MS);
}
export function markDecided(identity, now = Date.now()) {
  if (!identity) return;
  _trim(_decided);
  _decided.set(identity, now);
}

// The answer already asks for a key (or carries a wall ask): Test B stays out of it. The neutral
// "More detail is available at dchub.cloud/connect." line (lib/neutral-connect.mjs) rides every below-paid answer and
// is a pointer, not an ask, so plain /connect does not count; the wall's /mcp/connect, relay and key-tool asks do.
const KEY_ASK_RE = /\b(get_api_key|claim_free_key|bind_email)\b|dchub\.cloud\/mcp\/connect|\/upgrade\/h\/|dchub\.cloud\/u\/[A-Za-z0-9]/i;
export function answerAsks(result) {
  try {
    const parts = [];
    for (const b of (Array.isArray(result && result.content) ? result.content : [])) if (b && typeof b.text === 'string') parts.push(b.text);
    const sc = result && result.structuredContent;
    if (sc && typeof sc === 'object') {
      for (const f of ['next_ask', 'next_tools', 'for_your_human', 'email_ask', 'access', 'upgrade_block']) {
        if (sc[f] !== undefined) parts.push(JSON.stringify(sc[f]));
      }
    }
    return KEY_ASK_RE.test(parts.join('\n'));
  } catch (_) { return true; }   // unknown: do not add a second ask
}

// The line as its own text block after the answer. Never twice.
export function withSaveKeyLine(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  if (result.content.some((b) => b && typeof b.text === 'string' && b.text.includes(SAVE_KEY_LINE))) return result;
  return { ...result, content: [...result.content, { type: 'text', text: SAVE_KEY_LINE }] };
}

export function _resetForTests() { _calls.clear(); _decided.clear(); }
