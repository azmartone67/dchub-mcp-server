// planner-526-submarket-e2e.test.mjs — planner 5.26, item 2 end to end (Grok-relayed live agent
// reviews 2026-11-13): execute_plan "How much data center capacity is coming online in Ashburn?" routes to
// dc_capacity, and the get_pipeline step keeps the Ashburn row and cuts the Manassas row (the reviews
// saw Manassas rows labelled Ashburn). The real server.mjs on loopback against the harness stub, with a
// Pro key so the pipeline answers in full. No static import of server.mjs here: the harness sets PORT
// before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

describe('execute_plan "coming online in Ashburn" (real server.mjs on loopback)', () => {
  let H, fence;
  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p) => (p === '/api/v1/pipeline'
      ? { status: 200, body: { total: 2, projects: [
        { name: 'Ashburn Campus A', operator: 'Op', capacity_mw: 120, status: 'construction', market_slug: 'northern-virginia', lat: 39.04, lon: -77.48 },
        { name: 'Manassas Campus B', operator: 'Op', capacity_mw: 200, status: 'construction', market_slug: 'northern-virginia', lat: 38.75, lon: -77.47 },
      ] } } : undefined) });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });
  it('routes to dc_capacity and the pipeline step keeps Ashburn, cuts Manassas', async () => {
    const r = await H.call('/mcp', 'execute_plan', { intent: 'How much data center capacity is coming online in Ashburn?' },
      { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.9' });
    const o = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    expect(o.intent_class).toBe('dc_capacity');
    const pipe = o.executed.find((e) => e.tool === 'get_pipeline');
    expect(pipe, JSON.stringify(o.executed.map((e) => [e.tool, e.status]))).toBeTruthy();
    expect(pipe.submarket_scope, JSON.stringify(pipe)).toMatchObject({ submarket: 'Ashburn', kept: 1, dropped_outside_submarket: 1 });
    expect(JSON.stringify(pipe.result)).not.toContain('Manassas Campus B');
    expect(o.executed.find((e) => e.tool === 'search_facilities').args).toMatchObject({ city: 'Ashburn', state: 'VA' });
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
