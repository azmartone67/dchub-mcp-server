// mcp-dominance-2-planner-e2e-1117.test.mjs — planner 5.35 (Grok MCP-dominance evals 2026-11-17, gap 1) on a real
// server.mjs with a stub backend: "What is the generating capacity mix in Virginia?" answers with PJM's percentages.
// The stub /grid/intelligence rows carry the EIA-930 shape compare_isos reads (generation_mix in MW per fuel code).
// Pure routing tests: test/mcp-dominance-2-planner-1117.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';

// ---- end to end: the generation-mix answer on a real server.mjs ----
const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.35' };
const GI = {
  PJM: { iso: 'PJM', demand_mw: 88000, demand_period: '2026-11-17T06', generation_mix_period: '2026-11-17T06',
    generation_mix: { NG: 36000, NUC: 29000, COL: 13000, WND: 3600, SUN: 2500, WAT: 1500 } },
  MISO: { iso: 'MISO', demand_mw: 70000, demand_period: '2026-11-17T06', generation_mix_period: '2026-11-17T06',
    generation_mix: { COL: 28000, NG: 21000, WND: 14000, NUC: 7000 } },
};
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p) => {
    const m = /^\/api\/v1\/grid\/intelligence\/([A-Za-z-]+)$/.exec(p);
    if (m && GI[m[1].toUpperCase()]) return { status: 200, body: GI[m[1].toUpperCase()] };
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('execute_plan 5.35: the Virginia mix question answers with percentages (real server.mjs, stub backend)', () => {
  it('generation_mix runs compare_isos, and the intent_answer and lead state PJM\'s shares', async () => {
    const r = await H.call('/mcp', 'execute_plan', { intent: 'What is the generating capacity mix in Virginia for data center power planning?', state: 'VA' }, PRO);
    const o = sc(r);
    expect(o.intent_class).toBe('generation_mix');
    expect(o.executed.find((e) => e.tool === 'compare_isos').status).toBe('executed');
    expect(o.intent_answer && o.intent_answer.kind).toBe('generation_mix');
    expect(o.intent_answer.headline).toMatch(/^PJM generation mix: gas 42\.1%, nuclear 33\.9%, coal 15\.2%/);
    // The plain-language lead (lib/plan-lead-text.mjs) opens on the same headline.
    expect(planLeadText(o)).toMatch(/^PJM generation mix: gas 42\.1%/);
    // MISO rides only as compare_isos's second grid: it is context, never in the answer.
    expect(o.intent_answer.headline).not.toMatch(/MISO/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
