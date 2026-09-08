// r-invalid-bearer-credkey (2026-09-08) — the challenge BOUND must be keyed to
// the credential, not the caller IP.
//
// The 401 invalid-bearer challenge is deliberate and correct: it is the only
// OAuth signal that tells a client to refresh while its refresh token is still
// good. It is bounded to CHALLENGE_MAX and then SERVES, so "a client that
// cannot do OAuth loses CHALLENGE_MAX calls and then works forever".
//
// That guarantee did not hold. The bound was keyed by caller IP, so a connector
// egressing from a rotating pool started a fresh budget on every new IP and
// never reached the bound — a permanent 401 for exactly the clients the bound
// was written to protect (ChatGPT, Claude-User).
import { describe, it, expect } from 'vitest';
import { _challengeBudgetKey } from '../server.mjs';

const TOKEN = 'dch_live_expired_or_revoked_000000';

describe('challenge budget key', () => {
  it('is STABLE for one credential across rotating egress IPs', () => {
    // THE REGRESSION. Same dead token, three different IPs — one budget.
    const keys = new Set([
      _challengeBudgetKey({ bearer: TOKEN, clientIp: '203.0.113.7' }),
      _challengeBudgetKey({ bearer: TOKEN, clientIp: '198.51.100.42' }),
      _challengeBudgetKey({ bearer: TOKEN, forwardedFor: '192.0.2.9, 10.0.0.1' }),
    ]);
    expect(keys.size).toBe(1);
  });

  it('SEPARATES two different credentials arriving from one shared egress', () => {
    // The other direction still has to work: one office IP, two dead tokens,
    // two budgets — otherwise one caller spends another caller's.
    const a = _challengeBudgetKey({ bearer: TOKEN, clientIp: '203.0.113.7' });
    const b = _challengeBudgetKey({ bearer: TOKEN + 'x', clientIp: '203.0.113.7' });
    expect(a).not.toBe(b);
  });

  it('never embeds the raw token in the key', () => {
    const k = _challengeBudgetKey({ bearer: TOKEN, clientIp: '203.0.113.7' });
    expect(k).not.toContain(TOKEN);
    expect(k).not.toContain('expired_or_revoked');
    expect(k).toMatch(/^ib:c:[0-9a-f]{32}$/);
  });

  it('falls back to caller identity only when no credential is presented', () => {
    expect(_challengeBudgetKey({ clientIp: '203.0.113.7' })).toBe('ib:ip:203.0.113.7');
    expect(_challengeBudgetKey({ forwardedFor: '192.0.2.9, 10.0.0.1' })).toBe('ib:ip:192.0.2.9');
    expect(_challengeBudgetKey({ remoteAddress: '10.1.2.3' })).toBe('ib:ip:10.1.2.3');
    expect(_challengeBudgetKey({})).toBe('ib:ip:unknown');
  });

  it('treats whitespace-only and absent bearers alike', () => {
    expect(_challengeBudgetKey({ bearer: '   ', clientIp: '10.0.0.1' })).toBe('ib:ip:10.0.0.1');
  });
});
