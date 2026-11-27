// quota-meter-unbound-anon-frozen.test.mjs — inv-100659 (2026-11-26)
//
// THE DEFECT THIS PINS
// `remaining_full_today` (buildAutoMintBlock's top-level field) was gated only
// on `_capKnown && !_refused` — a pure PEEK of the per-IP counter, published
// whenever the mint itself was not refused. But that counter is incremented in
// exactly one place, inside `_capApplies`, which requires `autoBound` (this
// call's trial actually bound to a session). A caller that never gets a
// session bound — e.g. a stateless client carrying no session, so
// `_autoBindTrialToSession`'s `!_sid` guard always returns false — can never
// charge that counter, so the peek forever reads the virgin cap: the same
// number on every call, no matter how many are made.
//
// MEASURED (brain inv-100659, anon seat, ai_capacity_index): call 1
// remaining_full_today=2 ({limit:5}), call 2 remaining_full_today=2
// ({limit:7}) — identical despite the tool being called twice.
//
// THE FIX
// buildAutoMintBlock now requires `autoBound` (the same flag the caller
// already threads through) before publishing `remaining_full_today` — the
// same "never publish a counter on a seat that cannot charge it" rule
// quota-meter-charged.test.mjs already pins for the sibling
// `quota.full_answers_remaining_today` field.
import { describe, it, expect } from 'vitest';
import { buildAutoMintBlock } from '../server.mjs';

const MINT = { api_key: 'dch_trial_unboundfrozen0123456789', trial_days: 7, daily_calls: 1000 };

describe('remaining_full_today is published only where the counter can move', () => {
  it('an UNBOUND anon seat (autoBound=false) gets no remaining_full_today, even with a live peek', () => {
    const { sc } = buildAutoMintBlock(MINT, 'ai_capacity_index', false, 2);
    expect(sc.remaining_full_today).toBeUndefined();
  });

  it('calling it again with a different peek value still omits the field — the peek never moved and must not be shown as if it did', () => {
    const { sc } = buildAutoMintBlock(MINT, 'ai_capacity_index', false, 2);
    expect(sc.remaining_full_today).toBeUndefined();
  });

  it('a seat whose trial WAS bound to this session (autoBound=true) still gets the real number', () => {
    const { sc } = buildAutoMintBlock(MINT, 'ai_capacity_index', true, 1);
    expect(sc.remaining_full_today).toBe(1);
  });
});
