// depth-digest-ask.mjs: the weekly-digest offer on a depth wall (owner 2026-11-08, "build both").
//
// A depth wall withholds fields that only a paid plan returns (list_transactions' count and total
// value, compare_isos' scores, get_pipeline's rows ...). An email opens none of them, so these walls
// never asked for one: 7 days to 2026-11-08, 75% of walled calls carried no email ask, and most of
// them were these. What an email honestly buys here is updates: subscribe_digest sends a free
// weekly email of what changed (double opt-in, one-click unsubscribe). This module is the line and
// the rule for when it may be shown; server.mjs (_depthDigestAskStep) wires it. Pure.
//
// The line says outright that an email does not open the fields, so it cannot read as the unlock
// asks on the grid / queue / rank walls. It names no plan and no price (agent-facing copy).

export const DIGEST_ASK_LEAD = 'An email does not open the fields this preview held back. ';
export const DIGEST_ASK_SOURCE = 'depth_wall';

/** The agent line, one paragraph, or '' for a tool name that is not a plain identifier. */
export function digestAskLine(tool) {
  const t = String(tool || '');
  if (!/^[a-z0-9_]{1,64}$/.test(t)) return '';
  return DIGEST_ASK_LEAD
    + 'If your user would rather hear when this changes, ask for their email (only use an address '
    + 'they gave you) and call `subscribe_digest` with it and source "' + DIGEST_ASK_SOURCE + '": a free '
    + 'weekly email of what changed in the markets and deals they asked about. Double opt-in, '
    + 'one-click unsubscribe.';
}

/**
 * Whether this wall may carry the offer. Every input is a plain fact the caller already holds:
 *  depth      the tool is walled on depth (an email opens nothing more on it)
 *  partial    the result is a preview (preview_is_partial or trial_preview)
 *  bound      the caller already has an email on file
 *  asked      another email ask is already on this response
 *  paid       the caller is on a paid depth tier
 *  excluded   a profile / platform / step that carries no ask lines
 */
export function digestAskApplies({ depth, partial, bound, asked, paid, excluded }) {
  return !!depth && !!partial && !bound && !asked && !paid && !excluded;
}
