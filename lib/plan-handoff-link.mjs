// plan-handoff-link.mjs — an execute_plan step keeps its caller's agent-handoff access (2026-11-25).
//
// A keyless caller linked through the agent handoff (lib/commercial-wall.mjs handoffResolveEnter: the backend
// resolves the caller's identity or session to a paid tier) gets that tier on a direct call. execute_plan runs
// each step as a loopback tools/call, and handoffResolveEnter skips loopback steps (c.loopback_step), so every
// step re-entered as an anonymous caller on the same IP: preview depth, and the per-IP hard wall once the IP was
// past it. Measured live 2026-11-25: a linked caller's capacity_grid plan got anon_hard_wall on its
// site_selection_canvas step, and its queue and grid steps were skipped for want of an ISO.
//
// The plan hands each step a single-use, in-process token carrying the tier the plan's own call was lifted to and
// the linked token, and the step's handler (loopback peer only) applies the same lift. Same shape as
// lib/plan-caller-ip.mjs: a token that is missing, expired, reused or sent from outside is ignored, so no outside
// caller can claim a lift.

import { randomUUID } from 'node:crypto';

export const PLAN_HANDOFF_LINK_HEADER = 'x-dchub-plan-handoff-link';
const TTL_MS = 120_000;
const MAX_TOKENS = 5000;
const _tokens = new Map();   // token -> { tier, linked, exp }

export function mintPlanHandoffLinkToken(tier, linkedToken, now = Date.now()) {
  const t = typeof tier === 'string' ? tier.trim() : '';
  const l = typeof linkedToken === 'string' ? linkedToken : '';
  if (!t || t.length > 32 || !l || l.length > 512) return null;
  if (_tokens.size > MAX_TOKENS) {
    for (const [k, x] of _tokens) if (x.exp < now) _tokens.delete(k);
  }
  const tok = randomUUID() + randomUUID();
  _tokens.set(tok, { tier: t, linked: l, exp: now + TTL_MS });
  return tok;
}

/** { tier, linked_token } for a live token (and spends it), else null. */
export function consumePlanHandoffLinkToken(tok, now = Date.now()) {
  if (typeof tok !== 'string' || !tok) return null;
  const x = _tokens.get(tok);
  if (x === undefined) return null;
  _tokens.delete(tok);
  return x.exp >= now ? { tier: x.tier, linked_token: x.linked } : null;
}
