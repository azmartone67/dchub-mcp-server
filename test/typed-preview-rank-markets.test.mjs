// r-typed-preview (2026-09-03) — the free-tier trim must not null a number the
// SAME object already prints in its `value` display string.
//
// Live defect this guards: an agent asked for the largest US markets by
// capacity called rank_markets, read `total_mw`, got null on every row, and
// answered from a competitor's published table. The MW was on the wire the
// whole time, inside "value":"191 fac / 5793 MW / 55 ops".
import { describe, it, expect } from 'vitest';
import { trimForTrial, TRIAL_PREVIEW_ROWS } from '../server.mjs';

// Shaped exactly like the live backend payload (routes/mcp_tier1_tools.py)
// AFTER dchub-backend#5408. `score` is now the real best_overall sort value, the
// composite 0.4×total_mw + 50×operators + 20×facilities, and it does not change
// with `limit`. Measured live 2026-09-24: ashburn 8887.2, dallas 5097.2,
// chicago 4489.2 at both limit=3 and limit=10. (Before #5408 it was the rescaled
// rank 100×(N−rank+1)/N.)
const composite = (mw, ops, fac) => Math.round((0.4 * mw + 50 * ops + 20 * fac) * 10) / 10;
const SCORE_BASIS = 'score is the value the results are sorted by, as described in methodology '
  + '(not a 0-100 scale, not rank-derived); it does not change with limit.';
const row = (rank, market, fac, mw, ops) => ({
  rank, market, metro_slug: market.replace(/-[a-z]{2}$/, ''),
  city: market, state: 'VA', country: 'US',
  score: composite(mw, ops, fac),
  value: `${fac} fac / ${mw} MW / ${ops} ops`,
  facility_count: fac, total_mw: mw, operator_count: ops,
  url: `https://dchub.cloud/markets/${market}`,
});
const payload = () => ({
  criteria: 'best_overall', region: 'us', result_count: 10, score_basis: SCORE_BASIS,
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

  // ── r-score-is-mw (2026-09-24): the backend fix landed, score stays gated ──
  // History: r-score-derivable published `score`. r-score-not-a-composite put
  // the null back because `score` was a rank ladder that moved with `limit`.
  // dchub-backend#5408 then made it the real sort value, which was the stated
  // condition for publishing it. That value is MW, though. For best_overall,
  // total_mw = (score − 50×ops − 20×fac)/0.4 using counts this preview keeps free.
  // For most_capacity and cheapest_power, score IS total_mw. r-free-numerics
  // (#502) withholds MW from the free tiers, so `score` stays null (owner
  // decision, 2026-09-24).
  it('score STAYS nulled — the real composite recovers the free-gated MW', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    for (const r of out.results) expect(r.score).toBeNull();
  });

  // Non-vacuity: the fixture must actually CARRY the real composite, and the
  // composite must really recover MW, or the assertion above guards nothing.
  it('the fixture ships the real composite, and it recovers MW exactly', () => {
    const rows = payload().results;
    expect(rows[0].score).toBe(8887.2);                // measured live, ashburn
    expect(rows[1].score).toBe(5097.2);                // measured live, dallas
    for (const r of rows) {
      const mw = (r.score - 50 * r.operator_count - 20 * r.facility_count) / 0.4;
      expect(Math.round(mw)).toBe(r.total_mw);
    }
  });

  it('score_basis passes through the free trim untouched', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    expect(out.score_basis).toBe(SCORE_BASIS);
  });

  it('the ROW COUNT and result_count gates are untouched by this change', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    expect(out.result_count).toBeNull();              // would contradict rows shown
    expect(out._results_total_in_pro).toBe(6);        // honest total survives
    expect(out.results.length).toBeLessThan(6);
    expect(out.results.length).toBe(TRIAL_PREVIEW_ROWS);
  });

  it('changes NOTHING for any other tool (scope is per-tool)', () => {
    for (const tool of ['search_facilities', 'get_grid_intelligence', undefined]) {
      const out = trimForTrial(payload(), tool);
      expect(out.results[0].total_mw).toBeNull();
      expect(out.results[0].facility_count).toBeNull();
      expect(out.results[0].operator_count).toBeNull();
      // r-score-derivable is scoped to rank_markets ALONE: the keep-set is
      // keyed by tool, so no other tool starts publishing a score.
      expect(out.results[0].score).toBeNull();
    }
  });
});
