// mcp-dominance-3-routing-e2e-1117.test.mjs — planner 5.36 (Grok MCP-dominance evals 2026-11-17, gaps 4 and 6) on a
// real server.mjs with a stub backend: a point infrastructure ask, a point fiber ask and a subsea ask each RUN their
// tools at the point (none skipped_unresolved, none refused by the allowlist), and the lead states what came back.
// Pure routing tests: test/mcp-dominance-3-routing-1117.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.36' };
const INFRA = { success: true, counts: { substations: 14, transmission_lines_eia: 31, gas_pipelines: 6, discovered_power_plants: 9 },
  filter: { lat: 33.45, lon: -112.07, radius_km: 25 } };
const SUBSEA = { success: true, query: { lat: 36.8529, lng: -75.978, radius_km: 100 }, total_nearby: 2,
  landing_points: [{ name: 'Virginia Beach', distance_km: 3.2 }, { name: 'Sandbridge', distance_km: 18.4 }] };
const READINESS = { _entity: 'fiber', near_net_bucket: 'on-net', nearest_carrier_km: 0.08 };
const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    seen.push(p + (u && u.search ? u.search : ''));
    if (p === '/api/v1/infrastructure') return { status: 200, body: INFRA };
    if (p === '/api/v1/subsea/nearby') return { status: 200, body: SUBSEA };
    if (p === '/api/infrastructure/connectivity/score') return { status: 200, body: READINESS };
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

const step = (o, tool) => o.executed.find((e) => e.tool === tool);

describe('execute_plan 5.36: fiber, subsea and point-infrastructure asks run at the point (real server.mjs, stub backend)', () => {
  it('lines, plants and pipelines near a point: get_infrastructure runs there and the lead states the counts', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'What transmission lines, power plants and gas pipelines are near 33.45, -112.07?' }, PRO));
    expect(o.intent_class).toBe('point_infrastructure');
    expect(step(o, 'get_infrastructure').status).toBe('executed');
    expect(step(o, 'get_infrastructure').args).toMatchObject({ lat: 33.45, lon: -112.07, radius_km: 25 });
    expect(planLeadText(o)).toMatch(/Within 25 km of 33\.45, -112\.07: 14 substations, 31 transmission line segments, 6 gas pipeline segments, 9 power plants/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
  it('subsea near Virginia Beach: get_subsea_cables runs at the landing hub and the nearest landing leads', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Which subsea cables land near Virginia Beach?' }, PRO));
    expect(o.intent_class).toBe('subsea_cables');
    expect(step(o, 'get_subsea_cables').status).toBe('executed');
    expect(seen.some((s) => s.startsWith('/api/v1/subsea/nearby') && /lat=36\.8529/.test(s))).toBe(true);
    expect(planLeadText(o)).toMatch(/Nearest subsea landing to 36\.8529, -75\.978: Virginia Beach, 3\.2 km/);
  }, 120_000);
  it('on-net fiber at NYC coordinates: get_fiber_readiness runs at the point, labelled by the point', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Is there on-net fiber near 40.7128, -74.0060?' }, PRO));
    expect(o.intent_class).toBe('fiber');
    expect(step(o, 'get_fiber_readiness').status).toBe('executed');
    expect(step(o, 'get_fiber_readiness').args).toMatchObject({ lat: 40.7128, lon: -74.006 });
    expect(o.executed.some((e) => e.status === 'skipped_unresolved')).toBe(false);
    expect(planLeadText(o)).toMatch(/Fiber at 40\.7128, -74\.006: on-net, nearest carrier 0\.08 km/);
    expect(planLeadText(o)).not.toMatch(/New Jersey|\bNJ\b/);
  }, 120_000);
});
