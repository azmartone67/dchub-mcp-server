// compare-isos-bands-forwarded-tier.test.mjs — mcp#1476 follow-up (2026-11-16).
//
// ★THE DEFECT. #1476 cut the coarse bands in the free trim from the untrimmed rows. Live, a
// keyless compare_isos carried NO bands (probe 2026-11-16 06:15Z, ERCOT,PJM,MISO): since
// 2026-11-03 this server forwards the END USER's tier (X-DCHub-Caller-Tier), and
// /api/v1/dcpi/iso-comparison masks every ISO aggregate below the backend's paid plans
// (routes/dcpi.py _mask_iso_rows_inplace), so the "untrimmed" rows already held nulls. The
// #1476 test stub ignored that header and served full rows to everyone, which is how it passed.
//
// This stub masks the way the backend does: with the internal key and a forwarded tier below
// Pro, every aggregate except iso / iso_name / market_count / the *_count fields / the dates is
// null and the row is `locked`; with no forwarded tier (the server view) the rows are whole.
// DCHUB_GRID_HEADROOM_TIER=1 as live (the `_headroom_withheld` / `_queue_depth_gw_withheld`
// markers on the live row), which also nulls any key named time_to_power* or headroom* in the trim.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { gridIntelligence } from './helpers/us-grid-stub.mjs';
import { BAND_NOTE, cleanBands } from '../lib/iso-bands.mjs';

const K_PRO = 'dch_live_cmpbandsfwd_pro01';
const K_FREE = 'dch_live_cmpbandsfwd_free1';
const PAID = new Set(['pro', 'enterprise', 'founding']);
const ROWS = [
  { iso: 'ERCOT', iso_name: 'ERCOT', market_count: 19, build_count: 1, avg_constraint: 50, avg_excess: 66.2,
    avg_time_to_power_months: 24, avg_queue_wait_months: 31.4172, total_stranded_capacity_mw: 999.9, latest_computed_at: '2026-11-16T05:32:01Z' },
  { iso: 'PJM', iso_name: 'PJM Interconnection', market_count: 64, build_count: 3, avg_constraint: 71.2345, avg_excess: 40.1,
    avg_time_to_power_months: 47.9876, total_stranded_capacity_mw: 9876.54, latest_computed_at: '2026-11-16T05:32:13Z' },
  { iso: 'MISO', iso_name: 'Midcontinent ISO', market_count: 39, build_count: 0, avg_constraint: 70, avg_excess: 52,
    avg_time_to_power_months: 23.5, total_stranded_capacity_mw: 10000, latest_computed_at: '2026-11-16T05:32:08Z' },
];
const FREE_KEYS = new Set(['iso', 'iso_name', 'market_count', 'latest_computed_at', 'oldest_computed_at', 'locked']);
function isoComparisonFor(req) {
  const fwd = req.headers['x-dchub-caller-tier'];
  const internal = !!req.headers['x-internal-key'];
  const rows = ROWS.map((r) => ({ ...r }));
  // The backend: the forwarded tier is read only next to the internal key; no header = internal key = paid.
  if (internal && fwd !== undefined && !PAID.has(String(fwd).toLowerCase())) {
    for (const r of rows) {
      for (const k of Object.keys(r)) if (!FREE_KEYS.has(k) && !k.endsWith('_count')) r[k] = null;
      r.locked = true;
    }
  }
  return { isos: rows };
}
const NEEDLES = ['47.9876', '71.2345', '9876.54', '31.4172'];
const EXPECT = {
  ERCOT: { time_to_power_band: '24-48 mo', constraint_level: 'low', headroom_band: '<1 GW', band_note: BAND_NOTE },
  PJM: { time_to_power_band: '24-48 mo', constraint_level: 'high', headroom_band: '3-10 GW', band_note: BAND_NOTE },
  MISO: { time_to_power_band: '<24 mo', constraint_level: 'medium', headroom_band: '10+ GW', band_note: BAND_NOTE },
};

function leadingJson(text) {
  const s = String(text || '').trimStart();
  if (!s.startsWith('{')) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(s.slice(0, i + 1)); } catch (_) { return null; } } }
  }
  return null;
}

describe('cleanBands: only a known label rides a pre-attached bands object', () => {
  it('drops unknown labels and every other key', () => {
    expect(cleanBands({ time_to_power_band: '24-48 mo', constraint_level: 'high', headroom_band: '3-10 GW',
      avg_time_to_power_months: 47.9876, band_note: 'x' }))
      .toEqual({ time_to_power_band: '24-48 mo', constraint_level: 'high', headroom_band: '3-10 GW', band_note: BAND_NOTE });
    expect(cleanBands({ time_to_power_band: '47.9876 mo', constraint_level: 71.2345 })).toBeNull();
    expect(cleanBands(null)).toBeNull();
  });
});

describe('compare_isos bands when the backend masks for the forwarded caller tier', () => {
  let H, fence;
  const isoCmpCalls = [];
  const routes = (p, req, body) => {
    if (p === '/api/v1/keys/validate') {
      const key = (body && body.api_key) || '';
      if (key === K_PRO) return { status: 200, body: { valid: true, tier: 'pro', developer_id: 'dev_fwd_pro', tier_detail: { users_plan: 'pro' } } };
      if (key === K_FREE) return { status: 200, body: { valid: true, tier: 'free', developer_id: 'dev_fwd_free' } };
      return { status: 200, body: { valid: false, tier: 'free' } };
    }
    if (p === '/api/v1/dcpi/iso-comparison') {
      isoCmpCalls.push(req.headers['x-dchub-caller-tier'] ?? '(none)');
      return { status: 200, body: isoComparisonFor(req) };
    }
    if (p === '/api/v1/interconnection-queue/snapshot') return { status: 200, body: { by_iso: [] } };
    const m = /^\/api\/v1\/grid\/intelligence\/([A-Za-z-]+)$/.exec(p);
    if (m) { const b = gridIntelligence(m[1].toUpperCase()); return b ? { status: 200, body: b } : undefined; }
    return undefined;
  };

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: routes, env: { DCHUB_GRID_HEADROOM_TIER: '1' } });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('the stub masks like the backend: a keyless read gets null aggregates (the live shape)', async () => {
    isoCmpCalls.length = 0;
    const r = (await H.call('/mcp', 'compare_isos', { isos: 'ERCOT,PJM,MISO' },
      { 'user-agent': 'test-client', 'x-dc-client-ip': '203.0.113.71' })).msg.result;
    expect(isoCmpCalls[0], 'the caller read did not forward a tier').toBe('anonymous');
    // the caller's figures stay what the backend sent: null, never the server view's value
    const e = r.structuredContent.comparison.ERCOT;
    expect(e.avg_time_to_power_months ?? null).toBeNull();
    expect(e.constraint_score ?? null).toBeNull();
    expect(e.stranded_capacity_mw ?? null).toBeNull();
  }, 120_000);

  for (const [label, headers, ip] of [
    ['keyless', { 'user-agent': 'test-client' }, '203.0.113.72'],
    ['free key', { 'x-api-key': K_FREE, 'user-agent': 'test-client' }, '203.0.113.73'],
  ]) {
    it(`${label}: bands are cut from the server view, in text block 0 and structuredContent alike`, async () => {
      const r = (await H.call('/mcp', 'compare_isos', { isos: 'ERCOT,PJM,MISO' }, { ...headers, 'x-dc-client-ip': ip })).msg.result;
      const sc = r.structuredContent;
      const lead = leadingJson(r.content[0].text);
      expect(lead && lead.comparison, `${label}: text block 0 does not lead with the comparison JSON`).toBeTruthy();
      for (const iso of Object.keys(EXPECT)) {
        expect(sc.comparison[iso].bands, `${label} structuredContent ${iso}`).toEqual(EXPECT[iso]);
        expect(lead.comparison[iso].bands, `${label} text ${iso}`).toEqual(EXPECT[iso]);
      }
      expect(sc.bands_summary).toContain('ERCOT: time-to-power band 24-48 mo, constraint level low, headroom band <1 GW');
      expect(lead.bands_summary).toBe(sc.bands_summary);
      const all = r.content.map((c) => c.text || '').join('\n') + JSON.stringify(sc);
      for (const n of NEEDLES) expect(all.includes(n), `${label}: ${n} leaked`).toBe(false);
    }, 120_000);
  }

  it('keyless execute_plan: the compare_isos step carries the bands', async () => {
    const r = (await H.call('/mcp', 'execute_plan', { intent: 'compare ERCOT vs PJM vs MISO for 100 MW by 2028' },
      { 'user-agent': 'test-client', 'x-dc-client-ip': '203.0.113.74' })).msg.result;
    const step = (r.structuredContent.executed || []).find((e) => e.tool === 'compare_isos');
    expect(step, 'no compare_isos step').toBeTruthy();
    for (const iso of Object.keys(EXPECT)) {
      expect(step.result.comparison[iso].bands, `execute_plan step ${iso}`).toEqual(EXPECT[iso]);
    }
    for (const n of NEEDLES) expect(JSON.stringify(r).includes(n), `execute_plan: ${n} leaked`).toBe(false);
  }, 120_000);

  it('Pro: figures as sent, no bands, and no second iso-comparison read', async () => {
    isoCmpCalls.length = 0;
    const r = (await H.call('/mcp', 'compare_isos', { isos: 'ERCOT,PJM,MISO' }, { 'x-api-key': K_PRO, 'user-agent': 'test-client' })).msg.result;
    const sc = r.structuredContent;
    expect(sc.comparison.PJM.avg_time_to_power_months).toBe(47.9876);
    for (const iso of Object.keys(EXPECT)) expect(sc.comparison[iso].bands, iso).toBeUndefined();
    expect(sc.bands_summary).toBeUndefined();
    expect(isoCmpCalls).toEqual(['pro']);
  }, 120_000);
});
