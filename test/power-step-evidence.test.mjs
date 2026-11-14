// ── execute_plan: every grid/power step names its grid and its data date (5.17) ──
//
// Owner priority 1, 2026-11-08. Live 11-08 05:19Z, anonymous, the #118011 run:
// get_dchub_recommendation said "Right now DC Hub ranks Midland–Odessa … BUILD"
// while its own provenance.as_of was null ("UNMEASURED"), and answer_guide led
// with that verdict. The fixtures below keep the live shapes of the fields read.
//
// What fails here:
//   - a power step with no as_of (or no ISO and no named source) passing as ok;
//   - answer_guide not naming that step first, or still leading with its verdict;
//   - a dated, sourced step (the live grid and DCPI shapes) flagged;
//   - non-power tools, or steps that never ran, being checked at all.
// Pure functions, no network. The executor half: test/market-outlook-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { _execPowerEvidence, _execUndatedSentence, _execAnswerGuide } from '../server.mjs';

const GRID = { step: 3, tool: 'get_grid_intelligence', status: 'gated_preview', args: { iso: 'ERCOT' },
  result: { iso: 'ERCOT', as_of: '2026-11-08T04:00:00Z',
            provenance: { source: 'EIA-930 hourly RTO/BA feed (ERCO) + DC Hub grid intelligence', as_of: '2026-11-08T04:00:00.000Z' } } };
const DCPI = { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'san-antonio' },
  result: { market_slug: 'san-antonio', market_name: 'San Antonio', iso: 'ERCOT', verdict: 'CAUTION', composite_score: 42.3,
            provenance: { source: 'Data Center Power Index (DCPI) — market_power_scores', as_of: '2026-11-08T05:13:51.781165+00:00' } } };
const RECO = { step: 2, tool: 'get_dchub_recommendation', status: 'executed', args: { context: 'What is the data center power outlook for San Antonio?' },
  result: { top_pocket: { market: 'Midland–Odessa', iso: 'ERCOT', verdict: 'BUILD' },
            provenance: { source: 'DC Hub', as_of: null, as_of_basis: 'UNMEASURED — this response carries no source timestamp.' } } };
const INTEL = { step: 4, tool: 'get_market_intel', status: 'executed', args: { market: 'san-antonio' }, result: {} };
const strip = (e, ...path) => { const c = structuredClone(e); let o = c.result; for (const k of path.slice(0, -1)) o = o[k]; delete o[path.at(-1)]; return c; };

describe('_execPowerEvidence', () => {
  it('passes the live dated, sourced grid and DCPI shapes', () => {
    const ev = _execPowerEvidence([DCPI, GRID]);
    expect(ev).toEqual([
      { step: 1, tool: 'get_market_dcpi_rank', iso: 'ERCOT', source: 'Data Center Power Index (DCPI) — market_power_scores', as_of: '2026-11-08T05:13:51.781165+00:00', ok: true },
      { step: 3, tool: 'get_grid_intelligence', iso: 'ERCOT', source: 'EIA-930 hourly RTO/BA feed (ERCO) + DC Hub grid intelligence', as_of: '2026-11-08T04:00:00Z', ok: true },
    ]);
  });

  it('flags the live recommendation shape: provenance.as_of null, generic source, no iso of its own', () => {
    const [r] = _execPowerEvidence([RECO]);
    expect(r).toMatchObject({ tool: 'get_dchub_recommendation', ok: false, missing: ['as_of', 'iso_or_source'], as_of: null });
  });

  it('flags a dated step once its as_of is removed (every place one is read)', () => {
    const noTop = strip(GRID, 'as_of');
    const noDate = strip(noTop, 'provenance', 'as_of');
    expect(_execPowerEvidence([noTop])[0].ok).toBe(true);           // provenance.as_of still dates it
    expect(_execPowerEvidence([noDate])[0]).toMatchObject({ ok: false, missing: ['as_of'] });
    expect(_execPowerEvidence([strip(DCPI, 'provenance', 'as_of')])[0]).toMatchObject({ ok: false, missing: ['as_of'] });
    const notADate = structuredClone(DCPI); notADate.result.provenance.as_of = 'UNMEASURED';
    expect(_execPowerEvidence([notADate])[0].ok).toBe(false);
  });

  it('flags a dated step with no ISO and no named source', () => {
    const e = { step: 1, tool: 'get_energy_prices', status: 'executed', args: {},
                result: { as_of: '2026-11-08T00:00:00Z', provenance: { source: 'DC Hub' } } };
    expect(_execPowerEvidence([e])[0]).toMatchObject({ ok: false, missing: ['iso_or_source'] });
  });

  it('reads the pre-slim result when the executor kept one', () => {
    const slim = { ...GRID, result: { truncated: true } };
    expect(_execPowerEvidence([slim])[0].ok).toBe(false);
    expect(_execPowerEvidence([slim], new Map([[slim, GRID.result]]))[0].ok).toBe(true);
  });

  it('ignores non-power tools and steps that did not run', () => {
    expect(_execPowerEvidence([INTEL, { ...RECO, status: 'skipped_unresolved' }, { ...GRID, status: 'failed' }])).toEqual([]);
  });
});

// Planner 5.24, live 11-13 20:55Z "Texas 50 MW power": the state-grain timeline step names its
// grid in iso_context and its feeds in sources.<lane>.feed, and answer_guide called it "UNDATED".
const TIMELINE = { step: 1, tool: 'get_power_availability_timeline', status: 'executed', args: { state: 'TX' },
  result: { state: 'TX', as_of: '2026-11-13T20:55:35Z', iso_context: ['ERCOT'],
            sources: { generator_retirements: { feed: 'EIA-860M planned retirements', vintage: '2026-08' },
                       interconnect_queue: { feed: 'ERCOT GIS Report; MISO GI Queue API; SPP GI active requests (DC Hub interconnect_queue)' },
                       planned_generators: { feed: 'EIA-860M monthly (planned + under-construction generators)', vintage: '2026-11-01' } },
            provenance: { source: 'DC Hub', as_of: '2026-11-13T05:53:06.054Z' } } };

describe('state-grain power step (get_power_availability_timeline, 5.24)', () => {
  it('reads the grid from a one-ISO iso_context and the source from the named feeds', () => {
    const [r] = _execPowerEvidence([TIMELINE]);
    expect(r).toMatchObject({ tool: 'get_power_availability_timeline', iso: 'ERCOT', ok: true });
    expect(r.source).toContain('EIA-860M planned retirements');
    expect(r.source).toContain('ERCOT GIS Report');
    expect(_execUndatedSentence([r])).toBe('');
  });

  it('names no grid for a multi-ISO state, but the feeds still source it', () => {
    const multi = structuredClone(TIMELINE); multi.result.iso_context = ['PJM', 'MISO'];
    const [r] = _execPowerEvidence([multi]);
    expect(r.iso).toBe(null);
    expect(r.ok).toBe(true);
  });

  it('is still flagged with no iso_context and no named feed', () => {
    const bare = structuredClone(TIMELINE); delete bare.result.iso_context; bare.result.sources = { x: { feed: 'DC Hub' }, y: null };
    expect(_execPowerEvidence([bare])[0]).toMatchObject({ ok: false, missing: ['iso_or_source'] });
    const arr = structuredClone(TIMELINE); delete arr.result.iso_context; arr.result.sources = ['EIA-860M'];
    expect(_execPowerEvidence([arr])[0]).toMatchObject({ ok: false, missing: ['iso_or_source'] });
  });
});

describe('answer_guide on an undated power step', () => {
  it('names it first and does not lead with its verdict', () => {
    const run = [DCPI, RECO];
    const ev = _execPowerEvidence(run);
    const s = _execUndatedSentence(ev);
    expect(s).toBe('UNDATED — get_dchub_recommendation (step 2) returned no as_of and no ISO or named source. '
      + 'Do not present those steps\' figures or verdicts as current; quote only dated steps, each with its as_of.');
    const g = _execAnswerGuide(run, ['ERCOT'], null, new Set(ev.filter((x) => !x.ok).map((x) => x.step)));
    expect(g).toMatch(/this run returned: san-antonio: CAUTION \(42\.3\)\./);
    expect(g).not.toMatch(/Midland/);
    // Without the skip the undated verdict would be led with: the skip is what holds it.
    expect(_execAnswerGuide(run, ['ERCOT'])).toMatch(/Midland–Odessa: BUILD/);
  });

  it('says nothing when every power step is dated', () => {
    expect(_execUndatedSentence(_execPowerEvidence([DCPI, GRID]))).toBe('');
  });
});
