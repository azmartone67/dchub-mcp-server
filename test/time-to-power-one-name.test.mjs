// GUARD — avg_time_to_power_months must come from the time-to-power column,
// not from the queue-wait proxy.
//
// Measured live 2026-08-08T03:17Z:
//
//   get_grid_intelligence  ERCOT -> "avg_time_to_power_months": 71.5
//   /api/v1/iso/ERCOT/snapshot   -> "avg_time_to_power_months": 55.3
//
// Same field name, same instant, two numbers. shapeGridIntelligence read
// row.avg_queue_wait_months — the depth-derived interconnection-wait PROXY
// (12 + 0.6/GW, clipped 12-66) — and published it as time-to-power, because
// /api/v1/dcpi/iso-comparison did not aggregate the real column at all.
// Backend #2384 added it; this is the consuming half.
//
// Pure test — shapeGridIntelligence takes its three feed responses as inputs.
import { describe, it, expect } from 'vitest';
import { shapeGridIntelligence } from '../server.mjs';

// The two values are DELIBERATELY different, so a path reading the wrong one
// is visible rather than coincidentally right.
const CMP = {
  isos: [{
    iso: 'ERCOT', iso_name: 'Electric Reliability Council of Texas',
    market_count: 19, build_count: 1,
    avg_constraint: 55.4, avg_excess: 66.2,
    avg_queue_wait_months: 71.5,        // the proxy
    avg_time_to_power_months: 55.3,     // the real column
    avg_curtailment_pct: 4.3, avg_reserve_margin_pct: 19.9,
    avg_kwh_cents: 10.31, total_stranded_capacity_mw: 0,
    sum_emergency_30d: 0, latest_computed_at: '2026-08-08T01:41:57Z',
  }],
};
const GI = { region: 'ERCOT', demand_mw: 78623, demand_period: '2026-08-08T02',
             generation_mix: { NG: { mw: 37471, period: '2026-08-07T04' } } };
const Q = { by_iso: [{ iso: 'ERCOT', queued_load_total_gw: 440.3 }] };

describe('shapeGridIntelligence — avg_time_to_power_months', () => {
  it('reads the time-to-power column, not the queue-wait proxy', () => {
    const out = shapeGridIntelligence('ERCOT', GI, CMP, Q);
    expect(out.avg_time_to_power_months).toBe(55.3);
    expect(out.avg_time_to_power_months).not.toBe(71.5);
  });

  it('still publishes the queue-wait proxy, under its own honest name', () => {
    const out = shapeGridIntelligence('ERCOT', GI, CMP, Q);
    expect(out.avg_queue_wait_months).toBe(71.5);
  });

  it('keeps the two as distinct fields — never one value under two names', () => {
    const out = shapeGridIntelligence('ERCOT', GI, CMP, Q);
    expect(out.avg_time_to_power_months).not.toBe(out.avg_queue_wait_months);
  });

  it('goes NULL rather than substituting the proxy when the field is absent', () => {
    // A backend that has not deployed the new aggregate must produce null, not
    // a different measurement wearing this name. Silently substituting is the
    // entire defect.
    const stale = { isos: [{ ...CMP.isos[0] }] };
    delete stale.isos[0].avg_time_to_power_months;
    const out = shapeGridIntelligence('ERCOT', GI, stale, Q);
    // The row IS present and DOES carry the proxy — so a null here can only
    // mean the shaper refused to substitute, not that it found nothing.
    expect(out.avg_queue_wait_months).toBe(71.5);
    expect(out.avg_time_to_power_months).toBeNull();
  });

  it('no DCPI row at all leaves both null', () => {
    const out = shapeGridIntelligence('ERCOT', GI, { isos: [] }, Q);
    expect(out.avg_time_to_power_months).toBeNull();
    expect(out.avg_queue_wait_months).toBeNull();
  });

  it('the other DCPI passthroughs are unchanged', () => {
    const out = shapeGridIntelligence('ERCOT', GI, CMP, Q);
    expect(out.constraint_score).toBe(55.4);
    expect(out.excess_power_score).toBe(66.2);
    expect(out.curtailment_pct).toBe(4.3);
    expect(out.retail_price_cents_kwh).toBe(10.31);
    expect(out.market_count).toBe(19);
  });
});

describe('tool descriptions name both measurements', () => {
  const src = () => import('node:fs/promises')
    .then(fs => fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8'));

  it('get_grid_intelligence and compare_isos both distinguish them', async () => {
    const s = await src();
    for (const tool of ['get_grid_intelligence', 'compare_isos']) {
      // Anchor on the REGISTRATION, not the first mention — the name also
      // appears in comments and in other tools' "do NOT use" cross-references.
      const i = s.indexOf(`trackedTool(srv, '${tool}'`);
      expect(i, `${tool} registration not found`).toBeGreaterThan(-1);
      const desc = s.slice(i, i + 4000);
      expect(desc).toMatch(/avg_queue_wait_months/);
      expect(desc).toMatch(/DIFFERENT measurements/);
    }
  });
});
