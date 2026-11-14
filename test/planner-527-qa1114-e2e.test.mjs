// planner-527-qa1114-e2e.test.mjs — planner 5.27, live QA sweep 2026-11-14, end to end: the real
// server.mjs on loopback against the harness stub (no network), with a Pro key so no step is gated.
//   Bug 2: "what changed in PJM this week" ran get_changes since=24h and nothing about PJM.
//   Bug 3: "water risk and tax incentives for a data center in Phoenix" ran no water step and both
//          steps were skipped_unresolved on a '<2-letter US state>' placeholder.
// No static import of server.mjs here: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const HDR = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.27' };
let H, fence;
const run = async (intent) => {
  const r = await H.call('/mcp', 'execute_plan', { intent }, HDR);
  return r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
};
const steps = (o) => JSON.stringify(o.executed.map((e) => [e.tool, e.status, e.args]));

beforeAll(async () => {
  fence = fenceNetwork();
  // get_water_risk location=<slug> resolves through the market's published DCPI row (its centroid).
  H = await startHarness({ extraRoutes: (p) => (p === '/api/v1/dcpi/scores/phoenix'
    ? { ok: true, market_slug: 'phoenix', state: 'AZ', latitude: 33.45, longitude: -112.07, verdict: 'CAUTION' } : undefined) });
}, 240_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

describe('execute_plan, planner 5.27 (real server.mjs on loopback)', () => {
  it('Phoenix water + tax: get_tax_incentives state=AZ and get_water_risk location=phoenix both run', async () => {
    const o = await run('water risk and tax incentives for a data center in Phoenix');
    expect(o.planner_version).toBe('5.27');
    const tax = o.executed.find((e) => e.tool === 'get_tax_incentives');
    const water = o.executed.find((e) => e.tool === 'get_water_risk');
    expect(tax, steps(o)).toBeTruthy();
    expect(water, steps(o)).toBeTruthy();
    expect(tax.status, steps(o)).toBe('executed');
    expect(tax.args).toMatchObject({ state: 'AZ' });
    expect(water.status, steps(o)).toBe('executed');
    expect(water.args).toMatchObject({ location: 'phoenix' });
    // The water read reached the backend at the Phoenix centroid, not as a bare state or a placeholder.
    const hit = H.hits.find((h) => h.path === '/api/v1/water/drought');
    expect(hit, JSON.stringify(H.hits.map((h) => h.path))).toBeTruthy();
    expect(o.executed.filter((e) => e.status === 'skipped_unresolved').map((e) => e.tool), steps(o)).toEqual([]);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('"what changed in PJM this week": get_changes since=7d and get_news query=PJM from a week back', async () => {
    const o = await run('what changed in PJM this week');
    expect(o.intent_class).toBe('changes_delta');
    const ch = o.executed.find((e) => e.tool === 'get_changes');
    expect(ch && ch.args, steps(o)).toMatchObject({ since: '7d' });
    const news = o.executed.find((e) => e.tool === 'get_news');
    expect(news, steps(o)).toBeTruthy();
    expect(news.status, steps(o)).toBe('executed');
    expect(news.args.query).toBe('PJM');
    const back = Date.now() - Date.parse(news.args.date_from + 'T00:00:00Z');
    expect(back).toBeGreaterThan(6 * 86400000);
    expect(back).toBeLessThan(8.5 * 86400000);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
