// r-stop-arbitrage (2026-08-16) — the paywall must stop dispensing free keys
// to the AGENT that hit it.
//
// THE DEFECT, measured on GET /api/v1/admin/relay-watch in a 7d window lying
// entirely after the 2026-07-30 two-artifact split: 560 claims minted → 537
// redeemed BY MACHINE at a 0.79s median gap → machine_arbitrage 95.9%, 554
// free keys issued, human_opened 0, conversions 0. _autoRedeemClaim is the
// call that does it: it POSTs the freshly-minted claim token to
// /api/v1/mcp/high-intent/redeem with X-Internal-Key and hands the resulting
// key straight back to the agent, ~1s after the mint, with no human involved.
//
// What is pinned here is the NETWORK CALL, not the boolean. A test that only
// asserted the flag would still pass if someone re-wired the redeem behind a
// different branch — the thing that burns the token is the fetch, so the fetch
// is what the guard watches.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _autoRedeemEnabled, _autoRedeemClaim } from '../server.mjs';

const ENV = 'DCHUB_AUTO_REDEEM_ENABLE';
let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  delete process.env[ENV];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env[ENV];
});

describe('_autoRedeemEnabled — the opt-in seam', () => {
  it('THE PIN: auto-redeem is OFF by default', () => {
    expect(_autoRedeemEnabled()).toBe(false);
  });

  it('only the exact string "1" enables it', () => {
    for (const v of ['0', '', 'true', 'yes', 'on', 'TRUE']) {
      process.env[ENV] = v;
      expect(_autoRedeemEnabled()).toBe(false);
    }
    process.env[ENV] = '1';
    expect(_autoRedeemEnabled()).toBe(true);
  });

  it('is re-read per call, not frozen at import (#192 untestable-seam lesson)', () => {
    expect(_autoRedeemEnabled()).toBe(false);
    process.env[ENV] = '1';
    expect(_autoRedeemEnabled()).toBe(true);
    delete process.env[ENV];
    expect(_autoRedeemEnabled()).toBe(false);
  });
});

describe('_autoRedeemClaim — the token must not be burned by default', () => {
  it('THE ARBITRAGE PIN: by default it returns null and makes NO network call', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy;
    const out = await _autoRedeemClaim('claim_token_abc', 'generic');
    expect(out).toBeNull();
    expect(spy).not.toHaveBeenCalled();   // ← the claim token survives for the human
  });

  it('MUST-FAIL CONTROL: with the opt-in set, it DOES call the redeem endpoint', async () => {
    process.env[ENV] = '1';
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, api_key: 'k' }) }));
    globalThis.fetch = spy;
    const out = await _autoRedeemClaim('claim_token_abc', 'generic');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('/api/v1/mcp/high-intent/redeem');
    expect(out).toEqual({ ok: true, api_key: 'k' });
  });

  it('no token → null and no call, in either mode', async () => {
    for (const mode of [undefined, '1']) {
      if (mode) process.env[ENV] = mode; else delete process.env[ENV];
      const spy = vi.fn();
      globalThis.fetch = spy;
      expect(await _autoRedeemClaim('', 'generic')).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
