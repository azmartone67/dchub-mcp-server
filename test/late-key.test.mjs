// Unit tests for r-late-key (2026-07-16) — the per-request key-header adoption
// on an already-initialized session. Live-verified defect: an X-API-Key sent on
// tools/call AFTER an anonymous initialize was ignored (session stayed
// anonymous → 'API 401 auth_required' on keyed tools) until a full reconnect.
// _lateKeyResolve is the pure decision function the POST /mcp existing-session
// branch runs; imported directly from server.mjs (skips app.listen under VITEST).
import { describe, it, expect } from 'vitest';
import { _lateKeyResolve } from '../server.mjs';

const VALID = { valid: true, tier: 'pro', is_trial: false, metered_enforce: false, developer_id: 'dev_1', email: 'ops@example.com' };
const INVALID = { valid: false, tier: 'free' };

describe('_lateKeyResolve — key header on an existing session', () => {
  it('THE REPRO: anonymous session + valid header key → adopt + persist (no reconnect)', () => {
    const meta = { api_key: null, platform: 'claude', tier: 'free' };
    const r = _lateKeyResolve(meta, 'dchub_qa_abc', VALID);
    expect(r).not.toBeNull();
    expect(r.persist).toBe(true);
    expect(r.meta.api_key).toBe('dchub_qa_abc');
    expect(r.meta.tier).toBe('pro');
    expect(r.meta.developer_id).toBe('dev_1');
    expect(r.meta.email).toBe('ops@example.com');
    expect(r.meta.late_key_bound).toBe(true);
    // untouched fields survive the spread
    expect(r.meta.platform).toBe('claude');
  });

  it('no header key → no change (keyless follow-up calls stay on session identity)', () => {
    expect(_lateKeyResolve({ api_key: 'dch_live_x', tier: 'free' }, null, VALID)).toBeNull();
    expect(_lateKeyResolve({ api_key: 'dch_live_x', tier: 'free' }, '', VALID)).toBeNull();
  });

  it('same key re-sent every request → no change (hot path pays nothing)', () => {
    const meta = { api_key: 'dch_live_x', tier: 'identified' };
    expect(_lateKeyResolve(meta, 'dch_live_x', VALID)).toBeNull();
  });

  it('validated key SWAP on a keyed session → adopt the new identity (trial → paid)', () => {
    const meta = { api_key: 'dch_trial_old', tier: 'free', is_trial: true, platform: 'cursor' };
    const r = _lateKeyResolve(meta, 'dch_live_paid', VALID);
    expect(r.persist).toBe(true);
    expect(r.meta.api_key).toBe('dch_live_paid');
    expect(r.meta.tier).toBe('pro');
    expect(r.meta.is_trial).toBe(false);
  });

  it('unrecognized key on an ANONYMOUS session → honor for this request only, do NOT persist', () => {
    const meta = { api_key: null, platform: 'claude', tier: 'free' };
    const r = _lateKeyResolve(meta, 'garbage_or_blip', INVALID);
    expect(r.persist).toBe(false);
    // request ctx sees the key (backend answers its own 401, mirroring initialize)
    expect(r.meta.api_key).toBe('garbage_or_blip');
    expect(r.meta.tier).toBe('free');
    // the caller must NOT write this into sessionMeta — claim_free_key's
    // auto-bind refuses keyed sessions, so persisting junk would brick it.
  });

  it('unrecognized key on a KEYED session → never downgrade (expired Bearer JWT case)', () => {
    const meta = { api_key: 'dch_live_good', tier: 'identified' };
    expect(_lateKeyResolve(meta, 'eyJhbGciOi.raw.jwt', INVALID)).toBeNull();
  });

  it('missing validation object is treated as invalid (fail-soft)', () => {
    expect(_lateKeyResolve({ api_key: 'dch_live_good' }, 'dch_new', null)).toBeNull();
    const r = _lateKeyResolve({ api_key: null }, 'dch_new', undefined);
    expect(r.persist).toBe(false);
  });

  it('valid but tier-less validation defaults to free tier', () => {
    const r = _lateKeyResolve({ api_key: null }, 'dch_live_k', { valid: true });
    expect(r.persist).toBe(true);
    expect(r.meta.tier).toBe('free');
    expect(r.meta.developer_id).toBeNull();
    expect(r.meta.email).toBeNull();
  });
});
