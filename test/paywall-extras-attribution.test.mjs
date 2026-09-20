// The free-tier paywall payload (`buildPaywallExtras`) had NO test of any kind
// and was not exported, so nothing could call it. The sibling guard
// (gated-unlock-is-tokenized) reads source instead, scoped to `upgrade_url:`
// lines carrying a LITERAL url or the UPGRADE_URL constant — and line ~1038 is
// `upgrade_url: upgradeUrl`, a lowercase local. Literal-scan blind, constant-scan
// blind, never executed. Three instruments, one uncovered emission.
//
// WHAT THE SESSIONLESS URL ACTUALLY IS (verified against dchub-backend
// origin/main routes/stripe_direct_upgrade.py::_build_url, 2026-09-19):
//   surface unset -> ref_str = "mcp:tool=<tool>:ref=paywall"   <- agent funnel
//   + sid         -> ref_str = "...:sess=<sid>"                <- session bind
// and routes/conversion_attribution.py::parse_tool() finds the driving tool with
// /tool=([a-z_0-9]+)/. So a sessionless hit IS tool-attributed; what it cannot
// have is the session bind, because there is no session. `direct=1` makes the
// hop 302 straight to Stripe rather than land on the static wall.
//
// This file therefore pins the two properties that must survive a refactor:
// the hop stays PAYABLE (direct=1) and stays ATTRIBUTABLE (tool=), with sid
// present exactly when a session is.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _ctxALS, buildPaywallExtras } from '../server.mjs';

const SID = '1aa6536d-b1d4-24b4-74a8-e89ba266e781';
const ENV = ['DCHUB_INTERNAL_KEY', 'DCHUB_GO_LINKS', 'DCHUB_HUMAN_RELAY',
  'DCHUB_RELAY_KEY_BIND', 'DCHUB_ANON_ATTRIB', 'DCHUB_UPGRADE_URL'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.DCHUB_INTERNAL_KEY = 'test-internal-key-not-a-real-secret';
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

const extras = (ctx) => _ctxALS.run(ctx, () => buildPaywallExtras('analyze_site', 'free'));

/** Payable: the /pricing/upgrade hop with direct=1, which 302s to Stripe.
 *  Without direct=1 it falls into /pricing/checkout/start (the interstitial
 *  that historically zeroed conversions), and bare /pricing is the static wall. */
const isPayableHop = (u) =>
  /^https:\/\/(?:api\.)?dchub\.cloud\/pricing\/upgrade\?/.test(u) && /[?&]direct=1(?:&|$)/.test(u);
/** Attributable: the backend turns ?tool= into `mcp:tool=<tool>:…`, which
 *  conversion_attribution.parse_tool() reads back with /tool=([a-z_0-9]+)/. */
const carriesTool = (u) => /[?&]tool=[a-z_0-9]+(?:&|$)/i.test(u);
const carriesSid = (u) => /[?&]sid=[^&#]+/.test(u);

describe('buildPaywallExtras upgrade_url', () => {
  it('sessionless: payable AND tool-attributed, with no sid to bind', () => {
    const u = extras({}).upgrade_url;
    expect(isPayableHop(u)).toBe(true);
    expect(carriesTool(u)).toBe(true);
    expect(carriesSid(u)).toBe(false);
  });

  it('sessioned: same hop, plus the session bind', () => {
    const u = extras({ session_id: SID }).upgrade_url;
    expect(isPayableHop(u)).toBe(true);
    expect(carriesTool(u)).toBe(true);
    expect(carriesSid(u)).toBe(true);
    expect(u).toContain('sid=' + SID);
  });

  it('carries the CALLER’s session, not a pooled placeholder', () => {
    // 'no-session' pooled every sessionless caller into one row (mcp#430).
    expect(extras({ session_id: SID }).upgrade_url).not.toContain('no-session');
    expect(extras({}).upgrade_url).not.toContain('no-session');
  });

  it('never degrades to the static wall on either path', () => {
    for (const ctx of [{}, { session_id: SID }]) {
      const u = extras(ctx).upgrade_url;
      expect(/\/pricing(?:\?|$)/.test(u)).toBe(false);
      expect(/dchub\.cloud\/ai(?:$|[?#])/.test(u)).toBe(false);
    }
  });

  it('MUST-FAIL CONTROL: each predicate rejects the shape it exists to catch', () => {
    const P = 'https://api.dchub.cloud/pricing/upgrade?from=mcp&tool=analyze_site&tier=free&direct=1';
    expect(isPayableHop(P)).toBe(true);
    expect(isPayableHop('https://dchub.cloud/pricing')).toBe(false);              // static wall
    expect(isPayableHop('https://dchub.cloud/ai#pricing')).toBe(false);           // marketing page
    expect(isPayableHop(P.replace('&direct=1', ''))).toBe(false);                 // interstitial
    expect(carriesTool(P.replace('tool=analyze_site&', ''))).toBe(false);         // attribution lost
    expect(carriesSid(P)).toBe(false);
    expect(carriesSid(P + '&sid=' + SID)).toBe(true);
  });
});
