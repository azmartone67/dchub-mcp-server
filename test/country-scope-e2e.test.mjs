// ── execute_plan end to end: a named non-US country runs no US step ──
//
// Companion to test/country-scope-geography.test.mjs (pure planner + wording cases). The real
// server.mjs on loopback against a stub backend. No static import of server.mjs here: the
// harness sets PORT and the backend base before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { US_ONLY_TOOLS } from '../lib/country-scope.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

// ── end to end: the real server.mjs, a stub backend ─────────────────────────
describe('execute_plan end to end: a country question runs no US step', () => {
  let H, fence;
  const US_PATHS = /interconnection|retirement|grid\/intel|grid-intel|scoreboard|ai-capacity|ai_capacity|recommend|refined/i;
  async function plan(intent) {
    const r = await H.call('/mcp', 'execute_plan', { intent }, { 'user-agent': 'test-client' });
    const sc = r.msg && r.msg.result && r.msg.result.structuredContent;
    const t = r.msg && r.msg.result && r.msg.result.content && r.msg.result.content[0] && r.msg.result.content[0].text;
    return sc || (t ? JSON.parse(t) : null);
  }
  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({});
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('Ireland, 100 MW: country steps only, and the guide leads with what is not covered', async () => {
    const before = H.hits.length;
    const o = await plan('find 100 MW of buildable capacity in Ireland');
    expect(o && o._entity).toBe('plan_execution');
    const ran = o.executed.map((e) => e.tool);
    expect(ran.length, 'nothing ran: the path assertion below would be vacuous').toBeGreaterThan(0);
    expect(ran.filter((t) => US_ONLY_TOOLS.has(t))).toEqual([]);
    expect(o.executed.find((e) => e.tool === 'search_facilities').args).toMatchObject({ country: 'IE' });
    expect(o.executed.find((e) => e.tool === 'source_capacity').args).toMatchObject({ location: 'Ireland', min_mw: 100 });
    expect(H.hits.slice(before).map((h) => h.path).filter((p) => US_PATHS.test(p))).toEqual([]);
    expect(o.answer_guide).toMatch(/^GEOGRAPHY — Ireland is outside DC Hub's US grid and queue coverage/);
    expect(o.answer_guide).toContain('do not describe 100 MW as available there');
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('CONTROL: a Texas question still runs its US steps and carries no GEOGRAPHY line', async () => {
    const o = await plan('find 300 MW sites in Texas');
    expect(o.executed.map((e) => e.tool)).toContain('get_refined_queue');
    expect(o.answer_guide).not.toMatch(/GEOGRAPHY —/);
    expect(o.geography_scope).toBeUndefined();
  }, 120_000);
});
