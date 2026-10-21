// 2026-10-21 (owner: "mcp tools should cover way more"): get_grid_data and compare_isos serve
// every live grid DC Hub ingests, not only the 7 US ISOs. Routing + the non-US row shape.
import { describe, it, expect } from 'vitest';
import { _gridRoute, _gridCode, shapeLatestGrid, _validateToolArgs } from '../server.mjs';

describe('_gridRoute', () => {
  it('US ISOs and EIA regions read /grid/intelligence', () => {
    for (const c of ['PJM', 'ercot', 'ISO-NE', 'NEISO', 'TVA', 'BPA', 'AZPS', 'PHOENIX', 'PGE']) {
      expect(_gridRoute(c), c).toBe('intelligence');
    }
  });
  it('non-EIA grids and their aliases read /grid/latest', () => {
    for (const c of ['AESO', 'hydroquebec', 'IESO', 'NGESO', 'GB', 'UK', 'EU_DE_LU', 'eu_fr', 'JP_TOKYO',
                     'BR_SUL', 'TAIPOWER', 'OCCTO', 'KEPCO-KR', 'ONS', 'AEMO', 'EMA', 'ALBERTA', 'QUEBEC']) {
      expect(_gridRoute(c), c).toBe('latest');
    }
  });
  it('empty is null and codes are upper-cased without spaces', () => {
    expect(_gridRoute('')).toBeNull();
    expect(_gridCode(' eu_de_lu ')).toBe('EU_DE_LU');
  });
  it('get_grid_data no longer pre-rejects a non-ISO grid', () => {
    for (const c of ['AESO', 'EU_DE_LU', 'TVA', 'AZPS', 'NGESO']) expect(_validateToolArgs('get_grid_data', { iso: c }), c).toBeNull();
  });
});

describe('shapeLatestGrid', () => {
  const body = {
    iso: 'AESO', family: 'canada', demand_mw: 11301, newest_at: '2026-10-21T07:58:46+00:00', oldest_at: '2026-10-21T07:43:00+00:00',
    metrics: {
      generation_total_mw: { value: 10000, unit: 'MW' }, fuel_gas_mw: { value: 6000, unit: 'MW' },
      fuel_wind_mw: { value: 3000, unit: 'MW' }, fuel_hydro_mw: { value: 500, unit: 'MW' },
      fuel_solar_mw: { value: 0, unit: 'MW' }, fuel_other_mw: { value: 500, unit: 'MW' },
    },
  };
  it('derives renewable and gas share from the stored fuel rows', () => {
    const r = shapeLatestGrid('AESO', body);
    expect(r.renewable_share_pct).toBe(35);
    expect(r.gas_share_pct).toBe(60);
    expect(r.demand_mw).toBe(11301);
    expect(r.newest_at).toBe('2026-10-21T07:58:46+00:00');
  });
  it('DCPI and queue fields are null with a basis, never zero', () => {
    const r = shapeLatestGrid('AESO', body);
    for (const k of ['constraint_score', 'excess_power_score', 'avg_time_to_power_months', 'avg_queue_wait_months', 'queue_depth_gw']) {
      expect(r[k], k).toBeNull();
    }
    expect(r.not_tracked).toMatch(/not tracked, not zero/);
  });
  it('an error, a retired stream or no mix stays honest', () => {
    expect(shapeLatestGrid('X', { error: 'API 404', detail: 'no stored readings' }).error).toBe('API 404');
    expect(shapeLatestGrid('JP_OKINAWA', { retired: true, status: 'source_blocked', reason: 'Imperva 403' }).error).toBe('stream source_blocked');
    const r = shapeLatestGrid('EMA', { iso: 'EMA', demand_mw: 7692, metrics: { demand_mw: { value: 7692 } } });
    expect(r.renewable_share_pct).toBeNull();
    expect(r.generation_mix_mw).toBeNull();
  });
});
