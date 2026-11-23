// paid-full-only-meter-1123.test.mjs — the quota meter on a paid-full-only tool (2026-11-23).
// Measured live 11-23: a free key (claim_free_key, no email) called ai_capacity_index four times; every answer was the
// preview ("Withheld here: ...") yet each carried full_answers_cap_today 2, full_answers_remaining_today 2. The tool is
// paid-full-only (lib/paid-full-only.mjs) and ALWAYS_PARTIAL_PREVIEW, so _buildQuotaHint published the free-key taste
// budget the gate no longer serves. A meter that cannot move must not be shown (test/quota-meter-charged.test.mjs).
import { describe, it, expect } from 'vitest';
import { _buildQuotaHint, _ctxALS } from '../server.mjs';

const at = (seat, tool) => _ctxALS.run(seat, () => _buildQuotaHint(tool));
const FREE_KEY = { client_ip: '203.0.113.9', api_key: 'dch_test_free_meter', tier: 'free' };
const BOUND = { ...FREE_KEY, tier: 'identified', email: 'meter-test@example.com' };

describe('paid-full-only tools publish no free-seat budget', () => {
  for (const tool of ['ai_capacity_index', 'rank_markets']) {
    for (const [label, seat] of [['free key', FREE_KEY], ['email-bound key', BOUND]]) {
      it(`${tool}, ${label}: no cap, no remaining, a reason instead`, () => {
        const q = at(seat, tool);
        expect(q.full_answers_cap_today).toBeNull();
        expect(q.full_answers_remaining_today).toBeNull();
        expect(q.full_answers_unavailable_reason).toMatch(/^NOT APPLICABLE: `[a-z_]+` is a preview on every non-paid seat/);
      });
    }
  }
  it('a tool that still has a free-key taste keeps its moving meter', () => {
    const q = at(FREE_KEY, 'get_gas_intelligence');
    expect(q.full_answers_cap_today).toBeGreaterThan(0);
    expect(typeof q.full_answers_remaining_today).toBe('number');
  });
});
