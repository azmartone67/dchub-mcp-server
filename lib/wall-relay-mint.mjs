// lib/wall-relay-mint.mjs — every walled answer that hands out a relay link is recorded as a relay mint
// (owner via Grok 2026-11-27, funnel leak 1: "Show a sign-up link on every paywalled answer").
//
// The handoff funnel's paywall_to_relay_pct read 25.47% (135 of 530 paywall sessions, 7d, 2026-11-27 03:29Z).
// relay_minted counts mcp_high_intent_sessions rows with claim_minted_at. Only some wall branches wrote one:
//   * the trial-preview and hard-wall branches call trackPaidHit + shouldMintClaim, but the backend mints only
//     once a (session, tool) reaches DCHUB_HIGH_INTENT_THRESHOLD (2), so a session walled once never minted,
//     although its answer already carried the tagged /u/ or /upgrade/h/ link;
//   * the Pro wall (_stampProWall, logged status pro_wall) hands out a link and calls neither, so those
//     sessions are in paywall_hit and never in high_intent or relay_minted;
//   * only lp_wall passed wl=1 (the backend's "this response already handed the human its link" rule).
//
// _wallOuterStep is the one step every /mcp tool answer passes after the wall link is shortened and tagged
// (?via=mcp-wall&wall=<type>&src=<tool>). When that answer is a wall (wall type set) and it carries the link
// (lib/wall-via-tag.mjs wallLinkIssued), this records the paid hit (unless the branch already did, in this
// request) and asks should-mint-claim with wl=1, so the backend mints on the first hit. Same population as the
// existing wall-via memo: never QA callers, never the relay-readout exclusions, never a call with no
// transport session; shouldMintClaim itself still drops bots, probes and the Claude-directory profile.
//
// This does not change the high-intent threshold (it still defines the high_intent stage) and does not change
// any text the caller sees. Kill switch DCHUB_WALL_RELAY_MINT=0 (read per call).

// One retry after this long when the branch's own fire-and-forget paid hit may not have landed yet.
export const WALL_RELAY_MINT_RETRY_MS = 1500;

export function wallRelayMintOn(env = process.env) {
  return !/^(0|false|no|off)$/i.test(String((env && env.DCHUB_WALL_RELAY_MINT) || '').trim());
}

// Pure decision. Returns null (record nothing) or { sid, trackHit } where trackHit says whether this step
// must also write the paid hit (false when a branch already called trackPaidHit for this tool in this request).
export function wallRelayMintPlan({ on = true, wall = null, linkIssued = false, qa = false, excluded = false,
                                    sid = '', trackedTools = null, tool = '' } = {}) {
  if (!on || !wall || !linkIssued || qa || excluded) return null;
  const s = typeof sid === 'string' ? sid.trim() : '';
  if (!s || s === 'no-session' || !tool) return null;
  const already = !!(trackedTools && typeof trackedTools.has === 'function' && trackedTools.has(tool));
  return { sid: s, trackHit: !already };
}
