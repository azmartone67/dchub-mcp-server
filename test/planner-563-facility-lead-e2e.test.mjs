// planner-563-facility-lead-e2e.test.mjs -- DCHUB_PLAN_FACILITY_LEAD_V1 end to end (Grok spec 3, 2026-11-23): the real
// server.mjs on loopback against the harness stub, keyless, recorded fixtures only (fenceNetwork: no live call).
// Fixtures are Ashburn / Loudoun (PJM) and Columbus OH (PJM) only; no DCPI score is served for any other market.
//   P4 with market:"Ashburn": facility_search, search_facilities first, the facilities lead the answer and the fact
//      header SUMMARY, the count says N of M for a preview, and "Ashburn I" is inside Ashburn while Sterling is cut.
//   P5: still leads with Loudoun and names Suffolk.   P7: still runs search_facilities; its fact names the towns.
//   Flag off: P4 with market:"Ashburn" keeps 5.62 routing (market_ranking) and planner_version 5.62.
// No static import of server.mjs: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { compactPlanObject } from '../lib/plan-compact.mjs';
import { buildPlanFactHeader } from '../lib/plan-fact-header.mjs';

const seen = [];
// city=Ashburn, VA: the registry row 7826 shape (city field "Ashburn I"), two Ashburn rows, one Sterling row; the
// backend says 5 matched and served 4 (a preview).
const ASHBURN_ROWS = [
  { slug: 'vantage-data-centers-ashburn-i-va-united-states-d21021d5', name: 'Ashburn I', provider: 'Vantage Data Centers', city: 'Ashburn I', state: 'VA', as_of: '2026-03-30' },
  { slug: 'equinix-dc1', name: 'DC1', provider: 'Equinix', city: 'Ashburn', state: 'VA', as_of: '2026-04-02' },
  { slug: 'qts-ashburn-1', name: 'QTS Ashburn 1', provider: 'QTS', city: 'Ashburn', state: 'VA', as_of: '2026-02-11' },
  { slug: 'x-sterling-1', name: 'Sterling One', provider: 'Example Co', city: 'Sterling', state: 'VA', as_of: '2026-02-01' },
];
const COLUMBUS_ROWS = [
  { slug: 'aws-hilliard', name: 'Hilliard Data Center', provider: 'Amazon AWS', city: 'Dublin', state: 'OH', as_of: '2026-05-01' },
  { slug: 'qts-nal1-dc2', name: 'NAL1 DC2', provider: 'QTS', city: 'New Albany', state: 'OH', as_of: '2026-05-03' },
];
const MOR = { ok: true, class: 'moratorium', count: 2, as_of: '2026-11-22', records: [
  { jurisdiction: 'Loudoun County', state: 'VA', stage: 'enacted', effective_date: null, as_of: '2026-09-18', source_url: 'https://example.gov/loudoun' },
  { jurisdiction: 'Suffolk', state: 'VA', stage: 'enacted', effective_date: null, as_of: '2026-10-23', source_url: 'https://example.gov/suffolk' },
] };
const P4 = 'Which data center facilities are in the Ashburn market?';
const P5 = 'Are there any data center moratoriums or permitting constraints in Loudoun County or Northern Virginia?';
const P7 = 'Help me think about a data center site in Columbus, Ohio: power, fiber, and nearby facilities.';

const sf_kept = (o) => { const e = o.executed.find((x) => x.tool === 'search_facilities'); return e && e.submarket_scope ? e.submarket_scope.kept : (e && e.result && e.result.submarket_scope ? e.result.submarket_scope.kept : null); };
const plan = async (H, intent, extra = {}) => {
  const r = await H.call('/mcp', 'execute_plan', { intent, detail: 'full', ...extra },
    { 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.63' });
  return r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
};

describe('planner 5.63 facility lead end to end (real server.mjs on loopback)', () => {
  let H, fence;
  const prev = { c: process.env.DCHUB_PLAN_COMPACT, f: process.env.DCHUB_PLAN_FACILITY_LEAD_V1 };
  beforeAll(async () => {
    delete process.env.DCHUB_PLAN_COMPACT;
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p, _req, _body, u) => {
      if (p === '/api/v1/facilities') {
        const sp = u && u.searchParams ? u.searchParams : new URLSearchParams();
        seen.push(Object.fromEntries(sp.entries()));
        if (sp.get('city') === 'Ashburn') return { status: 200, body: { _data_total_available: 5, facilities: ASHBURN_ROWS } };
        if (sp.get('q') === 'Columbus') return { status: 200, body: { _data_total_available: 5, facilities: COLUMBUS_ROWS } };
        return { status: 200, body: { total_matching: 0, facilities: [] } };
      }
      if (p === '/api/v1/permitting/intel') {
        const sp = u && u.searchParams ? u.searchParams : new URLSearchParams();
        if (sp.get('class') === 'moratorium') return { status: 200, body: MOR };
        return { status: 200, body: { ok: true, count: 0, records: [] } };
      }
      return undefined;
    } });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
    for (const [k, v] of [['DCHUB_PLAN_COMPACT', prev.c], ['DCHUB_PLAN_FACILITY_LEAD_V1', prev.f]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  beforeEach(() => { seen.length = 0; });

  describe('flag on', () => {
    beforeAll(() => { process.env.DCHUB_PLAN_FACILITY_LEAD_V1 = '1'; });
    afterAll(() => { delete process.env.DCHUB_PLAN_FACILITY_LEAD_V1; });

    for (const extra of [{ market: 'Ashburn' }, {}]) {
      it(`P4 ${JSON.stringify(extra)}: facility_search, the facilities lead, N of M, Ashburn I kept, Sterling cut`, async () => {
        const o = await plan(H, P4, extra);
        expect(o.intent_class, o.replay && o.replay.decisions && o.replay.decisions[0].rationale).toBe('facility_search');
        expect(o.replay.planner_version).toBe('5.65');
        expect(o.executed[0].tool).toBe('search_facilities');
        expect(seen[0]).toMatchObject({ city: 'Ashburn', state: 'VA' });
        expect(o.executed.some((e) => e.tool === 'site_selection_canvas')).toBe(false);
        const lead = o.intent_answer && o.intent_answer.headline;
        expect(lead, JSON.stringify(o.intent_answer)).toMatch(/^3 of 5 matching rows shown \(preview\), in Ashburn, e\.g\. /);
        // The registry row whose city field is "Ashburn I" is counted inside Ashburn (3 kept, not 2). Its name equals its
        // city field, so it is counted, not listed, until the backend city normalisation runs.
        expect(sf_kept(o)).toBe(3);
        expect(lead).not.toMatch(/Sterling/);
        expect(lead).not.toMatch(/on record/);
        expect(lead).not.toMatch(/RANKING FOR WHERE TO BUILD|DCPI \d/);
        // The keyless preview serves 3 of the 4 stub rows, so the Sterling cut is proven in the unit test, not here.
        const sf = o.executed.find((e) => e.tool === 'search_facilities');
        expect(JSON.stringify(sf)).toMatch(/"submarket_match":"in"/);
        expect(JSON.stringify(sf)).not.toMatch(/"place":"Ashburn I"/);
        expect(o.ok).toBe(true);
        expect(JSON.stringify(o)).toMatch(/Source: DC Hub \(dchub\.cloud[^)]*\), as of \d{4}-\d{2}-\d{2}/);
        const fh = buildPlanFactHeader(o);
        expect(fh, fh).toMatch(/\nSUMMARY 3 of 5 matching rows shown|\nSUMMARY: 3 of 5 matching rows shown/);
        const c = compactPlanObject(o);
        expect(c.facts[0].tool, JSON.stringify(c.facts)).toBe('search_facilities');
        expect(fence.foreign).toEqual([]);
      }, 120_000);
    }

    it('P5: still leads with Loudoun County and names Suffolk', async () => {
      const o = await plan(H, P5, { market: 'Ashburn', state: 'VA' });
      expect(o.intent_class).toBe('permitting');
      expect(o.intent_answer.headline).toMatch(/^Named in the question: Loudoun County, VA: enacted, source date 2026-09-18/);
      expect(JSON.stringify(o.intent_answer)).toMatch(/Suffolk/);
      expect(fence.foreign).toEqual([]);
    }, 120_000);

    it('P7: still runs search_facilities; the fact names Dublin and New Albany and says N of M', async () => {
      const o = await plan(H, P7, { market: 'Columbus' });
      const sf = o.executed.find((e) => e.tool === 'search_facilities');
      expect(sf && sf.status, JSON.stringify(o.executed.map((e) => [e.tool, e.status]))).toBe('executed');
      const f = compactPlanObject(o).facts.find((x) => x.tool === 'search_facilities');
      expect(f && f.text, JSON.stringify(compactPlanObject(o).facts)).toMatch(/^2 of 5 matching rows shown \(preview\), matching "Columbus"; the rows sit in Dublin and New Albany, Columbus metro, e\.g\. /);
      expect(f.text).not.toMatch(/on record/);
      expect(fence.foreign).toEqual([]);
    }, 120_000);
  });

  describe('flag off (5.62 unchanged)', () => {
    beforeAll(() => { delete process.env.DCHUB_PLAN_FACILITY_LEAD_V1; });
    it('P4 with market:"Ashburn" keeps market_ranking and planner_version 5.63; the count wording is 5.62', async () => {
      const o = await plan(H, P4, { market: 'Ashburn' });
      expect(o.intent_class).toBe('market_ranking');
      expect(o.replay.planner_version).toBe('5.63');
      const p = await plan(H, P4);
      expect(p.intent_class).toBe('facility_search');
      expect(p.intent_answer.headline).toMatch(/^2 facilities in Ashburn on record/);
      expect(fence.foreign).toEqual([]);
    }, 120_000);
  });
});
