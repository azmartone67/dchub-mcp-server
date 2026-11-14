// ── a named non-US country is read as itself; MW is never worded as confirmed power ──
//
// Brain 2026-11-08, owner priority 1 (geography + power-constraint correctness). Measured on
// main 67d274d before lib/country-scope.mjs, _planQuery with no context:
//   Germany AI-campus ranking -> ai_capacity_index (US index, unscoped)
//   Ireland 100 MW            -> get_retirement_headroom + get_refined_queue (EIA + US queues)
//   Japan 50 MW headroom      -> get_grid_scoreboard, then "the ISO chosen from step 1" (US)
//   Brazil markets            -> rank_markets, whose default region is us
// Each of those answers a question about one country with data about another.
// The end-to-end run is test/country-scope-e2e.test.mjs (its harness must import server.mjs first).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { NON_US_COUNTRIES, US_ONLY_TOOLS, namedNonUsCountries, namesUsGeography, countryScopedPlan } from '../lib/country-scope.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';

// rank_markets is US-only at its default region; with a region that excludes the US it reads the
// country's region, and the plan tells the agent to keep only rows in that country.
const runsUsData = (s) => US_ONLY_TOOLS.has(s.tool)
  && !(s.tool === 'rank_markets' && s.args_hint && ['eu', 'apac', 'canada'].includes(s.args_hint.region));
const marketArgs = (s) => [s.args_hint && s.args_hint.market_slug, s.args_hint && s.args_hint.market].filter(Boolean);

const US_GRID_CODES = /^(PJM|ERCOT|MISO|CAISO|SPP|NYISO|ISONE|ISO-NE|TVA|BPA|WECC|[A-Z]{2,5}PS)$/;

// The four measured defects plus one per remaining region, each with the MW it names.
const CASES = [
  { intent: 'rank markets for a 200 MW AI campus in Germany', iso2: 'DE', name: 'Germany', mw: 200, grid: 'EU_DE_LU' },
  { intent: 'find 100 MW of buildable capacity in Ireland', iso2: 'IE', name: 'Ireland', mw: 100, grid: null },
  { intent: 'grid headroom for a 50 MW site in Japan', iso2: 'JP', name: 'Japan', mw: 50, grid: 'OCCTO' },
  { intent: 'best data center markets in Brazil', iso2: 'BR', name: 'Brazil', mw: null, grid: 'ONS' },
  { intent: 'help us find 100 MW in the UK', iso2: 'GB', name: 'United Kingdom', mw: 100, grid: 'NGESO' },
  { intent: 'where can a 300 MW AI campus get power in Singapore', iso2: 'SG', name: 'Singapore', mw: 300, grid: 'EMA' },
  { intent: 'evaluate 150 MW power headroom in Australia', iso2: 'AU', name: 'Australia', mw: 150, grid: 'AEMO' },
  { intent: 'find 80 MW sites in India', iso2: 'IN', name: 'India', mw: 80, grid: null },
  { intent: 'rank data center markets in Canada for a 60 MW campus', iso2: 'CA', name: 'Canada', mw: 60, grid: null },
];

describe('country detection: names the country, never a US place that shares a word', () => {
  it.each([
    ['power in New Mexico', []], ['sites in Georgia for 50 MW', []], ['data centers in Indiana', []],
    ['grid in North Korea', []], ['Northern Ireland, 100 MW', ['GB']], ['Ireland, 100 MW', ['IE']],
    ['Mexico City campus', ['MX']], ['Germany vs France', ['DE', 'FR']],
  ])('%s -> %j', (text, want) => {
    expect(namedNonUsCountries(text).map((c) => c.iso2)).toEqual(want);
  });

  it('the pronoun "us" is not the United States; "USA" and "U.S." are', () => {
    expect(namesUsGeography('help us find 100 MW in Germany', {})).toBe(false);
    expect(namesUsGeography('compare the USA and Germany', {})).toBe(true);
    expect(namesUsGeography('U.S. vs Germany for 100 MW', {})).toBe(true);
  });

  it('a comparison of two countries is not a US signal; a US slug in it is', () => {
    expect(namesUsGeography('', { comparePair: { a: 'germany', b: 'france' } })).toBe(false);
    expect(namesUsGeography('', { comparePair: { a: 'texas', b: 'germany' } })).toBe(true);
    expect(namesUsGeography('', { stateFromPlace: 'TX' })).toBe(true);
  });

  it('every table grid is a non-US code get_grid_data serves, and no region is one that holds US markets', () => {
    for (const c of NON_US_COUNTRIES) {
      if (c.grid) expect(c.grid, c.name).not.toMatch(US_GRID_CODES);
      if (c.region) expect(['eu', 'apac', 'canada'], c.name).toContain(c.region);
    }
  });
});

describe('planner: a named non-US country is planned as itself', () => {
  let P;
  beforeAll(async () => { P = await import('../server.mjs'); }, 120_000);

  it.each(CASES)('$intent', ({ intent, iso2, name, mw, grid }) => {
    const p = P._planQuery(intent, {});
    const seq = p.recommended_sequence;
    expect(seq.length, 'empty plan: every assertion below would be vacuous').toBeGreaterThan(0);
    // No step answers from US data.
    expect(seq.filter(runsUsData).map((s) => s.tool)).toEqual([]);
    expect(p.alternatives.map((a) => a.tool).filter((t) => US_ONLY_TOOLS.has(t))).toEqual([]);
    // The country itself is read.
    // First, unless a tracked market in that country was bound (Singapore): its read then leads.
    expect(seq.find((s) => s.tool === 'search_facilities')).toMatchObject({ args_hint: { country: iso2 } });
    if (!p.geography_scope.bound_market) expect(seq[0].tool).toBe('search_facilities');
    const sc = seq.find((s) => s.tool === 'source_capacity');
    expect(sc.args_hint.location).toBe(name);
    // The MW the question named is the size the capacity step runs at.
    if (mw) expect(sc.args_hint.min_mw).toBe(mw); else expect(sc.args_hint).not.toHaveProperty('min_mw');
    const g = seq.find((s) => s.tool === 'get_grid_data');
    if (grid) expect(g.args_hint).toEqual({ iso: grid }); else expect(g).toBeUndefined();
    for (const s of seq) {
      if (s.tool === 'rank_markets') expect(['eu', 'apac', 'canada']).toContain(s.args_hint.region);
      for (const v of Object.values(s.args_hint || {})) expect(String(v)).not.toMatch(/^<.*>$/);   // nothing to mint from a US step
    }
    // The plan says what it cannot read, instead of estimating it.
    expect(p.geography_scope).toMatchObject({ name, mixed_with_us: false });
    expect(p.geography_scope.countries.map((c) => c.country)).toEqual([iso2]);
    expect(p.geography_scope.note).toMatch(/report them as not covered, never estimated/);
    if (mw) expect(p.geography_scope.note).toContain(`do not describe ${mw} MW as available there`);
    expect(p.reason).toContain(p.geography_scope.note);
  });

  it('the measured defects: the US-only steps that ran before are named as dropped', () => {
    const dropped = (q) => P._planQuery(q, {}).geography_scope.steps_dropped;
    expect(dropped(CASES[0].intent)).toContain('rank_markets');   // 5.27: the US AI ranking (was ai_capacity_index)
    expect(dropped(CASES[1].intent)).toEqual(expect.arrayContaining(['get_retirement_headroom', 'get_refined_queue']));
    expect(dropped(CASES[2].intent)).toContain('get_grid_scoreboard');
    expect(dropped(CASES[3].intent)).toContain('rank_markets');
  });

  it('two countries: each is read, and neither is sent to a tool as a market slug', () => {
    const p = P._planQuery('compare Germany vs France for a 100 MW campus', {});
    const sf = p.recommended_sequence.filter((s) => s.tool === 'search_facilities').map((s) => s.args_hint.country);
    expect(sf).toEqual(['DE', 'FR']);
    expect(p.recommended_sequence.flatMap(marketArgs)).toEqual([]);
    expect(p.geography_scope.steps_dropped).toEqual(expect.arrayContaining(['get_market_dcpi_rank']));
  });

  it('a US place and a country: the US half keeps its steps, the country half gets its own', () => {
    const p = P._planQuery('compare Texas vs Germany for a 100 MW AI campus', {});
    const seq = p.recommended_sequence;
    expect(seq.some((s) => s.tool === 'get_market_dcpi_rank' && s.args_hint.market_slug === 'texas')).toBe(true);
    expect(seq.some((s) => s.tool === 'search_facilities' && s.args_hint.country === 'DE')).toBe(true);
    expect(seq.flatMap(marketArgs)).toEqual(['texas', 'texas']);   // never market_slug=germany
    expect(p.geography_scope.mixed_with_us).toBe(true);
    expect(seq.map((s) => s.step)).toEqual(seq.map((_, i) => i + 1));
  });

  it.each([
    ['find 300 MW sites in Texas', 'find_sites', { state: 'TX' }],
    ['evaluate 100 MW power headroom in PJM', 'get_grid_intelligence', { iso: 'PJM' }],
    ['is there 500 MW of available power near Ashburn', 'analyze_site', { capacity_mw: 500 }],
    ['power in New Mexico', 'discover_tools', {}],
  ])('CONTROL: a US question is untouched (%s)', (q, tool, args) => {
    const p = P._planQuery(q, {});
    expect(p.geography_scope).toBeUndefined();
    expect(p.recommended_sequence.find((s) => s.tool === tool).args_hint).toMatchObject(args);
    expect(countryScopedPlan(q, P._planSignals(q, {}), p.recommended_sequence, p.intent_class)).toBeNull();
  });
});

describe('MW is never worded as confirmed or available power', () => {
  const CONFIRMED = /\b\d[\d,]*\s*MW\s+(?:is |are |of )?(?:available|confirmed|secured|guaranteed|reserved)\b|\b(?:confirmed|guaranteed|secured) (?:power|capacity|headroom)\b/i;
  const NOW = Date.parse('2026-11-08T12:00:00Z');
  const steps = [
    { tool: 'get_refined_queue', status: 'executed', args: { iso: 'PJM', min_mw: 300 },
      result: { count_total_matching: 42, source_as_of: '2026-11-05', filters_applied: { min_mw: 300 },
        results: [{ estimated_ttp_months: 40 }, { estimated_ttp_months: 52 }] } },
    { tool: 'get_retirement_headroom', status: 'executed', args: { target_mw: 300 },
      result: { count_returned: 3, total_retiring_mw: 900, meta: { baseline_age: '2026-10' } } },
    { tool: 'get_hosting_capacity', status: 'executed', args: { state: 'VA' },
      result: { capacity_by_type: { load: { max_mw: 12 } } } },
  ];
  const text = (o) => [o.headline, ...o.evidence, ...o.not_established].join(' ');

  it.each([
    ['capacity_search', 'find 300 MW of available power in PJM'],
    ['site_analysis', 'is 300 MW of power available for a site in PJM'],
    ['grid_headroom', 'how soon can 300 MW of power be available in PJM'],
    ['power_timeline', 'time to power for 300 MW in PJM'],
  ])('intent_answer (%s) carries the asked MW and never calls it available', (cls, intent) => {
    const o = buildIntentAnswer({ intent, intent_class: cls,
      constraint_iso: ['PJM'], resolution_gap: null, requested_mw: 300 }, steps, null, NOW);
    expect(o, 'no answer built: the wording assertion would be vacuous').toBeTruthy();
    expect(o.requested_mw).toBe(300);
    expect(text(o)).toMatch(/300 MW/);
    expect(text(o)).not.toMatch(CONFIRMED);
    // Above the largest feeder, it says so instead of implying a fit.
    expect(o.not_established.join(' ')).toMatch(/300 MW is above any single published feeder \(12 MW\)/);
  });

  it('the grid scoreboard note and the grid_and_queue prompt call headroom a modeled estimate', () => {
    const src = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/grid headroom \(MW available\)/);
    expect(src).not.toMatch(/Answer plainly: how much power is available/);
    expect(src).toMatch(/per-ISO grid headroom \(a modeled MW estimate, not confirmed available power\)/);
    expect(src).toMatch(/how much headroom DC Hub's data shows \(a modeled estimate, not a utility or ISO confirmation that the power is available\)/);
  });
});

// mcp#1311 binds a tracked DCPI market as itself; several are also country names. Found by the
// cross-PR merge check: Singapore and Mexico City lost their DCPI steps to the country plan.
describe('a tracked DCPI market inside the named country wins over the country plan', () => {
  let P;
  beforeAll(async () => { P = await import('../server.mjs'); }, 120_000);
  const step = (p, tool) => p.recommended_sequence.find((s) => s.tool === tool);

  it.each([['Singapore', 'singapore'], ['Mexico City', 'mexico-city']])('power outlook for %s is the %s market plan, untouched', (place, slug) => {
    const p = P._planQuery(`What is the data center power outlook for ${place}?`, {});
    expect(p.intent_class).toBe('market_outlook');
    expect(step(p, 'get_market_dcpi_rank').args_hint).toEqual({ market_slug: slug });
    expect(step(p, 'get_market_intel').args_hint).toEqual({ market: slug });
    expect(p.geography_scope).toBeUndefined();
  });

  it.each([['find 100 MW in Singapore', 'singapore', 'SG'], ['find 100 MW sites near Frankfurt, Germany', 'frankfurt', 'DE']])('%s: the market read stays, bound to %s; US-only steps go', (q, slug, iso2) => {
    const p = P._planQuery(q, {});
    expect(step(p, 'get_market_dcpi_rank').args_hint).toEqual({ market_slug: slug });
    expect(p.recommended_sequence.filter(runsUsData).map((s) => s.tool)).toEqual([]);
    expect(step(p, 'search_facilities').args_hint.country).toBe(iso2);
    expect(step(p, 'source_capacity').args_hint.min_mw).toBe(100);
    expect(p.geography_scope.bound_market).toBe(slug);
  });

  it('a tracked slug that spells a country is a market, not a country', () => {
    expect(namesUsGeography('', { comparePair: { a: 'dallas', b: 'singapore' } })).toBe(true);
    const p = P._planQuery('compare Dallas vs Singapore for a 100 MW campus', {});
    expect(p.recommended_sequence.flatMap(marketArgs)).toEqual(expect.arrayContaining(['dallas', 'singapore']));
  });
});
