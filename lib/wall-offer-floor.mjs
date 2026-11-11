// wall-offer-floor.mjs: no wall leaves without an offer (owner 2026-11-11, item 2).
//
// Funnel 7d to 11-11 (quota_wall_hits.by_tool_email_ask_7d): 397 walls, 210 with any offer (52.9%).
// The asks each wall builder adds are conditional (the first wall of a tool in a session, a keyless
// caller, a session to grant onto, a step the lean step keeps ...), so a repeat wall in a session, a
// Pro / Land & Power wall, an anonymous hard wall and several depth walls reached the agent with a
// pay link and nothing the person could say yes to for free. Measured on main 2026-11-11, real /mcp
// handler, lean on: list_transactions / get_pipeline / compare_isos / hyperscaler_deals / get_tax_
// incentives / get_infrastructure / get_dchub_recommendation repeat walls "pro" only; compare_sites,
// generate_site_analysis, get_composite_site_score "free_key,pro" with no ask; every anon_hard_wall
// "free_key,pro" with no ask.
//
// This is the floor, not a new ask: it runs LAST on the result the agent receives (server.mjs
// _wallOfferFloorStep, after the lean step, so lean cannot cut it) and adds ONE line only when the
// walled answer carries neither an email ask nor the digest offer. Which line is the owner's rule:
//   email   an email opens more on this tool: the bind_email ask (keyless: bind_email with no key
//           returns an email-bound key; keyed without an email: bind_email {api_key, email}).
//   digest  a Depth / Pro tool, whose withheld fields only a paid plan returns (owner 11-02: an email
//           never unlocks depth, DCPI sub-scores included), or a caller whose email is already on
//           file: the weekly digest (subscribe_digest), and for a keyless caller the free key.
// Every line is one paragraph the agent can quote to its person, names no plan and no price, and
// never contacts anyone: subscribe_digest is double opt-in, bind_email needs the address the person
// gave. Pure: no ctx, no network. Kill switch DCHUB_WALL_OFFER_FLOOR=0.
import { DIGEST_ASK_SOURCE } from './depth-digest-ask.mjs';
import { EMAIL_ASK } from './claim-handoff.mjs';

export const FLOOR_EMAIL_LEAD = 'Next step for your user, free:';
export const FLOOR_DIGEST_LEAD = 'Next step for your user, free (an email does not open the fields held back here):';
// A caller whose email is already on file, on a wall an email would otherwise open: no fields claim.
export const FLOOR_DIGEST_LEAD_BOUND = FLOOR_EMAIL_LEAD;

export function wallOfferFloorOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_OFFER_FLOOR) || '').trim());
}

// The offer kind for a walled tool. Inputs are facts server.mjs already holds:
//   proOnly   the tool opens on a paid plan only (Pro-only, or Land & Power other than analyze_site)
//   depth     the wall is a depth wall (lib/depth-digest-ask: no free-key / capacity marker on it)
//   bound     the caller already has an email on file (an email ask buys nothing more)
export function floorOfferKind({ proOnly = false, depth = false, bound = false } = {}) {
  return (proOnly || depth || bound) ? 'digest' : 'email';
}

// The one line. depth=false (a bound caller on a wall an email would open): the digest line without the
// 'an email does not open the fields' clause, which would be false there.
export function floorOfferLine(kind, { keyed = false, bound = false, depth = true } = {}) {
  if (kind === 'email' && !bound) {
    // EMAIL_ASK verbatim: the lean step, the plan reader and the funnel all know the email ask by it.
    return FLOOR_EMAIL_LEAD + ' "Share your email and DC Hub opens more of this answer, no charge." '
      + EMAIL_ASK + ' Only use an address they gave you'
      + (keyed ? ': pass it with your api_key and it is bound to this key.'
        : '; with no key, `bind_email` returns an email-bound key to send as the X-API-Key header.');
  }
  return (depth ? FLOOR_DIGEST_LEAD : FLOOR_DIGEST_LEAD_BOUND) + ' "DC Hub can email you a free weekly summary of what changed here." '
    + 'If they want it (only use an address they gave you), call `subscribe_digest` with that email and source "'
    + DIGEST_ASK_SOURCE + '"; double opt-in, one-click unsubscribe.'
    + (keyed ? '' : ' A free key for more calls a day: `claim_free_key` (one call).');
}

// Whether the final result already carries an offer the person can take for free. `offers` is
// lib/offers-shown.mjs offersShown(result, emailAsk) (already counts the call's email_ask mark).
export function hasFreeOffer(offers) {
  return Array.isArray(offers) && (offers.includes('email_unlock') || offers.includes('digest'));
}

// Put the line in its own text block right after block 0 (the answer's JSON, or its first prose block), where
// the plan's own ask paragraph goes too (server.mjs _withPlanAskParagraph): the closing blocks (the human
// link line, the "(agent)" note, the Source line) keep their order and stay last. Returns a new result.
export function withFloorLine(result, line) {
  if (!line || !result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const blocks = result.content.slice();
  blocks.splice(Math.min(1, blocks.length), 0, { type: 'text', text: line });
  return { ...result, content: blocks };
}
