// ── planner 5.18: a US headroom question gets a dated US headline (Grok orchestration move 1) ──
//
// Live 2026-11-09, keyless: "Which US grids have the most power headroom for a 100 MW data
// center launch?" kept one scoreboard row (Brazil ONS; Grok's run showed Norway), ran the deep
// reads on SPP only because it was the greenest US grid, gave no reason for the pick, and the
// guide opened UNDATED for step 1. Owner 11-09 "Keep gated, fix routing": nothing paid is
// opened; the headline ranks the US RTOs by the DCPI BUILD rate the scoreboard already gives
// every caller, dated by the DCPI run.
// No static import of server.mjs in the e2e block: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { usHeadroomHeadline, scopeScoreboardToUs, US_QUEUE_RTOS } from '../lib/us-headroom-headline.mjs';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

const AS_OF = '2026-11-09T08:46:58+00:00';
const row = (iso, build, total, asOf = AS_OF, extra = {}) => ({
  iso, country: iso.startsWith('EU_') ? 'EU' : 'US', renewable_share_pct: 30,
  dcpi_detail: { build_markets: build, total_markets: total,
                 build_rate_pct: total ? Math.round((build / total) * 1000) / 10 : null, as_of: asOf }, ...extra });

describe('usHeadroomHeadline (pure)', () => {
  const board = { grids: [
    { iso: 'EU_NO_2', country: 'EU', renewable_share_pct: 99.7 },
    row('SPP', 1, 12), row('ERCOT', 5, 10), row('PJM', 0, 60), row('ISO-NE', 0, 11),
    row('BPA', 3, 3), row('TVA', 2, 2),               // not queue-tool grids: never ranked
    row('MISO', 2, 39, null),                          // no DCPI date: listed as not ranked
  ] };

  it('ranks only the queue-tool US RTOs, by BUILD rate, each dated with a reason', () => {
    const h = usHeadroomHeadline(board);
    expect(h.rows.map((r) => r.iso)).toEqual(['ERCOT', 'SPP', 'ISO-NE', 'PJM']);
    for (const r of h.rows) {
      expect(US_QUEUE_RTOS).toContain(r.iso);
      expect(r.as_of).toBe(AS_OF);
      expect(r.pick_reason).toMatch(new RegExp(`^${r.build_markets} of ${r.total_markets} tracked DCPI markets in ${r.iso} read BUILD`));
    }
    expect(h.rows[0].pick_reason).toMatch(/highest BUILD rate/);
    expect(h.rows[1].pick_reason).not.toMatch(/highest/);
    expect(h.not_ranked).toEqual(['MISO']);
    expect(h.as_of).toBe(AS_OF);
    expect(h.ranked_by).toMatch(/not megawatts of headroom/);
  });

  it('the rate decides, not the count: 3 of 3 BUILD ranks above 5 of 50', () => {
    const h = usHeadroomHeadline({ grids: [row('PJM', 5, 50), row('SPP', 3, 3)] });
    expect(h.rows.map((r) => r.iso)).toEqual(['SPP', 'PJM']);
  });

  it('a plan held to an ISO set ranks only those grids', () => {
    expect(usHeadroomHeadline(board, ['PJM', 'ISONE']).rows.map((r) => r.iso)).toEqual(['ISO-NE', 'PJM']);
  });

  it('no US RTO row: null (the step is left as it was)', () => {
    expect(usHeadroomHeadline({ grids: [{ iso: 'EU_NO_2' }] })).toBeNull();
    expect(usHeadroomHeadline(null)).toBeNull();
  });

  it('scopes the step result to the headline order, as many rows as the slim kept, no foreign row', () => {
    const h = usHeadroomHeadline(board);
    const slim = { ok: true, grids: [{ iso: 'EU_NO_2' }], ranked_by: 'renewable_share_pct' };
    const out = scopeScoreboardToUs(slim, board, h);
    expect(out.grids.map((g) => g.iso)).toEqual(['ERCOT']);
    expect(out.grids[0].dcpi_detail).toEqual({ build_markets: 5, total_markets: 10, build_rate_pct: 50, as_of: AS_OF });
    expect(out.as_of).toBe(AS_OF);
    expect(out.us_headroom_headline).toBe(h);
    expect(scopeScoreboardToUs(slim, board, null)).toBe(slim);
  });
});

// ── end to end: the real server.mjs, a stub backend ─────────────────────────
describe('execute_plan US headroom end to end (real server.mjs on loopback)', () => {
  let H, fence;
  // EIA-shaped US mixes: SPP is the greenest US grid, so a greenest-first harvest picks it.
  const mix = (wnd) => ({ NG: { mw: 100 - wnd, period: '2026-11-09T07' }, WND: { mw: wnd, period: '2026-11-09T07' } });
  const wind = { SPP: 60, ERCOT: 20, PJM: 5, MISO: 30, CAISO: 25, NYISO: 15, 'ISO-NE': 10, BPA: 50, TVA: 5 };
  const dcpi = [
    { iso: 'ERCOT', build_count: 5, market_count: 10, latest_computed_at: AS_OF },
    { iso: 'SPP', build_count: 1, market_count: 12, latest_computed_at: AS_OF },
    { iso: 'PJM', build_count: 0, market_count: 60, latest_computed_at: AS_OF },
    { iso: 'MISO', build_count: 1, market_count: 39, latest_computed_at: AS_OF },
  ];
  const routes = (p) => {
    const g = p.match(/\/api\/v1\/grid\/intelligence\/([A-Za-z-]+)/);
    if (g && wind[g[1].toUpperCase()] != null) {
      return { status: 200, body: { iso: g[1].toUpperCase(), demand_mw: 1000, demand_period: '2026-11-09T07',
                                    generation_mix_period: '2026-11-09T07', generation_mix: mix(wind[g[1].toUpperCase()]) } };
    }
    // A greener non-US grid, so the worldwide greenest-first order leads with it.
    if (/\/api\/v1\/iso\/uk\/snapshot/.test(p)) {
      return { status: 200, body: { metrics: { generation_total_mw: 100, fuel_wind_mw: 97, fuel_gas_mw: 3, demand_mw: 100 } } };
    }
    if (/\/api\/v1\/dcpi\/iso-comparison/.test(p)) return { status: 200, body: { isos: dcpi } };
    return undefined;
  };
  async function call(tool, args) {
    const r = await H.call('/mcp', tool, args, { 'user-agent': 'test-client' });
    const sc = r.msg && r.msg.result && r.msg.result.structuredContent;
    const text = r.msg && r.msg.result && r.msg.result.content && r.msg.result.content[0] && r.msg.result.content[0].text;
    return sc || (text ? JSON.parse(text) : null);
  }

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: routes });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('headline is US-only, dated, with reasons, and the deep reads use its first grid', async () => {
    const o = await call('execute_plan', { intent: 'Which US grids have the most power headroom for a 100 MW data center launch?' });
    expect(o.intent_class).toBe('grid_headroom');
    expect(o.planner_version).toBe('5.18');
    const s1 = o.executed.find((e) => e.step === 1);
    expect(s1.tool).toBe('get_grid_scoreboard');
    expect(s1.result.grids.length).toBeGreaterThan(0);
    for (const g of s1.result.grids) expect(US_QUEUE_RTOS).toContain(g.iso);
    const h = s1.result.us_headroom_headline;
    expect(h.rows[0].iso).toBe('ERCOT');                   // BUILD rate, not the greenest (SPP)
    for (const r of h.rows) { expect(r.as_of).toBeTruthy(); expect(r.pick_reason).toBeTruthy(); }
    for (const e of o.executed.filter((x) => x.step > 1)) expect(e.args.iso).toBe('ERCOT');
    const ev = (o.power_evidence || []).find((x) => x.step === 1);
    expect(ev).toMatchObject({ tool: 'get_grid_scoreboard', ok: true, as_of: AS_OF });
    expect(String(o.answer_guide)).not.toMatch(/get_grid_scoreboard \(step 1\)/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);

  it('get_grid_scoreboard called directly stays the worldwide greenest-first ranking', async () => {
    const o = await call('get_grid_scoreboard', {});
    expect(o.grids[0].iso).toBe('NGESO');
    expect(o.us_headroom_headline).toBeUndefined();
  }, 120_000);
});
