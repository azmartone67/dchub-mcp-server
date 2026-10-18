// Contract tests for intent_answer (MCP leadership plan item 2): one block per intent family.
// Fixtures are trimmed from real anonymous execute_plan envelopes read from prod 2026-10-18.
import { describe, it, expect } from 'vitest';
import { buildIntentAnswer, attachIntentRelay, classifyIntentAnswer, askedMarket } from '../lib/intent-answers.mjs';

const NOW = Date.parse('2026-10-18T01:00:00Z');
const step = (tool, args, p, status = 'executed') => ({ tool, args, status, result: p });
const queue = (asOf, total = 1433) => step('get_refined_queue', { iso: 'ERCOT' }, {
  count_total_matching: total, source_as_of: asOf, freshness_by_iso: { ERCOT: { source_as_of: asOf } },
  results: [{ estimated_ttp_months: null }], citation: { as_of: asOf }, provenance: { as_of: asOf } });
const retire = step('get_retirement_headroom', {}, { _total_available: 1, total_retiring_mw: null, meta: { baseline_age: '2026-07' } });
const grid = step('get_grid_intelligence', { iso: 'ERCOT' }, {
  iso: 'ERCOT', as_of: '2026-10-18T00:00:00Z', citation: { as_of: '2026-10-18T00:00:00Z' },
  taste: { band: { constraint: 'BUILD', excess_power: 'BUILD' } } });
const dcpi = (slug, v, sc) => step('get_market_dcpi_rank', { market_slug: slug }, { verdict: v, composite_score: sc, market_slug: slug, as_of: '2026-10-17' });
const ctx = (intent, intent_class, extra = {}) => ({ intent, intent_class, constraint_iso: [], resolution_gap: null, ...extra });
const skipped = { tool: 'get_market_dcpi_rank', status: 'skipped_unresolved', missing: 'market_slug' };

describe('classification', () => {
  it('routes the three families and leaves others alone', () => {
    expect(classifyIntentAnswer('how soon can I get 100 MW of power in ERCOT', 'capacity_search')).toBe('power_timing');
    expect(classifyIntentAnswer('find a site for a 150 MW data center in Ohio', 'capacity_search')).toBe('siting');
    expect(classifyIntentAnswer('is Columbus a good market for a data center', 'market_ranking')).toBe('market_check');
    expect(classifyIntentAnswer('rank markets for a 200 MW AI campus', 'market_ranking')).toBe(null);
    expect(classifyIntentAnswer('what changed this week', 'changes_delta')).toBe(null);
  });
  it('extracts the asked market', () => {
    expect(askedMarket('is Columbus a good market for a data center')).toBe('columbus');
    expect(askedMarket('Should I build a data center in Northern Virginia?')).toBe('northern virginia');
    expect(askedMarket('find a site for 150 MW')).toBe(null);
  });
});

describe('power timing', () => {
  const ex = [retire, queue('2026-08-31'), grid, skipped];
  const a = buildIntentAnswer(ctx('how soon can I get 100 MW of power in ERCOT', 'capacity_search', { constraint_iso: ['ERCOT'] }), ex, null, NOW);
  it('says time-to-power is not measurable instead of guessing a number', () => {
    expect(a.kind).toBe('power_timing');
    expect(a.headline).toContain('not measurable from this run');
    expect(a.headline).toContain('ERCOT (ISO-level) DCPI BUILD');
  });
  it('labels the band ISO-level and never as a market verdict', () => {
    expect(a.verdict).toMatchObject({ value: 'BUILD', scope: 'iso', subject: 'ERCOT' });
  });
  it('names the stale queue and dates the answer by its oldest input', () => {
    expect(a.not_established.join(' ')).toContain('queue data is 48 days old');
    expect(a.as_of).toBe('2026-08-31');
  });
  it('source is the LAST key and is a dated Source line', () => {
    expect(Object.keys(a).pop()).toBe('source');
    expect(a.source).toMatch(/^Source: DC Hub \(dchub\.cloud\/[^)]*\)(, as of \d{4}-\d{2}-\d{2}.*)?$/);
  });
});

describe('siting', () => {
  const hc = step('get_hosting_capacity', {}, { capacity_by_type: { load: { max_mw: 18 } } });
  const gap = { kind: 'unmapped', phrase: 'ohio' };
  const ex = [retire, queue('2026-10-17', 229), hc, skipped];
  const a = buildIntentAnswer(ctx('find a site for a 150 MW data center in Ohio', 'capacity_search', { constraint_iso: ['PJM'], resolution_gap: gap }), ex, null, NOW);
  it('produces no verdict when no DCPI read ran, and says so', () => {
    expect(a.kind).toBe('siting');
    expect(a.verdict).toBe(null);
    expect(a.not_established.join(' ')).toContain('No BUILD/CAUTION/AVOID');
  });
  it('flags a 150 MW ask against an 18 MW feeder ceiling', () => {
    expect(a.not_established.join(' ')).toContain('multi-feeder or transmission-level');
  });
  it('flags geography the index could not bind', () => {
    expect(a.not_established.join(' ')).toContain('"ohio" is outside the tracked geography index');
  });
  it('a DCPI read for the geography becomes a market verdict', () => {
    const b = buildIntentAnswer(ctx('find a site for a 150 MW data center in Ohio', 'capacity_search'), [...ex, dcpi('columbus-oh', 'BUILD', 71.2)], null, NOW);
    expect(b.verdict).toMatchObject({ value: 'BUILD', scope: 'market', subject: 'columbus-oh', composite_score: 71.2 });
  });
});

describe('market check', () => {
  const q = 'is Columbus a good market for a data center';
  const wrong = [step('site_selection_canvas', { region: 'OH' }, { ok: true }), dcpi('canton', 'AVOID', 30.1), dcpi('akron', 'AVOID', 30), grid];
  it('does NOT report Canton/Akron AVOID as the Columbus verdict (live 2026-10-18 mis-binding)', () => {
    const a = buildIntentAnswer(ctx(q, 'market_ranking'), wrong, null, NOW);
    expect(a.verdict).toBe(null);
    expect(a.headline).toContain('Columbus was not DCPI-checked');
    expect(a.headline).toContain('canton, akron');
    expect(JSON.stringify(a)).not.toMatch(/Columbus[^.]*AVOID/);
  });
  it('reports the verdict when the asked market was checked', () => {
    const a = buildIntentAnswer(ctx(q, 'market_ranking'), [dcpi('columbus-oh', 'BUILD', 71.2), dcpi('canton', 'AVOID', 30.1)], null, NOW);
    expect(a.verdict).toMatchObject({ value: 'BUILD', scope: 'market', subject: 'columbus-oh', composite_score: 71.2 });
    expect(a.headline).toBe('Columbus: DCPI BUILD (71.2).');
    expect(a.source).toContain('dchub.cloud/markets/columbus-oh');
  });
});

describe('relay + safety', () => {
  const base = { structuredContent: { human_url: 'https://dchub.cloud/upgrade/h/abc', human_message: 'm', intent_answer: { kind: 'siting', relay: null, source: 'Source: DC Hub (dchub.cloud)' } } };
  it('copies the existing link, keeps source last', () => {
    const r = attachIntentRelay(base).structuredContent.intent_answer;
    expect(r.relay.url).toBe('https://dchub.cloud/upgrade/h/abc');
    expect(Object.keys(r).pop()).toBe('source');
  });
  it('mints nothing when the response has no link', () => {
    const r = attachIntentRelay({ structuredContent: { intent_answer: { relay: null, source: 's' } } });
    expect(r.structuredContent.intent_answer.relay).toBe(null);
  });
  it('returns null on garbage and on no executed steps', () => {
    expect(buildIntentAnswer(null, null, null, NOW)).toBe(null);
    expect(buildIntentAnswer(ctx('how soon can I get 100 MW in ERCOT', 'capacity_search'), [skipped], null, NOW)).toBe(null);
  });
});
