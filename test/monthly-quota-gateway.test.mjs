// Unit tests for the monthly-quota GATEWAY CONSUMER — the half the backend's
// phase-2 decision (PR #2289) was written for and never had.
//
// Every test here names the mutation it kills. The feature is revenue-critical
// in BOTH directions: failing to block loses money, blocking wrongly takes a
// paying customer's service away. Fail-open is therefore load-bearing and gets
// the most coverage.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkMonthlyQuota, _setQuotaFetchImpl, _dropQuotaCache,
  _quotaTtlMs, _QUOTA_OPEN, QUOTA_EXEMPT_TOOLS,
} from '../server.mjs';

const KEY = 'dchub_live_test_key';

beforeEach(() => {
  _setQuotaFetchImpl(null);
  _dropQuotaCache(KEY);
});

describe('checkMonthlyQuota — fail-open is the whole safety story', () => {
  it('an anonymous caller is never quota-checked (no key, no hop)', async () => {
    let called = false;
    _setQuotaFetchImpl(async () => { called = true; return { allowed: false }; });
    const d = await checkMonthlyQuota('', 'free');
    expect(d.allowed).toBe(true);
    expect(called).toBe(false);   // kills: hopping to the backend for anon
  });

  it('a backend throw ALLOWS the call', async () => {
    _setQuotaFetchImpl(async () => { throw new Error('ECONNRESET'); });
    const d = await checkMonthlyQuota(KEY, 'paid');
    expect(d.allowed).toBe(true);
    // kills: any refactor that lets an exception become a block
  });

  it('a failure is NOT cached — the next call re-checks and self-heals', async () => {
    let n = 0;
    _setQuotaFetchImpl(async () => {
      n += 1;
      if (n === 1) throw new Error('timeout');
      return { allowed: true, remaining: 10, used: 5, quota: 15 };
    });
    await checkMonthlyQuota(KEY, 'starter');
    const second = await checkMonthlyQuota(KEY, 'starter');
    expect(n).toBe(2);                 // kills: caching the fail-open result
    expect(second.remaining).toBe(10);
  });

  it('a blocked decision is honoured', async () => {
    _setQuotaFetchImpl(async () => ({
      allowed: false, blocked: true, used: 6000, quota: 6000,
      message: 'wall', quota_tier: 'starter',
    }));
    const d = await checkMonthlyQuota(KEY, 'starter');
    expect(d.allowed).toBe(false);
    expect(d.quota_tier).toBe('starter');
  });
});

describe('checkMonthlyQuota — the tier passed to the backend', () => {
  it('forwards the tier verbatim, lowercased', async () => {
    let seen = null;
    _setQuotaFetchImpl(async (_k, t) => { seen = t; return { allowed: true }; });
    await checkMonthlyQuota(KEY, 'starter');
    expect(seen).toBe('starter');
    // The gateway must NOT send the normalized 'paid' for a starter customer:
    // the backend resolves 'paid' -> pro (60,000/mo), a 10x under-enforcement.
    // This asserts the value arrives unmangled; the call site passes c.tier.
  });
});

describe('checkMonthlyQuota — caching and burst collapse', () => {
  it('a second call inside the TTL does not re-hop', async () => {
    let n = 0;
    _setQuotaFetchImpl(async () => { n += 1; return { allowed: true, remaining: 5000 }; });
    await checkMonthlyQuota(KEY, 'pro');
    await checkMonthlyQuota(KEY, 'pro');
    expect(n).toBe(1);   // kills: dropping the cache (a hop on all 82 tools)
  });

  it('concurrent calls collapse into ONE backend hop', async () => {
    let n = 0;
    _setQuotaFetchImpl(async () => {
      n += 1;
      await new Promise(r => setTimeout(r, 20));
      return { allowed: true, remaining: 900 };
    });
    const all = await Promise.all([
      checkMonthlyQuota(KEY, 'pro'), checkMonthlyQuota(KEY, 'pro'),
      checkMonthlyQuota(KEY, 'pro'), checkMonthlyQuota(KEY, 'pro'),
    ]);
    expect(n).toBe(1);                       // kills: removing the in-flight map
    expect(all.every(d => d.allowed)).toBe(true);
  });

  it('_dropQuotaCache forces a re-check (an upgrade must land immediately)', async () => {
    let n = 0;
    _setQuotaFetchImpl(async () => { n += 1; return { allowed: true, remaining: 5000 }; });
    await checkMonthlyQuota(KEY, 'pro');
    _dropQuotaCache(KEY);
    await checkMonthlyQuota(KEY, 'pro');
    expect(n).toBe(2);
  });
});

describe('_quotaTtlMs — adaptive, so the wall is tight but cheap', () => {
  it('a BLOCKED decision re-checks within 30s so an upgrade unblocks fast', () => {
    expect(_quotaTtlMs({ allowed: false })).toBe(30_000);
  });
  it('close to the wall re-checks every 10s (bounds overshoot)', () => {
    expect(_quotaTtlMs({ allowed: true, remaining: 3 })).toBe(10_000);
    expect(_quotaTtlMs({ allowed: true, remaining: 50 })).toBe(10_000);
  });
  it('approaching the wall re-checks every 60s', () => {
    expect(_quotaTtlMs({ allowed: true, remaining: 51 })).toBe(60_000);
    expect(_quotaTtlMs({ allowed: true, remaining: 500 })).toBe(60_000);
  });
  it('far from the wall caches 5 min (no per-call hop)', () => {
    expect(_quotaTtlMs({ allowed: true, remaining: 5000 })).toBe(300_000);
  });
  it('no remaining (exempt / unresolved / fail-open) caches 5 min', () => {
    expect(_quotaTtlMs({ allowed: true, remaining: null })).toBe(300_000);
    expect(_quotaTtlMs(_QUOTA_OPEN)).toBe(300_000);
  });
  it('ordering is strict — a blocked decision with headroom still re-checks fast', () => {
    // kills: checking `remaining` before `allowed`, which would cache a block
    // for 5 minutes and strand a customer who just paid.
    expect(_quotaTtlMs({ allowed: false, remaining: 9999 })).toBe(30_000);
  });
});

describe('QUOTA_EXEMPT_TOOLS — the wall must never trap the customer', () => {
  it('exempts the tool that SELLS the upgrade', () => {
    expect(QUOTA_EXEMPT_TOOLS.has('unlock_more_data')).toBe(true);
    // kills: walling the buy path — the customer could not pay past the wall.
  });
  it('exempts key claim / bind / recovery', () => {
    for (const t of ['claim_free_key', 'bind_email', 'recover_my_key']) {
      expect(QUOTA_EXEMPT_TOOLS.has(t)).toBe(true);
    }
  });
  it('does NOT exempt ordinary data tools', () => {
    for (const t of ['get_market_intel', 'analyze_site', 'execute_plan']) {
      expect(QUOTA_EXEMPT_TOOLS.has(t)).toBe(false);
    }
  });
});
