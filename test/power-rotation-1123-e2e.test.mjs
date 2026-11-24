// power-rotation-1123-e2e.test.mjs — planner 5.63 on a real server.mjs with a stub backend (daily MCP head-to-head,
// POWER rotation, 2026-11-23). Pure tests: test/power-rotation-1123.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.63' };
const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    seen.push(p + (u && u.search ? u.search : ''));
    const q = u ? u.searchParams : new URLSearchParams();
    if (p === '/api/v1/interconnection-queue/by-iso' && String(q.get('iso') || '').toUpperCase() === 'ERCOT') {
      return { status: 200, body: { iso: 'ERCOT', queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-10-31', project_count: 1766,
        queue_kind: 'large_load', queued_large_load_gw: 474, queued_load_dc_share_pct: 90.2, source_as_of: '2026-10-31' } };
    }
    if (p === '/api/v1/planned-generators') {
      // the backend's raw rows; the MCP tool sums them (count, total_planned_mw, by_status)
      return { status: 200, body: { as_of: '2026-11-23 08:33:16.204394+00:00', generators: [
        { plant_name: 'Yates', entity_name: 'Georgia Power Co', capacity_mw: 482.8, technology: 'Natural Gas Fired Combustion Turbine',
          status: '(V) Under construction, more than 50 percent complete', planned_month: 2, planned_year: 2027, state: 'GA', ba_code: 'SOCO' },
        { plant_name: 'Pepper Hammock Solar and Storage', entity_name: 'BrightNight Power', capacity_mw: 1200, technology: 'Solar Photovoltaic',
          status: '(L) Regulatory approvals pending. Not under construction', planned_month: 9, planned_year: 2029, state: 'GA', ba_code: 'SOCO' }] } };
    }
    if (p === '/api/v1/grid/transmission-proximity') return { status: 200, body: { status: 'measured', distance_km: 1.8, voltage_kv: 230, operator: 'VIRGINIA ELECTRIC & POWER CO',
      substation: 'GREENWAY', lines_in_radius: 230, ehv_230kv_plus: 103 } };
    if (p === '/api/v1/infrastructure') return { status: 200, body: { success: true, counts: { substations: 225, transmission_lines_eia: 91 }, filter: { lat: 39.09, lon: -77.64, radius_km: 30 } } };
    if (p === '/api/v1/infra-projects') return { status: 200, body: { success: true, summary: { as_of: { transmission: '2026-05-15' },
      by_type: { transmission: { matching: 690, returned: 1, by_status: { Planned: 591, 'Under Construction': 86, 'On Hold': 13 } } } },
      sources: { transmission: { per_iso: [{ iso: 'PJM', as_of: '2026-11-19' }, { iso: 'CAISO', as_of: '2026-08-03' }] } },
      transmission_projects: [{ iso: 'PJM', kv: 500, owner: 'Dominion', status: 'Planned', projected_isd: '2029-06-01', description: 'Stub 500 kV rebuild', states: 'VA' }] } };
    if (p === '/api/v1/power/availability-timeline') return { status: 200, body: { state: q.get('state'), timeline: [] } };
    if (p === '/api/v1/energy/summary') {
      const iso = String(q.get('iso') || '').toUpperCase();
      return { status: 200, body: { retail_rates: { avg_cents_kwh: 7.68, latest_period: '2026-08' },
        ...(iso === 'ERCOT' ? { wholesale_lmp: { label: 'wholesale LMP, $/MWh', iso: 'ERCOT', hub: q.get('hub') || 'HB_HUBAVG', hubs_available: ['HB_HUBAVG', 'HB_NORTH'],
          real_time: { lmp_usd_mwh: 31.2, interval_ending: '2026-11-23T17:30:00-06:00', as_of: '2026-11-23T23:30:00Z', market: 'RTM', stale: false },
          source: 'ERCOT' } } : {}) } };
    }
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('execute_plan 5.63 POWER rotation (real server.mjs, stub backend)', () => {
  it('p2: the ERCOT large-load ask leads with the large-load GW, never a facility count', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'What is the status of large-load interconnection in ERCOT: how many GW of large loads, mostly data centers in Texas, have requested interconnection, and how many are approved or energized?' }, PRO));
    expect(o.intent_class).toBe('interconnection_queue');
    expect(o.executed.map((e) => e.tool)).not.toContain('search_facilities');
    expect(o.intent_answer.headline).toMatch(/^ERCOT large-load interconnection: 474 GW of large loads seeking interconnection/);
    expect(o.intent_answer.headline).not.toMatch(/facilities in TX/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  // Owner 2026-11-24 ("Yes, open it"): ERCOT's large-load total reaches a keyless caller's preview too. Two calls from
  // one keyless IP: the second is past the daily full answer, so it is the preview (taste) path.
  it('p2 keyless preview: still leads with the 474 GW large-load total, not "withheld"', async () => {
    const ANON = { 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '198.51.100.124' };
    const ask = { intent: 'How many GW of large loads have requested interconnection in ERCOT?' };
    await H.call('/mcp', 'execute_plan', ask, ANON);
    const o = sc(await H.call('/mcp', 'execute_plan', ask, ANON));
    expect(o.intent_class).toBe('interconnection_queue');
    expect(o.intent_answer.headline).toMatch(/^ERCOT large-load interconnection: 474 GW of large loads seeking interconnection/);
    expect(o.intent_answer.headline).not.toMatch(/withheld/);
    expect(JSON.stringify(o)).not.toContain('90.2');   // the data-center share stays withheld
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('p3: the Georgia generation ask leads with EIA-860M new generation and says firm supply is withheld', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'How much firm generating capacity does Georgia have in MW, and how much new generation is planned or under construction?' }, PRO));
    expect(o.intent_class).toBe('power_supply');
    expect(o.executed.map((e) => e.tool)).not.toContain('get_pipeline');
    expect(o.intent_answer.headline).toMatch(/^GA new generation: 2 planned or under-construction generators, 1,683 MW nameplate \(EIA-860M, as of 2026-11-23\); 1 under construction\./);
    expect(o.intent_answer.headline).not.toMatch(/no project on record/);
  }, 120_000);

  it('p4: the ERCOT North hub ask reads hub=HB_NORTH with no state, and leads with the real-time LMP', async () => {
    seen.length = 0;
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'What is the wholesale power price right now at the ERCOT North hub for a data center in Texas?' }, PRO));
    expect(o.intent_class).toBe('price_now');
    const ep = o.executed.find((e) => e.tool === 'get_energy_prices');
    expect(ep.args).toMatchObject({ iso: 'ERCOT', hub: 'HB_NORTH' });
    expect(ep.args.state).toBeUndefined();
    expect(seen.some((s) => s.startsWith('/api/v1/energy/summary') && /hub=HB_NORTH/.test(s) && !/state=/.test(s))).toBe(true);
    expect(o.intent_answer.headline).toMatch(/^ERCOT HB_NORTH real-time LMP: \$31\.2\/MWh/);
  }, 120_000);

  it('p5: the Loudoun transmission ask has an intent_answer and no bare DCPI lead', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'What transmission constraints limit new large loads in Northern Virginia (Loudoun County), and what transmission upgrades are planned?' }, PRO));
    expect(o.intent_class).toBe('grid_constraints');
    expect(o.executed.map((e) => e.tool)).toContain('get_infrastructure');
    expect(o.intent_answer).toBeTruthy();
    expect(o.intent_answer.headline).not.toMatch(/^DCPI/);
    // execute_plan runs get_infra_projects (it is on the read-only allowlist), so the planned upgrades are in the answer.
    const ip = o.executed.find((e) => e.tool === 'get_infra_projects');
    expect(ip && ip.status).toBe('executed');
    expect(JSON.stringify(o.intent_answer)).toMatch(/VA planned transmission upgrades: 690 on file \(591 planned, 86 under construction, 13 on hold; PJM project list, as of 2026-11-19\)/);
    expect(o.intent_answer.not_established.join(' ')).not.toMatch(/Planned transmission upgrades/);
  }, 120_000);
});
