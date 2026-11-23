// lib/continuity-ask.mjs — the email ask, in plain words, as continuity (Grok -> Brain 2026-11-17,
// "MCP funnel conversion gap").
//
// MEASURED (live /api/v1/mcp/funnel, 2026-11-17 ~00:30Z): 807 of 1,215 walls in 7 days already carried an
// email ask (66%; 91% with the digest offer) and 0 emails were entered over MCP. The ask is shown; nobody
// answers it. The old lines sold an unlock ("unlock the full data free", "N full answers a day"), which
// note F / option A now bars from agent-facing text (no prices, plan names, free tier, credits or
// calls-per-day wording). These lines say what an email keeps: the key, saved shortlists, alerts and the
// changes the caller tracks, for the next chat. Every claim is a tool that exists on /mcp
// (save_to_shortlist, set_market_alert / set_shortlist_alert, get_changes, recover_my_key).
//
// Kill switch DCHUB_CONTINUITY_ASK=0 restores the earlier owner-approved wording everywhere this module
// is read (lib/retention.mjs). Pure: no network, no request context.

export function continuityAskOn(env = process.env) {
  return !/^(0|off|false|no)$/i.test(String((env && env.DCHUB_CONTINUITY_ASK) || '').trim());
}

export const CONNECT_LINE = 'More detail is available at dchub.cloud/connect.';
const KEEPS = 'your saved shortlists, alerts and the changes you track';

// Grid / queue walls and the in-chat free-key form: the email really opens the full answer there
// (email-full decision tools; claimHandoffFreekeyText's bind_email mints an email-bound key), so the line
// still says so, then what the email keeps. "held back part of this answer" stays the line's opening:
// the wall tests find the line by it.
export function continuityWallLineText(url) {
  return 'DC Hub held back part of this answer. Reply with your email and I\'ll open the full answer and keep '
    + KEEPS + ' with it for your next chat. Your email is used only for this key and receipts. '
    + 'Or open this link: ' + url;
}
// The page-only free-key wall (no agent line to act on a reply): the link page leads with the email box.
export function continuityFreekeyLineText(url) {
  return 'DC Hub held back part of this answer. Open this link and enter your email to see all of it and keep '
    + KEEPS + ' for your next chat: ' + url;
}
// claim_free_key's ask (was claimBenefitText: "a free DC Hub key ... N full answers a day").
export function continuityClaimText() {
  return 'I set up a DC Hub key for this chat. Tell me your email and it opens fuller market '
    + 'answers, and keeps ' + KEEPS + ' for your next chat. Your email is used only for this key and receipts. '
    + CONNECT_LINE;
}
// claim_free_key's free_tier_rule VALUE (the field name stays: renaming it breaks clients). The keyless
// clause is the enforced rule (lib/tier-canon.mjs KEYLESS_FIRST_FULL_CLAUSE, passed in); the email half
// says what the key keeps instead of an allowance and a pricing pointer.
export function keyRuleText(keylessClause = '') {
  return (keylessClause ? keylessClause + ' ' : '') + 'With an email, the key keeps ' + KEEPS
    + ' for your next chat. ' + CONNECT_LINE;
}
// free_tier_decision_tools VALUE: the email-full decision tools, without the per-day count.
export const DECISION_TOOLS_LINE = 'Grid/queue/market-intel tools: previews without an email; an email opens fuller answers.';
// A key with no email, back on a later UTC day (server.mjs _returnNudgeStep): one line at the END of the
// answer, not a wall and not ahead of the data.
export function continuityReturnLine(marketName = '') {
  const m = typeof marketName === 'string' ? marketName.trim() : '';
  return 'Tell the user: "Welcome back. Want this to carry over to your next chat? Tell me your email and DC Hub '
    + 'keeps this key, ' + KEEPS + ' with it' + (m ? ', and can tell you when ' + m + ' changes' : '') + '. '
    + CONNECT_LINE + '"';
}
export const CONTINUITY_RETURN_AGENT =
  '(agent: only an address the user typed here; then call bind_email {email}. Ask once; do not repeat it this week.)';

// ── Agent-facing copies of the same promise (note F, option A, 2026-11-17) ──────────────────────────────
// The handshake, the key tools' descriptions and claim_free_key's own result used to sell an allowance
// ("50 calls/day", "10 full answers per tool per day", "Both are free", "Higher limits: dchub.cloud/pricing").
// They now say the same thing the lines above say, in the agent's voice: what the key KEEPS. One wording,
// read from here, so the handshake, tools/list and the claim result cannot drift into a second voice.
export const KEY_KEEPS = 'saved shortlists, alerts and tracked changes (get_changes)';
// initialize instructions (server.mjs _INSTRUCTIONS_LEAN). The tool names stay exactly as they are.
export const KEYS_INSTR_LINE = 'KEYS: get your human\'s email, then `claim_free_key`: the key keeps ' + KEY_KEEPS
  + ' across sessions; save it, never re-mint; `recover_my_key` re-sends a lost one.';
// claim_free_key / bind_email descriptions (server.mjs _emailBenefitText).
export function emailKeepsText() {
  return 'WHAT AN EMAIL KEEPS: the key, with its ' + KEY_KEEPS + ', for the next chat; fuller market '
    + 'answers; a weekly summary of what your key looked up (unsubscribe anytime); and recovery (recover_my_key '
    + 're-sends a lost key to that inbox).';
}
// claim_free_key's own result: the next-session hook and the bind step.
export const KEY_RETURN_HOOK = 'This key keeps get_changes working across sessions. Next session call get_changes since=24h '
  + 'to pull only what moved (DCPI market movers, new facilities, deals, news). Cache the returned generated_at and pass '
  + 'it back each session to keep a running watch.';
export const BIND_STEP_HINT = 'Ask your human for their email, then call bind_email {email}. This key already works; '
  + 'binding keeps its ' + KEY_KEEPS + ' for the next chat AND makes it recoverable next session (the durable-identity '
  + 'default; a header-less web session otherwise starts over anonymous).';

// The words note F / option A keeps out of these lines. test/continuity-ask.test.mjs runs every line above
// through it. "free" alone is listed: none of these lines needs it.
export const NOTE_F_WORDS = /\$\s?\d|\bfree\b|\bpro\b|\bplans?\b|\bpricing\b|\bcredits?\b|\btrial\b|\bper day\b|\ba day\b|calls?\s*(?:\/|per|a)\s*day/i;

// "Asked once" (Grok item 1): one return line per key per 7 days, held per replica in memory (a deploy or a
// second replica can ask again; never more than once a day per replica, the _NUDGE_DAY clock).
export function createOncePerWeek({ cap = 50000, ttlMs = 7 * 86400000, now = () => Date.now() } = {}) {
  const seen = new Map();
  return {
    take(k) {
      if (!k) return false;
      const t = now();
      const at = seen.get(k);
      if (at !== undefined && t - at < ttlMs) return false;
      if (seen.size >= cap) seen.clear();
      seen.set(k, t);
      return true;
    },
    clear() { seen.clear(); },
  };
}

// The line at the end of the answer's last text block (the data stays first).
export function appendTailLine(result, line) {
  if (!result || !Array.isArray(result.content) || !line) return result;
  const content = result.content.slice();
  let i = -1;
  for (let j = content.length - 1; j >= 0; j--) {
    const b = content[j];
    if (b && b.type === 'text' && typeof b.text === 'string') { i = j; break; }
  }
  if (i < 0) content.push({ type: 'text', text: line });
  else content[i] = { ...content[i], text: content[i].text + '\n\n' + line };
  return { ...result, content };
}
