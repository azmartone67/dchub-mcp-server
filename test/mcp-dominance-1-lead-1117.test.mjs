// mcp-dominance-1-lead-1117.test.mjs — Grok MCP-dominance evals (2026-11-17, server 2.12.59, planner 5.32), gap 2
// plus the lead side of gaps 5 and 8: the execute_plan lead reads what every step returned.
//
//   gap 2: a site_analysis lead said "no BUILD/CAUTION/AVOID verdict was produced" while analyze_site's
//          site_teaser.verdict was BUILD; price (TX 7.68 vs VA 10.63 cents/kWh), fiber, changes, pipeline and
//          timeline answers led with "DC Hub ran N lookups" while their steps carried headlines.
//   gap 5: get_pipeline OH returned 2 rows with capacity null and the lead gave no figure and no reason.
//   gap 8: Europe plans were honestly out of scope, but null EU grid steps cost points.
//
// Fixtures carry the field names the step tools serve (lib/free-decision-taste.mjs taste.headline, the
// /api/v1/pipeline projects rows, the /grid/latest ENTSO-E shape in test/grid-gating-one-rule.test.mjs).
import { describe, it, expect } from 'vitest';
import { factsFromStep, factsFromExecuted, siteVerdictOf, gridReadingOf, MW_NOT_HELD } from '../lib/plan-step-facts.mjs';
import { planLeadText, factLines, geographyScopeLine, PLAN_LEAD_MAX } from '../lib/plan-lead-text.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';
import { _planSuppressNullGridSteps, PLANNER_VERSION } from '../server.mjs';

const ex = (step, tool, args, result, status = 'executed') => ({ step, tool, args, status, result });
const plan = (executed, extra = {}) => ({ _entity: 'plan_execution', intent: 'q', executed, ...extra });

const TX_PRICE = { _entity: 'energy', as_of: '2026-08-31', filter: { state: 'TX' },
  taste: { headline: { name: 'retail_rate_cents_kwh', value: 7.68, unit: 'cents/kWh', sector: 'industrial', window: '2026', as_of: '2026-08-31' } } };
const VA_PRICE = { _entity: 'energy', as_of: '2026-08-31', filter: { state: 'VA' },
  taste: { headline: { name: 'retail_rate_cents_kwh', value: 10.63, unit: 'cents/kWh', sector: 'industrial', window: '2026', as_of: '2026-08-31' } } };
const OH_PIPELINE = { total: 2, scope: { state: 'OH' }, as_of: '2026-11-16',
  projects: [{ name: 'New Albany campus', status: 'construction', capacity_mw: null }, { name: 'Hilliard campus', status: 'planned', capacity_mw: null }] };
const queueTaste = (iso, gw) => ({ iso, taste: { headline: { name: 'queued_generation_gw', value: gw, unit: 'GW', window: 'active queue', as_of: '2026-10-31' } } });
const SITE_PREVIEW = { _gated: true, site_teaser: { verdict: 'BUILD', power_infrastructure: 'CAUTION', locked: ['overall_score'] } };
const EU_NULL = { iso: 'EU_FR', family: 'entsoe', demand_mw: null, metrics_count: 0, metrics: {} };
const EU_SHARES = { iso: 'EU_DE_LU', family: 'entsoe', demand_mw: null, newest_at: '2026-11-17T07:00:00+00:00',
  metrics: { gas_pct: { value: 11.7, unit: 'pct' }, renewable_pct: { value: 54.6, unit: 'pct' } } };
const DE_SCOPE = { name: 'Germany', not_covered: 'grid headroom, interconnection queues and time-to-power' };

describe('5.34: the planner version', () => {
  it('is 5.34', () => { expect(PLANNER_VERSION).toBe('5.35'); });
});

describe('gap 2: one line per entity, never "ran N lookups" when a step returned a headline', () => {
  it('TX vs VA price: both states lead, each with its own dated rate', () => {
    const t = planLeadText(plan([ex(1, 'get_energy_prices', { state: 'TX' }, TX_PRICE), ex(2, 'get_energy_prices', { state: 'VA' }, VA_PRICE)]));
    expect(t).toMatch(/^TX industrial retail electricity rate: 7\.68 cents\/kWh .* VA industrial retail electricity rate: 10\.63 cents\/kWh/);
    expect(t).not.toMatch(/ran \d+ lookups?/);
  });
  it('PJM | MISO | SPP queue reads: three entities, three lines (not PJM alone)', () => {
    const t = planLeadText(plan([ex(1, 'get_interconnection_queue', { iso: 'PJM' }, queueTaste('PJM', 373.5)),
      ex(2, 'get_interconnection_queue', { iso: 'MISO' }, queueTaste('MISO', 301.2)),
      ex(3, 'get_interconnection_queue', { iso: 'SPP' }, queueTaste('SPP', 120.4))]));
    for (const s of ['PJM queued generation: 373.5 GW', 'MISO queued generation: 301.2 GW', 'SPP queued generation: 120.4 GW']) expect(t).toContain(s);
    expect(t).toContain('as of 2026-10-31');
    expect(t.length).toBeLessThanOrEqual(PLAN_LEAD_MAX);
  });
  it('any step\'s taste.headline is a fact (a tool with no reader of its own)', () => {
    const f = factsFromStep('get_gas_intelligence', { taste: { headline: { name: 'henry_hub_usd_mmbtu', value: 3.12, unit: '$/MMBtu', as_of: '2026-11-14' } } }, { state: 'TX' });
    expect(f).toHaveLength(1);
    expect(f[0].text).toBe('TX henry hub usd mmbtu: 3.12 $/MMBtu (DC Hub, as of 2026-11-14).');
    expect(f[0].entity).toBe('TX');
  });
  it('a withheld headline (value null) is not a fact, and with nothing else the lookup count stays', () => {
    const p = plan([ex(1, 'get_interconnection_queue', { iso: 'PJM' }, { taste: { headline: { name: 'queued_generation_gw', value: null, unit: 'GW' } } })]);
    expect(planLeadText(p)).toMatch(/^DC Hub ran 1 lookup/);
  });
  it('changes: the counts the diff holds, dated', () => {
    const f = factsFromStep('get_changes', { since: '7d', generated_at: '2026-11-17T08:00:00Z', diff: { new_facilities: [1, 2, 3], new_deals: [1], dcpi_movers: [] } }, {});
    expect(f[0].text).toBe('Since 7d: 3 new facilities, 1 new deals (DC Hub change feed, as of 2026-11-17).');
  });
  it('a DCPI read is a fact with its own date', () => {
    const f = factsFromStep('get_market_dcpi_rank', { market_slug: 'columbus-oh', verdict: 'CAUTION', composite_score: 51.2, computed_at: '2026-11-16T04:00:00Z' }, { market_slug: 'columbus-oh' });
    expect(f[0].text).toBe('Columbus Oh DCPI verdict: CAUTION (51.2) (DCPI, as of 2026-11-16).');
  });
  it('whole lines only: a fourth entity that does not fit is dropped, never cut mid-line', () => {
    const many = ['PJM', 'MISO', 'SPP', 'ERCOT', 'CAISO', 'NYISO', 'ISONE', 'AESO'].map((iso, i) => ex(i + 1, 'get_interconnection_queue', { iso }, queueTaste(iso, 100 + i)));
    const l = factLines(many, 200);
    expect(l.length).toBeLessThanOrEqual(200);
    expect(l.endsWith(').')).toBe(true);
  });
});

describe('gap 2: a siting answer carries analyze_site\'s own verdict', () => {
  const executed = [ex(1, 'get_grid_intelligence', { iso: 'ERCOT' }, { iso: 'ERCOT' }),
    ex(2, 'analyze_site', { lat: 32.45, lon: -99.73 }, SITE_PREVIEW, 'gated_preview')];
  it('the headline states BUILD as the site-level band, not "no verdict was produced"', () => {
    const ia = buildIntentAnswer({ intent: 'Analyze a site for a 200 MW data center at 32.45, -99.73', intent_class: 'site_analysis', constraint_iso: ['ERCOT'] }, executed, null);
    expect(ia.kind).toBe('siting');
    expect(ia.headline).not.toMatch(/no BUILD\/CAUTION\/AVOID verdict was produced/);
    expect(ia.headline).toMatch(/site verdict BUILD at 32\.45, -99\.73 \(analyze_site, site-level; power infrastructure CAUTION\)/);
    expect(ia.verdict).toMatchObject({ value: 'BUILD', scope: 'site' });
    expect(ia.not_established.join(' ')).toMatch(/No DCPI market verdict in this run/);
  });
  it('a DCPI market verdict still wins over the site band', () => {
    const ia = buildIntentAnswer({ intent: 'Analyze a site for a 200 MW data center at 32.45, -99.73', intent_class: 'site_analysis', constraint_iso: ['ERCOT'] },
      [...executed, ex(3, 'get_market_dcpi_rank', { market_slug: 'abilene' }, { verdict: 'CAUTION', composite_score: 50 })], null);
    expect(ia.verdict).toMatchObject({ value: 'CAUTION', scope: 'market' });
  });
  it('siteVerdictOf reads site_teaser, full verdict and preview bands; anything else is null', () => {
    expect(siteVerdictOf(SITE_PREVIEW)).toEqual({ verdict: 'BUILD', power: 'CAUTION' });
    expect(siteVerdictOf({ verdict: 'avoid' })).toEqual({ verdict: 'AVOID', power: null });
    expect(siteVerdictOf({ verdict: 'GOOD' })).toBeNull();
  });
  it('with no answer block, the lead still states the site band', () => {
    expect(planLeadText(plan([executed[1]]))).toMatch(/^Site read at 32\.45, -99\.73 \(analyze_site\): BUILD; power infrastructure CAUTION/);
  });
});

describe('gap 5 (lead): a pipeline with no capacity says MW not held', () => {
  it('Ohio, 2 rows, capacity null', () => {
    const f = factsFromStep('get_pipeline', OH_PIPELINE, { state: 'OH' });
    expect(f[0].text).toBe(`OH data-center pipeline: 2 projects on record; ${MW_NOT_HELD} for them (DC Hub pipeline, as of 2026-11-16).`);
    expect(planLeadText(plan([ex(1, 'get_pipeline', { state: 'OH' }, OH_PIPELINE)]))).toMatch(/^OH data-center pipeline: 2 projects on record; MW not held for them/);
  });
  it('sizes that are stated are summed, the rest named as not held; a named campus names its first match', () => {
    const f = factsFromStep('get_pipeline', { projects: [{ name: 'Stargate Abilene', status: 'construction', capacity_mw: 1200 }, { name: 'x', capacity_mw: null }] },
      { query: 'Stargate Abilene' });
    expect(f[0].text).toBe('Stargate Abilene data-center pipeline: 2 projects on record, 1,200 MW across the 1 project that state a size; MW not held for 1 (DC Hub pipeline). First match: Stargate Abilene (construction).');
  });
  it('no rows is no fact (never "0 projects")', () => {
    expect(factsFromStep('get_pipeline', { projects: [], total: 0 }, { state: 'OH' })).toEqual([]);
  });
});

describe('gap 8 (lead): Europe leads with the honest scope line; a null grid step is suppressed', () => {
  it('a null EU grid step becomes no_data; a step with shares or a withheld marker is left alone', () => {
    const executed = [ex(1, 'get_grid_data', { iso: 'EU_FR' }, EU_NULL), ex(2, 'get_grid_data', { iso: 'EU_DE_LU' }, EU_SHARES),
      ex(3, 'get_grid_data', { iso: 'EU_NL' }, { iso: 'EU_NL', demand_mw: null, _demand_mw_withheld: true })];
    expect(_planSuppressNullGridSteps(executed, new Map())).toBe(1);
    expect(executed[0].status).toBe('no_data');
    expect(executed[0].result.note).toMatch(/^EU_FR returned no reading in this run/);
    expect(executed[1].status).toBe('executed');
    expect(executed[2].status).toBe('executed');
  });
  it('the lead opens on the scope line, then the reading the step did return', () => {
    const t = planLeadText(plan([ex(1, 'get_grid_data', { iso: 'EU_DE_LU' }, EU_SHARES), { step: 2, tool: 'get_grid_data', args: { iso: 'EU_FR' }, status: 'no_data', result: { note: 'x' } }],
      { geography_scope: DE_SCOPE }));
    expect(t.startsWith("Germany is outside DC Hub's US grid and queue coverage: grid headroom, interconnection queues and time-to-power are not covered there. EU_DE_LU live grid reading: gas 11.7% of generation, renewables 54.6%")).toBe(true);
    expect(t).not.toMatch(/null|ran \d+ lookups?/);
  });
  it('the scope line is read from answer_guide when the structured block is gated off', () => {
    const p = plan([], { answer_guide: "GEOGRAPHY — Germany is outside DC Hub's US grid and queue coverage. This plan reads Germany itself." });
    expect(geographyScopeLine(p)).toMatch(/^Germany is outside DC Hub's US grid and queue coverage/);
    expect(planLeadText(p)).toMatch(/^Germany is outside/);
  });
  it('gridReadingOf: null when nothing is stored', () => {
    expect(gridReadingOf(EU_NULL)).toBeNull();
    expect(gridReadingOf(EU_SHARES)).toMatchObject({ gas_pct: 11.7, renewable_pct: 54.6 });
  });
});

describe('every fact carries its entity, and executed facts keep step order', () => {
  it('entity falls back to the step args', () => {
    const f = factsFromExecuted([ex(1, 'get_energy_prices', { state: 'VA' }, VA_PRICE), ex(2, 'get_pipeline', { state: 'OH' }, OH_PIPELINE)], null);
    expect(f.map((x) => x.entity)).toEqual(['VA', 'OH']);
  });
});
