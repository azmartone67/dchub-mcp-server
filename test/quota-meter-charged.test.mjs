// quota-meter-charged.test.mjs — r-quota-charged (2026-08-18)
//
// WHAT THIS IS FOR
// A quota meter that cannot move is worse than no meter at all. It tells a
// self-governing agent it has headroom forever, so the agent never claims a key
// and never converts — and it tells US the wall is working when nothing has
// ever hit it.
//
// THE DEFECT THIS PINS
// `_trialDayCounts` is incremented in exactly one place, `_trialFullCallsExceeded`,
// which is reached only when
//     _capApplies = _mintBound && ALWAYS_PARTIAL_PREVIEW.has(name)
// but `_buildQuotaHint` published the budget on the RIGHT half of that condition
// alone. An UNBOUND ANONYMOUS seat is served partial previews, never a full
// answer, so it never charges the counter — yet it was shown a full budget.
//
// MEASURED 2026-08-18 (live, keyless dchub.cloud/mcp): two get_gas_intelligence
// calls 9 seconds apart from one anonymous seat, state TX then PA, both returned
//     full_answers_cap_today: 2, full_answers_remaining_today: 2
// Nothing had been spent because nothing at that seat can spend it. From the
// other end, /api/v1/mcp/funnel reported 0 quota wall hits and 0 distinct keys
// at quota for the whole month with enforce ON. Same defect, both directions.
//
// THE RULE THIS ENCODES
// Never publish a counter on a seat that cannot charge it. Show a number that
// moves, or say plainly why there is no number yet — never a frozen number.
import { describe, it, expect } from 'vitest';
import { _buildQuotaHint, _ctxALS } from '../server.mjs';

// get_gas_intelligence is a cap-governed ALWAYS_PARTIAL_PREVIEW tool — the exact
// tool the live reproduction used.
const TOOL = 'get_gas_intelligence';

const asSeat = (seat) => _ctxALS.run(seat, () => _buildQuotaHint(TOOL));

const ANON = { client_ip: '203.0.113.7' };                       // no api_key → unbound
const DURABLE = { client_ip: '203.0.113.7', api_key: 'dch_live_test', tier: 'free' };

describe('quota meter is published only where it is charged', () => {
  it('an anonymous seat is NOT given a full-answer budget', () => {
    const q = asSeat(ANON);
    expect(q).toBeTruthy();
    // The frozen 2-of-2 that shipped: cap and remaining both present and equal.
    expect(q.full_answers_remaining_today).toBeNull();
    expect(q.full_answers_cap_today).toBeNull();
  });

  it('an anonymous seat is told WHY there is no number, and how to get one', () => {
    const q = asSeat(ANON);
    expect(q.full_answers_unavailable_reason).toBeTruthy();
    // The reason must name the actual unlock, or it is just an apology.
    expect(q.full_answers_unavailable_reason).toContain('claim_free_key');
  });

  it('an anonymous seat is not mislabelled "free"', () => {
    // The live envelope carried quota.tier 'free' beside _upgrade.tier
    // 'anonymous' — two tiers in one response, and agents read this one first.
    expect(asSeat(ANON).tier).toBe('anonymous');
  });

  it('a durable (keyed) seat DOES get a real, spendable budget', () => {
    const q = asSeat(DURABLE);
    expect(typeof q.full_answers_remaining_today).toBe('number');
    expect(typeof q.full_answers_cap_today).toBe('number');
    expect(q.full_answers_cap_today).toBeGreaterThan(0);
    expect(q.tier).toBe('free');
    // The basis string only makes sense next to a real number.
    expect(q.full_answers_basis).toContain(TOOL);
  });

  it('never emits a basis for a null budget', () => {
    // Guards the pairing itself: a basis explaining a number that is not there
    // is how the 2026-08-10 "both numbers correct, together unreadable" bug read.
    const q = asSeat(ANON);
    expect(q.full_answers_basis).toBeUndefined();
  });
});
