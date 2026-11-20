// land-site-screen-e2e-1119.test.mjs — planner 5.42 on a real server.mjs with a stub backend: the LAND L2 land question
// runs find_sites first at the Columbus point and the lead names three search areas plus the queue line; the LAND L1
// site screen runs analyze_parcel and get_infrastructure and its lead carries the flood and transmission lines.
// Pure tests: test/land-site-screen-1119.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.38' };
const CAND = (lat, lon, mkt) => ({ anchor: { type: 'substation', voltage_kv: 345, name: 'Hyatt' }, fiber_distance_km: 1.2, gas_distance_km: 9.4,
  lat, lon, grid_operator: { resolved: true, iso: 'PJM' }, market: { market: mkt, verdict: 'CAUTION', as_of: '2026-11-19' }, verdict: 'CAUTION' });
const FIND = { success: true, count: 7, candidates: [CAND(40.21, -83.01, 'Worthington'), CAND(40.08, -82.81, 'New Albany'), CAND(39.85, -83.1, 'Columbus')] };
const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    seen.push(p + (u && u.search ? u.search : ''));
    // 5.50: the backend's flood_zone_at_point (FEMA NFHL) and the nearest transmission line.
    if (p === '/api/v1/grid/transmission-proximity') return { status: 200, body: { available: true, line_count: 47, ehv_230kv_plus: 34, max_voltage_kv: 500,
      nearest_km: 1.3, nearest: { distance_km: 1.3, from_sub: 'ASHBURN', to_sub: 'BEAUMEADE', voltage_kv: 230, operator: 'VIRGINIA ELECTRIC & POWER CO', line: 'VIRGINIA ELECTRIC & POWER CO' } } };
    if (p === '/api/v1/sites/find') return { status: 200, body: FIND };
    if (p === '/api/v1/site-planner/disaster-risk') return { status: 200, body: { success: true, coverage: 'validated',
      disaster_risk: { rating: 'Relatively Low' }, location: { county: 'Loudoun', state: 'Virginia' },
      hazards: { 'Riverine Flooding': 'Relatively Moderate' }, source: 'FEMA National Risk Index (NRI), county-level',
      flood_zone_at_point: { status: 'measured', zone: 'X', zone_subtype: 'AREA OF MINIMAL FLOOD HAZARD', special_flood_hazard_area: false,
        firm_panel: '51107C0261E', panel_effective_date: '2017-02-17', grain: 'point', source: 'FEMA National Flood Hazard Layer (NFHL), hazards.fema.gov' } } };
    if (p === '/api/v1/infrastructure') return { status: 200, body: { success: true,
      counts: { substations: 79, transmission_lines_eia: 14, gas_pipelines: 7 }, filter: { lat: 39.0186, lon: -77.458, radius_km: 10 } } };
    if (p === '/api/v1/analyze-parcel') return { status: 200, body: { _entity: 'parcel_analysis', total_acres: 41.2,
      hosted_parcel: { parcel_id: 'P-1', county: 'Loudoun', state: 'VA' } } };
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('execute_plan 5.42 (real server.mjs, stub backend)', () => {
  it('LAND L2: find_sites runs first at the Columbus point and the lead names three search areas', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Find land for a 100 MW data center near Columbus, Ohio' }, PRO));
    const fs = o.executed.find((e) => e.tool === 'find_sites');
    expect(fs).toBeTruthy();
    expect(fs.step).toBe(1);
    expect(fs.status).toBe('executed');
    expect(fs.args).toMatchObject({ lat: 39.9612, lon: -82.9988, radius_km: 60 });
    expect(seen.some((x) => x.startsWith('/api/v1/sites/find') && /lat=39\.9612/.test(x))).toBe(true);
    const lead = planLeadText(o);
    expect(lead).toMatch(/^find_sites: 7 search areas within 60 km of Columbus, OH \(3 shown\), top 3: 1\) near 40\.21, -83\.01 /);
    expect(lead).toMatch(/2\) near 40\.08, -82\.81 .*3\) near 39\.85, -83\.1 /);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
  it('LAND L1: the site screen reads the parcel and transmission and leads with flood and transmission lines', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Screen 21571 Beaumeade Circle, Ashburn, VA for flood zone, zoning and parcel, nearby transmission and the grid context',
      lat: 39.0186, lon: -77.458 }, PRO));
    expect(o.intent_class).toBe('site_analysis');
    const ran = o.executed.filter((e) => e.status === 'executed' || e.status === 'gated_preview').map((e) => e.tool);
    expect(ran).toEqual(expect.arrayContaining(['analyze_parcel', 'get_infrastructure', 'get_disaster_risk', 'get_permitting_intel']));
    const ia = o.intent_answer;
    // 5.50 (Grok daily 2026-11-19, item 13): the point's FEMA zone and the nearest line in km lead; county and counts follow.
    expect(ia.headline).toMatch(/Flood: FEMA flood zone X \(area of minimal flood hazard\) at the point, outside the Special Flood Hazard Area \(FEMA NFHL, FIRM panel 51107C0261E, effective 2017-02-17\)\. County context: Loudoun County, Virginia rates riverine flooding Relatively Moderate/);
    expect(ia.headline).toMatch(/Transmission: Nearest transmission line: 230 kV \(Virginia Electric & Power Co\), 1\.3 km from the point, measured to its ASHBURN substation endpoint \(EIA\/HIFLD\)\. Within the radius: 79 substations, 14 transmission-line records \(EIA snapshot\), 7 gas-pipeline records within 10 km/);
    expect(ia.not_established.join(' ')).not.toMatch(/flood zone at the point .* is answered in analyze_site/i);
    expect(ia.evidence.join(' ')).toMatch(/Parcel: 41\.2 acres, parcel P-1/);
    const dr = JSON.parse(JSON.stringify(o.executed.find((e) => e.tool === 'get_disaster_risk')));
    expect(JSON.stringify(dr)).toMatch(/"flood_zone_at_point":\{[^}]*"status":"measured"/);
    expect(seen.some((x) => x.startsWith('/api/v1/grid/transmission-proximity') && /lat=39\.0186/.test(x))).toBe(true);
  }, 120_000);
  it('a screen that names nothing still carries the nearest line (get_infrastructure always runs at a point)', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'screen a 100 MW site at 39.0438,-77.4874' }, PRO));
    expect(o.intent_class).toBe('site_analysis');
    expect(o.executed.map((e) => e.tool)).toContain('get_infrastructure');
    expect(o.intent_answer.headline).toMatch(/Nearest transmission line: 230 kV .*1\.3 km from the point/);
    expect(o.intent_answer.headline).toMatch(/FEMA flood zone X /);
  }, 120_000);
});
