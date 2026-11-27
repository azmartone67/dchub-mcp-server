// get_gas_intelligence's pipeline_capacity_utilization and get_fiber_readiness's fttp_providers come
// from public backend routes that serve every caller in full. The keyless trim nulled util_pct and
// provider_count with no withheld marker (scheduled_dth / operating_dth still beside util_pct, so the
// "withheld" figure was recomputable). Both blocks now pass through the anon trim untouched.
import { describe, it, expect } from 'vitest';
import { trimForTrial } from '../server.mjs';

const pcu = {
  state: 'TX', locations_in_state: 151, at_or_above_90pct_in_state: 2,
  most_utilized: [1, 2, 3, 4, 5, 6].map((i) => ({
    pipeline: 'TW', loc_id: String(i), util_pct: 90 + i, operating_dth: 1000, scheduled_dth: 900 + i,
    available_dth: 100 - i, gas_day: '2026-11-26' })),
  units: 'Dth per gas day',
};
const fttp = {
  provider_count: 31,
  top_providers: Array.from({ length: 10 }, (_, i) => ({ brand: 'B' + i, locations: 1000 - i, hexes: 10 + i })),
  bbox: [-97.0671, 32.5554, -96.5329, 33.0046], box_half_side_km: 25,
};

describe('anon trim keeps the public gas and fiber blocks whole', () => {
  it('pipeline_capacity_utilization: every row and every util_pct survive, no marker', () => {
    const out = trimForTrial({ region: 'TX', dcgi_score: 77.1, pipeline_capacity_utilization: pcu },
      'get_gas_intelligence');
    expect(out.pipeline_capacity_utilization).toEqual(pcu);
    expect(JSON.stringify(out.pipeline_capacity_utilization)).not.toMatch(/_in_pro|_withheld|_total_/);
  });

  it('fttp_providers: provider_count, all providers and the full bbox survive', () => {
    const out = trimForTrial({ score: 92, carrier_count: 506, fttp_providers: fttp }, 'get_fiber_readiness');
    expect(out.fttp_providers).toEqual(fttp);
  });

  it('non-vacuity: the same blocks under another key are still trimmed', () => {
    const out = trimForTrial({ other_block: pcu, other_fiber: fttp }, 'get_gas_intelligence');
    expect(out).not.toEqual({ other_block: pcu, other_fiber: fttp });
  });
});
