// planner-529-e2e.test.mjs — planner 5.29 (Grok note K, 2026-11-15) on a real server.mjs with a stub backend.
//
// The three re-check prompts through execute_plan: every one runs at least one step, and the Texas or
// Arizona run reads both states. A plan whose every step fails runs the guaranteed reads, names its manual
// calls in more_detail.calls, says NO DATA, and mints no Deal Desk brief (no "built from the FULL step
// results" on a plan that ran nothing). Pure-function tests: test/planner-529-note-k.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.29' };
let H, fence;
const mode = { failData: false, pipelineNote: null };
const pipelineQueries = [];   // the query string every /api/v1/pipeline call carried
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
const steps = (o) => JSON.stringify(o.executed.map((e) => [e.tool, e.status, e.args]));
const ran = (o) => o.executed.filter((e) => e.status === 'executed');

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, _req, _body, u) => {
    if (p === '/api/v1/pipeline') pipelineQueries.push(Object.fromEntries(u.searchParams));
    if (p === '/api/v1/pipeline' && mode.pipelineNote && !mode.failData) {
      return { status: 200, body: { projects: [{ name: 'Stub campus', operator: 'Stub', capacity_mw: 300, status: 'construction',
        expected_commissioning: '2027-06', market_slug: 'northern-virginia', country: 'US' }], total: 1,
        scope: { market: 'Northern Virginia', note: mode.pipelineNote } } };
    }
    if (mode.failData && p.startsWith('/api/v1/') && !p.startsWith('/api/v1/mcp/') && !p.startsWith('/api/v1/keys/')) {
      return { status: 500, body: { error: 'stub outage' } };
    }
    return undefined;
  } });
}, 240_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
}, 60_000);

describe('execute_plan 5.29: the three re-check prompts (real server.mjs on loopback)', () => {
  it('"Texas or Arizona, 100 MW by 2028": siting_search, steps ran for TX and for AZ', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Texas or Arizona, 100 MW by 2028' }, PRO));
    expect(o.planner_version).toBe('5.40');
    expect(o.intent_class).toBe('siting_search');
    expect(ran(o).length, steps(o)).toBeGreaterThan(0);
    const geo = (e) => e.args && (e.args.state || e.args.region);
    expect(ran(o).some((e) => geo(e) === 'TX'), steps(o)).toBe(true);
    expect(ran(o).some((e) => geo(e) === 'AZ'), steps(o)).toBe(true);
    expect(o.executed.filter((e) => e.status === 'skipped_unresolved'), steps(o)).toEqual([]);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('"ERCOT vs PJM vs MISO": iso_comparison, compare_isos and a grid read for each ISO ran', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'ERCOT vs PJM vs MISO' }, PRO));
    expect(o.intent_class).toBe('iso_comparison');
    expect(ran(o).find((e) => e.tool === 'compare_isos'), steps(o)).toBeTruthy();
    expect(ran(o).filter((e) => e.tool === 'get_grid_intelligence').map((e) => e.args.iso).sort()).toEqual(['ERCOT', 'MISO', 'PJM']);
  }, 120_000);

  it('"Northern Virginia, next 18 months": dc_capacity runs get_pipeline, search_facilities, the VA timeline and source_capacity', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Northern Virginia, next 18 months' }, PRO));
    expect(o.intent_class).toBe('dc_capacity');
    const tools = o.executed.map((e) => e.tool);
    for (const t of ['get_pipeline', 'search_facilities', 'get_power_availability_timeline', 'source_capacity']) expect(tools, steps(o)).toContain(t);
    expect(tools).not.toContain('discover_tools');
    expect(ran(o).length, steps(o)).toBeGreaterThan(0);
  }, 120_000);

  it('"Northern Virginia, next 18 months": get_pipeline is held to the market with a completion cutoff, and the widening is said', async () => {
    const note = 'Widened Northern Virginia to Virginia: 3 more projects are labelled only with the state.';
    mode.pipelineNote = note;
    pipelineQueries.length = 0;
    try {
      const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Northern Virginia, next 18 months' }, PRO));
      const pipe = o.executed.find((e) => e.tool === 'get_pipeline');
      expect(pipe, steps(o)).toBeTruthy();
      expect(pipe.status, steps(o)).toBe('executed');
      // The plan passes the resolved market slug and the date cutoff from "next 18 months".
      expect(pipe.args.market).toBe('northern-virginia');
      expect(pipe.args.expected_completion_before).toMatch(/^\d{4}-\d{2}-01$/);
      // Reached the backend. The cutoff is always declared; `market` arrives only on a schema that declares it
      // (mcp#1458): an older schema strips it and the step still runs (tolerated, not an error).
      expect(pipelineQueries.length, steps(o)).toBeGreaterThan(0);
      const q = pipelineQueries[pipelineQueries.length - 1];
      expect(q.expected_completion_before).toBe(pipe.args.expected_completion_before);
      expect([undefined, 'northern-virginia']).toContain(q.market);
      // The server's widening sentence is relayed, and the plan's own state-wide reads are named after it.
      expect(o.answer_guide).toContain(note);
      expect(o.answer_guide).toMatch(/Also: [a-z_, ]*search_facilities[a-z_, ]* read all of Virginia, not Northern Virginia alone/);
    } finally { mode.pipelineNote = null; }
  }, 120_000);

  it('a metro read state-wide says "Widened <metro> to <state>" even when the server says nothing', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'What data center capacity is under construction in Dallas?' }, PRO));
    expect(o.intent_class).toBe('dc_capacity');
    expect(o.executed.find((e) => e.tool === 'get_pipeline').args.market, steps(o)).toBe('dallas');
    expect(o.answer_guide).toMatch(/Widened Dallas to Texas: [a-z_, ]*search_facilities/);
  }, 120_000);

  it('a plan whose steps all wait on a market nobody named runs the guaranteed read instead of returning empty', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'fiber and power overlap' }, PRO));
    expect(o.intent_class).toBe('fiber_power_pairing');
    const fb = o.executed.filter((e) => e.fallback === true);
    expect(fb.map((e) => e.tool), steps(o)).toEqual(['discover_tools']);
    expect(fb[0].args).toEqual({ query: 'fiber and power overlap' });
    expect(fb[0].status, steps(o)).toBe('executed');
  }, 120_000);
});

describe('execute_plan 5.29: a plan with no data (items 2 and 3)', () => {
  it('every step fails: NO DATA, more_detail.calls with arguments, no Deal Desk mint and no FULL-results sentence', async () => {
    mode.failData = true;
    try {
      const before = H.hits.length;
      const r = await H.call('/mcp', 'execute_plan', { intent: 'Texas or Arizona, 100 MW by 2028' }, PRO);
      const o = sc(r);
      expect(ran(o), steps(o)).toEqual([]);
      expect(o.executed.some((e) => e.fallback === true), 'the guaranteed reads were tried').toBe(true);
      expect(String(o.answer_guide)).toMatch(/^NO DATA/);
      expect(Array.isArray(o.more_detail && o.more_detail.calls)).toBe(true);
      const calls = o.more_detail.calls;
      for (const t of ['site_selection_canvas', 'find_sites']) {
        for (const st of ['TX', 'AZ']) {
          expect(calls.some((c) => c.tool === t && (c.args.state === st || c.args.region === st)), `${t} ${st}: ${JSON.stringify(calls)}`).toBe(true);
        }
      }
      expect(H.hits.slice(before).some((h) => h.path === '/api/v1/deal-desk'), 'no brief minted from a plan with no data').toBe(false);
      expect(JSON.stringify(r.msg.result)).not.toMatch(/built from the FULL/);
      expect(o.deal_desk).toBeUndefined();
    } finally { mode.failData = false; }
  }, 120_000);

  it('control: the same Pro plan with data does try the Deal Desk mint', async () => {
    const before = H.hits.length;
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Texas or Arizona, 100 MW by 2028' }, PRO));
    expect(ran(o).length).toBeGreaterThan(0);
    expect(o.more_detail).toBeUndefined();
    expect(H.hits.slice(before).some((h) => h.path === '/api/v1/deal-desk'), 'a plan with data reaches the mint').toBe(true);
  }, 120_000);
});
