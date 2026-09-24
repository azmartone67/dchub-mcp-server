// auto-bind-quota-contradiction.test.mjs — r-quota-contradiction (2026-09-24)
//
// THE DEFECT THIS PINS
// On the anonymous call where a trial key is auto-minted and bound,
// buildAutoMintBlock ships a top-level `remaining_full_today` (a real number,
// gated only on the mint not being refused) while `_buildQuotaHint`'s
// `quota.full_answers_remaining_today` read the SAME request's ctx and found
// no `api_key` yet — because `_autoBindTrialToSession` wrote the bind into
// `sessionMeta` (read on the NEXT request) but never into the in-flight
// request's AsyncLocalStorage store. One structuredContent therefore carried
// both a spendable-looking budget and "NOT YET APPLICABLE ... anonymous seat"
// for the identical call.
//
// MEASURED (queue #493, get_grid_intelligence, 2026-09-24): top-level
// remaining_full_today=1 next to quota.full_answers_remaining_today=null,
// full_answers_unavailable_reason='NOT YET APPLICABLE at an anonymous seat...'.
//
// THE FIX
// _autoBindTrialToSession now mirrors the bind onto the live ctx object
// (same object getCtx() returns for the rest of this request), so
// _buildQuotaHint sees a durable seat as soon as the mint succeeds.
import { describe, it, expect } from 'vitest';
import { _autoBindTrialToSession, sessionMeta, _ctxALS, _buildQuotaHint } from '../server.mjs';

const TOOL = 'get_grid_intelligence';

describe('auto-mint bind is visible to the SAME request that minted it', () => {
  it('binding a trial key updates the live ctx, not just sessionMeta', () => {
    const sid = 'sid-quota-contradiction-1';
    sessionMeta.set(sid, { platform: 'test' }); // anonymous: no api_key yet

    _ctxALS.run({ session_id: sid, client_ip: '203.0.113.9' }, () => {
      const bound = _autoBindTrialToSession({ api_key: 'dch_test_bound_1' });
      expect(bound).toBe(true);

      const store = _ctxALS.getStore();
      expect(store.api_key).toBe('dch_test_bound_1');
      expect(store.tier).toBe('free');
    });
  });

  it('quota.full_answers_remaining_today is no longer "not yet applicable" on the mint call itself', () => {
    const sid = 'sid-quota-contradiction-2';
    sessionMeta.set(sid, { platform: 'test' });

    _ctxALS.run({ session_id: sid, client_ip: '203.0.113.10' }, () => {
      // Before the bind, this seat reads as anonymous — matches the pre-fix
      // envelope's quota block.
      const before = _buildQuotaHint(TOOL);
      expect(before.full_answers_remaining_today).toBeNull();
      expect(before.full_answers_unavailable_reason).toContain('NOT YET APPLICABLE');

      _autoBindTrialToSession({ api_key: 'dch_test_bound_2' });

      // Same request, after the bind: the field a top-level
      // `remaining_full_today` would be shown alongside must now agree
      // instead of contradicting it.
      const after = _buildQuotaHint(TOOL);
      expect(after.full_answers_unavailable_reason).toBeUndefined();
      expect(typeof after.full_answers_remaining_today).toBe('number');
    });
  });

  it('never overrides an already-identified/keyed session', () => {
    const sid = 'sid-quota-contradiction-3';
    sessionMeta.set(sid, { platform: 'test', api_key: 'dch_existing_key' });

    _ctxALS.run({ session_id: sid, client_ip: '203.0.113.11' }, () => {
      const bound = _autoBindTrialToSession({ api_key: 'dch_test_should_not_bind' });
      expect(bound).toBe(false);
      expect(_ctxALS.getStore().api_key).toBeUndefined();
    });
  });
});
