// us-grid-stub.mjs — a stub backend for the US grid reads get_grid_scoreboard
// fans out to. Not a test file (vitest collects *.test.mjs only).
//
// Figures are the live anonymous get_grid_scoreboard US rows measured
// 2026-11-09 08:32Z (DCPI BUILD counts from /api/v1/dcpi/iso-comparison, queue
// GW from /api/v1/interconnection-queue/snapshot). The paid DCPI aggregates
// (queue wait, curtailment, emergencies, reserve margin) carry PLANTED values
// so a test can prove an anonymous answer never shows them.
export const DCPI_COMPUTED_AT = '2026-11-09T08:33:06.830552+00:00';
// The OLDEST market score per ISO aggregate (backend oldest_computed_at, MIN(computed_at)).
// PJM's is the oldest of all, so a ranking dated by its oldest row reads this day.
export const DCPI_OLDEST = { PJM: '2026-11-08T05:13:51+00:00' };
export const DCPI_OLDEST_DEFAULT = '2026-11-09T08:31:12.104210+00:00';
export const PLANTED_QUEUE_WAIT = 41.7;
export const PLANTED_RESERVE_MARGIN = 17.3;

const FUEL = {
  PJM:   { NG: 33391, NUC: 30709, COL: 13013, WND: 5584, SUN: 13, WAT: 1642, OIL: 271, OTH: 2006 },
  ERCOT: { NG: 26798, NUC: 3851, COL: 8487, WND: 5838, SUN: 1 },
  CAISO: { NG: 9841, NUC: 1253, COL: 2, WND: 971, WAT: 1466, GEO: 686, OTH: 286 },
  MISO:  { NG: 27273, NUC: 8469, COL: 14702, WND: 18577, SUN: 5, WAT: 677, OTH: 517 },
  SPP:   { NG: 11357, NUC: 1418, COL: 7797, WND: 9564, WAT: 299, OTH: 75 },
  NYISO: { NG: 4499, NUC: 3331, WND: 1449, WAT: 2226, OTH: 247 },
  'ISO-NE': { NG: 4960, NUC: 2111, WND: 1132, WAT: 258, OTH: 545 },
  BPA:   { NG: 392, NUC: 1147, WND: 736, WAT: 6061, OTH: 120 },
  TVA:   { NG: 4506, NUC: 7294, COL: 1912, WAT: 1284, OTH: 24 },
};
const DEMAND = { PJM: 78497, ERCOT: 44550, CAISO: 22878, MISO: 66761, SPP: 27602, NYISO: 12958, 'ISO-NE': 10074, BPA: 5884, TVA: 15610 };
const MIX_PERIOD = { PJM: '2026-11-08T04', ERCOT: '2026-11-09T07', CAISO: '2026-11-09T08', MISO: '2026-11-08T04',
  SPP: '2026-11-08T05', NYISO: '2026-11-09T07', 'ISO-NE': '2026-11-09T08', BPA: '2026-11-08T07', TVA: '2026-11-08T05' };
// build_count / market_count per ISO (BPA has no DCPI row, as live).
const DCPI = { PJM: [0, 64], ERCOT: [1, 19], CAISO: [2, 14], MISO: [2, 39], SPP: [12, 12], NYISO: [0, 10], ISONE: [0, 11], TVA: [0, 7] };
const QUEUE = { PJM: [null, null], ERCOT: [461.4, '2026-11-09'], CAISO: [164.9, '2026-07-16'], MISO: [null, null],
  SPP: [185.9, null], NYISO: [10, null], ISONE: [10.9, null] };

export function gridIntelligence(iso) {
  const f = FUEL[iso];
  if (!f) return undefined;
  const gm = {};
  for (const [k, mw] of Object.entries(f)) gm[k] = { mw, period: MIX_PERIOD[iso] };
  // The backend's own mix age (shapeScoreboardUsRow prefers it), fixed so the scoreboard's
  // stale-mix list does not move with the clock: SPP is fresh, every other grid is stale. The
  // harvest meets the stale list first, so a plan that took the first harvested ISO reads NYISO;
  // one that follows the ranking reads SPP.
  return { iso, region: iso, demand_mw: DEMAND[iso], demand_period: '2026-11-09T07',
           generation_mix_period: MIX_PERIOD[iso], generation_mix: gm,
           generation_mix_age_hours: iso === 'SPP' ? 1 : 27 };
}

// opts.oldest: false = a backend that predates oldest_computed_at (the row stays undated).
export function isoComparison(computedAt = DCPI_COMPUTED_AT, opts = {}) {
  return {
    as_of: computedAt,
    isos: Object.entries(DCPI).map(([iso, [b, m]]) => ({
      iso, build_count: b, market_count: m, latest_computed_at: computedAt,
      ...(opts.oldest === false ? {} : { oldest_computed_at: DCPI_OLDEST[iso] || DCPI_OLDEST_DEFAULT }),
      avg_queue_wait_months: PLANTED_QUEUE_WAIT, avg_curtailment_pct: 2.2, sum_emergency_30d: 3,
      avg_reserve_margin_pct: PLANTED_RESERVE_MARGIN,
    })),
  };
}

export function queueSnapshot() {
  return {
    by_iso: Object.entries(QUEUE).filter(([, [gw]]) => gw != null)
      .map(([iso, [gw, asOf]]) => ({ iso, queued_generation_gw: gw, as_of: asOf })),
    totals: { queued_generation_gw: 1468.9 },
  };
}

// opts.dcpi: false drops the DCPI comparison (an outage), opts.computedAt overrides its date,
// opts.oldest: false serves the pre-oldest_computed_at backend shape.
export function usGridRoutes(opts = {}) {
  return (p) => {
    const m = /^\/api\/v1\/grid\/intelligence\/([A-Za-z-]+)$/.exec(p);
    if (m) {
      const body = gridIntelligence(m[1].toUpperCase());
      return body ? { status: 200, body } : undefined;
    }
    if (p === '/api/v1/dcpi/iso-comparison') {
      if (opts.dcpi === false) return { status: 503, body: { error: 'unavailable' } };
      return { status: 200, body: isoComparison(opts.computedAt, opts) };
    }
    if (p === '/api/v1/interconnection-queue/snapshot') return { status: 200, body: queueSnapshot() };
    if (/^\/api\/v1\/iso\/[a-z]+\/snapshot$/.test(p)) return { status: 503, body: { error: 'stub: no international feed' } };
    return undefined;
  };
}
