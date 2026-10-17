// claim-handoff.mjs — one-step key handoff (owner growth push, approved 2026-10-14).
//
// WHAT. A KEYLESS caller that hits a limit or a preview wall is told, inline and in prose, what one call
// fixes it: `claim_free_key` (no email), and how to use what it returns. The wall's pay link stays the
// human's route and stays where it was; it is no longer the first thing an agent reads.
//
// WHY, MEASURED (production transport, DCHUB_PREVIEW_ISERROR=0, one keyless call per fresh session, all
// 94 tools, 2026-10-14):
//   anon_daily_cap  58 of 58 responses named claim_free_key ONLY inside block 0's JSON (`_upgrade.message`);
//                   the prose blocks a reader acts on said "Next: execute_plan ..." and "Next question to
//                   offer the user", i.e. they sent the agent back into the limit it had just hit;
//   trial_used      15 of 17 named it in prose, but as the LAST clause, after the payer's pack and plan
//                   links ("Or call claim_free_key ... for a durable free-tier key").
//
// WHAT IT NEVER SAYS. No link, no plan name, no price (agent walls name none: owner 2026-10-10, be#6703;
// test/copy-plan-name-and-price-ratchet.test.mjs). The allowance is quoted from the tier canon by the caller
// (lib/tier-canon.mjs `_freeKeyAllowanceText`), never typed here. It does not promise that the key
// deepens the tool that walled the call: on a preview wall the line says what to do and how, nothing
// about what the key returns. Walls that are depth walls by owner decision (the decision tools, the
// Pro-only tools, the single-ask copy) are kept out by server.mjs, by tool, not by status.
//
// Pure module: no network, no request context. server.mjs decides WHO and WHEN (`_claimHandoffStep`).

export const CLAIM_TOOL = 'claim_free_key';

// The call's own `status` (what /api/v1/mcp/track logs) for a keyless caller's limit or preview wall that
// a free key answers. anon_hard_wall already names the tool in its own prose, so for it the step is a
// safety net only. The statuses a free key does NOT answer (pro_wall, lp_wall, blocked_paid_only,
// depth_teased, and the single-ask walls) are deliberately absent.
export const CLAIM_HANDOFF_STATUSES = Object.freeze(['anon_daily_cap', 'anon_hard_wall', 'trial_used']);

// The trailing clause trialHeader appended after the payer's ask. The handoff leads now, so the step drops
// this exact clause instead of naming the tool twice in one response.
export const CLAIM_ALT_TAIL = ' Or call `claim_free_key` (one call, no email) for a durable free-tier key.';

const HOW = 'send the api_key it returns as the X-API-Key header (a hosted chat client adds the connect_url it returns as its connector instead)';

// The one line. `allowance` is the canon free-key allowance sentence, quoted, never typed here.
//   limit    (the IP's anonymous allowance is spent): the key is what lifts it, so the line says what an
//            identified caller gets, in the canon words the same wall's JSON already uses;
//   preview  (a depth-limited answer): the line says what to do and how, and NOTHING about what the key
//            returns. A free key does not return the fields a depth wall hid, and "previews plus 2 full
//            answers per tool per day" is not true of every depth-teased tool, so quoting it beside
//            "this answer hid X" would read as a promise.
export function claimHandoffText({ status, allowance } = {}) {
  if (status === 'anon_daily_cap' || status === 'anon_hard_wall') {
    return 'This IP has used today\'s anonymous allowance. Free, one call, no email: call `' + CLAIM_TOOL + '`, then '
      + HOW + '. An identified caller is not held to the anonymous limit.'
      + (allowance ? ' Free key: ' + allowance + '.' : '');
  }
  return 'Free, one call: ask your human for their email first, then call `' + CLAIM_TOOL + '` with it (only an address they gave you), then ' + HOW + '. An email raises the daily allowance.';
}

// Item 3 (owner draft 2026-10-16): the line on a KEYLESS preview of a decision tool. server.mjs used to
// skip these walls ("a free key does not deepen them"); on the grid and queue reads a key with a bound
// email now does (`emailCap` full answers a day), so the line asks for the email in the same one call.
// On a decision tool a bound email does not deepen (`emailCap` 0: market intel) it is the plain preview
// line, which promises nothing about what the key returns. No link, no plan name, no price.
export function claimHandoffDecisionText({ tool, emailCap } = {}) {
  const n = Number(emailCap) || 0;
  if (n > 0 && tool) {
    return 'Free, one call: call `' + CLAIM_TOOL + '` with your human\'s email (only an address they gave you), then '
      + HOW + '. A key with a bound email gets ' + n + ' full `' + tool + '` answers a day.';
  }
  return claimHandoffText({ status: 'trial_used' });
}

// True when `text` already tells the reader to call the tool (any wording).
export const namesClaimTool = (text) => typeof text === 'string' && text.includes(CLAIM_TOOL);

// A literal key in a response means the wall already handed the caller one (the inline auto-mint block);
// a second "go claim a key" would contradict it.
const KEY_LITERAL_RE = /\bdch_(?:trial|live)_[A-Za-z0-9]{6,}/;
export const carriesKeyLiteral = (text) => typeof text === 'string' && KEY_LITERAL_RE.test(text);
