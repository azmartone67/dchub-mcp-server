// r-mpp-refused-coverage (2026-09-08): every MPP price must clear the Stripe
// Shared-Payment-Token FIAT MINIMUM.
//
// WHY THIS IS A BUILD FAILURE AND NOT A COMMENT. A sub-floor price does not
// fail closed. `mppChallengeError` issues the quote happily; Stripe rejects the
// token mint at the far end. So the agent that DID agree to pay — the rarest
// event in this entire funnel, 0 settles in the rail's lifetime — gets an
// error instead of data, and we get a `mpp_verify_failed` that reads as agent
// abandonment. The failure is invisible on our side and maximally expensive.
//
// mpp-hook.mjs already carried the constraint in prose ("Priced at the $0.50
// Stripe SPT fiat minimum … a sub-$0.50 SPT would be rejected by Stripe") and
// prose does not fail a build. This is the same gap that let two phantom tool
// names sit in MPP_PRICE for two months with a comment noting one of them did
// not exist — see test/mpp-covered-tools-exist.test.mjs.
//
// ★ THE FLOOR IS HARDCODED HERE ON PURPOSE, and that is NOT the
// guard-restates-its-own-canon anti-pattern. 0.50 is an EXTERNAL fact about
// Stripe's fiat minimum, not a value this repo owns. Deriving it from
// MPP_PRICE — the thing under test — is what would make it vacuous.
import { describe, it, expect } from 'vitest';
import { MPP_COVERED_TOOLS, mppPrice } from '../mpp-hook.mjs';

const STRIPE_SPT_FIAT_MINIMUM_USD = 0.50;

describe('MPP prices clear the Stripe fiat floor', () => {
  it('reads a non-empty covered set (guard against a vacuous pass)', () => {
    // "every price clears the floor" is true for free over an empty set.
    expect(MPP_COVERED_TOOLS.length).toBeGreaterThan(3);
  });

  it('every covered tool is priced at or above the floor', () => {
    const under = MPP_COVERED_TOOLS
      .map(t => [t, mppPrice(t)])
      .filter(([, p]) => !(Number.parseFloat(p) >= STRIPE_SPT_FIAT_MINIMUM_USD));
    expect(
      under,
      `priced below the Stripe SPT fiat minimum ($${STRIPE_SPT_FIAT_MINIMUM_USD}). `
      + `The challenge is issued, the token mint is rejected at Stripe, and the `
      + `agent that agreed to pay gets an error: ${under.map(([t, p]) => `${t}=${p}`).join(', ')}`,
    ).toEqual([]);
  });

  it('every price is a decimal STRING, not a number', () => {
    // The challenge payload carries price_usd as a string ('0.50'); a float
    // would serialise as 0.5 and lose the cents form the rail asserts on.
    const wrong = MPP_COVERED_TOOLS
      .map(t => [t, mppPrice(t)])
      .filter(([, p]) => typeof p !== 'string' || !/^\d+\.\d{2}$/.test(p));
    expect(wrong, `price must be a 'N.NN' string: ${JSON.stringify(wrong)}`).toEqual([]);
  });

  it('the fallback for an unpriced tool is itself at the floor', () => {
    // mppPrice() is `MPP_PRICE[name] || '0.50'`, so a tool missing from the
    // table still quotes something. Whatever that fallback is, it must also
    // clear the floor — otherwise a lookup miss becomes an unpayable quote.
    const fallback = mppPrice('a_tool_that_is_not_on_the_rail');
    expect(Number.parseFloat(fallback)).toBeGreaterThanOrEqual(STRIPE_SPT_FIAT_MINIMUM_USD);
  });
});
