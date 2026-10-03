// P0-1 (owner D5, 2026-10-03): substation detail is Pro. Below Pro the Land &
// Power preview must not carry a substation's name or exact voltage anywhere.
// Before this, analyze_site's nearest.hv_substation.name passed the generic
// masker (it keeps every `name`) and a free key read test_sub_xyz at
// 33.45,-112.07.
import { describe, it, expect } from 'vitest';
import { _lpPreviewResult, _stripSubstationDetail, _substationLockedView,
  SUBSTATION_DETAIL_MIN_TIER, SUBSTATION_DETAIL_FIELDS } from '../server.mjs';

const FULL = {
  success: true, overall_score: 41.9,
  nearest: { hv_substation: { name: 'WESTWING', voltage_kv: 500, km: 3.2 },
    gas_pipeline_km: 1.1 },
  nearby: { substations_50km: 212, facilities_100km: 40 },
  fiber: { top_carriers: ['Zayo', 'Lumen'] },
  nearest_substations: { substations: [{ hifld_id: '107655', name: 'WESTWING', max_kv: 500,
    distance_km: 3.2, kv_band: '500 kV+' }], search_radius_km: 50, coverage: 'HIFLD' },
  hosting_capacity: { feeders: [{ utility: 'APS', substation: 'Feeder Sub', available_mw: 2 }] },
};
const preview = (name = 'analyze_site', body = FULL) => _lpPreviewResult(name,
  { content: [{ type: 'text', text: JSON.stringify(body) }] }, false).structuredContent;

describe('P0-1 substation detail is Pro in the MCP preview', () => {
  it('the line is Pro and the CM-4 locked view reads it', () => {
    expect(SUBSTATION_DETAIL_MIN_TIER).toBe('pro');
    expect(_substationLockedView({ substations: [] }).required_plan).toBe(SUBSTATION_DETAIL_MIN_TIER);
  });

  it('analyze_site below Pro: no nearest HV substation name or kV', () => {
    const p = preview();
    expect(p.nearest.hv_substation).toBeDefined();
    for (const k of SUBSTATION_DETAIL_FIELDS) expect(k in p.nearest.hv_substation).toBe(false);
    expect(JSON.stringify(p)).not.toMatch(/WESTWING|107655/);
  });

  it('keeps what the preview is for: counts, carriers, other names', () => {
    const p = preview();
    expect(p.nearby.substations_50km).toBe(212);
    expect(p.fiber.top_carriers).toEqual(['Zayo', 'Lumen']);
    expect(p.hosting_capacity.feeders[0].utility).toBe('APS');
    // B2 (merge on/after 2026-10-19): below Pro the block is the free view
    // (distance band + kV band), still with no name, id or exact kV; the CM-4
    // lock returns under DCHUB_B2_SITE_HEADLINE=0.
    expect(p.nearest_substations.tier_required).toBe(SUBSTATION_DETAIL_MIN_TIER);
    expect(p.nearest_substations.substations).toEqual([{ distance_band: 'within 5 km', kv_band: '500 kV+' }]);
  });

  it('compare_sites: every site\'s nearest substation is stripped too', () => {
    const p = preview('compare_sites', { sites: [FULL, { ...FULL, nearest: {
      hv_substation: { name: 'test_sub_xyz', voltage_kv: 230, km: 0.4 } } }] });
    expect(JSON.stringify(p)).not.toMatch(/WESTWING|test_sub_xyz/);
  });

  it('only objects under a substation key lose fields', () => {
    const v = { facility: { name: 'Equinix DC1' }, substation: { name: 'X', operator: 'Y', kv_band: '500 kV+' } };
    expect(_stripSubstationDetail(v)).toEqual({ facility: { name: 'Equinix DC1' },
      substation: { kv_band: '500 kV+' } });
  });
});
