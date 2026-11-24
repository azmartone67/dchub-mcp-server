// asof-phoenix-answer-lines-1123.test.mjs — execute_plan answer lines say the America/Phoenix day.
//
// The daily head-to-head QA run of 2026-11-23 17:40 America/Phoenix (00:40Z on 11-24) read headlines "(as of
// 2026-11-23)" beside lines that said the UTC day of the same reads:
//   * "ASHBURN DCPI verdict: AVOID (20) (DCPI, as of 2026-11-24)"   (computed_at 2026-11-24T00:31Z)
//   * the capacity_grid shortlist "DCPI verdicts read 2026-11-24"   (citation.retrieved_at, the serve clock)
//   * "(DC Hub pipeline, as of 2026-11-24)"                         (a serve-time as_of)
//   * the market_ranking lead "Source: DC Hub (dchub.cloud), as of 2026-11-23T04:00:00.000Z" (the raw stamp)
// Each line now goes through lib/cite-day.mjs (spokenDay -> phoenixDay): a day, never a time or a "Z", never the
// UTC date. Pure; no network.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { factsFromStep } from '../lib/plan-step-facts.mjs';
import { buildCrossDomainAnswer, marketIntelFact } from '../lib/cross-domain-answer.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';
import { pairLines } from '../lib/plan-pairs.mjs';
import { spokenDay } from '../lib/cite-day.mjs';

const SERVE = '2026-11-24T00:40:00Z';          // 17:40 on 2026-11-23 in America/Phoenix
const UTC_DAY = '2026-11-24';
const TIME_OR_Z = /\d{4}-\d{2}-\d{2}T|\dZ\b/;
const clean = (s) => {
  expect(typeof s).toBe('string');
  expect(s).not.toContain(UTC_DAY);
  expect(s).not.toMatch(TIME_OR_Z);
};

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(SERVE)); });
afterAll(() => { vi.useRealTimers(); });

describe('spokenDay', () => {
  it('a timestamp is its Phoenix day; a date stays that date; junk is null', () => {
    expect(spokenDay('2026-11-24T00:31:05.118989+00:00')).toBe('2026-11-23');
    expect(spokenDay('2026-11-24T00:40:00Z')).toBe('2026-11-23');
    expect(spokenDay('2026-11-24 00:40:00')).toBe('2026-11-23');   // no zone: read as UTC, the backend's convention
    expect(spokenDay('2026-11-23')).toBe('2026-11-23');
    expect(spokenDay('2026-11-23T18:00:00Z')).toBe('2026-11-23');
    expect(spokenDay('soon')).toBeNull();
    expect(spokenDay(null)).toBeNull();
  });
});

describe('the DCPI evidence line', () => {
  for (const [slug, name, verdict, score] of [['northern-virginia', 'ASHBURN', 'AVOID', 20], ['atlanta', 'Atlanta', 'CAUTION', 48],
    ['chicago', 'Chicago', 'CAUTION', 51], ['phoenix', 'Phoenix', 'CAUTION', 43.5]]) {
    it(`${name}: computed 00:31Z on 11-24 reads as of 2026-11-23`, () => {
      const p = { market_name: name, market_slug: slug, verdict, composite_score: score, computed_at: '2026-11-24T00:31:05.118989+00:00',
        provenance: { as_of: '2026-11-24T00:31:05.118989+00:00', retrieved_at: '2026-11-24T00:40:22.208Z' } };
      const [f] = factsFromStep('get_market_dcpi_rank', p, { market_slug: slug });
      expect(f.text).toBe(`${name} DCPI verdict: ${verdict} (${score}) (DCPI, as of 2026-11-23).`);
      clean(f.text);
      expect(f.as_of).toBe('2026-11-24');   // the machine field is unchanged
    });
  }
});

describe('the paired-sides DCPI line', () => {
  it('a DCPI step computed 00:31Z on 11-24 reads as of 2026-11-23', () => {
    const p = { market_name: 'Phoenix', market_slug: 'phoenix', verdict: 'CAUTION', composite_score: 43.5, computed_at: '2026-11-24T00:31:05.118989+00:00' };
    const ps = pairLines([{ step: 1, tool: 'get_market_dcpi_rank', args: { market_slug: 'phoenix' }, status: 'executed', result: p }], (e) => e.result);
    expect(ps.data_center.line).toContain('verdict CAUTION, composite score 43.5 (as of 2026-11-23)');
    clean(ps.data_center.line);
    expect(ps.data_center.as_of).toBe('2026-11-24');   // the machine field is unchanged
  });
});

describe('the pipeline line', () => {
  it('a serve-time as_of reads the Phoenix day', () => {
    const p = { as_of: SERVE, total: 2, projects: [{ project: 'A', capacity: 300 }, { project: 'B', capacity: 120 }] };
    const [f] = factsFromStep('get_pipeline', p, { state: 'AZ' });
    expect(f.text).toContain('(DC Hub pipeline, as of 2026-11-23)');
    clean(f.text);
    expect(f.as_of).toBe('2026-11-24');   // the machine field is unchanged
  });
  it('a data as_of of 2026-11-23 stays 2026-11-23', () => {
    const [f] = factsFromStep('get_pipeline', { as_of: '2026-11-23', total: 1, projects: [{ project: 'A', capacity: 300 }] }, { state: 'AZ' });
    expect(f.text).toContain('(DC Hub pipeline, as of 2026-11-23)');
    clean(f.text);
  });
});

describe('the cross-domain DCPI line from market intel', () => {
  it('siting.dcpi.as_of 00:34Z on 11-24 reads as of 2026-11-23', () => {
    const [, f] = marketIntelFact({ tool: 'get_market_intel', step: 1, args: { market: 'northern-virginia' },
      p: { market: { name: 'Ashburn' }, as_of: '2026-11-23', stats: { facility_count: 587 }, siting: { dcpi: { verdict: 'AVOID', as_of: '2026-11-24T00:34:29Z' } } } });
    expect(f.text).toBe('Ashburn Data Center Power Index (DCPI) verdict: AVOID (as of 2026-11-23).');
    expect(f.short).toBe('DCPI AVOID (as of 2026-11-23)');
    expect(f.as_of).toBe('2026-11-24');
  });
});

describe('the capacity_grid "DCPI verdicts read" line', () => {
  const QA = 'Where can I get 50 MW of colocation or powered capacity with power in under 24 months in the US, and what do grid headroom and the interconnection queue look like there?';
  const canvas = { ok: true, max_months_applied: false,
    citation: { retrieved_at: '2026-11-24T00:40:12.553Z' },
    shortlist: [
      { market: 'Midland–Odessa', state: 'TX', iso: 'ERCOT', verdict: 'BUILD', time_to_power_months: null, _time_to_power_months_withheld: true },
      { market: 'Williston, ND', state: 'ND', iso: 'MISO', verdict: 'BUILD', time_to_power_months: null, _time_to_power_months_withheld: true },
    ] };
  const queue = (iso) => ({ ok: true, iso, as_of: '2026-11-23', taste: { headline: { name: 'queued_generation_gw', value: 300, unit: 'GW' } } });
  const grid = (iso) => ({ ok: true, iso, as_of: '2026-11-23T18:00:00Z', taste: { headline: { name: 'demand_mw', value: 50000, unit: 'MW', as_of: '2026-11-23T18:00:00Z' } } });
  const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
  const executed = [
    ex(1, 'site_selection_canvas', { capacity_mw: 50, max_months: 24 }, canvas),
    ex(2, 'get_interconnection_queue', { iso: 'ERCOT' }, queue('ERCOT')),
    ex(2, 'get_interconnection_queue', { iso: 'MISO' }, queue('MISO')),
    ex(3, 'get_grid_intelligence', { iso: 'ERCOT' }, grid('ERCOT')),
    ex(3, 'get_grid_intelligence', { iso: 'MISO' }, grid('MISO')),
  ];
  const ia = buildCrossDomainAnswer({ intent: QA, intent_class: 'capacity_grid', requested_mw: 50, deadline_months: 24 },
    executed, new Map(executed.map((e) => [e, e.result])));

  it('each finalist row says the Phoenix day the verdicts were read', () => {
    const rows = ia.evidence.filter((e) => /site-selection shortlist/.test(e));
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r).toContain('DCPI verdicts read 2026-11-23');
      clean(r);
    }
    const row = ia.facts.find((f) => f.tool === 'site_selection_canvas');
    expect(row.collected_at).toBe('2026-11-24');   // the machine field is unchanged
  });
  it('no answer line (headline, evidence, facts) says the UTC day or a time', () => {
    clean(ia.headline);
    for (const e of ia.evidence) clean(e);
    for (const f of ia.facts) clean(f.text);
  });
});

describe('the market_ranking Source line', () => {
  const plan = {
    _entity: 'plan_execution', intent: 'rank the best US markets for a 100 MW AI campus',
    fact_header: 'SOURCE: DC Hub (dchub.cloud) | AS_OF: 2026-11-23T04:00:00.000Z\nENTITY: US\nSUMMARY: ranked markets',
    ranked_answer: { headline: 'Best checked market: Abilene, TX, DCPI BUILD (71.2).' },
    executed: [],
  };
  it('prints the Phoenix day of the stamp, never the stamp', () => {
    const lead = planLeadText(plan);
    // 04:00Z on 11-23 is 21:00 on 11-22 in America/Phoenix.
    expect(lead).toContain('Source: DC Hub (dchub.cloud), as of 2026-11-22.');
    clean(lead);
  });
  it('a serve-clock stamp at 00:40Z reads the Phoenix day, not 2026-11-24', () => {
    const lead = planLeadText({ ...plan, fact_header: `SOURCE: DC Hub (dchub.cloud) | AS_OF: ${SERVE}` });
    expect(lead).toContain('Source: DC Hub (dchub.cloud), as of 2026-11-23.');
    clean(lead);
  });
  it('the machine field keeps the stamp', () => {
    planLeadText(plan);
    expect(plan.fact_header).toContain('AS_OF: 2026-11-23T04:00:00.000Z');
  });
});
