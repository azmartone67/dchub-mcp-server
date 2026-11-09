// plan-caller-ip.mjs — an execute_plan step is counted against the CALLER's IP, not the loopback's.
//
// execute_plan runs each step as a loopback tools/call to 127.0.0.1 (server.mjs
// _execLoopbackCall). The step's request carries no X-DC-Client-IP and no X-Forwarded-For, so
// the handler's clientIp fell back to the socket peer: 127.0.0.1, for EVERY anonymous plan step
// from EVERY caller. The anonymous per-IP daily cap (_anonOverCap -> backend
// /api/v1/mcp/anon-usage, a count of today's keyless mcp_tool_calls rows for that ip_address)
// therefore counted every caller's plan steps against one address.
//
// Measured live 2026-11-09 08:22Z, anonymous, execute_plan "where in the US is there grid
// headroom for a 100 MW data center": its get_grid_scoreboard step came back as the over-cap
// preview — _upgrade.tier "anon_daily_cap", "You've hit today's free anonymous calls from this
// IP", grids "3 of 46 shown" (three Norwegian/Swedish zones, no US row). A direct anonymous
// get_grid_scoreboard from the same machine a minute later returned all 46 rows, uncapped: the
// caller's own IP was under the cap; the loopback's was not.
//
// The documented model for plan steps is "every step pays the same quota and gets the same tier
// gate as a native call". This restores it: the plan hands each step a single-use, in-process token
// naming the caller's IP, and the step's handler (loopback peer only) uses it as clientIp. Same
// shape as the plan session token (PLAN_SESSION_HEADER): a token that is missing, expired, reused or
// sent from outside is ignored, so no outside caller can choose the IP it is counted under.

import { randomUUID } from 'node:crypto';

export const PLAN_CALLER_IP_HEADER = 'x-dchub-plan-caller-ip';
const TTL_MS = 120_000;
const MAX_TOKENS = 5000;
const _tokens = new Map();   // token -> { ip, exp }

export function mintPlanCallerIpToken(ip, now = Date.now()) {
  const v = typeof ip === 'string' ? ip.trim() : '';
  if (!v || v.length > 64) return null;
  if (_tokens.size > MAX_TOKENS) {
    for (const [t, x] of _tokens) if (x.exp < now) _tokens.delete(t);
  }
  const tok = randomUUID() + randomUUID();
  _tokens.set(tok, { ip: v, exp: now + TTL_MS });
  return tok;
}

export function consumePlanCallerIpToken(tok, now = Date.now()) {
  if (typeof tok !== 'string' || !tok) return null;
  const x = _tokens.get(tok);
  if (x === undefined) return null;
  _tokens.delete(tok);
  return x.exp >= now ? x.ip : null;
}
