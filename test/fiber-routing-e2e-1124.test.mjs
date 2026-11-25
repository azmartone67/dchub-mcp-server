// fiber-routing-e2e-1124.test.mjs — Grok Brain note 2026-11-24, item 10a and 10c, on a real server.mjs with a stub
// backend: the address ask geocodes "350 E Cermak, Chicago, IL" and runs get_fiber_readiness THERE (not at the metro
// core), and its lead is the on-net read; the Phoenix-to-Los Angeles route ask runs get_fiber_intel at both ends and
// leaves nothing skipped_unresolved. Pure routing and composer tests: test/fiber-routing-1124.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.37' };
// A building point a fixed distance from the Chicago metro core the planner holds (41.853, -87.618).
const GEO = { lat: 41.8601, lon: -87.6301, lng: -87.6301, label: '350 E Cermak Rd, Chicago, Illinois, 60616', source: 'stub' };
const READINESS = { _entity: 'fiber', near_net_bucket: 'on-net', nearest_carrier_km: 0.05 };
const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    seen.push(p + (u && u.search ? u.search : ''));
    if (p === '/api/v1/geocode') return { status: 200, body: GEO };
    if (p === '/api/infrastructure/connectivity/score') return { status: 200, body: READINESS };
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

const step = (o, tool) => o.executed.find((e) => e.tool === tool);

describe('execute_plan fiber 1124 (real server.mjs, stub backend)', () => {
  it('fb-a: "350 E Cermak, Chicago" runs get_fiber_readiness at the geocoded building and leads on-net + km', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Is 350 E Cermak, Chicago on-net for fiber?' }, PRO));
    expect(o.intent_class).toBe('fiber');
    expect(step(o, 'get_fiber_readiness').status).toBe('executed');
    expect(step(o, 'get_fiber_readiness').args).toMatchObject({ lat: 41.8601, lon: -87.6301 });
    expect(seen.some((s) => s.startsWith('/api/v1/geocode'))).toBe(true);
    expect(planLeadText(o)).toMatch(/Fiber at 350 E Cermak, Chicago, IL: on-net, nearest carrier 0\.05 km/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
  it('fb-d: Phoenix to Los Angeles reads both ends; nothing is skipped_unresolved', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'fiber routes and latency from Phoenix to Los Angeles' }, PRO));
    expect(o.intent_class).toBe('fiber');
    const fi = o.executed.filter((e) => e.tool === 'get_fiber_intel');
    expect(fi.map((e) => e.args && e.args.market)).toEqual(expect.arrayContaining(['phoenix', 'los-angeles']));
    expect(o.executed.some((e) => e.status === 'skipped_unresolved')).toBe(false);
    expect(o.executed.some((e) => e.tool === 'plan_fiber_leadin')).toBe(false);
    expect(planLeadText(o)).not.toMatch(/nearest carrier 0 km/);
  }, 120_000);
});
