// execute-plan-alternatives-dropped-e2e.test.mjs — Grok QA v2.12.48 (2026-11-13), item 3, end to end.
// execute_plan "I need 200 MW in Reno within 24 months ... faster alternatives?" runs a
// site_selection_canvas step (region us, 200 MW, 24 months) and answer_guide names, with the step's own
// reason, what that step did not apply (the keyless canvas does not apply max_months).
// The real server.mjs on loopback against the harness stub; the canvas answers with the keyless body
// served live 2026-11-13. No static import of server.mjs here: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const RENO = 'I need 200 MW in Reno within 24 months. Can I get power there in time, and what are faster alternatives?';

// The keyless canvas body as served live 2026-11-13 (trimmed to the fields read here).
const CANVAS_KEYLESS = {
  ok: true, matched: 124, applied_filters: { max_months: null, region: 'us' },
  constraint_coverage: {
    capacity_mw: { applied: false, status: 'unavailable',
      reason: 'The shortlist is NOT sized to this target. Ranking uses region, time-to-power, DCPI verdict and composite score.' },
    max_months: { applied: false, status: 'locked',
      reason: "max_months was not applied: it filters on time to power, which this caller's access does not open. This answer ranks without it." },
    region: { applied: true },
  },
  shortlist: [{ market: 'Midland–Odessa', slug: 'midland-tx', state: 'TX', iso: 'ERCOT', verdict: 'BUILD' }],
};

// End to end: the real server.mjs on loopback, the canvas answering as it does keyless live.
describe('execute_plan Reno, anonymous (real server.mjs on loopback)', () => {
  let H, fence;
  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p) => (p === '/api/v1/site-selection/canvas'
      ? { status: 200, body: CANVAS_KEYLESS } : undefined) });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('runs the alternatives step and answer_guide names what it dropped', async () => {
    const r = await H.call('/mcp', 'execute_plan', { intent: RENO },
      { 'user-agent': 'dchub-qa-brain/1113', 'x-dc-client-ip': '203.0.113.9' });
    const o = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    expect(o.planner_version).toBe('5.27');
    const canvas = o.executed.find((e) => e.tool === 'site_selection_canvas');
    expect(canvas, JSON.stringify(o.executed.map((e) => [e.tool, e.status]))).toBeTruthy();
    expect(canvas.args).toMatchObject({ region: 'us', capacity_mw: 200, max_months: 24 });
    expect(canvas.args.state).toBeUndefined();          // the plan's NV is not injected over region us
    expect(o.answer_guide).toMatch(/DROPPED — .*site_selection_canvas: max_months=24 was not applied \(it filters on time to power/);
    expect(o.dropped_filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'site_selection_canvas', param: 'max_months', kind: 'locked' })]));
    expect(fence.foreign).toEqual([]);
  }, 120_000);
  it('/mcp/chatgpt (where Grok asked it): the canvas step runs and the answer says what it dropped', async () => {
    const r = await H.call('/mcp/chatgpt', 'execute_plan', { intent: RENO },
      { 'user-agent': 'dchub-qa-brain/1113', 'x-dc-client-ip': '203.0.113.9' });
    const res = r.msg.result;
    const o = res.structuredContent || JSON.parse(res.content[0].text);
    expect((o.executed || []).find((e) => e.tool === 'site_selection_canvas')).toMatchObject({ status: 'executed' });
    expect(o.answer_guide).toMatch(/DROPPED — .*step \d site_selection_canvas: max_months=24 was not applied \(it filters on time to power/);
    expect(o.answer_guide).toMatch(/Say this plainly in the answer/);
    expect(o.dropped_filters).toBeUndefined();          // the structured block stays off the frozen directory surface
  }, 120_000);
});
