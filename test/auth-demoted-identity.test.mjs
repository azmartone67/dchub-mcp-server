// auth-demoted-identity.test.mjs — r-auth-demoted (2026-09-20)
//
// ★THE THIRD OUTCOME. A presented credential has three ends, and until now only
// two had a signal:
//   REFUSED      200 + valid:false, key_rejected:true  → credential_refused
//   UNVERIFIABLE backend 5xx/timeout, indeterminate    → credential_unverified
//   DEMOTED      200 + valid:true, tier BELOW entitlement → nothing at all
//
// The third is the one that costs money. The key is good and was accepted; the
// ACCOUNT resolves to free (canceled, or dunning past the demote stamp). Both
// existing predicates are blind to it by construction — key_rejected is false
// and indeterminate is false — and tier:'free' is the same string a genuinely
// free keyed caller gets. auth-unverified-identity.test.mjs named this gap and
// scoped itself out of it: "Closing that needs the backend to say so."
//
// ★WHICH IS EXACTLY WHAT THIS DOES NOT DO LOCALLY. _authDemoted reads a flag
// the backend sets. It does not compare tiers, infer a plan, or reconstruct the
// entitlement rule — this process cannot see the other side of that comparison.
// Restating an entitlement rule in a second place is the defect dchub-backend
// spent #4877, #4903 and #4950 removing; doing it here would be the fourth.
//
// ★INERT AGAINST A BACKEND THAT DOES NOT SEND THE FIELD. Production today does
// not. Every assertion below that the signal FIRES is therefore a statement
// about this process given a backend that sends it — not a live measurement.
import { describe, it, expect } from 'vitest';
import {
  _authDemoted, _authRefusal, _authUnverified, _identitySource,
} from '../server.mjs';

const KEY = 'dch_live_somekey';
const DEMOTED = { valid: true, tier: 'free', key_rejected: false, demoted: true, demote_reason: 'dunning_demote' };
const CANCELED = { valid: true, tier: 'free', key_rejected: false, demoted: true, demote_reason: 'canceled' };
const INDET = { valid: false, tier: 'free', key_rejected: false, indeterminate: true };
const REJECTED = { valid: false, tier: 'free', key_rejected: true, reason: 'bind_email_required' };
const PAID = { valid: true, tier: 'pro', key_rejected: false };
// What today's backend actually returns for a paid account — no demote field.
const OLD_BACKEND_FREE = { valid: true, tier: 'free', key_rejected: false };

describe('_authDemoted — the predicate', () => {
  it('fires when the backend accepted the key and reports a demote', () => {
    expect(_authDemoted(KEY, DEMOTED)).toBe('dunning_demote');
    expect(_authDemoted(KEY, CANCELED)).toBe('canceled');
  });

  it('carries the backend reason through rather than deriving one', () => {
    expect(_authDemoted(KEY, { valid: true, demoted: true, demote_reason: 'something_new' }))
      .toBe('something_new');
  });

  it('falls back to a bare marker when the backend sends no reason', () => {
    expect(_authDemoted(KEY, { valid: true, demoted: true })).toBe('demoted');
  });

  it('does NOT fire when no key was presented', () => {
    expect(_authDemoted(null, DEMOTED)).toBeNull();
    expect(_authDemoted('', DEMOTED)).toBeNull();
  });

  it('is INERT against a backend that does not send the field', () => {
    expect(_authDemoted(KEY, OLD_BACKEND_FREE)).toBeNull();
    expect(_authDemoted(KEY, PAID)).toBeNull();
  });

  it('does NOT fire on a missing or shapeless validation', () => {
    expect(_authDemoted(KEY, null)).toBeNull();
    expect(_authDemoted(KEY, undefined)).toBeNull();
    expect(_authDemoted(KEY, {})).toBeNull();
  });

  it('requires the flag to be exactly true, not merely truthy', () => {
    expect(_authDemoted(KEY, { valid: true, demoted: 'yes' })).toBeNull();
    expect(_authDemoted(KEY, { valid: true, demoted: 1 })).toBeNull();
  });

  it('requires the backend to have ACCEPTED the key', () => {
    // A demote is an entitlement statement about an account whose key is good.
    // A refused key is not demoted — it is refused.
    expect(_authDemoted(KEY, { valid: false, demoted: true, demote_reason: 'x' })).toBeNull();
  });
});

describe('the three outcomes are disjoint BY CONSTRUCTION, not by ordering', () => {
  it('a demote is invisible to the other two predicates', () => {
    expect(_authRefusal(KEY, null, DEMOTED)).toBeNull();
    expect(_authUnverified(KEY, DEMOTED)).toBe(false);
  });

  it('a refusal and an unverifiable answer are invisible to this one', () => {
    expect(_authDemoted(KEY, REJECTED)).toBeNull();
    expect(_authDemoted(KEY, INDET)).toBeNull();
  });

  it('no validation shape can satisfy two of them at once', () => {
    for (const v of [DEMOTED, CANCELED, REJECTED, INDET, PAID, OLD_BACKEND_FREE, {}]) {
      const n = [
        _authRefusal(KEY, null, v) !== null,
        _authUnverified(KEY, v) === true,
        _authDemoted(KEY, v) !== null,
      ].filter(Boolean).length;
      expect(n, `two signals fired for ${JSON.stringify(v)}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('_identitySource — what the agent actually reads', () => {
  const ctxOf = (over) => ({ auth_source: 'header', tier: 'free', api_key: KEY, ...over });

  it('stamps credential_demoted with the reason', () => {
    const id = _identitySource(ctxOf({ auth_demoted: 'dunning_demote' }));
    expect(id.credential_demoted).toBe('dunning_demote');
    expect(id.credential_refused).toBeUndefined();
    expect(id.credential_unverified).toBeUndefined();
  });

  it('says nothing when the account is not demoted', () => {
    const id = _identitySource(ctxOf({ auth_demoted: null }));
    expect(id.credential_demoted).toBeUndefined();
    expect(id.means).toBeUndefined();
  });

  it('does NOT tell the agent to go find another key', () => {
    // The refusal prose says exactly that, and it is WRONG here: the key is
    // good. An agent sent key-hunting burns the turn on a problem that does
    // not exist and never reaches the human who can actually fix it.
    const means = _identitySource(ctxOf({ auth_demoted: 'dunning_demote' })).means;
    expect(means).not.toMatch(/claim_free_key` issues one/);
    expect(means).toMatch(/not a credential problem/i);
    expect(means).toMatch(/claim_free_key` will not\s+help|will not\s+help/);
  });

  it('routes the agent to its human, not to a retry', () => {
    const means = _identitySource(ctxOf({ auth_demoted: 'canceled' })).means;
    expect(means).toMatch(/PAUSE and tell your human/);
    expect(means).toMatch(/dchub\.cloud\/account/);
  });

  it('distinguishes the two reasons in prose', () => {
    const dunning = _identitySource(ctxOf({ auth_demoted: 'dunning_demote' })).means;
    const canceled = _identitySource(ctxOf({ auth_demoted: 'canceled' })).means;
    expect(dunning).toMatch(/payment .* did not go through/);
    expect(canceled).toMatch(/no longer active/);
    expect(dunning).not.toBe(canceled);
  });

  it('degrades to a neutral sentence on a reason it does not know', () => {
    const means = _identitySource(ctxOf({ auth_demoted: 'some_future_reason' })).means;
    expect(means).toMatch(/currently resolves to the free tier/);
    expect(means).not.toMatch(/some_future_reason/);   // never echo an opaque token at a human
  });

  it('names NO plan and NO price', () => {
    for (const r of ['dunning_demote', 'canceled', 'whatever']) {
      const means = _identitySource(ctxOf({ auth_demoted: r })).means;
      expect(means).not.toMatch(/\$\d/);
      expect(means).not.toMatch(/\b(pro|starter|developer|founding|team|enterprise)\b/i);
    }
  });

  it('reports the tier it was actually served at', () => {
    const id = _identitySource(ctxOf({ auth_demoted: 'canceled', tier: 'free' }));
    expect(id.tier).toBe('free');
    expect(id.means).toMatch(/served at FREE tier/);
  });

  it('a refusal still wins over a demote if both were somehow set', () => {
    // Cannot happen (see the disjointness suite) — this pins the fallback so a
    // future shape change degrades to the authoritative signal, not the softer one.
    const id = _identitySource(ctxOf({ auth_refused: 'rejected', auth_demoted: 'canceled' }));
    expect(id.credential_refused).toBe('rejected');
    expect(id.credential_demoted).toBeUndefined();
  });

  it('an anonymous call is untouched', () => {
    const id = _identitySource({ auth_source: 'none', tier: 'free', auth_demoted: 'canceled' });
    expect(id.credential_demoted).toBeUndefined();
    expect(id.means).toMatch(/served ANONYMOUSLY/);
  });
});
