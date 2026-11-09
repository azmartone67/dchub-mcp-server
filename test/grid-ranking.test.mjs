// ── planner 5.18: the US grid-headroom answer is a DATED ranking that says why ──
//
// Owner move 1, 2026-11-09. Live 08:22Z, anonymous, execute_plan "where in the US is there grid
// headroom for a 100 MW data center" (planner 5.17): answer_guide opened "UNDATED —
// get_grid_scoreboard (step 1) returned no as_of", the scoreboard's answer was the GLOBAL
// greenest-first fuel-mix order, and the deep read went to SPP for no stated reason.
//
// What fails here:
//   - a US row placed without a reason, value, ISO and as_of, or a non-US row ranked;
//   - a row with no DCPI aggregate (BPA) placed instead of listed in not_ranked;
//   - a tie broken with a number the caller's tier withholds (_locked_fields), or that number shown;
//   - the ranking dated when any ranked row is undated, or dated by anything but its OLDEST row;
//   - the scoreboard step dated in power_evidence by anything but a dated ranking of its own rows;
//   - a ranking emitted for a country/region scope or a non-headroom class;
//   - the deep read not taking the best-ranked queue ISO, or leaving the run's ISO constraint.
// Pure functions, no network. The executor half: test/grid-ranking-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { rankUsGrids, buildGridRanking, gridRankingGuideLine, topQueueIso, intentNamesNonUsRegion } from '../lib/grid-ranking.mjs';
import { _execPowerEvidence, _execUndatedSentence, _gridDeepReadIso, _scoreboardDcpiAsOf } from '../server.mjs';

const OLD = '2026-11-08T05:13:51+00:00';
const NEW = '2026-11-09T08:31:12+00:00';
const LOCKED = ['avg_queue_wait_months', 'avg_curtailment_pct', 'grid_emergencies_30d'];
// The anonymous dcpi_detail shape (_scoreboardForCaller): paid aggregates null + _locked_fields.
const dcpi = (b, m, asOf, extra = {}) => ({ avg_queue_wait_months: null, avg_curtailment_pct: null, build_markets: b, total_markets: m,
  build_rate_pct: m ? Math.round((b / m) * 1000) / 10 : null, grid_emergencies_30d: null, as_of: asOf, _locked_fields: LOCKED, ...extra });
const us = (iso, d) => ({ iso, region: iso, country: 'US', demand_mw: 1000, renewable_share_pct: 10, ...(d ? { dcpi_detail: d } : {}) });
const SB = () => ({
  grids: [
    { iso: 'EU_NO_2', region: 'Norway (NO2)', country: 'EU', renewable_share_pct: 99.7 },
    us('BPA', null),
    us('SPP', dcpi(12, 12, NEW)),
    us('NYISO', dcpi(0, 10, NEW)),
    us('MISO', dcpi(2, 39, NEW)),
    us('CAISO', dcpi(2, 14, NEW)),
    us('ISO-NE', dcpi(0, 11, NEW)),
    us('ERCOT', dcpi(1, 19, NEW)),
    us('TVA', dcpi(0, 7, NEW)),
    us('PJM', dcpi(0, 64, OLD)),
  ],
  provenance: { source: 'DC Hub — US: EIA hourly RTO (live, ranked)', as_of: null },
});
const step1 = (sb = SB()) => ({ step: 1, tool: 'get_grid_scoreboard', status: 'executed', args: {}, result: sb });
const CTX = { intent: 'where in the US is there grid headroom for a 100 MW data center', intent_class: 'grid_headroom' };

describe('rankUsGrids', () => {
  it('ranks only US rows by DCPI BUILD rate, each with reason, value, ISO and as_of', () => {
    const { rows, not_ranked: nr } = rankUsGrids(SB());
    expect(rows.map((r) => [r.rank, r.iso])).toEqual([
      [1, 'SPP'], [2, 'CAISO'], [3, 'ERCOT'], [4, 'MISO'], [5, 'ISO-NE'], [5, 'NYISO'], [5, 'PJM'], [5, 'TVA']]);
    expect(rows[0].reason).toEqual({ metric: 'dcpi_build_rate_pct', value: 100, unit: '%', build_markets: 12, tracked_markets: 12,
      text: '12 of 12 DCPI-tracked markets in SPP rate BUILD (100%)', iso: 'SPP',
      source: 'DC Hub Data Center Power Index (DCPI), per-ISO aggregate', as_of: NEW });
    expect(rows.find((r) => r.iso === 'PJM').reason.as_of).toBe(OLD);
    expect(rows.some((r) => r.iso === 'EU_NO_2')).toBe(false);
    expect(nr).toEqual([expect.objectContaining({ iso: 'BPA' })]);
    expect(nr[0].why).toMatch(/No DCPI per-ISO aggregate/);
  });

  it('a withheld tie-break is named without its number and the tied rows share a rank', () => {
    const tied = rankUsGrids(SB()).rows.filter((r) => r.reason.value === 0);
    expect(tied.map((r) => r.rank)).toEqual([5, 5, 5, 5]);
    for (const r of tied) {
      expect(r.tie_break).toEqual(expect.objectContaining({ metric: 'dcpi_avg_queue_wait_months', withheld: true }));
      expect(r.tie_break).not.toHaveProperty('value');
      expect(r.tied_with).toHaveLength(3);
    }
  });

  it('a tier that shows the queue wait breaks the tie with it, shortest first', () => {
    const sb = SB();
    const wait = { 'ISO-NE': 30, NYISO: 12, PJM: 55, TVA: 20 };
    for (const g of sb.grids) if (wait[g.iso] != null) g.dcpi_detail = { ...g.dcpi_detail, avg_queue_wait_months: wait[g.iso], _locked_fields: [] };
    const tied = rankUsGrids(sb).rows.filter((r) => r.reason.value === 0);
    expect(tied.map((r) => [r.rank, r.iso, r.tie_break.value])).toEqual([[5, 'NYISO', 12], [6, 'TVA', 20], [7, 'ISO-NE', 30], [8, 'PJM', 55]]);
    expect(tied.every((r) => !r.tied_with)).toBe(true);
  });

  it('a locked or missing BUILD rate is not placed', () => {
    const sb = SB();
    sb.grids.find((g) => g.iso === 'SPP').dcpi_detail = dcpi(12, 12, NEW, { build_rate_pct: null, build_markets: null, _locked_fields: [...LOCKED, 'build_rate_pct'] });
    const { rows, not_ranked: nr } = rankUsGrids(sb);
    expect(rows.some((r) => r.iso === 'SPP')).toBe(false);
    expect(nr.map((x) => x.iso)).toContain('SPP');
  });
});

describe('buildGridRanking', () => {
  it('dates the ranking by its OLDEST row and hands that date to the scoreboard step', () => {
    const e = step1();
    const r = buildGridRanking(CTX, [e], null);
    expect(r.block.as_of).toBe(OLD);
    expect(r.block.as_of_basis).toMatch(/^Oldest per-row date among the 8 ranked US grids/);
    expect(r.block.source).toBe('DC Hub (dchub.cloud/dcpi), DC Hub Data Center Power Index (DCPI), per-ISO aggregate, as of 2026-11-08');
    expect(r.evidence).toMatchObject({ entry: e, as_of: OLD });
    const ev = _execPowerEvidence([e], null, new Map([[r.evidence.entry, r.evidence]]));
    expect(ev[0]).toMatchObject({ tool: 'get_grid_scoreboard', ok: true, as_of: OLD });
    expect(ev[0].as_of_basis).toMatch(/grid_ranking/);
    expect(_execUndatedSentence(ev)).toBe('');
  });

  it('one undated ranked row leaves the whole ranking undated and the step UNDATED', () => {
    const sb = SB();
    sb.grids.find((g) => g.iso === 'TVA').dcpi_detail.as_of = null;
    const e = step1(sb);
    const r = buildGridRanking(CTX, [e], null);
    expect(r.block.as_of).toBeNull();
    expect(r.block.as_of_basis).toMatch(/^UNMEASURED: 1 of 8 ranked grids carry no DCPI date \(TVA\)/);
    expect(r.evidence).toBeNull();
    expect(gridRankingGuideLine(r.block)).toBe('');
    const ev = _execPowerEvidence([e], null, null);
    expect(ev[0]).toMatchObject({ ok: false, missing: ['as_of'] });
    expect(_execUndatedSentence(ev)).toMatch(/^UNDATED — get_grid_scoreboard \(step 1\) returned no as_of/);
  });

  it('the backend shape before oldest_computed_at: every row undated, nothing dated', () => {
    const sb = SB();
    for (const g of sb.grids) if (g.dcpi_detail) g.dcpi_detail.as_of = null;
    const r = buildGridRanking(CTX, [step1(sb)], null);
    expect(r.block.rows).toHaveLength(8);
    expect(r.block.as_of).toBeNull();
    expect(r.evidence).toBeNull();
  });

  it('a derived date never overrides a step that is dated itself, and needs a real date', () => {
    const e = step1(); e.result.provenance.as_of = '2026-11-09T09:00:00Z';
    expect(_execPowerEvidence([e], null, new Map([[e, { as_of: OLD, as_of_basis: 'x' }]]))[0])
      .toEqual(expect.objectContaining({ as_of: '2026-11-09T09:00:00Z', ok: true }));
    expect(_execPowerEvidence([e], null, new Map([[e, { as_of: OLD }]]))[0]).not.toHaveProperty('as_of_basis');
    const f = step1();
    expect(_execPowerEvidence([f], null, new Map([[f, { as_of: 'UNMEASURED', as_of_basis: 'x' }]]))[0]).toMatchObject({ ok: false });
  });

  it('is emitted only for a US-scoped grid_headroom run that read the scoreboard', () => {
    expect(buildGridRanking({ ...CTX, intent_class: 'market_ranking' }, [step1()], null)).toBeNull();
    expect(buildGridRanking({ ...CTX, geography_scope: { countries: ['DE'] } }, [step1()], null)).toBeNull();
    expect(buildGridRanking({ ...CTX, intent: 'where in Europe is there grid headroom' }, [step1()], null)).toBeNull();
    expect(buildGridRanking(CTX, [{ ...step1(), status: 'failed' }], null)).toBeNull();
    expect(buildGridRanking({ ...CTX, intent: 'grid headroom in New Mexico or anywhere in the US' }, [step1()], null)).not.toBeNull();
    expect(intentNamesNonUsRegion('headroom in New Mexico')).toBe(false);
    expect(intentNamesNonUsRegion('headroom in Mexico')).toBe(true);
  });

  it('reads the pre-slim result and reports a trimmed scoreboard as a preview', () => {
    const e = { ...step1(), result: { truncated: true } };
    const full = { ...SB(), _grids_total_available: 46 };
    const r = buildGridRanking(CTX, [e], new Map([[e, full]]));
    expect(r.block.rows).toHaveLength(8);
    expect(r.block.preview).toEqual(expect.objectContaining({ scoreboard_rows_shown: 10, scoreboard_rows_total: 46, us_rows_shown: 9 }));
  });

  it('the guide line names every ranked grid with its value and the ranking date', () => {
    const line = gridRankingGuideLine(buildGridRanking(CTX, [step1()], null).block);
    expect(line).toMatch(/^LEAD WITH THE US GRID RANKING — DCPI BUILD rate by ISO, as of 2026-11-08: 1\. SPP 100% \(12\/12 markets BUILD\); 2\. CAISO 14\.3%/);
    expect(line).toMatch(/5\. PJM 0% \(0\/64 markets BUILD\)/);
    expect(line).toMatch(/not a MW availability figure/);
  });
});

describe('deep read follows the ranking', () => {
  it('puts the best-ranked queue ISO first in the iso mints', () => {
    const minted = { iso: ['MISO', 'SPP', 'NYISO'] };
    const sc = { intent: CTX.intent, intent_class: 'grid_headroom' };
    expect(_gridDeepReadIso(sc, 'get_grid_scoreboard', SB(), [], minted, 3)).toBe('SPP');
    expect(minted.iso).toEqual(['SPP', 'MISO', 'NYISO']);
  });

  it('skips a top row the queue tools do not cover, and stays inside the ISO constraint', () => {
    const sb = SB();
    sb.grids.find((g) => g.iso === 'TVA').dcpi_detail = dcpi(7, 7, NEW);   // TVA ranks first, not a queue ISO
    sb.grids.find((g) => g.iso === 'SPP').dcpi_detail = dcpi(5, 12, NEW);
    expect(rankUsGrids(sb).rows[0].iso).toBe('TVA');
    expect(topQueueIso(sb, [])).toBe('SPP');
    expect(topQueueIso(sb, ['ERCOT', 'MISO'])).toBe('ERCOT');
    expect(topQueueIso(sb, ['ISO-NE'])).toBe('ISONE');
  });

  it('leaves the mints alone outside a US grid_headroom scoreboard step', () => {
    const minted = { iso: ['MISO'] };
    expect(_gridDeepReadIso({ intent: CTX.intent, intent_class: 'interconnection_queue' }, 'get_grid_scoreboard', SB(), [], minted)).toBeNull();
    expect(_gridDeepReadIso({ intent: CTX.intent, intent_class: 'grid_headroom' }, 'get_grid_intelligence', SB(), [], minted)).toBeNull();
    expect(_gridDeepReadIso({ intent: CTX.intent, intent_class: 'grid_headroom', geography_scope: {} }, 'get_grid_scoreboard', SB(), [], minted)).toBeNull();
    expect(minted.iso).toEqual(['MISO']);
  });
});

describe('_scoreboardDcpiAsOf', () => {
  it('dates a DCPI aggregate by its oldest market score, never its newest', () => {
    expect(_scoreboardDcpiAsOf({ oldest_computed_at: OLD, latest_computed_at: NEW })).toEqual(
      { as_of: OLD, as_of_basis: expect.stringMatching(/oldest market score/) });
    expect(_scoreboardDcpiAsOf({ latest_computed_at: NEW }).as_of).toBeNull();
    expect(_scoreboardDcpiAsOf({ oldest_computed_at: 'n/a' }).as_of).toBeNull();
  });
});
