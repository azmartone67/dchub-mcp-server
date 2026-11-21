// grok-daily-routing-1120d-e2e.test.mjs — planner 5.56 on a real server.mjs with a stub backend (no network): the four
// questions from Grok's daily MCP note (2026-11-20), run through execute_plan end to end.
//   item 1  the Beaumeade street-address screen runs the site screen at the geocoded address, with the VA permitting read
//   item 2  "QTS Atlanta Metro" is searched by its name, get_facility reads ATL1 (not Suwanee), and the record leads
//   item 3  "under construction in Northern Virginia" runs get_pipeline {status: construction, state: VA}; the lead names
//           the projects and their companies, never PJM demand
//   item 4  "operational versus under construction in Texas" runs get_market_intel and get_pipeline; the lead holds the
//           operational count + MW floor (dated) and the construction count; facts[] and paired_sides count the same
//           projects when the pipeline step was slimmed
// Pure tests: test/grok-daily-routing-1120d.test.mjs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';
import { compactPlanObject } from '../lib/plan-compact.mjs';
import { factsFromExecuted } from '../lib/plan-step-facts.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.39' };
const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
const SUWANEE = { name: 'QTS Suwanee', provider: 'QTS Data Centers', city: 'Suwanee', state: 'GA', status: 'operational', slug: 'qts-qts-suwanee-1a2b3c4d' };
const ATL1 = { name: 'QTS Atlanta-Metro (ATL1)', provider: 'QTS Data Centers', city: 'Atlanta', state: 'GA', status: 'operational', slug: 'qts-qts-atlanta-metro-atl1-5e6f7a8b' };
const NOVA_PIPE = { success: true, as_of: '2026-11-20', total: 2, projects: [
  { company: 'Amazon Web Services', project: 'AWS Devlin Tech Park', capacity: 300, status: 'construction', market: 'Northern Virginia' },
  { company: 'CyrusOne', project: 'CyrusOne Sterling VI', capacity: null, status: 'construction', market: 'Northern Virginia' }] };
// A keyless-shaped pipeline preview with no total and enough fields per row that execute_plan slims it to one row.
const pad = (k) => Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`f${k}_${i}`, `value ${i} of a long project field`]));
const WY_PIPE = { success: true, as_of: '2026-11-20', preview_is_partial: true, projects: [
  { company: 'Example Co', project: 'Cheyenne Campus A', capacity: null, status: 'construction', market: 'Cheyenne', ...pad('a') },
  { company: 'Other Co', project: 'Cheyenne Campus B', capacity: null, status: 'construction', market: 'Cheyenne', ...pad('b') }] };
const INTEL = { dallas: ['Dallas', 246, 4323, 45], houston: ['Houston', 120, 900, 20] };

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    seen.push(p + (u && u.search ? u.search : ''));
    const q = u ? u.searchParams : new URLSearchParams();
    if (p === '/api/v1/geocode') return { status: 200, body: { lat: 39.02219, lng: -77.45358, label: '21571 Beaumeade Cir, Ashburn, Virginia, 20147', source: 'ArcGIS World Geocoder' } };
    // The registry returns Suwanee first for a GA search, as it did live.
    if (p === '/api/v1/facilities') return { status: 200, body: { success: true, total: 2, data: [SUWANEE, ATL1] } };
    if (p.startsWith('/api/v1/facilities/qts-qts-atlanta') || p.startsWith('/api/v1/facility/qts-qts-atlanta')) return { status: 200, body: { success: true, data: { ...ATL1, address: '1033 Jefferson St NW, Atlanta, GA 30318', updated_at: '2026-11-02T00:00:00Z' } } };
    if (p.startsWith('/api/v1/facilities/qts-qts-suwanee') || p.startsWith('/api/v1/facility/qts-qts-suwanee')) return { status: 200, body: { success: true, data: { ...SUWANEE, updated_at: '2026-11-01T00:00:00Z' } } };
    if (p === '/api/v1/pipeline') return { status: 200, body: q.get('state') === 'WY' ? WY_PIPE : NOVA_PIPE };
    if (p.startsWith('/api/v1/markets/')) {
      const m = INTEL[p.split('/').pop()];
      if (m) return { status: 200, body: { success: true, as_of: '2026-11-20', market: { name: m[0] }, stats: { facility_count: m[1], total_power_mw: m[2], mw_reporting_count: m[3] } } };
    }
    if (p === '/api/v1/grid/intelligence' || p.startsWith('/api/v1/grid-intelligence')) return { status: 200, body: { iso: 'PJM', demand_mw: 95340 } };
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

const ranOk = (e) => e.status === 'executed' || e.status === 'gated_preview';

describe('execute_plan 5.56 (real server.mjs, stub backend)', () => {
  it('item 1: the Beaumeade screen is a site screen at the geocoded address, with the VA permitting read', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Screen 21571 Beaumeade Circle, Ashburn, VA 20147 as a data center site: flood zone, zoning and parcel, nearby transmission and the grid context.' }, PRO));
    expect(o.intent_class).toBe('site_analysis');
    for (const t of ['get_composite_site_score', 'get_infrastructure', 'get_disaster_risk']) {
      const e = o.executed.find((x) => x.tool === t);
      expect(e, t).toBeTruthy();
      expect(e.args).toMatchObject({ lat: 39.02219, lon: -77.45358 });
    }
    expect(o.executed.find((x) => x.tool === 'get_permitting_intel').args).toMatchObject({ state: 'VA' });
  }, 120_000);

  it('item 2: the named facility is searched by name, ATL1 is read, and the record leads', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Give me the details for QTS Atlanta Metro data center: address, operator, power capacity and status.' }, PRO));
    expect(o.intent_class).toBe('facility_search');
    expect(o.executed.find((e) => e.tool === 'search_facilities').args.query).toContain('QTS Atlanta Metro');
    const gf = o.executed.find((e) => e.tool === 'get_facility');
    expect(gf.args.slug).toMatch(/^qts-qts-atlanta-metro-atl1/);
    const lead = planLeadText(o);
    expect(lead.startsWith('QTS Atlanta-Metro')).toBe(true);
    const first = lead.split(/(?<=\.)\s/)[0];
    expect(first).not.toMatch(/firm-supply|firm supply/i);
  }, 120_000);

  it('item 3: the status ask runs get_pipeline {construction, VA} and leads with projects, not PJM demand', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Which data center campuses are under construction in Northern Virginia, with operator and MW?' }, PRO));
    const gp = o.executed.find((e) => e.tool === 'get_pipeline');
    expect(gp && ranOk(gp)).toBe(true);
    expect(gp.args).toMatchObject({ status: 'construction', state: 'VA' });
    const lead = planLeadText(o);
    expect(lead).toMatch(/AWS Devlin Tech Park \(Amazon Web Services, 300 MW\)/);
    expect(lead).not.toMatch(/PJM demand/);
    expect(seen.some((x) => x.startsWith('/api/v1/pipeline') && /status=construction/.test(x) && /state=VA/.test(x))).toBe(true);
  }, 120_000);

  it('item 4: Texas reads the market brief and the pipeline; the lead holds both sides', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'How much data center capacity in Texas is operational versus under construction (MW)?' }, PRO));
    expect(o.intent_class).toBe('dc_capacity');
    const ran = o.executed.filter(ranOk).map((e) => e.tool);
    expect(ran).toEqual(expect.arrayContaining(['get_market_intel', 'get_pipeline']));
    expect(o.executed.find((e) => e.tool === 'get_pipeline').args).toMatchObject({ status: 'construction', state: 'TX' });
    const h = o.intent_answer.headline;
    expect(h).toMatch(/Dallas: 246 facilities tracked, 4,323 MW across the 45 that report capacity \(a floor\) \(DC Hub market brief, as of 2026-11-20\)/);
    expect(h).toMatch(/Under construction: TX data-center pipeline: \d+ projects? (?:on record|shown in this preview)/);
  }, 120_000);

  it('item 4: facts[] and paired_sides count the same projects when the pipeline step was slimmed', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'How much data center capacity in Wyoming is operational versus under construction (MW)?' }, PRO));
    expect(o.intent_class).toBe('dc_capacity');
    // The pipeline step in executed[] is the slimmed copy (first row, full count in truncation.rows_total): the copy the
    // compact answer's facts[] is read from. paired_sides was read from the full result.
    const pe = o.executed.find((e) => e.tool === 'get_pipeline');
    const pr = typeof pe.result === 'string' ? JSON.parse(pe.result) : pe.result;
    expect(pr.truncation && pr.truncation.rows_total && pr.truncation.rows_total.projects).toBe(2);
    expect(pr.projects).toHaveLength(1);
    const c = compactPlanObject(o);
    const count = (s) => { const m = /(\d+) projects? (?:on record|shown)/.exec(String(s || '')); return m ? Number(m[1]) : null; };
    const pf = (c.facts || []).filter((f) => f.tool === 'get_pipeline').map((f) => count(f.text)).filter((n) => n != null);
    const side = c.paired_sides && c.paired_sides.data_center;
    expect(side && side.tool).toBe('get_pipeline');
    expect(pf.length).toBeGreaterThan(0);
    expect(new Set([...pf, count(side.line)])).toEqual(new Set([2]));
    // and the step fact read from the slimmed copy alone (what facts[] carried before the answer's own facts) agrees
    const slimFact = factsFromExecuted(o.executed).find((f) => f.tool === 'get_pipeline');
    expect(count(slimFact && slimFact.text)).toBe(2);
  }, 120_000);
});
