// ── execute_plan end to end: a short power ask is a power plan, and the answer is dated ──
//
// Grok QA relay 2026-11-13 (Gemini cold start): keyless execute_plan(intent="Texas 50 MW power")
// routed away from the power reads and returned provenance.as_of = null. The real server.mjs on
// loopback against the harness stub, whose rows carry no source timestamp, so the as_of here can only
// come from the generated_at fallback. Run with the lean step on (the /mcp default) and off
// (DCHUB_LEAN_RESPONSES=0): lean strips top-level keys and a field kept only on one path has hidden
// before. leanResponsesOn() reads the env per call, so one harness serves both.
// No static import of server.mjs here: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

describe('execute_plan "Texas 50 MW power", anonymous (real server.mjs on loopback)', () => {
  let H, fence;
  const prevLean = process.env.DCHUB_LEAN_RESPONSES;

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({});
  }, 240_000);
  afterAll(async () => {
    if (prevLean === undefined) delete process.env.DCHUB_LEAN_RESPONSES;
    else process.env.DCHUB_LEAN_RESPONSES = prevLean;
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  for (const lean of ['1', '0']) {
    it(`routes to the power reads and dates the answer (lean=${lean})`, async () => {
      process.env.DCHUB_LEAN_RESPONSES = lean;
      const r = await H.call('/mcp', 'execute_plan', { intent: 'Texas 50 MW power' },
        { 'user-agent': 'dchub-qa-brain/1113', 'x-dc-client-ip': '203.0.113.9' });
      const res = r.msg.result;
      const views = [res.structuredContent, JSON.parse(res.content[0].text)].filter(Boolean);
      expect(views.length).toBe(2);
      for (const o of views) {
        expect(o.intent_class).toBe('grid_headroom');
        expect(o.planner_version).toBe('5.27');
        const tools = o.executed.map((e) => e.tool);
        expect(tools).toContain('get_power_availability_timeline');
        expect(tools).not.toContain('search_facilities');
        expect(tools).not.toContain('discover_tools');
        expect(typeof o.provenance.as_of).toBe('string');
        expect(Number.isFinite(Date.parse(o.provenance.as_of))).toBe(true);
        expect(o.provenance.as_of_kind).toBe('generated_at');
        expect(o.provenance.as_of_basis).toMatch(/^generated_at: /);
        expect(o.citation.as_of).toBe(o.provenance.as_of);
      }
    }, 120_000);
  }
});
