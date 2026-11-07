// ── execute_plan end to end: one named market is read as itself (#118011) ──
//
// The real server.mjs on loopback against a stub backend whose every
// recommendation is Midland–Odessa: the only way San Antonio leads is if the
// plan held the market. Pure-function cases: test/market-outlook-routing.test.mjs.
// No static import of server.mjs here: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

// ── end to end: the real server.mjs, a stub backend ─────────────────────────
describe('execute_plan end to end (real server.mjs on loopback)', () => {
  let H, fence;
  const recommendHits = () => H.hits.filter((h) => /recommend/.test(h.path)).length;
  // A backend where every recommendation is Midland–Odessa and every market
  // read also mentions it: the only way San Antonio leads is if the plan held it.
  const routes = (p) => {
    if (/recommend/.test(p)) return { status: 200, body: { top_pocket: { market: 'Midland–Odessa', iso: 'ERCOT', verdict: 'BUILD' } } };
    if (/dcpi/.test(p) && /san-antonio/.test(p)) {
      return { status: 200, body: { market_slug: 'san-antonio', market_name: 'San Antonio', iso: 'ERCOT', verdict: 'CAUTION', composite_score: 42.3,
                                    nearby: [{ market: 'Midland–Odessa', iso: 'ERCOT', verdict: 'BUILD' }] } };
    }
    return undefined;
  };
  async function plan(intent) {
    const r = await H.call('/mcp', 'execute_plan', { intent }, { 'user-agent': 'test-client' });
    const sc = r.msg && r.msg.result && r.msg.result.structuredContent;
    const text = r.msg && r.msg.result && r.msg.result.content && r.msg.result.content[0] && r.msg.result.content[0].text;
    return sc || (text ? JSON.parse(text) : null);
  }

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: routes });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('San Antonio: no recommendation call, DCPI read for san-antonio, guide leads with it', async () => {
    const before = recommendHits();
    const o = await plan('What is the data center power outlook for San Antonio?');
    expect(o && o._entity).toBe('plan_execution');
    expect(o.intent_class).toBe('market_outlook');
    expect(o.planner_version).toBe('5.16');
    const ran = o.executed.map((e) => e.tool);
    expect(ran).not.toContain('get_dchub_recommendation');
    expect(recommendHits()).toBe(before);
    const dcpi = o.executed.find((e) => e.tool === 'get_market_dcpi_rank');
    expect(dcpi.args.market_slug).toBe('san-antonio-tx');
    expect(o.answer_guide).not.toMatch(/Midland/);
    expect(o.answer_guide).toMatch(/san-antonio: CAUTION/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('an unmatched question says it is unresolved and runs no recommendation', async () => {
    const before = recommendHits();
    const o = await plan('hello there');
    expect(o.intent_class).toBe('unknown');
    expect(o.executed.map((e) => e.tool)).toEqual(['discover_tools']);
    expect(recommendHits()).toBe(before);
    expect(o.answer_guide).toMatch(/^UNRESOLVED — No intent class matched/);
    expect(o.unresolved && o.unresolved.kind).toBe('no_intent_match');
  }, 120_000);

  it('an untracked place: market steps skipped_unresolved, nothing substituted', async () => {
    const o = await plan('power outlook for Timbuktu');
    expect(o.intent_class).toBe('market_outlook');
    const st = Object.fromEntries(o.executed.map((e) => [e.tool, e.status]));
    expect(st.get_market_dcpi_rank).toBe('skipped_unresolved');
    expect(st.get_market_intel).toBe('skipped_unresolved');
    expect(o.answer_guide).toMatch(/^UNRESOLVED — "Timbuktu" is not a market DC Hub tracks/);
  }, 120_000);
});
