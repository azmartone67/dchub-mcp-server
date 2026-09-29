// ── a masked number that sits beside its own addends is not paywalled ───────
//
// MEASURED LIVE 2026-09-20, anonymous caller, get_interconnection_queue:
//
//   projects.total        null
//   projects.by_iso_count {CAISO:279, ERCOT:1907, ISO-NE:68, MISO:1136,
//                          NYISO:176, PJM:972, SPP:1021}       sum = 5559
//   /api/v1/interconnection-queue/snapshot (admin)   total    = 5559
//
// by_iso_count survives trimForTrial intact — it is an OBJECT keyed by ISO
// name, so the array slice never touches it and the ISO keys are not metric
// keys — while `total` matches _isMetricKey's `^total$` and is nulled. So the
// free tier published every addend and withheld the sum. One addition recovers
// it exactly. The mask bought nothing and cost the honesty: `null` says
// "unknown" when the number is derivable from the field beside it.
//
// Same argument as excluded_total / markets_in_region in
// test/coverage-counts-not-masked.test.mjs — two fields carrying the SAME
// number, one masked and one not.
//
// ★ IF THIS FILE STARTS FAILING because by_iso_count is no longer published
// whole, do NOT patch the sum. The premise changed: once the addends are gone,
// masking `total` is coherent again and the _TYPED_PREVIEW_FIELDS entry should
// be REMOVED instead.
import { describe, it, expect } from 'vitest';
import { trimForTrial, TRIAL_PREVIEW_ROWS, _isMetricKey } from '../server.mjs';

const BY_ISO_COUNT = { CAISO: 279, ERCOT: 1907, 'ISO-NE': 68, MISO: 1136,
                       NYISO: 176, PJM: 972, SPP: 1021 };
const TRUE_TOTAL = Object.values(BY_ISO_COUNT).reduce((a, b) => a + b, 0); // 5559

// The live shape, not a shape small enough to dodge the trim: 10 by_iso rows
// (so the array slice fires) and per-project rows carrying capacity_mw.
const snapshot = () => ({
  as_of: '2026-09-20',
  iso_count: 10,
  by_iso: ['NESO', 'ERCOT', 'PJM', 'MISO', 'CAISO', 'SPP', 'NYISO', 'ISO-NE', 'AESO', 'IESO']
    .map((iso) => ({ iso, queued_load_total_gw: 412.5,
                     queued_load_data_center_gw: 225.3, source_name: 'public queue' })),
  projects: {
    total: TRUE_TOTAL,
    tracked: true,
    by_iso_count: { ...BY_ISO_COUNT },
    top: [{ project_name: 'A', capacity_mw: 300, iso: 'CAISO', state: 'AZ' },
          { project_name: 'B', capacity_mw: 250, iso: 'PJM', state: 'PA' },
          { project_name: 'C', capacity_mw: 180, iso: 'PJM', state: 'NJ' },
          { project_name: 'D', capacity_mw: 120, iso: 'MISO', state: 'IL' }],
  },
});

describe('get_interconnection_queue: the queue total is not withheld from its own addends', () => {
  it('projects.total survives the free-tier trim', () => {
    const out = trimForTrial(snapshot(), 'get_interconnection_queue');
    expect(out.projects.total).toBe(TRUE_TOTAL);
  });

  // ★ The load-bearing assertion. Computed from the TRIMMED OUTPUT, not the
  // input, so a trim that mangles by_iso_count fails here rather than passing
  // on a stale premise.
  it('equals the sum of the by_iso_count the trim actually publishes', () => {
    const out = trimForTrial(snapshot(), 'get_interconnection_queue');
    const published = out.projects.by_iso_count;
    expect(Object.keys(published).sort()).toEqual(Object.keys(BY_ISO_COUNT).sort());
    for (const [iso, n] of Object.entries(BY_ISO_COUNT)) {
      expect(published[iso], `${iso} must keep its count`).toBe(n);
    }
    expect(Object.values(published).reduce((a, b) => a + b, 0)).toBe(out.projects.total);
  });

  // ★ Non-vacuous: the mask must still bite on this same tool and this same
  // call, or the exemption is a hole rather than a patch.
  it('the paywalled metrics on this tool are STILL masked', () => {
    const out = trimForTrial(snapshot(), 'get_interconnection_queue');
    for (const row of out.by_iso) {
      expect(row.queued_load_total_gw, `${row.iso} GW must stay masked`).toBeNull();
      expect(row.queued_load_data_center_gw, `${row.iso} DC GW must stay masked`).toBeNull();
    }
    expect(out.iso_count).toBeNull();
    for (const row of out.projects.top) expect(row.capacity_mw).toBeNull();
  });

  it('the array trim still applies, with an honest total beside it', () => {
    const out = trimForTrial(snapshot(), 'get_interconnection_queue');
    expect(out.by_iso).toHaveLength(TRIAL_PREVIEW_ROWS);
    expect(out._by_iso_total_in_pro).toBe(10);
  });

  // ★ Scope. `total` is a genuine paywalled aggregate on other surfaces, and
  // the exemption must not have escaped this tool. An implementation that
  // added 'total' to _PROTECTED_KEYS (bare name, no tool scope) passes every
  // test above and fails this one.
  it('the exemption is scoped to this tool, not to the name `total`', () => {
    expect(_isMetricKey('total')).toBe(true);
    for (const other of ['hyperscaler_deals', 'list_transactions', 'get_market_intel']) {
      const out = trimForTrial({ total: 4242, deal_total: 99 }, other);
      expect(out.total, `total must stay masked on ${other}`).toBeNull();
      expect(out.deal_total).toBeNull();
    }
  });

  it('and is scoped to the field, not to the whole tool', () => {
    const out = trimForTrial({ total: 7, total_mw: 1234, facility_count: 9 },
                             'get_interconnection_queue');
    expect(out.total).toBe(7);
    expect(out.total_mw).toBeNull();
    expect(out.facility_count).toBeNull();
  });
});
