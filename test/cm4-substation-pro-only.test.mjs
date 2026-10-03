// CM-4 (owner 2026-10-03, superseding CM-4b): analyze_site's
// nearest_substations is Pro and up; below Pro it is locked (a count, no
// rows). Feeder MW and distances keep the Land & Power preview rule (null).
import { describe, it, expect } from 'vitest';
import { _lpPreviewResult, _substationLockedView, SUBSTATION_ROW_FIELDS } from '../server.mjs';

const ROW = { hifld_id: '107655', name: 'HOLCOMBE', max_kv: 138, distance_km: 2.3,
  kv_band: '115-229 kV', source: 'HIFLD Electric Substations', as_of: '2021-02-01',
  basis_class: 'published' };
const FULL = {
  success: true, overall_score: 81.2,
  nearest_substations: { substations: [ROW, { ...ROW, hifld_id: '2', name: 'B', distance_km: 4.1 }],
    substations_in_radius: 37,
    search_radius_km: 50, coverage: 'HIFLD (United States and territories) only' },
  hosting_capacity: { feeders: [{ utility: 'Dominion Energy Virginia', feeder_id: 'F1',
    available_mw: 3.0, distance_km: 1.2, capacity_type: 'load', as_of: '2026-08-01',
    source: 'Dominion Energy Virginia', basis_class: 'published' }] },
};
const preview = () => _lpPreviewResult('analyze_site',
  { content: [{ type: 'text', text: JSON.stringify(FULL) }] }, false).structuredContent;

describe('CM-4 substations are Pro only', () => {
  it('below Pro the block is locked: a count and the locked fields, no row data', () => {
    const p = preview();
    const subs = p.nearest_substations;
    expect(subs).toEqual({ locked: true, required_plan: 'pro', substations_in_radius: 37,
      search_radius_km: 50, coverage: 'HIFLD (United States and territories) only',
      locked_fields: SUBSTATION_ROW_FIELDS,
      note: expect.stringContaining('is Pro') });
    expect(JSON.stringify(subs)).not.toMatch(/HOLCOMBE|107655|2\.3|115-229/);
    expect(p.upgrade_url).toBeTruthy();
  });

  it('leaves feeder MW and distance under the LP rule (null), labels kept', () => {
    const f = preview().hosting_capacity.feeders[0];
    expect(f.available_mw).toBeNull();
    expect(f.distance_km).toBeNull();
    expect(f.capacity_type).toBe('load');
    expect(f.utility).toBe('Dominion Energy Virginia');
  });

  it('the count is the radius count from the backend, never the capped row length', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...ROW, hifld_id: String(i) }));
    expect(_substationLockedView({ substations: rows, substations_in_radius: 37 })
      .substations_in_radius).toBe(37);
    // a backend that did not send the count (or a failed count): unknown, not 5
    expect(_substationLockedView({ substations: rows }).substations_in_radius).toBeNull();
    expect(_substationLockedView({ substations: rows, substations_in_radius: null })
      .substations_in_radius).toBeNull();
  });

  it('a failed block stays null, an absent one stays absent', () => {
    expect(_substationLockedView(null)).toBeNull();
    const none = _lpPreviewResult('analyze_site',
      { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] }, false).structuredContent;
    expect('nearest_substations' in none).toBe(false);
  });
});
