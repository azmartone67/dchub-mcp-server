// site-point-depth-1120.test.mjs — planner 5.50 (Grok daily note 2026-11-19, item 13): the FEMA NFHL flood zone at the
// point as the site screen says it (the backend reads it, fail-closed), the nearest transmission line in km, and a 4 s composite cap in a plan.
import { describe, it, expect } from 'vitest';
import { nearestTransmission, floodZoneText, nearestLineText } from '../lib/site-point-depth.mjs';
import { _execStepCapMs, _EXEC_COMPOSITE_MS_DEFAULT, _EXEC_SCOREBOARD_MS_DEFAULT } from '../server.mjs';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const ZONE = { features: [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: '', SFHA_TF: 'T', DFIRM_ID: '48201C' } }] };
const PANEL = { features: [{ attributes: { FIRM_PAN: '48201C0670N', EFF_DATE: 1538352000000 } }] };
const route = (zones, panels) => async (url) => (/\/28\/query/.test(url) ? zones() : panels());

describe('floodZoneText (the backend\'s flood_zone_at_point)', () => {
  it('a measured zone, its SFHA side and its FIRM panel date', () => {
    expect(floodZoneText({ status: 'measured', zone: 'AE', zone_subtype: null, special_flood_hazard_area: true,
      firm_panel: '48201C0670N', panel_effective_date: '2018-10-01' }))
      .toBe('FEMA flood zone AE at the point, inside the Special Flood Hazard Area (1% annual chance) (FEMA NFHL, FIRM panel 48201C0670N, effective 2018-10-01).');
    expect(floodZoneText({ status: 'measured', zone: 'X', zone_subtype: 'AREA OF MINIMAL FLOOD HAZARD', special_flood_hazard_area: false }))
      .toBe('FEMA flood zone X (area of minimal flood hazard) at the point, outside the Special Flood Hazard Area (FEMA NFHL).');
  });
  it('unmapped is said as unmapped, a failed read as not available: never a zone', () => {
    expect(floodZoneText({ status: 'not_mapped', zone: null })).toMatch(/none mapped .*not the same as minimal hazard/);
    expect(floodZoneText({ status: 'unavailable', zone: null, reason: 'NFHL did not answer within 3 s' }))
      .toBe('FEMA flood zone at the point: not available (NFHL did not answer within 3 s).');
    expect(floodZoneText({ status: 'unavailable', zone: 'X' })).not.toMatch(/zone X/);
    expect(floodZoneText(null)).toBeNull();
  });
});

describe('nearestTransmission', () => {
  it('the nearest line, its kV, operator and the substation it is measured to', () => {
    const nt = nearestTransmission({ available: true, line_count: 47, ehv_230kv_plus: 34, max_voltage_kv: 500,
      nearest: { distance_km: 1.3, from_sub: 'ASHBURN', to_sub: 'BEAUMEADE', voltage_kv: 230, operator: 'VIRGINIA ELECTRIC & POWER CO' } });
    expect(nt).toMatchObject({ status: 'measured', distance_km: 1.3, voltage_kv: 230, substation: 'ASHBURN', lines_in_radius: 47 });
    expect(nearestLineText(nt)).toBe('Nearest transmission line: 230 kV (Virginia Electric & Power Co), 1.3 km from the point, measured to its ASHBURN substation endpoint (EIA/HIFLD).');
  });
  it('none in radius, outside coverage and a failed read are each said, never a distance', () => {
    expect(nearestTransmission({ available: true, line_count: 0, nearest_km: null }).status).toBe('none_in_radius');
    expect(nearestTransmission({ available: false, reason: 'outside_coverage' }).status).toBe('outside_coverage');
    expect(nearestTransmission(null).status).toBe('unavailable');
    expect(nearestLineText(nearestTransmission(null))).toBe('Nearest transmission line: not available in this run.');
  });
});

describe('_execStepCapMs (plan caps)', () => {
  it('composite gets 4 s inside a plan, scoreboard 5 s, other steps the 20 s default', () => {
    expect(_EXEC_COMPOSITE_MS_DEFAULT).toBe(4000);
    expect(_execStepCapMs('get_composite_site_score', {})).toBe(4000);
    expect(_execStepCapMs('get_grid_scoreboard', {})).toBe(_EXEC_SCOREBOARD_MS_DEFAULT);
    expect(_execStepCapMs('analyze_site', {})).toBe(20000);
  });
  it('DCHUB_PLAN_COMPOSITE_MS overrides within 1000-20000', () => {
    expect(_execStepCapMs('get_composite_site_score', { DCHUB_PLAN_COMPOSITE_MS: '2500' })).toBe(2500);
    expect(_execStepCapMs('get_composite_site_score', { DCHUB_PLAN_COMPOSITE_MS: '50' })).toBe(4000);
    expect(_execStepCapMs('get_grid_scoreboard', { DCHUB_PLAN_COMPOSITE_MS: '2500' })).toBe(_EXEC_SCOREBOARD_MS_DEFAULT);
  });
});
