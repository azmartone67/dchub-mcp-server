// auth-unverified-identity.test.mjs — r-auth-unverified (2026-09-20)
//
// ★THE GAP. _validateKeyUncached returns
// { valid:false, tier:'free', key_rejected:false, indeterminate:true } when the
// backend validator 500s, times out or throws. That is deliberate: a blip must
// not be cached as a downgrade, and must not be read as "this key is fake", so
// _effectiveCallerKey KEEPS the key. But the tier for that call is free — and
// nothing said so. key_rejected is false, so _authRefusal returns null and no
// credential_refused is stamped, leaving an envelope byte-identical to a
// genuinely free keyed caller. _identitySource's own comment named the hole:
// "A key that was accepted, OR COULD NOT BE CHECKED, gets neither the field nor
// prose."
//
// ★WHAT THIS IS NOT. It is not the dunning demote. When the BACKEND decides a
// paid account is currently free it answers 200 with valid:true and tier:'free',
// and this layer cannot see that the account is entitled to more — validation
// carries no entitled-tier field to compare against. Closing that needs the
// backend to say so; inventing a signal here would be guessing. Scope is the
// case this process actually knows about.
//
// UPDATE 2026-09-20 (r-auth-demoted): the backend now says so, and that third
// outcome has its own predicate and guard — see auth-demoted-identity.test.mjs.
// This file's scope is unchanged; the sentence above is kept because it is why
// _authUnverified does not try to cover it.
import { describe, it, expect } from 'vitest';
import { _authUnverified, _authRefusal, _identitySource } from '../server.mjs';

const KEY = 'dch_live_somekey';
const INDET = { valid: false, tier: 'free', key_rejected: false, indeterminate: true };
const REJECTED = { valid: false, tier: 'free', key_rejected: true, reason: 'bind_email_required' };
const VALID = { valid: true, tier: 'pro', key_rejected: false };

describe('_authUnverified — the predicate', () => {
  it('fires when a presented key could not be checked', () => {
    expect(_authUnverified(KEY, INDET)).toBe(true);
  });

  it('does NOT fire when no key was presented', () => {
    expect(_authUnverified(null, INDET)).toBe(false);
    expect(_authUnverified('', INDET)).toBe(false);
  });

  it('does NOT fire for an authoritative rejection', () => {
    expect(_authUnverified(KEY, REJECTED)).toBe(false);
  });

  it('does NOT fire for a key that validated', () => {
    expect(_authUnverified(KEY, VALID)).toBe(false);
  });

  it('does NOT fire on a missing or shapeless validation', () => {
    expect(_authUnverified(KEY, null)).toBe(false);
    expect(_authUnverified(KEY, undefined)).toBe(false);
    expect(_authUnverified(KEY, {})).toBe(false);
  });

  it('requires the flag to be exactly true, not merely truthy', () => {
    expect(_authUnverified(KEY, { indeterminate: 'yes' })).toBe(false);
    expect(_authUnverified(KEY, { indeterminate: 1 })).toBe(false);
  });

  it('is mutually exclusive with _authRefusal, which is why order is safe', () => {
    // indeterminate implies key_rejected === false, so a refusal cannot co-occur
    expect(_authRefusal(KEY, null, INDET)).toBeNull();
    expect(_authUnverified(KEY, REJECTED)).toBe(false);
  });

  it('does NOT require the served key to differ from the presented one', () => {
    // The difference from _authRefusal. On indeterminate the key RIDES
    // (_effectiveCallerKey fail-soft), so a servedKey !== presentedKey guard
    // would make this permanently unreachable.
    expect(_authUnverified(KEY, INDET)).toBe(true);
    expect(_authRefusal(KEY, KEY, REJECTED)).toBeNull();   // that guard, for contrast
  });
});

describe('_identitySource — what the caller reads', () => {
  it('stamps credential_unverified and says retry, not "send another key"', () => {
    const out = _identitySource({ auth_source: 'header', tier: 'free', auth_unverified: true });
    expect(out.credential_unverified).toBe(true);
    expect(out.means).toMatch(/could NOT be checked/);
    expect(out.means).toMatch(/calling again re-validates/);
    expect(out.credential_refused).toBeUndefined();
  });

  it('says nothing when the key was checked and accepted', () => {
    const out = _identitySource({ auth_source: 'header', tier: 'pro' });
    expect(out).toEqual({ credential_source: 'header', tier: 'pro' });
  });

  it('a refusal still wins its own branch and reads as a refusal', () => {
    const out = _identitySource({
      auth_source: 'header', tier: 'free', auth_refused: 'bind_email_required',
    });
    expect(out.credential_refused).toBe('bind_email_required');
    expect(out.credential_unverified).toBeUndefined();
  });

  it('an anonymous call is unaffected', () => {
    const out = _identitySource({ auth_source: 'none', tier: 'free', auth_unverified: true });
    expect(out.means).toMatch(/served ANONYMOUSLY/);
    expect(out.credential_unverified).toBeUndefined();
  });

  it('the prose does not blame the key', () => {
    const out = _identitySource({ auth_source: 'header', tier: 'free', auth_unverified: true });
    expect(out.means).not.toMatch(/REFUSED|rejected|invalid/i);
  });
});
