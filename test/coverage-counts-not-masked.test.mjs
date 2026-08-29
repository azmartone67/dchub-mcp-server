// ── a coverage count is not a paywalled metric ──────────────────────────────
//
// FOUND LIVE 2026-08-29, on the deploy of backend #3327, minutes after merge.
//
// #3327 returns `excluded_total` — how many markets exist in a geography when
// none met the verdict filter — specifically so the honest count survives
// whatever later trims the row array. Its own backend test asserts
// `excluded_total == 9` and passes, because at the backend it IS 9.
//
// The MCP free-tier trimmer then nulled it: `excluded_total` matches `_total$`
// in _isMetricKey's paywalled-metric regex. Measured on the live deploy:
//
//   region=OH -> markets_in_region: 9        (unmasked)
//                excluded_total:    null     (masked)
//                _excluded_top_total_in_pro: 9
//
// Two fields carrying the SAME number, one masked and one not. And `null` is
// the one reading this field must never have: it says "unknown", when the truth
// is "nine, and three of them are right here". An agent that reads null cannot
// distinguish "no coverage" from "coverage withheld".
//
// ★ THE GENERAL RULE: the mask exists to withhold PAID DATA. A count that
// describes what the answer does NOT cover is the opposite — it is the honesty
// surface, and gating it inverts the incentive exactly the way tier-gating
// constraint_coverage would. Same argument, same conclusion.
import { describe, it, expect } from 'vitest';
import { _isMetricKey } from '../server.mjs';

describe('coverage counts survive the free-tier metric mask', () => {
  it('excluded_total is not treated as a paywalled metric', () => {
    expect(_isMetricKey('excluded_total')).toBe(false);
  });

  it('markets_in_region is not either — they carry the same number', () => {
    expect(_isMetricKey('markets_in_region')).toBe(false);
  });

  // ★ The mask must still do its job, or this fix is a hole rather than a patch.
  it('genuinely paywalled metrics are STILL masked', () => {
    for (const k of ['total_capacity_mw', 'facility_count', 'power_mw', 'mrr',
                     'revenue_total', 'average_price', 'unique_operators']) {
      expect(_isMetricKey(k), `${k} should still be masked`).toBe(true);
    }
  });

  it('the exemption is exact, not a prefix that opens the door', () => {
    // A neighbouring name must not inherit the exemption.
    expect(_isMetricKey('excluded_total_mw')).toBe(true);
    expect(_isMetricKey('deal_total')).toBe(true);
  });
});
