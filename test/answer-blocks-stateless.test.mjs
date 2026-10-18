// answer-blocks-stateless.test.mjs — live regression, 2026-10-18.
// mcp#1033 gated ranked_answer / intent_answer on ctx.path ('/mcp' or '/mcp/oauth'). The STATELESS tools/call
// branch (no mcp-session-id: curl, gateways, many agents) built its ctx without `path`, so "unknown context ->
// no block" switched both answers OFF for every sessionless client on the full profile. The session-based
// suites always initialize first and never saw it. These calls send NO session header.
// (ranked_answer is not asserted here: a stateless anonymous call gets the capacity index as a gated preview,
// so there is legitimately nothing to rank; that is tier gating, not this path bug.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const row = (market, rank, city, state, dep, score) => ({ market, rank, city, state, score,
  deployable_mw: { value: dep }, ai_ready_mw: { value: 100 }, hyperscale_ready: true });
const MARKETS = [row('ashburn-va', 1, 'Ashburn', 'VA', 500, 450), row('columbus-oh', 2, 'Columbus', 'OH', 400, 300)];
const VERDICT = { 'ashburn-va': ['AVOID', 26.7], ashburn: ['AVOID', 26.7], 'columbus-oh': ['BUILD', 71.2], columbus: ['BUILD', 71.2] };

let H, fence;
const run = async (path, intent, ua = 'curl/8.0') => {
  const res = await H.call(path, 'execute_plan', { intent }, { 'user-agent': ua });
  const line = res.raw.split('\n').find((l) => l.startsWith('data:')) || res.raw;
  return { raw: res.raw, sc: JSON.parse(line.replace(/^data:\s*/, '')).result.structuredContent };
};
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({ extraRoutes: (p) => {
  if (p === '/api/v1/ai-capacity-index') return { ok: true, index_name: 'AI Compute Capacity Index', markets: MARKETS };
  const m = /^\/api\/v1\/dcpi\/scores\/([^/]+)$/.exec(p);
  if (m && VERDICT[m[1]]) return { ok: true, market_slug: m[1], verdict: VERDICT[m[1]][0], composite_score: VERDICT[m[1]][1] };
  return undefined;
} }); }, 60_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore && fence.restore(); });

describe('stateless execute_plan', () => {
  it('bare /mcp carries intent_answer with no session', async () => {
    const r = await run('/mcp', 'how soon can I get 100 MW of power in ERCOT');
    expect(r.sc._entity).toBe('plan_execution');
    expect(r.sc.intent_answer && r.sc.intent_answer.kind).toBe('power_timing');
  });
  it.each(['/mcp/chatgpt', '/mcp/claude', '/mcp/grok'])('%s still carries neither block with no session', async (p) => {
    const r = await run(p, 'how soon can I get 100 MW of power in ERCOT', 'Mozilla/5.0 (Macintosh)');
    expect(r.raw).toMatch(/plan_execution|execute_plan/);
    expect(r.raw).not.toMatch(/intent_answer/);
    expect(r.raw).not.toMatch(/ranked_answer/);
  });
});
