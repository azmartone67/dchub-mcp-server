// A SIZE trim is not tier gating (live 2026-11-09).
//
// A keyed enterprise execute_plan ("What does the Dallas data center market look like for a 50 MW
// deployment?") came back with every step provenance.completeness 'unrestricted' and the envelope
// stamped 'partial_preview' for one reason, "step result truncated" (_slimStepResult cutting long
// step results to fit the response). The agent was told "PARTIAL RESPONSE — data was withheld by
// tier gating" and handed the /upgrade/h/ relay link, though nothing was withheld.
//
// Real server.mjs, stub backend: a keyed plan whose steps are big enough to be slimmed carries no
// tier warning and no relay link; the keyless run of the same plan is still walled.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

describe('execute_plan: a size-slimmed keyed plan is not a tier-gated one (real server.mjs, stub backend)', () => {
  let H, fence;
  const AS_OF = '2026-11-08T00:00:00Z';
  // Big enough that _slimStepResult cuts it (> 6,000 characters per step).
  const big = () => ({ ok: true, as_of: AS_OF, source: 'DC Hub',
    items: Array.from({ length: 120 }, (_, i) => ({ metro_slug: `m-${i}`, name: `Market ${i}`, score: 50 + (i % 40),
      as_of: AS_OF, detail: 'x'.repeat(160) })) });
  const PRO = { 'user-agent': 'test-client', 'x-api-key': PRO_KEY };
  const INTENT = 'rank markets for a 200 MW AI campus in Dallas';

  async function settle(quietMs = 300, maxMs = 8000) {
    const t0 = Date.now(); let n = H.hits.length, last = Date.now();
    while (Date.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 50));
      if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); } else if (Date.now() - last >= quietMs) return;
    }
  }
  async function plan(headers) {
    const r = await H.call('/mcp', 'execute_plan', { intent: INTENT }, headers);
    await settle();
    const res = r.msg && r.msg.result;
    const text = res && res.content ? res.content.map((b) => b.text || '').join('\n') : '';
    let out = res && res.structuredContent;
    if (!out && res && res.content && res.content[0]) { try { out = JSON.parse(res.content[0].text); } catch { out = null; } }
    return { out, text };
  }
  const slimmedSteps = (out) => (out.executed || []).filter((e) => e && e.result && e.result.truncated === true);

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p, req) => {
      if (req.headers['x-api-key'] !== PRO_KEY) return undefined;   // keyless: the harness's walled bodies
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      return { status: 200, body: big() };
    } });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('keyed: steps slimmed for size -> no partial_preview, no tier warning, no relay link, no PARTIAL cite', async () => {
    const { out, text } = await plan(PRO);
    expect(out && out._entity).toBe('plan_execution');
    expect(slimmedSteps(out).length, 'control: at least one step was cut for size').toBeGreaterThan(0);
    const p = out.provenance || {};
    expect(p.preview && p.preview.reasons, 'control: the size reason is still reported').toContain('step result truncated');
    expect(p.completeness).toBe('unrestricted');
    expect(p.preview_warning).toBeUndefined();
    expect(text).not.toMatch(/withheld by tier gating/i);
    expect(String(out.human_url || '')).not.toMatch(/\/upgrade\/h\//);
    expect(text).not.toMatch(/dchub\.cloud\/upgrade\/h\//);
    expect(String((out.citation && out.citation.cite_as) || '')).not.toMatch(/PARTIAL/);
  }, 120_000);

  it('keyless: the same plan is still walled (real gating untouched)', async () => {
    const { out, text } = await plan({ 'user-agent': 'test-client' });
    expect(out && out._entity).toBe('plan_execution');
    const p = out.provenance || {};
    expect(p.preview && p.preview.reasons, 'control: this plan was size-slimmed too').toContain('step result truncated');
    expect(p.preview.withheld_fields.length, 'real tier markers name withheld fields').toBeGreaterThan(0);
    expect(p.preview.withholding_proven).toBe(true);
    expect(p.completeness).toBe('partial_preview');
    expect(p.preview_warning).toMatch(/withheld by tier gating/i);
    expect(String(out.human_url || '')).toMatch(/^https:\/\/dchub\.cloud\/upgrade\/h\//);
    expect(text).toMatch(/dchub\.cloud\/upgrade\/h\//);
  }, 120_000);
});
