// ── execute_plan steps are counted against the caller's IP (planner 5.18) ──
// lib/plan-caller-ip.mjs: the single-use token a plan hands each loopback step. What fails here:
// a token that can be replayed, outlives its TTL, or carries an empty/oversized value.
// The executor half (a step counted against 127.0.0.1): test/grid-ranking-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { mintPlanCallerIpToken, consumePlanCallerIpToken, PLAN_CALLER_IP_HEADER } from '../lib/plan-caller-ip.mjs';

describe('plan caller-IP token', () => {
  it('names the caller IP once, then never again', () => {
    const t = mintPlanCallerIpToken('203.0.113.7', 1000);
    expect(consumePlanCallerIpToken(t, 1001)).toBe('203.0.113.7');
    expect(consumePlanCallerIpToken(t, 1002)).toBeNull();
  });
  it('expires', () => {
    const t = mintPlanCallerIpToken('203.0.113.7', 1000);
    expect(consumePlanCallerIpToken(t, 1000 + 120_001)).toBeNull();
  });
  it('mints nothing for no IP, and an unknown token names nothing', () => {
    expect(mintPlanCallerIpToken(null)).toBeNull();
    expect(mintPlanCallerIpToken('   ')).toBeNull();
    expect(mintPlanCallerIpToken('x'.repeat(65))).toBeNull();
    expect(consumePlanCallerIpToken('not-a-token')).toBeNull();
    expect(consumePlanCallerIpToken(undefined)).toBeNull();
    expect(PLAN_CALLER_IP_HEADER).toBe('x-dchub-plan-caller-ip');
  });
});
