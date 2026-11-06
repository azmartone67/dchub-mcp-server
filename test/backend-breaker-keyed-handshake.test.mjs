// 2026-11-06: backend jammed for hours; every KEYED initialize still paid the 3 s
// /keys/validate hop and every keyed call the 1.5 s monthly-usage hop, never cached
// on failure. /mcp p90 hit 30 s and Glama's hourly keyed health check timed out.
// r-backend-breaker: 3 failed hops open a 30 s breaker that skips both hops; a key
// validated before keeps its last answer (stale) instead of dropping to free.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

let S, prevBase;
beforeAll(async () => {
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';
  S = await import('../server.mjs');
});
afterAll(() => {
  S._setValidateFetchImpl(null);
  S._setQuotaFetchImpl(null);
  delete process.env.DCHUB_BACKEND_BREAKER_DISABLE;
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});
beforeEach(() => {
  for (const b of Object.values(S._backendBreakers)) { b.fails = 0; b.openUntil = 0; }
  S._dropKeyCache();
  delete process.env.DCHUB_BACKEND_BREAKER_DISABLE;
});

let hops = 0;
const timeoutErr = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
const down = () => S._setValidateFetchImpl(async () => { hops++; throw timeoutErr(); });
const up = (tier = 'pro') => S._setValidateFetchImpl(async () => {
  hops++; return { ok: true, json: async () => ({ valid: true, tier }) };
});

describe('backend breaker on the keyed handshake', () => {
  it('opens after 3 failed validate hops and then skips the hop entirely', async () => {
    down(); hops = 0;
    for (let i = 0; i < 3; i++) {
      const r = await S.validateKey(`dch_live_breaker_${i}`);
      expect(r.indeterminate).toBe(true);
      expect(r.key_rejected).toBe(false);
    }
    expect(hops).toBe(3);
    expect(S._backendBreakerOpen('validate')).toBe(true);
    const r = await S.validateKey('dch_live_breaker_new');
    expect(hops).toBe(3);                               // no 4th hop while open
    expect(r).toMatchObject({ valid: false, tier: 'free', key_rejected: false, indeterminate: true });
  });

  it('a key validated before keeps its tier through the outage (stale, not demoted)', async () => {
    up('pro');
    const KEY = 'dch_live_breaker_paid';
    expect((await S.validateKey(KEY)).tier).toBe('pro');
    S.keyCache.get(KEY).exp = Date.now() - 1000;        // cache expired mid-outage
    down();
    const r = await S.validateKey(KEY);                 // the hop fails
    expect(r).toMatchObject({ valid: true, tier: 'pro', stale: true });
    S._backendBreakers.validate.openUntil = Date.now() + 30_000;  // and while the breaker is open
    expect(await S.validateKey(KEY)).toMatchObject({ valid: true, tier: 'pro', stale: true });
  });

  it('stale has a bound: a key last seen > 6 h ago is indeterminate', () => {
    const hit = { valid: true, tier: 'pro', exp: Date.now() - 7 * 3600 * 1000 };
    expect(S._staleKeyOrIndeterminate(hit).indeterminate).toBe(true);
    expect(S._staleKeyOrIndeterminate(null).indeterminate).toBe(true);
    expect(S._staleKeyOrIndeterminate({ valid: false, tier: 'free', exp: Date.now() }).indeterminate).toBe(true);
  });

  it('a success resets the failure count; the breaker closes after its window', async () => {
    down();
    await S.validateKey('dch_live_breaker_a'); await S.validateKey('dch_live_breaker_b');
    up('free');
    await S.validateKey('dch_live_breaker_c');
    expect(S._backendBreakers.validate.fails).toBe(0);
    expect(S._backendBreakerOpen('validate')).toBe(false);
    S._backendBreakers.validate.openUntil = Date.now() - 1;
    expect(S._backendBreakerOpen('validate')).toBe(false);
  });

  it('monthly quota fails open without a hop while the breaker is open', async () => {
    let qhops = 0;
    S._setQuotaFetchImpl(async () => { qhops++; return { allowed: true, remaining: 10 }; });
    S._backendBreakers.quota.openUntil = Date.now() + 30_000;
    const d = await S.checkMonthlyQuota('dch_live_breaker_quota', 'free');
    expect(qhops).toBe(0);
    expect(d.reason).toBe('gateway_fail_open');
  });

  it('failed quota hops open the QUOTA breaker only; key validation still runs', async () => {
    S._setQuotaFetchImpl(async () => { throw timeoutErr(); });
    for (let i = 0; i < 3; i++) await S.checkMonthlyQuota(`dch_live_breaker_q${i}`, 'free');
    expect(S._backendBreakerOpen('quota')).toBe(true);
    expect(S._backendBreakerOpen('validate')).toBe(false);
    up('pro'); hops = 0;
    expect((await S.validateKey('dch_live_breaker_after_quota')).tier).toBe('pro');
    expect(hops).toBe(1);
  });

  it('a fast 503 never opens it (only hung or unreachable hops count)', async () => {
    S._setValidateFetchImpl(async () => { hops++; return { ok: false, status: 503, json: async () => ({}) }; });
    for (let i = 0; i < 5; i++) expect((await S.validateKey(`dch_live_breaker_503_${i}`)).indeterminate).toBe(true);
    S._setQuotaFetchImpl(async () => { throw new Error('monthly-usage 503'); });
    for (let i = 0; i < 5; i++) await S.checkMonthlyQuota(`dch_live_breaker_q503_${i}`, 'free');
    expect(S._backendBreakerOpen('validate')).toBe(false);
    expect(S._backendBreakerOpen('quota')).toBe(false);
  });

  it('kill switch: DCHUB_BACKEND_BREAKER_DISABLE=1 never opens it', async () => {
    process.env.DCHUB_BACKEND_BREAKER_DISABLE = '1';
    down(); hops = 0;
    for (let i = 0; i < 5; i++) await S.validateKey(`dch_live_breaker_k${i}`);
    expect(hops).toBe(5);
    expect(S._backendBreakerOpen('validate')).toBe(false);
  });
});
