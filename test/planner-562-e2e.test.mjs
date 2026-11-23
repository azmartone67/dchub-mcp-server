// planner-562-e2e.test.mjs -- planner 5.62 end to end (Grok answer-quality note 2026-11-23): the real server.mjs on
// loopback against the harness stub, keyless. PJM fixtures only (Ashburn, Loudoun, Northern Virginia).
//   P4: the facility search is held to Ashburn (city=), widens once to the metro query when the town has no row
//       (replay.scope_widened says so), and the answer leads with the facilities, dated by row as_of.
//   P5: a Loudoun permitting ask routes to permitting and the answer leads with Loudoun County.
// No static import of server.mjs: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { compactPlanObject } from '../lib/plan-compact.mjs';

const seen = [];
const NOVA_ROWS = [
  { slug: 'vantage-ashburn-i', name: 'Ashburn I', provider: 'Vantage Data Centers', city: 'Ashburn', state: 'VA', lat: 39.03, lon: -77.47, as_of: '2026-03-30' },
  { slug: 'vantage-ashburn-ii', name: 'Ashburn II', provider: 'Vantage Data Centers', city: 'Ashburn', state: 'VA', lat: 39.03, lon: -77.46, as_of: '2026-03-30' },
  { slug: 'x-sterling-1', name: 'Sterling One', provider: 'Example Co', city: 'Sterling', state: 'VA', lat: 39.01, lon: -77.43, as_of: '2026-02-01' },
];
const MOR = { ok: true, class: 'moratorium', count: 2, as_of: '2026-11-22', records: [
  { jurisdiction: 'Loudoun County', state: 'VA', stage: 'enacted', effective_date: null, as_of: '2026-09-18', source_url: 'https://example.gov/loudoun' },
  { jurisdiction: 'Suffolk', state: 'VA', stage: 'enacted', effective_date: null, as_of: '2026-10-23', source_url: 'https://example.gov/suffolk' },
] };

const plan = async (H, intent) => {
  const r = await H.call('/mcp', 'execute_plan', { intent, detail: 'full' },
    { 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.62' });
  return r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
};

describe('planner 5.62 end to end (real server.mjs on loopback)', () => {
  let H, fence;
  const prevCompact = process.env.DCHUB_PLAN_COMPACT;
  beforeAll(async () => {
    delete process.env.DCHUB_PLAN_COMPACT;   // the compact default (mcp#1518); detail:'full' asks for the full form
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: (p, _req, _body, u) => {
      if (p === '/api/v1/facilities') {
        const sp = u && u.searchParams ? u.searchParams : new URLSearchParams();
        seen.push(Object.fromEntries(sp.entries()));
        if (sp.get('city') === 'Ashburn') return { status: 200, body: { total_matching: 0, facilities: [] } };
        return { status: 200, body: { total_matching: 605, facilities: NOVA_ROWS } };
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
    if (prevCompact === undefined) delete process.env.DCHUB_PLAN_COMPACT; else process.env.DCHUB_PLAN_COMPACT = prevCompact;
  });

  it('P4: Ashburn first, widened once to Northern Virginia, the facilities lead, dated by row', async () => {
    seen.length = 0;
    const o = await plan(H, 'Which data center facilities are in the Ashburn market?');
    expect(o.intent_class).toBe('facility_search');
    expect(o.planner_version).toBe('5.62');
    expect(seen[0]).toMatchObject({ city: 'Ashburn', state: 'VA' });
    expect(seen[1]).toMatchObject({ q: 'Northern Virginia', state: 'VA' });
    const sf = o.executed.find((e) => e.tool === 'search_facilities');
    expect(sf.scope_widened).toMatchObject({ widened_from: 'Ashburn', to: 'Northern Virginia' });
    expect(o.replay.scope_widened).toMatchObject({ widened_from: 'Ashburn', to: 'Northern Virginia' });
    // The widened rows are cut back to Ashburn: Sterling is never called Ashburn.
    const lead = o.intent_answer && o.intent_answer.headline;
    expect(lead, JSON.stringify(o.intent_answer)).toMatch(/^2 facilities in Ashburn on record, e\.g\. Vantage Ashburn I, Vantage Ashburn II \(DC Hub, row as_of 2026-03-30\)\./);
    expect(lead).not.toMatch(/Sterling/);
    expect(o.intent_answer.facts[0].tool).toBe('search_facilities');
    expect(JSON.stringify(o.paired_sides || {})).not.toMatch(/undated/);
    // The compact form of this answer carries facts[] at the top: the facility fact is first.
    const c = compactPlanObject(o);
    expect(c.facts[0].tool, JSON.stringify(c.facts)).toBe('search_facilities');
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('P7: the Columbus site ask executes search_facilities {q:Columbus, state:OH} beside fiber, DCPI and grid', async () => {
    seen.length = 0;
    const o = await plan(H, 'Help me think about a data center site in Columbus, Ohio: power, fiber, and nearby facilities.');
    expect(o.intent_class).toBe('fiber_power_pairing');
    const sf = o.executed.find((e) => e.tool === 'search_facilities');
    expect(sf, JSON.stringify(o.executed.map((e) => [e.tool, e.status]))).toBeTruthy();
    expect(sf.status).toBe('executed');
    expect(sf.args).toMatchObject({ query: 'Columbus', state: 'OH' });
    expect(seen.some((q) => q.q === 'Columbus' && q.state === 'OH')).toBe(true);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('P5: the Loudoun permitting ask leads with Loudoun County, its stage, source date and link', async () => {
    const o = await plan(H, 'Are there any data center moratoriums or permitting constraints in Loudoun County or Northern Virginia?');
    expect(o.intent_class).toBe('permitting');
    const m = o.executed.find((e) => e.tool === 'get_permitting_intel' && e.args && e.args.class === 'moratorium');
    expect(m && m.status).toBe('executed');
    expect(m.args).toMatchObject({ class: 'moratorium', state: 'VA' });
    expect(o.intent_answer.headline).toMatch(/^Named in the question: Loudoun County, VA: enacted, source date 2026-09-18, source https:\/\/example\.gov\/loudoun/);
    expect(o.intent_answer.headline).not.toMatch(/effective/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
