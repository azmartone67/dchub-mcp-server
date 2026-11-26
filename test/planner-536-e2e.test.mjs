// planner-536-e2e.test.mjs — planner 5.36 on a real server.mjs with a stub backend (Grok QA 2026-11-17).
// The western-PA prompt runs the Pittsburgh card, the PA canvas, find_sites over the region and the PA
// timeline, and no step is left skipped_unresolved. Pure-function tests: test/planner-536-regions-ttp.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.36' };
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
const steps = (o) => JSON.stringify(o.executed.map((e) => [e.tool, e.status, e.args]));

beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({}); }, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('execute_plan 5.36: western Pennsylvania (real server.mjs on loopback)', () => {
  it('runs the market card, canvas, region search and timeline, none unresolved', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', {
      intent: 'where in western Pennsylvania can I get 300 MW of power for a data center, and how soon' }, PRO));
    expect(o.planner_version).toBe('5.63');
    expect(o.intent_class, steps(o)).toBe('siting_search');
    const by = Object.fromEntries(o.executed.map((e) => [e.tool, e]));
    expect(Object.keys(by).sort(), steps(o)).toEqual(['find_sites', 'get_market_dcpi_rank',
      'get_permitting_intel', 'get_power_availability_timeline', 'site_selection_canvas']);
    expect(String(by.get_market_dcpi_rank.args.market_slug)).toMatch(/^pittsburgh/);
    expect(by.find_sites.args).toMatchObject({ lat: 40.7, lon: -79.7, radius_km: 150 });
    expect(by.get_power_availability_timeline.args.state).toBe('PA');
    expect(o.executed.filter((e) => e.status === 'skipped_unresolved'), steps(o)).toEqual([]);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
