// grok-daily-answers-e2e-1120d.test.mjs — planner 5.57 on a real server.mjs with a stub backend (Grok daily note
// 2026-11-20, items 5, 7 and 10). Pure tests: test/grok-daily-answers-1120d.test.mjs.
//   5   "Find land for a 250 MW data center near Chicago": the DCPI card read starts in the first wave, while the
//       refined-queue read (the slow one, 5.5 s live) is still running; it never waits on find_sites or the queue.
//   7   a MISO withdrawals ask leads with the by-iso queue_withdrawals block (2,327 requests, 395 GW, as of its load).
//   10  "Where in Texas can I get grid power the fastest" reads ERCOT's by-iso summary.by_county and leads with the top
//       three counties by queued MW, with no "rows shown" disclaimer and no DCPI score.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork, PRO_KEY } from './helpers/claude-directory-harness.mjs';

const PRO = { 'x-api-key': PRO_KEY, 'user-agent': 'dchub-qa-readonly', 'x-dc-client-ip': '203.0.113.57' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timing = [];   // { path, start, end }
const seen = [];
let H, fence;
const sc = (r) => r.msg.result.structuredContent || JSON.parse(r.msg.result.content.find((b) => b.text.trim().startsWith('{')).text);
const timed = async (p, ms, body) => { const t = { path: p, start: Date.now(), end: null }; timing.push(t); await sleep(ms); t.end = Date.now(); return { status: 200, body }; };

// Live shapes (backend, 2026-11-20), trimmed.
const WITHDRAWALS = { basis: 'Requests the ISO\'s own queue file marks withdrawn, by the year the ISO dates the withdrawal.',
  by_iso: { MISO: { basis: 'MISO GI queue API: applicationStatus \'Withdrawn\', dated by withdrawnDate', count: 2327, gw: 395.038, status: 'captured' } },
  by_year: [{ count: 947, gw: 165.855, year: 2025 }, { count: 339, gw: 74.081, year: 2026 }],
  count: 2327, gw: 395.038, isos_captured: ['MISO'], loaded_at: '2026-11-20T09:31:37.913466+00:00', undated: { count: 22, gw: 2.343 } };
const BY_COUNTY = { as_of: '2026-11-20', iso: 'ERCOT', counties: 193, projects: 1766, source_reports: ['GIS_Report_October2026.xlsx'],
  top: [{ county: 'Pecos', projects: 53, queued_mw: 21389.2, share_pct: 4.8 }, { county: 'Brazoria', projects: 48, queued_mw: 10834.1, share_pct: 2.4 },
    { county: 'Wharton', projects: 41, queued_mw: 8625.1, share_pct: 1.9 }], total_mw: 446265.8 };
const BY_ZONE = { as_of: '2026-11-20', iso: 'ERCOT', top: [{ zone: 'WEST', projects: 515, queued_mw: 150969.5, share_pct: 33.8 }] };
const row = (county) => ({ county, state: 'TX', iso: 'ERCOT', project_name: `P ${county}` });

beforeAll(async () => {
  fence = fenceNetwork();
  H = await startHarness({ extraRoutes: async (p, req, body, u) => {
    seen.push(p + (u && u.search ? u.search : ''));
    const q = u ? u.searchParams : new URLSearchParams();
    if (p === '/api/v1/geocode') return { status: 200, body: { lat: 41.8755, lng: -87.6244, label: 'Chicago, Cook County, Illinois, United States', source: 'stub' } };
    if (p === '/api/v1/interconnection-queue/refined') {
      if (q.get('state') === 'TX') return { status: 200, body: { ok: true, count_total_matching: 1761, filters_applied: { state: 'TX', status: 'active' },
        freshness_by_iso: { ERCOT: { source_as_of: '2026-10-31' } }, results: [row('Fisher'), row('Franklin'), row('Leon')] } };
      if (q.get('status') === 'withdrawn') return { status: 200, body: { ok: true, count_total_matching: 0, filters_applied: { iso: 'MISO', status: 'withdrawn' }, results: [] } };
      return timed(p, 900, { ok: true, count_total_matching: 12, filters_applied: { min_mw: 250 }, results: [] });
    }
    if (p.startsWith('/api/v1/dcpi/scores/')) return timed(p, 300, { market_slug: 'chicago', market_name: 'Chicago', verdict: 'AVOID', iso: 'PJM',
      composite_score: 31.2, time_to_power_months: null, latitude: 41.87, longitude: -87.63, computed_at: '2026-11-20T03:00:00Z' });
    if (p === '/api/v1/sites/find') return timed(p, 300, { success: true, count: 0, candidates: [] });
    if (p === '/api/v1/interconnection-queue/by-iso') {
      const iso = String(q.get('iso') || '').toUpperCase();
      if (iso === 'MISO') return { status: 200, body: { iso: 'MISO', queued_generation_gw: 256.9, queued_generation_gw_as_of: '2026-11-20', project_count: 1136,
        source_as_of: '2026-11-20', source_as_of_basis: 'source_file_date', queue_withdrawals: WITHDRAWALS } };
      if (iso === 'ERCOT') return { status: 200, body: { iso: 'ERCOT', queued_generation_gw: 461.4, queued_generation_gw_as_of: '2026-10-31', project_count: 1766,
        summary: { by_county: BY_COUNTY, by_zone: BY_ZONE } } };
    }
    if (p === '/api/v1/power/availability-timeline') return { status: 200, body: { state: q.get('state'), timeline: [{ year: 2026, cumulative_firm_signal_mw: null, under_construction_mw: null, units: 89 }] } };
    if (p === '/api/v1/retirement-headroom' || p.startsWith('/api/v1/grid/retirement')) return { status: 200, body: { count_returned: 0, generators: [] } };
    return undefined;
  } });
}, 240_000);
afterAll(async () => { if (H) await H.stop(); if (fence) fence.restore(); }, 60_000);

describe('execute_plan 5.57 (real server.mjs, stub backend)', () => {
  it('item 5: the Chicago land plan reads the DCPI card in the first wave, while the queue read is still running', async () => {
    timing.length = 0;
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Find land for a 250 MW data center near Chicago' }, PRO));
    const ran = o.executed.filter((e) => e.status === 'executed').map((e) => e.tool);
    expect(ran).toEqual(expect.arrayContaining(['find_sites', 'get_refined_queue', 'get_market_dcpi_rank']));
    const dcpi = timing.find((t) => t.path.startsWith('/api/v1/dcpi/scores/'));
    const queue = timing.find((t) => t.path === '/api/v1/interconnection-queue/refined');
    const sites = timing.find((t) => t.path === '/api/v1/sites/find');
    expect(dcpi && queue && sites).toBeTruthy();
    // Concurrent, not chained: the card read starts before the 900 ms queue read ends and before find_sites ends.
    expect(dcpi.start).toBeLessThan(queue.end);
    expect(dcpi.start).toBeLessThan(sites.end);
    expect(Math.abs(dcpi.start - queue.start)).toBeLessThan(400);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('item 7: a MISO withdrawals ask leads with the withdrawn count, GW and its date', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'How many MISO interconnection requests were withdrawn?' }, PRO));
    expect(o.intent_class).toBe('queue_withdrawals');
    const h = o.intent_answer.headline;
    expect(h).toMatch(/^MISO withdrawn interconnection requests: 2,327 \(395 GW requested\), 339 of them withdrawn in 2026 \(MISO GI queue API, as of 2026-11-20; /);
    expect(h).not.toMatch(/loaders drop withdrawn requests/);
    expect(o.intent_answer.not_established.join(' ')).not.toMatch(/not served yet/);
  }, 120_000);

  it('item 10: "where in Texas" leads with ERCOT\'s top three counties by queued MW', async () => {
    const o = sc(await H.call('/mcp', 'execute_plan', { intent: 'Where in Texas can I get grid power the fastest for a data center?' }, PRO));
    expect(o.intent_class).toBe('dc_power_place');
    expect(o.executed.find((e) => e.tool === 'get_interconnection_queue' && e.args && e.args.iso === 'ERCOT')).toBeTruthy();
    const h = o.intent_answer.headline;
    expect(h).toMatch(/Where in TX: the ERCOT queue's requested generation is largest in Pecos County \(21,389 MW, 53 projects\), Brazoria County \(10,834 MW, 48 projects\), Wharton County \(8,625 MW, 41 projects\) \(ERCOT queue, as of 2026-11-20; queued generation MW\)/);
    expect(h).not.toMatch(/rows shown/);
    expect(h).not.toMatch(/Fisher County/);
    expect(JSON.stringify(o.intent_answer)).not.toMatch(/DCPI/);
  }, 120_000);
});
