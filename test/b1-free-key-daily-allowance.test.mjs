// b1-free-key-daily-allowance.test.mjs — B1 (D4, owner 2026-10-03)
//
// Live since 2026-10-04T00:15Z: the owner kept B1 live, so it landed inside the
// pricing A/B window (10-04..10-18). The readout segments on that time.
//
// The free key's "10 calls to try" (a lifetime count) becomes a renewing daily
// allowance: previews plus TRIAL_DAILY_FULL_CAP full answers per tool per day.
// The backend publishes it as allowance.free = {calls: null, period: 'day',
// full_answers_per_tool_per_day: 2} on /api/v1/tiers (dchub-backend B1 PR), and
// every free-key sentence here reads that SHAPE from canonical/tier_limits.json.
// These pin:
//   * both shapes render: lifetime = today's bytes, day = the B1 sentence,
//     byte for byte the backend pin (ai_surface_canon PINNED free_tier_rule);
//   * once daily, the retired lifetime refusal is not a counting gate
//     _freeKeyCallRefusal re-asks, and an unbound key is not refused on call 11;
//   * the daily caps (daily_cap_unbound / daily_cap) still are;
//   * the third full answer on one tool in one day is a preview (the cap the
//     daily allowance is made of).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const B1_SENTENCE = 'Anonymous: previews, no key needed. Free key: previews plus 2 full answers '
  + 'per tool per day. Add an email: 50 calls/day (up to 10 full answers per tool per day). '
  + 'Paid plans: dchub.cloud/pricing.';
const LIFETIME = {
  calls_per_day: { identified: 50 },
  allowance: {
    anonymous: { calls: null, period: null, full_answers_per_tool_per_day: 2 },
    free: { calls: 10, period: 'lifetime' },
    identified: { calls: 50, period: 'day', full_answers_per_tool_per_day: 10 },
  },
};
const DAILY = {
  ...LIFETIME,
  allowance: { ...LIFETIME.allowance, free: { calls: null, period: 'day', full_answers_per_tool_per_day: 2 } },
};

let S, TC, prevBase;
beforeAll(async () => {
  prevBase = process.env.DCHUB_API_BASE;
  process.env.DCHUB_API_BASE = 'http://127.0.0.1:1';   // nothing listens: every peek fails open
  TC = await import('../lib/tier-canon.mjs');
  S = await import('../server.mjs');
});
afterAll(() => {
  S._setValidateFetchImpl(null);
  if (prevBase === undefined) delete process.env.DCHUB_API_BASE; else process.env.DCHUB_API_BASE = prevBase;
});

describe('B1 free-key copy follows the published shape', () => {
  it('lifetime shape: the bytes served today', () => {
    expect(TC._freeKeyIsDaily(LIFETIME)).toBe(false);
    expect(TC._freeKeyOfferText(LIFETIME)).toBe('10 calls to try');
    expect(TC._freeKeyAllowanceText(LIFETIME)).toBe('10 calls to try, 50/day with an email');
    expect(TC._unboundKeyLadderText(LIFETIME))
      .toBe("10 free calls total, then results drop to previews until it's bound");
    expect(TC._freeTierRuleText(LIFETIME)).toBe('Anonymous: previews, no key needed. '
      + 'Free key: 10 calls to try. Add an email: 50 calls/day (up to 10 full answers per tool per day). '
      + 'Paid plans: dchub.cloud/pricing.');
  });

  it('daily shape: the B1 sentence, byte for byte the backend pin', () => {
    expect(TC._freeKeyIsDaily(DAILY)).toBe(true);
    expect(TC._freeTierRuleText(DAILY)).toBe(B1_SENTENCE);
    expect(TC._freeKeyOfferText(DAILY)).toBe('previews plus 2 full answers per tool per day');
    expect(TC._freeKeyAllowanceText(DAILY)).toBe('previews plus 2 full answers per tool per day, 50/day with an email');
    for (const t of [TC._freeKeyAllowanceText(DAILY), TC._unboundKeyLadderText(DAILY), B1_SENTENCE]) {
      expect(t).not.toMatch(/calls to try|calls total|n\/a|undefined|NaN|—/);
    }
  });

  it('daily shape with no full-answer figure is not daily (fail to the old copy, never "n/a")', () => {
    const broken = { ...DAILY, allowance: { ...DAILY.allowance, free: { calls: null, period: 'day' } } };
    expect(TC._freeKeyIsDaily(broken)).toBe(false);
  });
});

describe('B1 _freeKeyCallRefusal: the lifetime refusal is retired once daily', () => {
  const KEY = 'dch_live_b1_unbound_fixture';
  let used, gateAt;
  const validate = (body) => {
    if (body.count_call === true) used += 1;
    const over = gateAt !== null && used > gateAt;
    return over
      ? { valid: false, tier: 'free', reason: 'bind_email_required' }
      : { valid: true, tier: 'free', email: null, counts_tool_calls: true };
  };
  const install = () => S._setValidateFetchImpl(async (_url, req) => ({
    ok: true, json: async () => validate(JSON.parse(req.body)),
  }));
  const ctx = { api_key: KEY, tier: 'free', profile: '', session_id: 'b1-sid' };

  it('the daily gate set drops bind_email_required and keeps the daily caps', () => {
    expect([...S._freeKeyCountGates(true)].sort()).toEqual(['daily_cap', 'daily_cap_unbound']);
    expect(S._freeKeyCountGates(false).has('bind_email_required')).toBe(true);
  });

  it('an unbound key (B1 backend: never gated) is not refused on call 11 or 30', async () => {
    used = 0; gateAt = null; install(); S._dropKeyCache(KEY);
    for (let i = 1; i <= 30; i++) {
      expect(await S._freeKeyCallRefusal(ctx, 'get_grid_intelligence', true), `call ${i}`).toBeNull();
    }
    expect(used).toBe(30);   // still one counted hop per call: the usage record survives
  });

  it('daily: even an un-migrated backend answering bind_email_required is not a refusal here', async () => {
    used = 0; gateAt = 10; install(); S._dropKeyCache(KEY);
    for (let i = 1; i <= 11; i++) {
      expect(await S._freeKeyCallRefusal(ctx, 'get_grid_intelligence', true), `call ${i}`).toBeNull();
    }
  });

  it('lifetime (backend kill switch): call 11 is refused with bind_email_required, as before B1', async () => {
    used = 0; gateAt = 10; install(); S._dropKeyCache(KEY);
    for (let i = 1; i <= 10; i++) expect(await S._freeKeyCallRefusal(ctx, 'get_grid_intelligence', false)).toBeNull();
    const r = await S._freeKeyCallRefusal(ctx, 'get_grid_intelligence', false);
    expect(r && r.reason).toBe('bind_email_required');
    S._dropKeyCache(KEY);
  });
});

describe('B1 daily allowance: the third full answer on one tool in one day is a preview', () => {
  it('a keyed free caller is on the capped taste path, and the cap is 2 per tool per day', async () => {
    const gate = S.applyTierGate('get_grid_intelligence', {}, 'free', true, false);
    expect(gate.trial_taste).toBe(true);
    const cap = Math.max(0, parseInt(process.env.DCHUB_TRIAL_TOOL_DAILY_FULL || '2', 10));
    expect(cap).toBe(2);
    const ip = '198.51.100.' + (Date.now() % 200);
    const id = 'dch_live_b1_cap_fixture_' + Date.now();
    expect(await S._trialFullCallsExceeded(ip, 'get_grid_intelligence', cap, id)).toBe(false);   // full 1
    expect(await S._trialFullCallsExceeded(ip, 'get_grid_intelligence', cap, id)).toBe(false);   // full 2
    expect(await S._trialFullCallsExceeded(ip, 'get_grid_intelligence', cap, id)).toBe(true);    // preview
    // another tool the same day has its own two
    expect(await S._trialFullCallsExceeded(ip, 'get_fiber_intel', cap, id)).toBe(false);
  });
});
