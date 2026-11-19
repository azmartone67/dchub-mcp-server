// mcp-dominance-3-routing-1117.test.mjs — Grok MCP-dominance evals (2026-11-17), planner 5.36: gaps 4 and 6.
//
//   gap 4  Every fiber ask ran one recipe (get_fiber_intel longhaul; get_fiber_readiness and plan_fiber_leadin
//          skipped_unresolved). get_metro_fiber / get_peering_intel never ran; an on-net check at a point and a
//          subsea ask went to site_analysis; a point read could be labelled by the state its response carried.
//   gap 6  "transmission lines / plants / gas pipelines near <lat, lon>" went to site_analysis bands.
//
// Routing is pure (_planQuery). The end-to-end run is test/mcp-dominance-3-routing-e2e-1117.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _EXEC_ALLOWED_TOOLS, _CLASS_WHY_LIVE, PLANNER_VERSION } from '../server.mjs';
import { fiberKind, pointInfraAsk, nearestMetro, subseaWhere } from '../lib/plan-routing.mjs';
import { factsFromStep } from '../lib/plan-step-facts.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const args = (p, tool) => p.recommended_sequence.filter((s) => s.tool === tool).map((s) => s.args_hint);

describe('5.37', () => {
  it('PLANNER_VERSION is the current one (5.40)', () => { expect(PLANNER_VERSION).toBe('5.44'); });
  it('get_subsea_cables and get_infrastructure are on the execute_plan allowlist, and the new classes carry a why_live code', () => {
    expect(_EXEC_ALLOWED_TOOLS).toContain('get_subsea_cables');
    expect(_EXEC_ALLOWED_TOOLS).toContain('get_infrastructure');
    expect(_CLASS_WHY_LIVE.subsea_cables).toBe('requires_current_infrastructure_layers');
    expect(_CLASS_WHY_LIVE.point_infrastructure).toBe('requires_current_infrastructure_layers');
  });
});

describe('gap 4: a fiber ask at a point reads that point', () => {
  it('on-net fiber near NYC coordinates: readiness and peering at the point, then the New York metro map', () => {
    const p = _planQuery('Is there on-net fiber near 40.7128, -74.0060?', {});
    expect(p.intent_class).toBe('fiber');
    expect(tools(p)).toEqual(['get_fiber_readiness', 'get_peering_intel', 'get_metro_fiber']);
    expect(args(p, 'get_fiber_readiness')[0]).toEqual({ lat: 40.7128, lon: -74.006 });
    expect(args(p, 'get_peering_intel')[0]).toEqual({ lat: 40.7128, lon: -74.006 });
    expect(args(p, 'get_metro_fiber')[0]).toEqual({ market: 'New York' });
    expect(tools(p)).not.toContain('analyze_site');
  });
  it('the NYC point is New York, not New Jersey: the nearest metro core wins over Secaucus', () => {
    const n = nearestMetro(40.7128, -74.006);
    expect(n.metro.state).toBe('NY');
    expect(nearestMetro(40.7895, -74.0565).metro.state).toBe('NJ');
    expect(nearestMetro(0, 0)).toBeNull();
  });
  it('a point read is labelled by the point, never by the state its response carried', () => {
    const f = factsFromStep('get_fiber_readiness', { state: 'NJ', near_net_bucket: 'on-net', nearest_carrier_km: 0.1 }, { lat: 40.7128, lon: -74.006 });
    expect(f[0].entity).toBe('40.7128, -74.006');
    expect(f[0].text).toBe('Fiber at 40.7128, -74.006: on-net, nearest carrier 0.1 km (PeeringDB carrier presence + FCC fiber coverage).');
    const t = factsFromStep('get_peering_intel', { state: 'NJ', taste: { headline: { name: 'facilities_nearby', value: 40 } } }, { lat: 40.7128, lon: -74.006 });
    expect(t[0].text).not.toMatch(/\bNJ\b/);
  });
  it('a whole-site ask with coordinates stays a site analysis; a lead-in ask adds the lead-in plan', () => {
    expect(_planQuery('Evaluate the site at 39.04, -77.49 for power, water and fiber', {}).intent_class).toBe('site_analysis');
    const p = _planQuery('Plan diverse fiber lead-in routes from 32.78, -96.80', {});
    expect(tools(p)).toContain('plan_fiber_leadin');
    expect(args(p, 'plan_fiber_leadin')[0].from).toBe('32.78,-96.8');
  });
});

describe('gap 4: a carrier hotel / IX / metro fiber ask reads the metro fiber map and peering', () => {
  it('metro fiber in Northern Virginia: get_metro_fiber, peering at the metro core, metro routes', () => {
    const p = _planQuery('Metro fiber options in Northern Virginia for a data center', {});
    expect(p.intent_class).toBe('fiber');
    expect(tools(p)).toEqual(['get_metro_fiber', 'get_peering_intel', 'get_fiber_intel']);
    expect(args(p, 'get_metro_fiber')[0]).toEqual({ market: 'Northern Virginia' });
    expect(args(p, 'get_fiber_intel')[0]).toEqual({ route_type: 'metro', market: 'northern-virginia' });
  });
  it('"Internet exchanges and peering in Chicago" matched nothing; it now reads Chicago\'s fiber and peering', () => {
    const p = _planQuery('Internet exchanges and peering in Chicago', {});
    expect(p.intent_class).toBe('fiber');
    expect(args(p, 'get_peering_intel')[0]).toEqual({ lat: 41.853, lon: -87.618 });
  });
  it('a colocation carrier-hotel ask keeps the colocation plan (5.32), which already reads metro fiber and peering', () => {
    const p = _planQuery('Which carrier hotels and internet exchanges are in Dallas?', {});
    expect(p.intent_class).toBe('colocation');
    expect(tools(p)).toEqual(expect.arrayContaining(['get_metro_fiber', 'get_peering_intel']));
  });
  it('a long-haul ask keeps the long-haul recipe', () => {
    expect(fiberKind('Zayo long-haul fiber routes into Dallas', {})).toBeNull();
    expect(tools(_planQuery('Zayo long-haul fiber routes into Dallas', {}))[0]).toBe('get_fiber_intel');
  });
});

describe('gap 4: subsea reads get_subsea_cables near the place named', () => {
  it('Virginia Beach: landing points within 100 km of the landing hub, then peering there', () => {
    const p = _planQuery('Which subsea cables land near Virginia Beach?', {});
    expect(p.intent_class).toBe('subsea_cables');
    expect(tools(p)).toEqual(['get_subsea_cables', 'get_peering_intel']);
    expect(args(p, 'get_subsea_cables')[0]).toEqual({ lat: 36.8529, lon: -75.978, radius_km: 100 });
  });
  it('New York landing stations read at New York; coordinates read at the coordinates; no place reads the catalogue', () => {
    expect(subseaWhere('Subsea cable landing stations in New York', {}).label).toBe('New York, NY');
    expect(args(_planQuery('Subsea cable landing stations in New York', {}), 'get_subsea_cables')[0]).toMatchObject({ lat: 40.7128, lon: -74.006 });
    expect(args(_planQuery('Subsea cables near 36.85, -75.98', {}), 'get_subsea_cables')[0]).toMatchObject({ lat: 36.85, lon: -75.98 });
    const cat = _planQuery('List the submarine cables DC Hub tracks', {});
    expect(cat.intent_class).toBe('subsea_cables');
    expect(args(cat, 'get_subsea_cables')[0]).toEqual({});
  });
  it('the nearest landing and its distance lead the fact', () => {
    const f = factsFromStep('get_subsea_cables', { landing_points: [{ name: 'Virginia Beach', distance_km: 3.2 }, { name: 'Sandbridge', distance_km: 18 }],
      total_nearby: 2, query: { lat: 36.8529, lng: -75.978, radius_km: 100 } }, { lat: 36.8529, lon: -75.978, radius_km: 100 });
    expect(f[0].text).toBe('Nearest subsea landing to 36.8529, -75.978: Virginia Beach, 3.2 km; 2 landing points within 100 km (DC Hub subsea landing points).');
  });
});

describe('gap 6: what is near a point reads get_infrastructure at the point', () => {
  it('lines, plants and gas pipelines near Phoenix coordinates: get_infrastructure then analyze_site, no placeholder gas step', () => {
    const p = _planQuery('What transmission lines, power plants and gas pipelines are near 33.45, -112.07?', {});
    expect(p.intent_class).toBe('point_infrastructure');
    expect(tools(p)).toEqual(['get_infrastructure', 'analyze_site']);
    expect(args(p, 'get_infrastructure')[0]).toEqual({ lat: 33.45, lon: -112.07, radius_km: 25 });
    expect(JSON.stringify(p.recommended_sequence)).not.toMatch(/<2-letter US state/);
  });
  it('the nearest substation and gas pipeline ask routes the same way; a whole-site evaluation does not', () => {
    expect(_planQuery('Nearest substation and gas pipeline to 39.04, -77.49', {}).intent_class).toBe('point_infrastructure');
    expect(pointInfraAsk('Analyze the site at 39.04, -77.49 including nearby substations', { coords: { lat: 39.04, lon: -77.49 } })).toBe(false);
    expect(pointInfraAsk('substations near Dallas', {})).toBe(false);
  });
  it('the counts lead, by asset class, with a null count named as not measured (never 0)', () => {
    const f = factsFromStep('get_infrastructure', { success: true, counts: { substations: 14, transmission_lines_eia: 31, gas_pipelines: null, discovered_power_plants: 9 },
      filter: { lat: 33.45, lon: -112.07, radius_km: 25 } }, { lat: 33.45, lon: -112.07, radius_km: 25 });
    expect(f[0].text).toBe('Within 25 km of 33.45, -112.07: 14 substations, 31 transmission line segments, 9 power plants; gas pipeline segments not measured (HIFLD/EIA asset counts, box search).');
  });
});
