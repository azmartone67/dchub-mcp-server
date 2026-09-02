// =============================================================================
// Funnel invariants — HARD gate
// -----------------------------------------------------------------------------
// Split out of test/regression.test.mjs on 2026-08-30, unchanged in substance.
// Its own comment already said "Pure local source read, no network", but it sat
// in test.yml's continue-on-error live step and so could never fail a build.
// These pin money-facing literals; they are exactly the kind of guard that has
// to block. See test/version-consistency.test.mjs for the full account.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ── Funnel invariants guard (r-peace 2026-07-05) ───────────────────────────
// Pin the anon→free→$10→metered fixes so a later edit can't silently revert:
//   (1) claim_free_key's daily_limit fallback is 10 (matches the CF worker's
//       enforced free cap) — NOT 25, which over-promised vs the 10 enforced.
//   (2) The Stripe-MPP per-call path is FIRST-CLASS in unlock_more_data — the
//       recommendation is 'mpp' when the rail is on, and an 'mpp' plan entry
//       exists — so agents that can pay $0.50 themselves aren't sent to buy
//       the $10 human pack. Pure local source read, no network.
describe('funnel invariants (peace 2026-07-05)', () => {
  const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

  it('claim_free_key daily_limit fallback is the canonical free rung (10), not 25', async () => {
    // r-tier-canon (2026-09-02): the literal 10 became _rungNum('free'), read
    // from canonical/tier_limits.json — the same guard, one source instead of two.
    expect(src).toMatch(/typeof r\.daily_limit === 'number'\) \? r\.daily_limit : _rungNum\('free'\)/);
    expect(src).not.toMatch(/typeof r\.daily_limit === 'number'\) \? r\.daily_limit : 25\b/);
    const { _rungNum } = await import('../lib/tier-canon.mjs');
    expect(_rungNum('free')).toBe(10);
  });

  it('unlock_more_data makes MPP first-class (recommended + plan entry)', () => {
    expect(src).toMatch(/recommended:\s*_mppOn\s*\?\s*'mpp'\s*:\s*'credits'/);
    expect(src).toMatch(/id:\s*'mpp'/);
  });
});