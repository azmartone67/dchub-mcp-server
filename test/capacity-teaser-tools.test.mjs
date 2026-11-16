// 2026-11-16 (owner via Grok): one teaser line for new capacity listings, with no partner name, no MW,
// no dates and no prices or plans. Two homes:
//   1. source_capacity's description, so tools/list (and every directory that copies the catalog)
//      carries it. The /mcp wire copy is cut at SLIM_DESC_MAX, so the line must sit inside the cut.
//   2. execute_plan's answer_guide, when the plan executed a source_capacity step.
// The line is CAPACITY_TEASER_LINE, byte-identical to the README line in mcp#1498.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { CAPACITY_TEASER_LINE, CAPACITY_TEASER_WALL_LINE, capacityInventoryViolations } from '../lib/capacity-source-summary.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const LINE = 'New data center capacity listings are coming soon: query them with source_capacity, or browse https://dchub.cloud/listings.';

describe('the line itself', () => {
  it('is the canonical text', () => expect(CAPACITY_TEASER_LINE).toBe(LINE));
  it('names no number, date, price or plan', () => {
    expect(capacityInventoryViolations(LINE)).toEqual([]);
    expect(LINE).not.toMatch(/\d|\$|\bMW\b|\bkW\b|\bpro\b|\bplan\b|\bprice|\bpricing\b|\bfree\b/i);
  });
});

describe('generated catalogs carry it', () => {
  for (const f of ['mcp-server.json', 'toolspec.json', 'integrations/packs/deals.json', 'integrations/packs/siting.json']) {
    it(f, () => expect(readFileSync(new URL('../' + f, import.meta.url), 'utf8')).toContain(LINE));
  }
});

describe('live server (real server.mjs, stub backend)', () => {
  let H, fence;
  const AS_OF = '2026-11-16T00:00:00Z';
  const PRO = { 'user-agent': 'test-client', 'x-api-key': PRO_KEY };
  const clean = () => ({ ok: true, as_of: AS_OF, source: 'DC Hub', items: [{ metro_slug: 'dallas-tx', name: 'Dallas', score: 70, as_of: AS_OF }] });

  async function settle(quietMs = 300, maxMs = 8000) {
    const t0 = Date.now(); let n = H.hits.length, last = Date.now();
    while (Date.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 50));
      if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); } else if (Date.now() - last >= quietMs) return;
    }
  }
  async function plan(intent, headers = PRO) {
    const r = await H.call('/mcp', 'execute_plan', { intent }, headers);
    await settle();
    const res = r.msg && r.msg.result;
    let out = res && res.structuredContent;
    if (!out && res && res.content && res.content[0]) { try { out = JSON.parse(res.content[0].text); } catch { out = null; } }
    return out;
  }

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p, req) => {
      if (req.headers['x-api-key'] !== PRO_KEY) return undefined;
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
      if (p.startsWith('/api/v1/listings')) return { status: 200, body: { ok: true, items: [], total: 0, as_of: AS_OF } };
      return { status: 200, body: clean() };
    } });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('tools/list on /mcp: source_capacity carries the line inside the slim cut', async () => {
    const r = await H.list('/mcp', PRO);
    const t = r.msg.result.tools.find((x) => x.name === 'source_capacity');
    expect(t, 'control: source_capacity is listed on /mcp').toBeTruthy();
    expect(t.description).toContain(LINE);
  }, 120_000);

  it('a plan that runs source_capacity carries the line once', async () => {
    const out = await plan('find 20 MW of colocation capacity in Dallas');
    expect(out.executed.some((e) => e.tool === 'source_capacity' && e.status === 'executed'), 'control: the step ran').toBe(true);
    expect(out.answer_guide.split(LINE).length - 1).toBe(1);
  }, 120_000);

  it('a plan with no source_capacity step does not', async () => {
    const out = await plan('evaluate 100 MW power headroom for a GPU training cluster in PJM');
    expect(out.executed.map((e) => e.tool), 'control: no capacity step').not.toContain('source_capacity');
    expect(out.answer_guide).not.toContain(LINE);
  }, 120_000);

  // A one-link wall turns bare /listings into the unlock link; the line drops its link there instead
  // of reading "browse <unlock link>".
  it('a walled (keyless) plan carries the link-free form, never "browse" + another link', async () => {
    const out = await plan('find 20 MW of colocation capacity in Dallas', { 'user-agent': 'test-client' });
    const txt = JSON.stringify(out);
    expect(out.human_url, 'control: this run is a wall').toBeTruthy();
    expect(out.executed.some((e) => e.tool === 'source_capacity'), 'control: the step ran').toBe(true);
    expect(out.answer_guide).toContain(CAPACITY_TEASER_WALL_LINE);
    expect(txt).not.toContain(LINE);
    expect(txt).not.toMatch(/browse https:\/\/dchub\.cloud\/(?!listings)/);
  }, 120_000);

  it('DCHUB_CAPACITY_POINTERS=off removes it', async () => {
    process.env.DCHUB_CAPACITY_POINTERS = 'off';
    try {
      expect(H.S._capacityTeaser([{ tool: 'source_capacity', status: 'executed' }])).toBeNull();
    } finally { delete process.env.DCHUB_CAPACITY_POINTERS; }
    expect(H.S._capacityTeaser([{ tool: 'source_capacity', status: 'executed' }]), 'control: on by default').toBe(LINE);
    expect(H.S._capacityTeaser([{ tool: 'source_capacity', status: 'failed' }])).toBeNull();
  });
});
