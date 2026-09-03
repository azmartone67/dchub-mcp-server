// r-typed-preview (2026-09-03) — the free-tier trim must not null a number the
// SAME object already prints in its `value` display string.
//
// Live defect this guards: an agent asked for the largest US markets by
// capacity called rank_markets, read `total_mw`, got null on every row, and
// answered from a competitor's published table. The MW was on the wire the
// whole time, inside "value":"191 fac / 5793 MW / 55 ops".
import { describe, it, expect } from 'vitest';
import { trimForTrial, TRIAL_PREVIEW_ROWS } from '../server.mjs';

// Shaped exactly like the live backend payload (routes/mcp_tier1_tools.py).
const row = (rank, market, fac, mw, ops) => ({
  rank, market, metro_slug: market.replace(/-[a-z]{2}$/, ''),
  city: market, state: 'VA', country: 'US',
  score: 100 - rank,
  value: `${fac} fac / ${mw} MW / ${ops} ops`,
  facility_count: fac, total_mw: mw, operator_count: ops,
  url: `https://dchub.cloud/markets/${market}`,
});
const payload = () => ({
  criteria: 'best_overall', region: 'us', result_count: 10,
  results: [
    row(1, 'ashburn-va', 191, 5793, 55),
    row(2, 'dallas-tx', 102, 1268, 51),
    row(3, 'chicago-il', 81, 923, 50),
    row(4, 'phoenix-az', 64, 807, 44),
    row(5, 'atlanta-ga', 58, 1459, 39),
    row(6, 'reno-nv', 21, 402, 12),
  ],
});

describe('rank_markets typed preview', () => {
  it('keeps the raw-fact metrics TYPED on the rows it does show', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    expect(out.results.length).toBe(TRIAL_PREVIEW_ROWS);
    for (const r of out.results) {
      expect(typeof r.total_mw).toBe('number');
      expect(typeof r.facility_count).toBe('number');
      expect(typeof r.operator_count).toBe('number');
    }
    // anchored to the FIRST row specifically, not "some row somewhere"
    expect(out.results[0].total_mw).toBe(5793);
    expect(out.results[0].facility_count).toBe(191);
    expect(out.results[0].operator_count).toBe(55);
  });

  it('agrees with the `value` string it ships alongside', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    for (const r of out.results) {
      expect(r.value).toBe(`${r.facility_count} fac / ${r.total_mw} MW / ${r.operator_count} ops`);
    }
  });

  it('still gates the DECISION layer and the row count', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    expect(out.results[0].score).toBeNull();          // composite rank = paid
    expect(out.result_count).toBeNull();              // would contradict rows shown
    expect(out._results_total_in_pro).toBe(6);        // honest total survives
    expect(out.results.length).toBeLessThan(6);
  });

  it('changes NOTHING for any other tool (scope is per-tool)', () => {
    for (const tool of ['search_facilities', 'get_grid_intelligence', undefined]) {
      const out = trimForTrial(payload(), tool);
      expect(out.results[0].total_mw).toBeNull();
      expect(out.results[0].facility_count).toBeNull();
      expect(out.results[0].operator_count).toBeNull();
    }
  });
});
