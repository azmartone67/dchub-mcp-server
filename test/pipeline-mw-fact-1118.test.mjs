// The pipeline fact reads the rows /api/v1/pipeline actually returns (`capacity`, `project`), and a preview's
// nulled capacity is said as withheld. Fixtures are trimmed from live responses on 2026-11-18 (market=abilene keyed;
// state=TX keyless preview), Grok weekly competitor brief 2026-11-18. The MCP wrapper's citation.as_of dates the step.
import { describe, it, expect } from 'vitest';
import { factsFromStep, MW_NOT_HELD, PIPELINE_MW_WITHHELD } from '../lib/plan-step-facts.mjs';

const ROW = { company: 'Oracle/OpenAI', market: 'Abilene, TX', project: 'Stargate Abilene Expansion +600MW', status: 'construction', expected_cod: null };
const KEYED = { success: true, data: [{ ...ROW, capacity: 600.0 }], pipeline: [{ ...ROW, capacity: 600.0 }], count: 1, total_count: 1, last_updated: '2026-11-18T17:35:10.555966',
  citation: { as_of: '2026-11-18T17:35:10.555966' } };
const PREVIEW = { success: true, preview_is_partial: true, trial_preview: true, count: null, total_count: null,
  data: [{ ...ROW, project: 'Frontier Campus 1.4 GW', capacity: null }, { ...ROW, capacity: null }, { ...ROW, project: 'Stargate Texas Site 2', capacity: null }],
  _data_total_available: 6, last_updated: '2026-11-18T17:35:10.555966',
  citation: { as_of: '2026-11-18T17:35:10.555966' } };

describe('get_pipeline fact: live row shape', () => {
  it('reads `capacity` on a full row (was "MW not held" for 600 MW)', () => {
    const f = factsFromStep('get_pipeline', KEYED, { market: 'abilene', state: 'TX' });
    expect(f[0].text).toBe('abilene data-center pipeline: 1 project on record, 600 MW across the project that state a size (DC Hub pipeline, as of 2026-11-18).');
    expect(f[0].text).not.toContain(MW_NOT_HELD);
  });
  it('names the first match from `project` when the step searched by name', () => {
    const f = factsFromStep('get_pipeline', KEYED, { query: 'Stargate Abilene' });
    expect(f[0].text).toMatch(/First match: Stargate Abilene Expansion \+600MW \(construction\)\.$/);
  });
  it('a preview says withheld, not not held, and counts the full list', () => {
    const f = factsFromStep('get_pipeline', PREVIEW, { state: 'TX' });
    expect(f[0].text).toBe(`TX data-center pipeline: 6 projects on record; ${PIPELINE_MW_WITHHELD} for them (DC Hub pipeline, as of 2026-11-18).`);
  });
  it('reported rows (be#9030) are counted apart and their MW is never summed', () => {
    const rep = (mw, url) => ({ ...ROW, company: 'Microsoft', market: 'Texas', capacity: mw, confidence: 'reported', source_url: url });
    const MIXED = { ...KEYED, data: [{ ...ROW, capacity: 600.0, confidence: 'curated' }, rep(2670, 'https://x/1'), rep(1200, 'https://x/2')],
      pipeline: undefined, total_count: 3, confidence_coverage: { curated: 1, reported: 2 } };
    const f = factsFromStep('get_pipeline', MIXED, { state: 'TX' });
    expect(f[0].text).toBe('TX data-center pipeline: 1 curated project on record, 600 MW across the project that state a size; '
      + '2 more reported in linked news articles (each with its source; MW as the article states it, not summed) (DC Hub pipeline, as of 2026-11-18).');
    const only = factsFromStep('get_pipeline', { ...MIXED, data: [rep(2670, 'https://x/1')], total_count: 1, confidence_coverage: { curated: 0, reported: 1 } }, { state: 'TX' });
    expect(only[0].text).toBe('TX data-center pipeline: 0 curated projects on record, 1 more reported in linked news articles (each with its source; MW as the article states it, not summed) (DC Hub pipeline, as of 2026-11-18).');
  });
  it('a full row with no stated size still says MW not held', () => {
    const f = factsFromStep('get_pipeline', { ...KEYED, data: [{ ...ROW, capacity: null }], pipeline: undefined }, { market: 'abilene' });
    expect(f[0].text).toContain(`${MW_NOT_HELD} for it`);
  });
});
