// get_gas_intelligence's pipeline_capacity_utilization dropped each pipeline's `fetched_at` (when DC Hub read the
// posting). posted_at is null for Transwestern (measured live 2026-11-27), so an agent could cite only the gas day.
import { describe, it, expect } from 'vitest';
import { _gasPipelineCapacityBlock } from '../server.mjs';

const body = {
  ok: true, units: 'Dth per gas day',
  features: [{ properties: { pipeline: 'TW', state: 'TX', loc_id: '1', util_pct: 96, gas_day: '2026-11-26' } }],
  pipelines: [{ code: 'TW', name: 'Transwestern', gas_day: '2026-11-26', cycle: 'Intraday 1', posted_at: null,
    fetched_at: '2026-11-26T21:40:16.987892+00:00', stale: false, source_url: 'https://x', terms_url: 'https://y' }],
};

describe('gas pipeline block carries fetched_at', () => {
  it('keeps the pipeline fetched_at beside posted_at', () => {
    const out = _gasPipelineCapacityBlock(body, 'TX');
    expect(out.pipelines).toHaveLength(1);   // non-vacuity: the pipeline row is there
    expect(out.pipelines[0].fetched_at).toBe('2026-11-26T21:40:16.987892+00:00');
    expect(out.pipelines[0].posted_at).toBeNull();
  });
});
