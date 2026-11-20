// 2026-11-16 (owner via Grok): one teaser line for new capacity listings, with no partner name, no MW,
// no dates and no prices or plans. Two homes:
//   1. source_capacity's description, so tools/list (and every directory that copies the catalog)
//      carries it. The /mcp wire copy is cut at SLIM_DESC_MAX, so the line must sit inside the cut.
//   2. execute_plan's answer_guide, when the plan executed a source_capacity step.
// The line is CAPACITY_TEASER_LINE, byte-identical to the README line in mcp#1498.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { CAPACITY_TEASER_LINE, CAPACITY_TEASER_WALL_LINE, CAPACITY_NOT_LISTINGS_LINE, capacityInventoryViolations } from '../lib/capacity-source-summary.mjs';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const LINE = 'New data center capacity listings are coming soon: query them with source_capacity, or browse https://dchub.cloud/listings.';

describe('the line itself', () => {
  it('is the canonical text', () => expect(CAPACITY_TEASER_LINE).toBe(LINE));
  it('the not-listings line names no inventory count and carries no link', () => {
    expect(capacityInventoryViolations(CAPACITY_NOT_LISTINGS_LINE)).toEqual([]);
    expect(CAPACITY_NOT_LISTINGS_LINE).not.toMatch(/\d|https?:/);
  });
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
      // Capacity Source answers every caller (live 11-20: keyless source_capacity returns items [] too).
      if (p.startsWith('/api/v1/listings')) return { status: 200, body: { ok: true, items: [], total: 0, as_of: AS_OF } };
      if (req.headers['x-api-key'] !== PRO_KEY) return undefined;
      if (p.startsWith('/api/v1/mcp/') || p.startsWith('/api/v1/keys/') || p.startsWith('/api/v1/sources/')) return undefined;
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

  // 2026-11-20: Gemini relayed pipeline projects and sites from a capacity plan as listed capacity while
  // Capacity Source had no live listing. A no-fit plan now says the other rows are not for sale or lease.
  it('a no-fit plan says its other rows are not listings, in answer_guide and intent_answer', async () => {
    const out = await plan('where can I get 20 MW of data center capacity in Texas available by 2027');
    expect(out.executed.some((e) => e.tool === 'source_capacity' && e.status === 'executed'), 'control: the step ran').toBe(true);
    expect(out.answer_guide.split(CAPACITY_NOT_LISTINGS_LINE).length - 1).toBe(1);
    expect(out.answer_guide.indexOf(CAPACITY_NOT_LISTINGS_LINE), 'ahead of the teaser').toBeLessThan(out.answer_guide.indexOf(LINE));
    expect(out.intent_answer, 'control: this run carries intent_answer').toBeTruthy();
    expect(out.intent_answer.not_established[0]).toBe(CAPACITY_NOT_LISTINGS_LINE);
  }, 120_000);

  it('the walled (keyless) form keeps the line whole', async () => {
    const out = await plan('find 20 MW of colocation capacity in Dallas', { 'user-agent': 'test-client' });
    expect(out.human_url, 'control: this run is a wall').toBeTruthy();
    expect(out.answer_guide).toContain(CAPACITY_NOT_LISTINGS_LINE);
  }, 120_000);

  it('fires only when every source_capacity step found nothing', () => {
    const sc = (result) => ({ tool: 'source_capacity', status: 'executed', result });
    expect(H.S._capacityNotListings([sc({ ok: true, items: [] })])).toBe(CAPACITY_NOT_LISTINGS_LINE);
    expect(H.S._capacityNotListings([sc({ ok: true, exact: [], bundles: [], shortfall: { mw: 20 } })])).toBe(CAPACITY_NOT_LISTINGS_LINE);
    expect(H.S._capacityNotListings([sc({ ok: true, items: [{ slug: 'x' }] })]), 'a listing matched').toBeNull();
    expect(H.S._capacityNotListings([sc({ ok: true, items: [] }), sc({ ok: true, items: [{ slug: 'x' }] })]), 'one step matched').toBeNull();
    expect(H.S._capacityNotListings([sc(undefined)]), 'unreadable result is not a no-fit').toBeNull();
    expect(H.S._capacityNotListings([{ tool: 'source_capacity', status: 'failed', result: { items: [] } }])).toBeNull();
    expect(H.S._capacityNotListings([{ tool: 'get_pipeline', status: 'executed', result: { items: [] } }])).toBeNull();
  });

  it('_withNotListings adds the line once and leaves other answers alone', () => {
    const ia = { headline: 'h', not_established: ['a'] };
    const once = H.S._withNotListings(ia, CAPACITY_NOT_LISTINGS_LINE);
    expect(once.not_established).toEqual([CAPACITY_NOT_LISTINGS_LINE, 'a']);
    expect(H.S._withNotListings(once, CAPACITY_NOT_LISTINGS_LINE).not_established).toHaveLength(2);
    expect(H.S._withNotListings(ia, null)).toBe(ia);
    expect(ia.not_established, 'input not mutated').toEqual(['a']);
  });

  it('DCHUB_CAPACITY_POINTERS=off removes it', async () => {
    process.env.DCHUB_CAPACITY_POINTERS = 'off';
    try {
      expect(H.S._capacityTeaser([{ tool: 'source_capacity', status: 'executed' }])).toBeNull();
    } finally { delete process.env.DCHUB_CAPACITY_POINTERS; }
    expect(H.S._capacityTeaser([{ tool: 'source_capacity', status: 'executed' }]), 'control: on by default').toBe(LINE);
    expect(H.S._capacityTeaser([{ tool: 'source_capacity', status: 'failed' }])).toBeNull();
  });
});
