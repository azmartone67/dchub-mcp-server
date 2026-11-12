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
                                    as_of: '2026-11-08T05:13:51Z', computed_at: '2026-11-08T05:13:51Z',
                                    nearby: [{ market: 'Midland–Odessa', iso: 'ERCOT', verdict: 'BUILD' }] } };
    }
    // A grid read with no data date, for the 5.17 undated-power check.
    if (/grid/i.test(p) && /ercot/i.test(p)) return { status: 200, body: { iso: 'ERCOT', demand_mw: 50972 } };
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
    expect(o.planner_version).toBe('5.21');
    const ran = o.executed.map((e) => e.tool);
    expect(ran).not.toContain('get_dchub_recommendation');
    expect(recommendHits()).toBe(before);
    const dcpi = o.executed.find((e) => e.tool === 'get_market_dcpi_rank');
    expect(dcpi.args.market_slug).toBe('san-antonio');
    expect(o.answer_guide).not.toMatch(/Midland/);
    expect(o.answer_guide).toMatch(/san-antonio: CAUTION/);
    expect(fence.foreign).toEqual([]);
    // 5.17: the dated DCPI step passes; the grid step the stub left undated is
    // named, never presented as a current reading.
    const ev = Object.fromEntries((o.power_evidence || []).map((x) => [x.tool, x]));
    expect(ev.get_market_dcpi_rank).toMatchObject({ iso: 'ERCOT', ok: true });
    expect(ev.get_market_dcpi_rank.as_of).toBeTruthy();
    // Anonymous: the grid step is a gated preview, which the agent still reads.
    expect(o.executed.find((e) => e.tool === 'get_grid_intelligence').status).toBe('gated_preview');
    expect(ev.get_grid_intelligence).toMatchObject({ iso: 'ERCOT', ok: false, missing: ['as_of'] });
    expect(o.answer_guide).toMatch(/UNDATED — get_grid_intelligence \(step 3\) returned no as_of/);
  }, 120_000);

  // 5.21: a market on no US RTO (WECC) used to run DCPI + brief only. The state's power timeline now runs
  // with the state the index placed the market in; nothing else is read for another place.
  it('Phoenix (WECC): the Arizona power timeline runs beside DCPI and the brief', async () => {
    const o = await plan('What is the power and interconnection outlook for data centers in Phoenix?');
    expect(o.intent_class).toBe('market_outlook');
    expect(o.planner_version).toBe('5.21');
    const ran = o.executed.map((e) => e.tool);
    expect(ran).toEqual(['get_market_dcpi_rank', 'get_market_intel', 'get_power_availability_timeline']);
    const tl = o.executed.find((e) => e.tool === 'get_power_availability_timeline');
    expect(tl.args).toMatchObject({ state: 'AZ' });
    expect(['executed', 'gated_preview']).toContain(tl.status);
    expect(ran).not.toContain('get_dchub_recommendation');
    expect(o.unresolved).toBeUndefined();
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

  // 5.17: the executor must not fill the placeholders from the 'columbus'
  // substring hit in _CITY_ISO_META (columbus-oh) when the plan said Columbus,
  // GA is not tracked. Only the end-to-end run can see the executor's mint.
  it('Columbus, GA: unresolved, and Columbus, OH is never read in its place', async () => {
    const o = await plan('What is the data center power outlook for Columbus, GA?');
    expect(o.intent_class).toBe('market_outlook');
    const st = Object.fromEntries(o.executed.map((e) => [e.tool, e.status]));
    expect(st.get_market_dcpi_rank).toBe('skipped_unresolved');
    expect(st.get_market_intel).toBe('skipped_unresolved');
    expect(H.hits.filter((h) => /columbus/.test(h.path))).toEqual([]);
    expect(o.answer_guide).toMatch(/^UNRESOLVED — "Columbus, GA" is not a market DC Hub tracks\. The index tracks that name only as Columbus \(OH, columbus\)/);
  }, 120_000);

  it('Midland–Odessa, a market _CITY_ISO_META never had, is read as itself', async () => {
    const o = await plan('What is the data center power outlook for Midland-Odessa?');
    expect(o.intent_class).toBe('market_outlook');
    const args = Object.fromEntries(o.executed.map((e) => [e.tool, e.args]));
    expect(args.get_market_dcpi_rank).toEqual({ market_slug: 'midland-tx' });
    expect(args.get_market_intel).toEqual({ market: 'midland-tx' });
    expect(args.get_grid_intelligence).toEqual({ iso: 'ERCOT' });
    expect(o.unresolved).toBeUndefined();
  }, 120_000);
});
