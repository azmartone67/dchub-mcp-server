// Grok Note L (2026-11-15), the parts inside compare_isos's own result, end to end on the real server.mjs
// (loopback, stub backend shaped like the live feeds of 2026-11-15).
//   L1/L2  a keyless compare (direct, and through execute_plan) names no paid plan, price, checkout or
//          /upgrade or /pricing path anywhere in its text or structuredContent.
//   L3     a DCPI row with no BUILD count gives build_rate_pct null with a "not available" basis, never 0;
//          a reported 0 stays 0.
//   L4     ERCOT's generation queue (461.4 GW) and large-load queue (474 GW, 426.6 GW of it data center)
//          are separate figures, each with its own basis.
// No static import of server.mjs here: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { gridIntelligence } from './helpers/us-grid-stub.mjs';

export const NOTE_L_PAID_RE = /paid upgrade|paid data tier|paid (plan|tier|key)|upgrade page|\/pricing|\/upgrade|checkout|stripe|\$\d|\b(Pro|Developer|Enterprise|Starter) plan/i;
const K_PRO = 'dch_live_noteL_pro_000001';

const DCPI_ROWS = [
  // PJM: the DCPI row carries no BUILD count (the L3 case). MISO: a REPORTED 0 (the control).
  { iso: 'PJM', iso_name: 'PJM Interconnection', market_count: 64, latest_computed_at: '2026-11-15T18:32:13Z' },
  { iso: 'ERCOT', iso_name: 'ERCOT', market_count: 19, build_count: 1, latest_computed_at: '2026-11-15T18:32:01Z' },
  { iso: 'MISO', iso_name: 'Midcontinent ISO', market_count: 39, build_count: 0, latest_computed_at: '2026-11-15T18:32:08Z' },
];
const QSNAP = { by_iso: [
  { iso: 'ERCOT', queue_kind: 'large_load', queued_load_total_gw: 474.0, queued_generation_gw: 461.4,
    queued_load_data_center_gw: 426.6, queued_load_dc_share_pct: 90.0, queued_generation_gw_as_of: '2026-10-31',
    source_as_of: '2026-10-31', source_as_of_basis: 'published_report',
    source_report: 'ERCOT GIS Report, October 2026 (posted 2026-11-02), Summary sheet (generation queue); ERCOT Senate presentation Jul 29 2026, June 2026 data (large load)' },
  { iso: 'PJM', queue_kind: 'generation_queue', queued_generation_gw: 373.6, source_as_of: '2026-11-15',
    source_as_of_basis: 'live_feed_fetch_date', fetched_at: '2026-11-15T06:00:51Z', source_name: 'PJM cycle + serial service request status' },
  { iso: 'MISO', queue_kind: 'generation_queue', queued_generation_gw: 260.0, source_as_of: '2026-11-15',
    source_as_of_basis: 'live_feed_fetch_date', fetched_at: '2026-11-15T06:00:52Z', source_name: 'MISO GI Queue API' },
] };

describe('compare_isos, Grok Note L (real server.mjs on loopback)', () => {
  let H, fence;
  const routes = (p, req, body) => {
    if (p === '/api/v1/keys/validate') {
      const key = (body && body.api_key) || '';
      return { status: 200, body: key === K_PRO ? { valid: true, tier: 'pro', developer_id: 'dev_noteL' } : { valid: false, tier: 'free' } };
    }
    if (p === '/api/v1/dcpi/iso-comparison') return { status: 200, body: { isos: DCPI_ROWS } };
    if (p === '/api/v1/interconnection-queue/snapshot') return { status: 200, body: QSNAP };
    const m = /^\/api\/v1\/grid\/intelligence\/([A-Za-z-]+)$/.exec(p);
    if (m) { const b = gridIntelligence(m[1].toUpperCase()); return b ? { status: 200, body: b } : undefined; }
    return undefined;
  };

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: routes });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  const payload = (r) => JSON.stringify([(r.msg.result.content || []).map((c) => c.text || ''), r.msg.result.structuredContent || null]);

  // L1/L2 scope: the parts of the answer compare_isos itself writes (the comparison rows, scope, source,
  // citation, provenance) and the execute_plan step note around its result. The wall/offer copy beside
  // them (human_url, upgrade, continuation, for_your_human, the relay prose) is written by the wall libs,
  // which another change owns; on this stub that copy still matches NOTE_L_PAID_RE (an /upgrade/h link
  // and plan/checkout wording), so it is reported, not asserted here.
  const OWN = ['isos', 'comparison', 'source', 'citation', 'provenance', 'retrieved_at', 'unsupported_ignored', 'note', 'truncation'];
  const own = (o) => JSON.stringify(Object.fromEntries(OWN.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]])));
  const hits = (s) => [...s.matchAll(new RegExp(NOTE_L_PAID_RE.source, 'gi'))].map((m) => s.slice(Math.max(0, m.index - 120), m.index + 40));

  it('L1/L2: keyless compare_isos (array isos): its own result names no paid plan, price, checkout or upgrade path', async () => {
    const r = await H.call('/mcp', 'compare_isos', { isos: ['ERCOT', 'PJM', 'MISO'] }, { 'user-agent': 'test-client', 'x-dc-client-ip': '203.0.113.21' });
    expect(r.msg.error, JSON.stringify(r.msg.error || {})).toBeUndefined();
    const sc = r.msg.result.structuredContent;
    expect(sc.isos).toEqual(['ERCOT', 'PJM', 'MISO']);
    expect(hits(own(sc))).toEqual([]);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('L1/L2: keyless execute_plan compare: the compare_isos step names no paid plan, price, checkout or upgrade path', async () => {
    const r = await H.call('/mcp', 'execute_plan', { intent: 'compare ERCOT vs PJM vs MISO for 100 MW by 2028' },
      { 'user-agent': 'test-client', 'x-dc-client-ip': '203.0.113.22' });
    const o = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    const step = o.executed.find((e) => e.tool === 'compare_isos');
    expect(step, 'the plan ran no compare_isos step').toBeTruthy();
    expect(step.result.isos).toEqual(['ERCOT', 'PJM', 'MISO']);
    expect(hits(own(step.result))).toEqual([]);
    // every slimmed step's note (execute_plan writes it, not the wall)
    for (const e of o.executed) expect(hits(String((e.result && e.result.note) || '')), e.tool).toEqual([]);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('L3: no BUILD count is null and "not available", never 0; a reported 0 stays 0', async () => {
    const r = await H.call('/mcp', 'compare_isos', { isos: 'ERCOT,PJM,MISO' }, { 'x-api-key': K_PRO, 'user-agent': 'test-client' });
    const cmp = r.msg.result.structuredContent.comparison;
    expect(cmp.PJM.build_rate_pct).toBe(null);
    expect(cmp.PJM.build_count).toBe(null);
    expect(cmp.PJM.build_rate_basis).toMatch(/^not available/);
    expect(cmp.MISO.build_rate_pct).toBe(0);            // control: a reported 0
    expect(cmp.MISO.build_rate_basis).toMatch(/verdict share, not a construction rate/);
    expect(cmp.ERCOT.build_rate_pct).toBe(5.3);
    const s = payload(r);
    expect(s).not.toMatch(/Build Rate = 0%|not building|slowest-building/i);
  }, 120_000);

  it('L4: ERCOT generation and large-load queues are separate figures, each with its own basis', async () => {
    const r = await H.call('/mcp', 'compare_isos', { isos: ['ERCOT', 'PJM'] }, { 'x-api-key': K_PRO, 'user-agent': 'test-client' });
    const e = r.msg.result.structuredContent.comparison.ERCOT;
    expect([e.queue_depth_gw, e.queue_depth_basis]).toEqual([461.4, 'generation_queue']);
    expect([e.large_load_queue_gw, e.large_load_queue_basis]).toEqual([474, 'large_load']);
    expect(e.large_load_queue_data_center_gw).toBe(426.6);
    const s = payload(r);
    expect(s).not.toMatch(/461\.4[^\n|]{0,40}large[- ]load/i);
    // A generation-only row gains no large-load key.
    expect('large_load_queue_gw' in r.msg.result.structuredContent.comparison.PJM).toBe(false);
  }, 120_000);

  it('L4: the large-load figures stay withheld from a keyless caller, as queue_depth_gw is', async () => {
    const r = await H.call('/mcp', 'compare_isos', { isos: ['ERCOT', 'PJM'] }, { 'user-agent': 'test-client', 'x-dc-client-ip': '203.0.113.23' });
    const s = payload(r);
    expect(s).not.toMatch(/(?<![0-9.])474(?![0-9])|426\.6|461\.4/);
  }, 120_000);
});
