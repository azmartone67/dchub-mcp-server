// lib/wall-oauth-lead.mjs — OAuth sign-in as the LEAD offer on a wall (owner 2026-11-12, 12:53 PM Phoenix:
// "Make OAuth sign-in the lead wall offer and add a free-key offer to Grok's wall").
//
// WHY. Funnel 2026-11-12: identity durability is the weak link — a keyless agent that hits a wall and takes the
// email step still arrives from a new session each call, while a sign-in (AuthKit, /mcp/oauth) gives its person
// one identity every later call carries. A wall used to lead with the email ask or the digest and never named the
// sign-in URL. OAuth is performed by the CLIENT in answer to a 401 + WWW-Authenticate challenge, which tool text
// cannot trigger, so the offer is a line that names the URL to connect through and tells the agent what its person
// does: add that URL as the connector, which opens the DC Hub sign-in. It leads: the line sits right after block 0,
// ahead of the email ask / digest line, which stay as the secondary offers on the same wall.
//
// WHERE. server.mjs _wallOfferFloorStep, the last step on /mcp, only on a walled answer, only while WorkOS validation
// is on (without it /mcp/oauth serves keyless, so there would be nothing to sign in to), never for a caller that is
// already signed in (c.auth_oauth) or email-bound (durable already).
//   · walls the floor is allowed on: the sign-in line leads, whatever else the wall offers;
//   · Grok (contract G3, fixed copy): the wall copy is untouched; ONE extra block is added after it, naming
//     /mcp/grok/oauth as the free key (an account bound to the sign-in). No header, config or reconnect copy and no
//     tool name (a hosted connector has no header field and Grok's tools/list is eleven tools), no price, no plan.
// Not on: a clean platform, the directory / Claude / core profiles (frozen or commerce-free copy), an execute_plan
// step (the plan answer speaks for it), the key / account tools (server.mjs _floorStanding).
//
// No prices and no plan names: this is the free path. Kill switch DCHUB_WALL_OAUTH_LEAD=0.

export const OAUTH_SIGNIN_URL = 'https://dchub.cloud/mcp/oauth';
export const GROK_OAUTH_SIGNIN_URL = 'https://dchub.cloud/mcp/grok/oauth';
export const OAUTH_LEAD = 'Best next step for your user, free:';
export const GROK_OAUTH_LEAD = 'A free key for your user:';

export function wallOauthLeadOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_OAUTH_LEAD) || '').trim());
}

// Pure decision. `walled`: the answer is a wall or a tier-masked preview. `signedIn`: c.auth_oauth === true.
export function wallOauthLeadEligible({ walled, workosEnabled, signedIn, bound, env = process.env } = {}) {
  if (!walled || !workosEnabled) return false;
  if (signedIn || bound) return false;
  return wallOauthLeadOn(env);
}

// depth: nothing an account opens is on this wall (the fields held back stay held back), so the line claims no more
// than the sign-in gives: a durable identity, and the free allowance that comes with it.
export function wallOauthLeadLine({ grok = false, depth = false } = {}) {
  if (grok) {
    return GROK_OAUTH_LEAD + ' "Sign in once and your sign-in counts as a free DC Hub key, with more calls a day than no key." '
      + 'Connect the DC Hub connector with ' + GROK_OAUTH_SIGNIN_URL + ' instead of /mcp/grok (same tools); '
      + 'the connector opens the DC Hub sign-in, so there is nothing to copy or paste. No payment is involved.'
      + (depth ? ' An account does not open the fields held back here.' : '');
  }
  return OAUTH_LEAD + ' "Sign in once and DC Hub remembers you across sessions; the sign-in counts as your free key." '
    + 'Add ' + OAUTH_SIGNIN_URL + ' as the DC Hub connector URL in place of /mcp (same tools and data); '
    + 'the client opens the DC Hub sign-in and sends the token itself, so there is no key to copy. '
    + 'No payment is involved.'
    + (depth ? ' An account does not open the fields held back here.' : '');
}

// Own text block right after block 0, ahead of the floor / email / digest line already placed there.
export function withOauthLeadLine(result, line) {
  if (!line || !result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const blocks = result.content.slice();
  blocks.splice(Math.min(1, blocks.length), 0, { type: 'text', text: line });
  return { ...result, content: blocks };
}

export const OAUTH_SIGNIN_RE = /https:\/\/dchub\.cloud\/mcp\/(?:grok\/)?oauth\b/;
