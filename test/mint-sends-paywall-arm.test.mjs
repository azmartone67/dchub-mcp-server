// r-arm-at-mint (2026-09-29): should-mint-claim carries the caller's paywall arm.
// The backend stamps it on mcp_high_intent_sessions.paywall_arm so the scorecard
// can divide relay opens by relay mints per arm (be#5900). This drives the real
// shouldMintClaim with fetch stubbed and reads the URL it actually requested.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shouldMintClaim, _paywallArmFor, _ctxALS } from '../server.mjs';

const SID = 'e6f1c0de-1234-4aaa-9999-abcdef012345';
const CTX = { session_id: SID, platform: 'claude', client_ua: 'Claude-User', client_ip: '203.0.113.9' };
let seen;
const saved = {};

beforeEach(() => {
  seen = [];
  for (const k of ['DCHUB_PAYWALL_CONTRACT']) saved[k] = process.env[k];
  vi.stubGlobal('fetch', vi.fn(async (u) => {
    seen.push(new URL(String(u)));
    return { ok: true, json: async () => ({ should_mint: false }) };
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const mint = () => _ctxALS.run({ ...CTX }, () => shouldMintClaim(SID, 'get_tax_incentives'));

describe('should-mint-claim sends the paywall arm', () => {
  it('contract on: pc is the arm _paywallArmFor assigns', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'on';
    const arm = _ctxALS.run({ ...CTX }, () => _paywallArmFor(CTX));
    expect(arm).toBe('v2');   // control: the arm exists, so the test below is not vacuous
    await mint();
    expect(seen).toHaveLength(1);
    expect(seen[0].pathname).toBe('/api/v1/mcp/should-mint-claim');
    expect(seen[0].searchParams.get('pc')).toBe('v2');
  });

  it('contract off: no pc at all', async () => {
    process.env.DCHUB_PAYWALL_CONTRACT = 'off';
    await mint();
    expect(seen).toHaveLength(1);
    expect(seen[0].searchParams.has('pc')).toBe(false);
  });
});
