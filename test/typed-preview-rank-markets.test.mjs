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
// The backend's published composite, verbatim from the `methodology` string
// this tool ships in the same object: 0.4×total_mw + 50×operators + 20×facilities.
const composite = (fac, mw, ops) => 0.4 * mw + 50 * ops + 20 * fac;
const row = (rank, market, fac, mw, ops) => ({
  rank, market, metro_slug: market.replace(/-[a-z]{2}$/, ''),
  city: market, state: 'VA', country: 'US',
  score: composite(fac, mw, ops),
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

  // ── r-score-derivable (2026-09-04): DELIBERATE CONTRACT REVERSAL ─────────
  // This assertion used to read `expect(out.results[0].score).toBeNull()` with
  // the comment "composite rank = paid". The gate it defended was vacuous: the
  // same object publishes the formula (`methodology`) and all three inputs, so
  // any agent that can multiply already had the number. Measured live on an
  // anonymous call — 0.4(5793)+50(55)+20(191) = 8887.2 reproduces published
  // rank 1 exactly. Nulling it cost the citation and withheld nothing.
  it('THE FIX: score survives TYPED — the gate it had was derivable anyway', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    expect(typeof out.results[0].score).toBe('number');
    // the live-measured figure, hardcoded — not recomputed by the same
    // expression under test, so a broken formula cannot pass this by mirroring.
    expect(out.results[0].score).toBeCloseTo(8887.2, 5);
    expect(out.results[1].score).toBeCloseTo(5097.2, 5);
    expect(out.results[2].score).toBeCloseTo(4489.2, 5);
  });

  it('the surviving score still RANKS — it is the field it claims to be', () => {
    const out = trimForTrial(payload(), 'rank_markets');
    // Non-vacuity guard: with every score nulled, the sort below is a no-op and
    // this test passes while asserting nothing. Verified by mutation — without
    // this line, dropping 'score' from the keep-set leaves this test GREEN.
    for (const r of out.results) expect(typeof r.score).toBe('number');
    const byScore = [...out.results].sort((a, b) => b.score - a.score).map((r) => r.rank);
    expect(byScore).toEqual([...out.results].map((r) => r.rank).sort((a, b) => a - b));
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
