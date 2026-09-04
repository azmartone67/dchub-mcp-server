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
// What the backend ACTUALLY puts in `score` — measured live 2026-09-04 by
// sweeping `limit`: a within-result-set position ladder, NOT the composite the
// `methodology` string names. N is the caller's limit, so the same market scores
// differently depending only on how many rows were requested.
//     score = 100 × (N − rank + 1) / N
const N_ROWS = 6;
const ladder = (rank, n = N_ROWS) => Math.round((100 * (n - rank + 1) / n) * 10) / 10;
const row = (rank, market, fac, mw, ops) => ({
  rank, market, metro_slug: market.replace(/-[a-z]{2}$/, ''),
  city: market, state: 'VA', country: 'US',
  score: ladder(rank),
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

  // ── r-score-not-a-composite (2026-09-04): the reversal is REVERSED ───────
  // r-score-derivable briefly published `score`, on the finding that it was the
  // composite named in `methodology` and so recomputable by any caller. The
  // evidence was that the composite reproduced the published RANK ORDER — which
  // it does, and which proves nothing, because rank order survives every
  // monotonic transform. Measured live by sweeping `limit`, `score` is
  // 100×(N−rank+1)/N: a position ladder that moves with the caller's own limit
  // (Dallas is 66.7 at limit=3 and 98 at limit=50). It restates `rank`, which is
  // published un-nulled anyway, and describes no property of the market.
  //
  // Gating it was vacuous; publishing it was worse. `null` is uninformative, a
  // limit-dependent `98` is misleading. It stays out until it means something —
  // the upstream fix belongs in the backend, where `methodology` promises a
  // composite that `score` does not deliver.
  it('score STAYS nulled — it is a limit-dependent ladder, not a metric', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    expect(out.results[0].score).toBeNull();
    for (const r of out.results) expect(r.score).toBeNull();
  });

  // Non-vacuity: the fixture must actually CARRY a score, or the assertion above
  // passes against a payload that never had one and guards nothing.
  it('the fixture really does ship a score for the trim to remove', () => {
    expect(typeof payload().results[0].score).toBe('number');
    expect(payload().results[0].score).toBe(100);      // rank 1 of 6
    expect(payload().results[1].score).toBe(83.3);     // rank 2 of 6 — moves with N
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
