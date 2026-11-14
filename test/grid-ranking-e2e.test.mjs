// ── execute_plan end to end: the US grid-headroom answer is a dated ranking (planner 5.18) ──
//
// The real server.mjs on loopback against a stub backend shaped like the live US grid feeds
// (test/helpers/us-grid-stub.mjs, measured 2026-11-09). Anonymous caller at 203.0.113.7, with the
// anonymous per-IP daily cap ON and the loopback address (127.0.0.1, where every plan step used to
// be counted) far over it — the live 11-09 condition that served the scoreboard step as a
// "3 of 46" over-cap preview with no US row.
//
// What fails here:
//   - a plan step counted against 127.0.0.1 instead of the caller (the scoreboard comes back
//     capped, the ranking loses its rows);
//   - no grid_ranking, a row without reason/value/ISO/as_of, or the ranking dated by anything but
//     its oldest row;
//   - answer_guide still calling the scoreboard step UNDATED, or not leading with the ranking;
//   - the deep read following the harvest order (NYISO here) instead of the ranking (SPP);
//   - a paid DCPI aggregate (queue wait, reserve margin) reaching the anonymous answer.
// Unit cases: test/grid-ranking.test.mjs. One scenario per file: the scoreboard is cached per
// process for 90 s.
// No static import of server.mjs here: the harness sets PORT before importing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { usGridRoutes, DCPI_OLDEST, PLANTED_QUEUE_WAIT, PLANTED_RESERVE_MARGIN } from './helpers/us-grid-stub.mjs';

const CALLER_IP = '203.0.113.7';
const LOOPBACK = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/;

describe('execute_plan: US grid headroom, anonymous (real server.mjs on loopback)', () => {
  let H, fence;
  const capReads = [];
  const grid = usGridRoutes();
  const routes = (p, req, body, u) => {
    if (p === '/api/v1/mcp/anon-usage') {
      const ip = u.searchParams.get('ip') || '';
      capReads.push(ip);
      return { status: 200, body: { ok: true, count: LOOPBACK.test(ip) ? 500 : 0 } };
    }
    return grid(p);
  };

  beforeAll(async () => {
    fence = fenceNetwork();
    H = await startHarness({ extraRoutes: routes, env: { DCHUB_ANON_DAILY_CAP: '20' } });
  }, 240_000);
  afterAll(async () => {
    if (H) await H.stop();
    if (fence) fence.restore();
  });

  it('answers with a dated, reasoned US ranking and deep-reads its top queue ISO', async () => {
    const r = await H.call('/mcp', 'execute_plan', { intent: 'where in the US is there grid headroom for a 100 MW data center' },
      { 'user-agent': 'test-client', 'x-dc-client-ip': CALLER_IP });
    const o = r.msg.result.structuredContent || JSON.parse(r.msg.result.content[0].text);
    expect(o.intent_class).toBe('grid_headroom');
    expect(o.planner_version).toBe('5.26');
    expect(o.executed.map((e) => e.tool)).toEqual(['get_grid_scoreboard', 'get_grid_intelligence', 'get_interconnection_queue']);

    // Every plan step was counted against the caller, none against the loopback.
    expect(capReads.length).toBeGreaterThanOrEqual(1);
    expect(capReads.filter((ip) => LOOPBACK.test(ip))).toEqual([]);
    expect(capReads).toContain(CALLER_IP);
    const sb = o.executed[0].result;
    expect(JSON.stringify(sb)).not.toMatch(/anon_daily_cap/);

    const g = o.grid_ranking;
    expect(g.rows.map((x) => [x.rank, x.iso])).toEqual([
      [1, 'SPP'], [2, 'CAISO'], [3, 'ERCOT'], [4, 'MISO'], [5, 'ISO-NE'], [5, 'NYISO'], [5, 'PJM'], [5, 'TVA']]);
    for (const x of g.rows) {
      expect(x.reason).toEqual(expect.objectContaining({ metric: 'dcpi_build_rate_pct', iso: x.iso, unit: '%' }));
      expect(typeof x.reason.value).toBe('number');
      expect(Date.parse(x.reason.as_of)).not.toBeNaN();
    }
    expect(g.rows[0].reason.text).toBe('12 of 12 DCPI-tracked markets in SPP rate BUILD (100%)');
    expect(g.as_of).toBe(DCPI_OLDEST.PJM);
    expect(g.not_ranked.map((x) => x.iso)).toEqual(['BPA']);

    // The scoreboard step is dated by the ranking; the guide leads with it.
    const ev = Object.fromEntries(o.power_evidence.map((x) => [x.tool, x]));
    expect(ev.get_grid_scoreboard).toMatchObject({ ok: true, as_of: DCPI_OLDEST.PJM });
    expect(ev.get_grid_scoreboard.as_of_basis).toMatch(/grid_ranking/);
    expect(o.answer_guide).not.toMatch(/get_grid_scoreboard \(step 1\) returned no as_of/);
    expect(o.answer_guide).toMatch(/LEAD WITH THE US GRID RANKING — DCPI BUILD rate by ISO, as of 2026-11-08: 1\. SPP 100%/);

    // The deep read follows the ranking (the harvest order alone reads NYISO on this stub).
    expect(o.executed[1].args.iso).toBe('SPP');
    expect(o.executed[2].args.iso).toBe('SPP');
    expect(g.deep_read).toEqual(expect.objectContaining({ iso: 'SPP' }));

    // Tier gating: the anonymous answer never shows a paid DCPI aggregate.
    const all = JSON.stringify(o);
    expect(all).not.toContain(String(PLANTED_QUEUE_WAIT));
    expect(all).not.toContain(String(PLANTED_RESERVE_MARGIN));
    // …and by name, so a leak that rounds the value is still caught.
    const PAID = /^(avg_)?(queue_wait_months|reserve_margin_pct)$/;
    const leaks = [];
    (function walk(v, path) {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (PAID.test(k) && typeof x === 'number') leaks.push(`${path}.${k}=${x}`);
          walk(x, `${path}.${k}`);
        }
      }
    })(o, '$');
    expect(leaks).toEqual([]);
    for (const x of g.rows.filter((y) => y.tie_break)) expect(x.tie_break).not.toHaveProperty('value');
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
