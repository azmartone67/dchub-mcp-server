// Grok Note K item 6c (2026-11-15): ONE definition of "N of M shown" for a per-entity series.
//
// compare_isos withholds the hourly demand curve per grid: the free preview keeps 3 rows of each grid's
// `demand_24h` and records each grid's own length in `_demand_24h_total_in_pro` (20, 21, 21 live). Three
// readers then each told a different story:
//   - the direct call's citation: "3 of 21 shown"   (3 rows of ONE grid, PJM's 21: the biggest single gap)
//   - execute_plan's envelope:   "1 of 21 shown"   (the same, after the size slim cut 3 rows to 1)
//   - continuation.gated:        records_shown 3, records_available 21
// None of them counted the comparison. For a series named here, every occurrence is summed (rows shown
// across all grids of all rows those grids hold: 9 of 62 on that call), and the count says what it
// counts. A response with one grid sums to that grid's own count, so a single-grid answer keeps its
// number. Keyed by the withheld field's name; nothing outside this map changes.
export const GATE_SERIES_NOUN = Object.freeze({
  demand_24h: 'hourly demand readings',
});

export function gateSeriesNoun(base, entities) {
  const n = GATE_SERIES_NOUN[base];
  if (!n) return null;
  return entities > 1 ? `${n} across ${entities} grids` : n;
}
