// lib/wall-depth-trial.mjs — the real unlock on the seven digest-only depth walls (owner 2026-11-13, Grok
// "Dead-end walls": list_transactions, get_pipeline, get_dchub_recommendation, hyperscaler_deals, compare_isos,
// get_intelligence_index, get_air_permit_context "offer only the digest ... add one-click OAuth sign-in plus a
// 7-day Pro trial offer to each, so there's a real unlock").
//
// WHAT WAS LIVE (measured 2026-11-13): these walls already led with the OAuth sign-in line (mcp#1391/#1400) and
// the human link on every one of them already opens a page whose button is "Start the 7-day trial" (dchub-backend
// routes/human_relay: the depth page with its trial switch on, the Pro-only page for
// get_dchub_recommendation whenever the trial Payment Link is live). What the AGENT read was two refusals in a
// row, "An account does not open the fields held back here." and "An email does not open the fields this preview
// held back.", and nothing that says what does. So an agent told its person "that data is paid" and stopped:
// the dead end was the copy, not a missing offer.
//
// THIS LINE says what does open them: a free 7-day trial the person starts on the page behind the link the wall
// already carries. No plan name and no price (owner 2026-10-10, agent walls name no plan and state no price):
// the page and Stripe Checkout show those to the person. One trial per person (dchub-backend
// routes/pro_trial_guard ends a repeat trial at once), so the line does not promise a free week to everyone.
//
// WHERE: server.mjs _wallOfferFloorStep, on a walled answer whose standing is 'allowed' (never Grok's fixed G3
// copy, the directory / Claude / core profiles, a clean platform or a plan step), for one of DEPTH_TRIAL_TOOLS,
// at depth (an email opens nothing there), for a caller below a paid plan, and only when the answer carries the
// human link the line points at. It sits right below the block that hands out that link, after the free offers
// (sign-in, digest, free key), so the free path still leads and the digest line stays directly above the human
// line; it does not repeat the URL: the session keeps one pointer (r-relay-cap) and the agent relays the link it
// already has.
//
// COUPLING: the line is true while the page offers the trial. If the backend's depth-page trial switch or the trial
// link itself is turned off, turn this off too: DCHUB_WALL_DEPTH_TRIAL=0.
// Pure: no ctx, no network.

export const DEPTH_TRIAL_TOOLS = Object.freeze(new Set([
  'list_transactions', 'get_pipeline', 'get_dchub_recommendation', 'hyperscaler_deals',
  'compare_isos', 'get_intelligence_index', 'get_air_permit_context',
]));

export const DEPTH_TRIAL_LEAD = 'What opens the fields held back here: a 7-day free trial.';
export const DEPTH_TRIAL_RE = /What opens the fields held back here: a 7-day free trial\./;

// The human link a wall hands the person: the /u/ short link or the signed /upgrade/h/ page.
const HUMAN_LINK_RE = /^https:\/\/dchub\.cloud\/(?:u\/[A-Za-z0-9]+|upgrade\/h\/[A-Za-z0-9_-]+\.[0-9a-f]{32})(?:\?[A-Za-z0-9_=&-]{0,200})?$/;

export function depthTrialOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_DEPTH_TRIAL) || '').trim());
}

// The link the line points at, or '' when the answer carries none (then there is nothing to start it from).
export function humanLinkOf(result) {
  try {
    const sc = result && result.structuredContent;
    if (!sc || typeof sc !== 'object') return '';
    const fy = sc.for_your_human;
    for (const v of [sc.human_url, fy && typeof fy === 'object' ? fy.url : '']) {
      if (typeof v === 'string' && HUMAN_LINK_RE.test(v)) return v;
    }
    return '';
  } catch (_) { return ''; }
}

// Pure decision. `paid`: the caller's tier is a paid plan already (a trial is not its next step).
export function depthTrialEligible({ tool, walled, depth, paid, link, env = process.env } = {}) {
  if (!walled || !depth || paid || !link) return false;
  if (!DEPTH_TRIAL_TOOLS.has(String(tool || ''))) return false;
  return depthTrialOn(env);
}

export function depthTrialLine() {
  return DEPTH_TRIAL_LEAD + ' Your user starts it on the page behind the link for your human (human_url);'
    + ' that page returns these fields for the 7 days. A card is required to start, one trial per person, and only'
    + ' your user can start it: relay that link, do not sign up for them.';
}

// Own text block at index `before` (server.mjs passes the slot right below the human line, or ahead of the closing
// lines). `before` < 1 or past the end: right after block 0. Returns a new result.
export function withDepthTrialLine(result, line, { before = -1 } = {}) {
  if (!line || !result || typeof result !== 'object' || !Array.isArray(result.content)) return result;
  const blocks = result.content.slice();
  const at = (Number.isInteger(before) && before >= 1 && before <= blocks.length) ? before : Math.min(1, blocks.length);
  blocks.splice(at, 0, { type: 'text', text: line });
  return { ...result, content: blocks };
}
