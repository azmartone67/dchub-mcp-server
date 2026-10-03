// CM-4b (owner 2026-10-03): analyze_site's nearest_substations on a free key
// is distance + kV band; hifld_id, name and exact kV are Pro. Feeder MW and
// distances keep the Land & Power preview rule (null).
import { describe, it, expect } from 'vitest';
import { _lpPreviewResult, _substationFreeView, SUBSTATION_PAID_FIELDS } from '../server.mjs';

const ROW = { hifld_id: '107655', name: 'HOLCOMBE', max_kv: 138, distance_km: 2.3,
  kv_band: '115-229 kV', source: 'HIFLD Electric Substations', as_of: '2021-02-01',
  basis_class: 'published' };
const FULL = {
  success: true, overall_score: 81.2,
  nearest_substations: { substations: [ROW, { ...ROW, hifld_id: '2', name: 'B', distance_km: 4.1 }],
    search_radius_km: 50, coverage: 'HIFLD (United States and territories) only' },
  hosting_capacity: { feeders: [{ utility: 'Dominion Energy Virginia', feeder_id: 'F1',
    available_mw: 3.0, distance_km: 1.2, capacity_type: 'load', as_of: '2026-08-01',
    source: 'Dominion Energy Virginia', basis_class: 'published' }] },
};
const preview = () => _lpPreviewResult('analyze_site',
  { content: [{ type: 'text', text: JSON.stringify(FULL) }] }, false).structuredContent;

describe('CM-4b substation free view', () => {
  it('keeps distance and kV band, removes the paid keys, names them', () => {
    const subs = preview().nearest_substations;
    expect(subs.substations).toHaveLength(2);
    expect(subs.substations[0]).toEqual({ distance_km: 2.3, kv_band: '115-229 kV',
      source: 'HIFLD Electric Substations', as_of: '2021-02-01', basis_class: 'published' });
    expect(subs.locked_fields).toEqual(SUBSTATION_PAID_FIELDS);
    expect(JSON.stringify(subs)).not.toMatch(/HOLCOMBE|107655/);
  });

  it('leaves feeder MW and distance under the LP rule (null), labels kept', () => {
    const f = preview().hosting_capacity.feeders[0];
    expect(f.available_mw).toBeNull();
    expect(f.distance_km).toBeNull();
    expect(f.capacity_type).toBe('load');
    expect(f.utility).toBe('Dominion Energy Virginia');
  });

  it('a failed block stays null, an absent one stays absent', () => {
    expect(_substationFreeView(null)).toBeNull();
    const none = _lpPreviewResult('analyze_site',
      { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }, false).structuredContent;
    expect('nearest_substations' in none).toBe(false);
  });
});
