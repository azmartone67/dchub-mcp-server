// ── execute_plan end to end: a head-to-head keeps its first market (2026-11-11) ──
//
// The real server.mjs on loopback against a stub backend whose DCPI reads answer
// the way the live ones do: atlanta reports iso SOCO (its balancing authority),
// ashburn reports PJM. Live, "200 MW in Atlanta (Georgia Power) vs Ashburn: time
// to power" read Ashburn twice and led with "ashburn: AVOID (20) · ashburn: AVOID
// (20)". Pure-function cases: test/comparison-primary-metro.test.mjs.
// No static import of server.mjs here: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

describe('execute_plan: a comparison reads each market once, first-named first', () => {
  let H, fence;
  const routes = (p) => {
    if (/dcpi/.test(p) && /atlanta/.test(p)) {
      return { status: 200, body: { market_slug: 'atlanta', market_name: 'Atlanta', iso: 'SOCO', verdict: 'AVOID',
                                    composite_score: 20.7, as_of: '2026-11-11T18:32:05Z', computed_at: '2026-11-11T18:32:05Z' } };
    }
    if (/dcpi/.test(p) && /ashburn/.test(p)) {
      return { status: 200, body: { market_slug: 'ashburn', market_name: 'Ashburn', iso: 'PJM', verdict: 'AVOID',
                                    composite_score: 20, as_of: '2026-11-11T18:32:05Z', computed_at: '2026-11-11T18:32:05Z' } };
    }
    return undefined;
  };
  async function plan(intent) {
    const r = await H.call('/mcp', 'execute_plan', { intent }, { 'user-agent': 'test-client' });
    const sc = r.msg && r.msg.result && r.msg.result.structuredContent;
    const text = r.msg && r.msg.result && r.msg.result.content && r.msg.result.content[0] && r.msg.result.content[0].text;
    return sc || (text ? JSON.parse(text) : null);
  }
  const marketOf = (e) => (e.args && (e.args.market_slug || e.args.market)) || null;

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: routes });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('"Atlanta (Georgia Power) vs Ashburn": Atlanta then Ashburn, and the guide leads with Atlanta', async () => {
    const o = await plan('200 MW in Atlanta (Georgia Power) vs Ashburn: time to power');
    expect(o && o._entity).toBe('plan_execution');
    expect(o.intent_class).toBe('market_comparison');
    const dcpi = o.executed.filter((e) => e.tool === 'get_market_dcpi_rank');
    expect(dcpi.map(marketOf)).toEqual(['atlanta', 'ashburn']);
    expect(o.executed.filter((e) => e.tool === 'get_market_intel').map(marketOf)).toEqual(['atlanta', 'ashburn']);
    expect(o.answer_guide).toMatch(/^LEAD WITH THE VERDICT — this run returned: atlanta: AVOID \(20\.7\) · ashburn: AVOID \(20\)\./);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('a comparison whose sides resolve to one market reads it once and says the other is unresolved', async () => {
    // "Ashburn vs Ashburn" yields no pair, so both sides' placeholders fall back
    // to the one constraint slug: side B must not run as a copy of side A.
    const o = await plan('compare Ashburn vs Ashburn');
    expect(o.intent_class).toBe('market_comparison');
    for (const tool of ['get_market_dcpi_rank', 'get_market_intel']) {
      const rows = o.executed.filter((e) => e.tool === tool);
      expect(rows.filter((e) => e.status !== 'skipped_unresolved').map(marketOf)).toEqual(['ashburn-va']);
      const skipped = rows.find((e) => e.status === 'skipped_unresolved');
      expect(skipped && skipped.note).toMatch(/a comparison reads each market once/);
    }
  }, 120_000);
});
