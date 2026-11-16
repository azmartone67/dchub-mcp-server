// wall-key-line.mjs: the free-key line ahead of the digest offer on a digest-only wall (Grok note N item 1,
// 2026-11-15).
//
// WHY. Live funnel /api/v1/mcp/funnel, quota_wall_hits.by_tool_email_ask_7d, read 2026-11-16 00:4xZ:
// get_pipeline 37 walled hits / 0 with an ask, list_transactions 36/0, get_intelligence_index 31/0,
// compare_sites 21/0, compare_isos 17/0, every one offer_kind 'digest'. Those are Depth / Pro walls
// (lib/wall-offer-floor.mjs floorOfferKind 'digest'), and an email never opens their held-back fields (owner
// 2026-11-02), so they only ever offered the weekly digest. What an email DOES get a caller with no email on file is
// its free key and the daily allowance that comes with it, and nothing said so.
//
// WHAT. On such a wall, for a caller with NO email on file (lib/wall-offers.mjs wallEntitlements bound false), one
// plain line goes AHEAD of the digest offer, in the same block, and the digest offer stays second:
//   "Add your email to get your free key (50 MCP calls/day) and keep going."
// then the tool hint (keyless: `bind_email` with their email returns an email-bound key, or `claim_free_key`;
// keyed without an email: `bind_email` with this key and their email) and "Only use an address they gave you."
// NO link: the wall's one link stays its own human_url (test/anon-top-tools-snapshot, test/spent-cap-link-line:
// one link per wall), and the tool call is the route. No braces either: the line rides the prose after block 0's
// JSON, and a stray "{...}" there reads as a second JSON object to an agent slicing the first {...} out of the text.
// Not for a paid caller: it already holds a key with more than the free allowance.
// It never says the email opens this answer's fields: it does not. The figure is canon's (lib/tier-canon.mjs
// FREE_TIER.identified_calls_per_day, written as canon's FREE_OFFER_EMAIL writes it). No plan, no price.
// The call is marked 'key_line' (lib/keyless-wall.mjs WALL_ASK_KINDS; dchub-backend
// routes/mcp_funnel_events counts it as an email-for-key ask) and offers_shown names 'email_key'.
// A caller with an email on file keeps today's digest line unchanged; Grok's fixed G3 copy is unchanged.
// Pure: no ctx, no network. Kill switch DCHUB_WALL_KEY_LINE=0.
import { FREE_TIER, FREE_OFFER_EMAIL } from './tier-canon.mjs';

export const KEY_LINE_ASK = 'key_line';
export const KEY_LINE_KIND = 'email_key';

export function wallKeyLineOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_KEY_LINE) || '').trim());
}

// Canon's figure, in canon's own form ("50 MCP calls/day"). '' when canon has no number for the rung, or its number
// disagrees with FREE_OFFER_EMAIL: then the line is not built at all rather than state a figure canon does not.
export function keyLineAllowance(perDay = FREE_TIER.identified_calls_per_day) {
  const n = Number(perDay);
  if (!Number.isFinite(n) || n <= 0) return '';
  const s = n + ' MCP calls/day';
  return FREE_OFFER_EMAIL.startsWith(s + ' ') ? s : '';
}

export const KEY_LINE_LEAD = 'Add your email to get your free key';

/** The line. keyed: the caller already holds a key (with no email on it). '' when canon gives no figure. */
export function keyLine({ keyed = false, perDay } = {}) {
  const allowance = keyLineAllowance(perDay);
  if (!allowance) return '';
  return KEY_LINE_LEAD + ' (' + allowance + ') and keep going.\n'
    + (keyed
      ? 'Ask your user for their email, then call `bind_email` with this key and their email: the email is bound to this key.'
      : 'Ask your user for their email, then call `bind_email` with it: with no key it returns an email-bound key '
        + 'to send as the X-API-Key header (or `claim_free_key` with the same email).')
    + ' Only use an address they gave you.';
}

// The key line as it appears in a result (both variants), for offers_shown: the `bind_email` it names is an
// email-for-key ask, not an email that opens this answer.
export const KEY_LINE_RE = /Add your email to get your free key \(\d[\d,]* MCP calls\/day\) and keep going\.\nAsk your user for their email, then call `bind_email`[^\n]*?Only use an address they gave you\./g;

// Whether this wall gets the line: a digest-only wall (floor kind 'digest') for an unpaid caller with no email on
// file, whose answer carries the digest offer (already, or the floor adds it now) and no email unlock ask.
export function keyLineEligible({ floorKind = '', bound = false, paid = false, digest = false, unlock = false, env = process.env } = {}) {
  return wallKeyLineOn(env) && floorKind === 'digest' && !bound && !paid && !!digest && !unlock;
}

const isProse = (b) => b && b.type === 'text' && typeof b.text === 'string' && !/^\s*[{[]/.test(b.text);

// Put the line AHEAD of the digest offer, in the digest's own text block (the first prose block naming
// `subscribe_digest`), so the two read as one offer: the free key first, the weekly summary second. Returns the
// result unchanged when no prose block carries the digest offer (the line is never placed without it).
export function withKeyLineAheadOfDigest(result, line) {
  if (!line || !result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const i = result.content.findIndex((b) => isProse(b) && /`subscribe_digest`/.test(b.text));
  if (i < 0) return result;
  const blocks = result.content.slice();
  blocks[i] = { ...blocks[i], text: line + '\n\n' + blocks[i].text };   // its own paragraph, ahead
  return { ...result, content: blocks };
}
