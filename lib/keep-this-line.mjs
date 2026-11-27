// lib/keep-this-line.mjs — the keep-this line on a keyless FULL answer from the two tools that deliver the most keyless
// full answers (Grok -> Brain 2026-11-27, owner-approved).
//
// WHY. Live /api/v1/mcp/funnel keyless_full_trial (14 days): get_market_dcpi_rank 95 full answers from 40 IPs (Data
// Center Power Index (DCPI) verdicts) and analyze_site 69 from 50 IPs, and those answers did not consistently say what
// a key keeps. One line, at the end of the last data block, before any "Source: DC Hub (" / "Cite as:" footer
// (lib/keyless-return-ask.mjs appendBeforeFooter), in the approved keep-phrase (lib/continuity-ask.mjs KEY_KEEPS).
//
// WHO. server.mjs _keylessReturnStep: a keyless caller, a successful non-walled answer, the same caller filters as the
// keyless return ask (no directory / Claude / core profile, clean platform, bot or internal traffic), never an
// execute_plan step, never /mcp/chatgpt or a ChatGPT client. Skipped when the answer already asks for a key or an email
// (lib/save-key-prompt.mjs answerAsks), or the keyless return line was appended to it. Once per session (no session:
// once per IP hash per 7 days, per replica).
//
// Pure apart from the once-memo the caller passes in. Kill switch DCHUB_KEEP_THIS_LINE=0 (default on).
import { KEY_KEEPS } from './continuity-ask.mjs';
import { appendBeforeFooter } from './keyless-return-ask.mjs';
import { answerAsks } from './save-key-prompt.mjs';

export const KEEP_THIS_LINE = 'A key keeps ' + KEY_KEEPS + ' across sessions. DCHUB_API_KEY is optional. '
  + 'To keep this, share your email with get_api_key.';
export const KEEP_THIS_TOOLS = Object.freeze(new Set(['get_market_dcpi_rank', 'analyze_site']));

export function keepThisLineOn(env = process.env) {
  return !/^(0|off|false|no)$/i.test(String((env && env.DCHUB_KEEP_THIS_LINE) || '').trim());
}

// result: the answer; name: the tool; c: the request context; onceKey: '' = no way to hold "once" (skip);
// once: { take(key) -> bool }; eligible(c) / isWall(result, c): server.mjs's own tests.
export function keepThisLineStep(result, { name = '', c = null, env = process.env, once = null, onceKey = '',
  eligible = () => true, isWall = () => true } = {}) {
  try {
    if (!keepThisLineOn(env) || !KEEP_THIS_TOOLS.has(String(name))) return result;
    if (!result || typeof result !== 'object' || result.isError || !Array.isArray(result.content)) return result;
    if (!c || c.api_key || c.loopback_step) return result;
    if (/chatgpt|openai/i.test(String(c.platform || ''))) return result;
    if (!eligible(c) || isWall(result, c)) return result;
    if (answerAsks(result)) return result;
    if (result.content.some((b) => b && typeof b.text === 'string' && b.text.includes(KEEP_THIS_LINE))) return result;
    if (!onceKey || !once || !once.take(onceKey)) return result;
    return appendBeforeFooter(result, KEEP_THIS_LINE);
  } catch (_) { return result; }
}
