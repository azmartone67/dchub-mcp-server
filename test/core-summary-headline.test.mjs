// /mcp/core: the top-level `summary` string and the grid_power headline (2026-11-25).
//
// Microsoft 365 Copilot recertification: Copilot Chat and Researcher narrate a core result, and the envelope
// had no short sentence at the top; a partial grid_power result also left every top-level headline field null
// while the section held a measured demand figure. This suite pins, offline with a mocked delegate:
//   * every core tool result carries a non-empty plain-ASCII `summary` that names no figure the same result
//     does not carry, uses no plan wording and survives the scrub unchanged;
//   * a partial grid result's published readings (demand, one generation share, the two band words) are in the
//     top-level headline with their own hours, and no withheld figure is;
//   * the per-caller daily limit reads as a request limit, in the section and in the summary.
// test/core-profile.test.mjs runs the same checks through the real server and its gate.
import { describe, it, expect } from 'vitest';
import * as C from '../lib/core-profile.mjs';
import { buildFreeDecisionTaste } from '../lib/free-decision-taste.mjs';

const GRID_FULL = {
  iso: 'PJM', iso_name: 'PJM Interconnection', as_of: '2026-11-24T04:00:00Z', demand_mw: 91234, demand_period: '2026-11-24T04',
  constraint_score: 61.5, excess_power_score: 44.5, queue_depth_gw: 250.1, avg_time_to_power_months: 48.5,
  reserve_margin_pct: 17.2, retail_price_cents_kwh: 12.4, renewable_share_pct: 7.9, generation_mix_period: '2026-11-23T05',
  demand_24h: [{ period: '2026-11-24T03', mw: 90111 }],
  provenance: { source: 'EIA-930 hourly RTO/BA feed + DC Hub Data Center Power Index (DCPI)', as_of: '2026-11-24T04:00:00Z' },
};
// The canonical handler's own partial shape, built by the module that serves it.
const gridPartial = (over = {}) => buildFreeDecisionTaste('get_grid_intelligence', { ...GRID_FULL, ...over }, { bandFor: (k) => (k === 'constraint_score' ? 'TIGHT' : 'MODERATE') }).envelope;
const asResult = (payload, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload, ...(isError ? { isError: true } : {}) });
const WALL = asResult({ error: 'anon_hard_wall', tool: 'get_grid_intelligence', binding_limit: 'anon_ip_daily_hard', limit: 60 }, true);

const ROWS = {
  success: true, as_of: '2026-11-24T00:00:00Z',
  provenance: { source: 'EIA-930; DC Hub', as_of: '2026-11-24T00:00:00Z', license: 'CC-BY-4.0' },
  shortlist: [{ market_slug: 'dallas', market_name: 'Dallas' }, { market_slug: 'columbus', market_name: 'Columbus' }],
  results: [{ market_slug: 'querétaro', market_name: 'Querétaro', score: 71 }, { market_slug: 'phoenix', market_name: 'Phoenix', score: 66 }],
  matched: 2, universe: 312,
  data: [{ name: 'Example DC 1', provider: 'OpCo', city: 'Ashburn', state: 'VA', country: 'US' }], total_matching: 4821,
  intent_class: 'markets', recommended_sequence: [{ step: 1, derived_from: 'rank_markets' }],
  executed: [{ step: 1, status: 'executed', derived_from: 'rank_markets' }, { step: 2, status: 'skipped_unresolved', derived_from: 'get_interconnection_queue' }],
  market_name: 'Phoenix', market_slug: 'phoenix', verdict: 'CAUTION', composite_score_band: 'CAUTION', iso: 'WECC',
  near_net_bucket: '1-5 km', carrier_data_coverage: 'measured', market: 'Dallas-Fort Worth',
  citation_text: 'DC Hub (dchub.cloud), as of 2026-11-24', cite_as: 'DC Hub (dchub.cloud), as of 2026-11-24', layer: 'dcpi',
  summary: { overall_health: 'healthy', healthy: 41, stale: 2 },
  comparison: { PJM: {}, ERCOT: {} }, winner: '39.04,-77.48',
};
const deps = (delegate) => ({
  delegate: async (name, args) => delegate(name, args),
  async siteHeadline() { return { ok: false }; },
  async resolveLocation() { return { ok: false }; },
});
const tool = (name) => C.CORE_TOOLS.find((t) => t.name === name);
async function run(name, args, delegate = () => asResult(ROWS)) {
  const env = await tool(name).run(args || {}, deps(delegate));
  const res = env && Array.isArray(env.content) ? env : C.toToolResult(env);
  return { res, env: res.structuredContent };
}

const PLAN_WORDS = /\b(free|paid|pro|upgrade|pricing|subscription|sign ?up|key|keyless|trial)\b/i;
const numbersIn = (t) => (String(t).match(/\d+(?:\.\d+)?/g) || []);
function summaryProblems(env) {
  const out = [];
  const s = env && env.summary;
  if (typeof s !== 'string' || !s.trim()) return ['summary is missing or empty'];
  if (!/^[\x20-\x7E]*$/.test(s)) out.push('non-ASCII');
  if (s.length > C.CORE_SUMMARY_MAX) out.push('too long: ' + s.length);
  if (PLAN_WORDS.test(s)) out.push('plan wording: ' + s.match(PLAN_WORDS)[0]);
  if (C.scrubText(s) !== s) out.push('the scrub would change it');
  if (C.findForbidden(s).length) out.push('forbidden: ' + C.findForbidden(s).join(','));
  const { summary, ...rest } = env;
  const have = new Set(numbersIn(JSON.stringify(rest)));
  const stray = numbersIn(s).filter((n) => !have.has(n));
  if (stray.length) out.push('figures not in the result: ' + stray.join(', '));
  return out;
}

const EVERY_TOOL = [
  ['plan_and_answer', {}], ['plan_and_answer', { intent: 'where could 200 MW land in Texas', dry_run: true }],
  ['find_sites', {}], ['find_sites', { state: 'OH', min_voltage_kv: 345 }],
  ['evaluate_site', { lat: 39.04, lon: -77.48 }], ['evaluate_site', {}],
  ['compare_sites', { locations: ['39.04,-77.48', '33.45,-112.07'] }], ['compare_sites', { locations: ['phoenix', 'dallas'] }],
  ['market_snapshot', { market: 'phoenix' }],
  ['rank_markets', {}], ['rank_markets', { criteria: 'ai_capacity', limit: 5 }],
  ['grid_power', {}], ['grid_power', { iso: 'PJM,ERCOT' }], ['grid_power', { state: 'OH' }],
  ['fiber_connectivity', { lat: 39.04, lon: -77.48 }], ['fiber_connectivity', {}],
  ['facility_lookup', {}], ['facility_lookup', { id: 'example-1' }],
  ['get_evidence', { subject: 'Phoenix DCPI verdict CAUTION' }], ['get_evidence', {}],
];

describe('/mcp/core summary: every tool, every result kind', () => {
  it('the list below covers all ten core tools', () => {
    expect([...new Set(EVERY_TOOL.map(([n]) => n))].sort()).toEqual([...C.CORE_TOOL_NAMES].sort());
  });
  for (const [name, args] of EVERY_TOOL) {
    it(`${name} ${JSON.stringify(args)}: data served`, async () => {
      const { env, res } = await run(name, args);
      expect(summaryProblems(env), env.summary).toEqual([]);
      expect(Object.keys(env)[1]).toBe('summary');
      expect(JSON.parse(res.content[0].text).summary).toBe(env.summary);
    });
    it(`${name} ${JSON.stringify(args)}: caller past the daily request limit`, async () => {
      const { env } = await run(name, args, () => WALL);
      expect(summaryProblems(env), env.summary).toEqual([]);
    });
    it(`${name} ${JSON.stringify(args)}: delegate throws`, async () => {
      const { env } = await run(name, args, () => { throw new Error('upstream timed out after 25000 ms'); });
      expect(summaryProblems(env), env.summary).toEqual([]);
    });
  }

  it('names the entities and the as_of the result carries', async () => {
    const rm = (await run('rank_markets', {})).env;
    expect(rm.summary).toMatch(/^Markets ranked by ai_ready: markets shown 2; top ranked: Queretaro, Phoenix\./);
    expect(rm.summary).toContain('As of 2026-11-24T00:00:00Z.');
    expect(rm.summary).toContain('Sources: EIA-930');
    const fl = (await run('facility_lookup', {})).env;
    expect(fl.summary).toMatch(/Facility list \(country US\): records shown 1, total matching 4821; first listed Example DC 1\./);
    const fs = (await run('find_sites', {})).env;
    expect(fs.summary).toMatch(/Market shortlist \(region us\): markets shown 2, matched 2, of a universe of 312; first listed Dallas, Columbus\./);
    const pa = (await run('plan_and_answer', {})).env;
    expect(pa.summary).toMatch(/steps run 2, complete 1, partial 0, not run 1, intent class markets\./);
    // A step that did not run is named in plain words, never by the name of a tool this profile does not list.
    expect(pa.summary).toContain('Not served: step 2 (interconnection queue) (skipped unresolved).');
    expect(pa.summary).not.toMatch(/get_[a-z_]+/);
  });

  it('folds names to plain ASCII without losing letters, and leaves out a name it cannot write', async () => {
    const { env } = await run('rank_markets', {}, () => asResult({ success: true, results: [
      { market_name: '\u6771\u4eac', market_slug: 'tokyo' }, { market_name: '\u0141\u00f3d\u017a \u2013 Nord \u2019A\u2019' }, { market_name: 'Troms\u00f8' }, { market_name: 'Quer\u00e9taro' }] }));
    expect(env.summary).toMatch(/^[\x20-\x7E]+$/);
    // The first row's name has no ASCII form, so its ASCII slug is used; no row is written with letters missing.
    expect(env.summary).toContain("top ranked: tokyo, Lodz - Nord 'A', Tromso.");
    const cjkOnly = (await run('rank_markets', {}, () => asResult({ success: true, results: [{ market_name: '\u6771\u4eac' }, { market_name: 'Phoenix' }] }))).env;
    expect(cjkOnly.summary).toContain('markets shown 2; top ranked: Phoenix.');
  });

  it('a question or a source written in another script still yields a plain-ASCII summary', async () => {
    const { env } = await run('plan_and_answer', { intent: '\u6771\u4eac\u306e\u96fb\u529b power outlook \u26a1' }, () => asResult({ ...ROWS, provenance: { source: 'EIA-930; \u7d4c\u6e08\u7523\u696d\u7701 METI', as_of: '2026-11-24T00:00:00Z' } }));
    expect(env.query.intent).toContain('\u6771\u4eac');
    expect(env.summary).toMatch(/^[\x20-\x7E]+$/);
    expect(env.summary).toContain('Plan for "power outlook"');
    expect(env.summary).toContain('METI');
  });

  it('says so when the source gave no date, and writes no date of its own', async () => {
    const { env } = await run('rank_markets', {}, () => asResult({ success: true, results: [{ market_name: 'Phoenix' }] }));
    expect(env.as_of).toBeNull();
    expect(env.summary).toContain('The source gave no as_of date.');
    expect(env.summary).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('an input error and an internal error carry a summary too', async () => {
    const bad = (await run('fiber_connectivity', {})).env;
    expect(bad.error).toBe('invalid_input');
    expect(bad.summary).toBe('fiber_connectivity returned no data (invalid input): Pass lat and lon, or market.');
    const boom = C.toToolResult({ tool: 'grid_power', error: 'internal_error', message: 'x', as_of: null, sources: [], headline: {}, unavailable: [] }, true).structuredContent;
    expect(boom.summary).toBe('grid_power returned no data (internal error): x.');
  });

  it('stays inside the length budget in the worst case, and still ends with the date and a source', () => {
    const long = (w) => (w + '_').repeat(30);
    const s = C.composeSummary({ tool: 't', lead: 'Site comparison: ' + 'candidate verdict BUILD; '.repeat(60), level: 'preview', as_of: '2026-11-24T04:00:00Z',
      sources: [long('source one'), long('source two'), long('source three')],
      unavailable: [1, 2, 3, 4].map((i) => ({ factor: long('location ' + i), status: long('status') })),
      withheld_fields: Array.from({ length: 12 }, (_, i) => long('field' + i)) });
    expect(s.length).toBeLessThanOrEqual(C.CORE_SUMMARY_MAX);
    expect(s).toMatch(/Withheld at this access level: .* and others\. Not served: /);
    expect(s).toMatch(/ As of 2026-11-24T04:00:00Z\. Sources: source one[^;]*\.$/);
  });

  it('stays inside the length budget when the lead is long, keeping the access line and the date', () => {
    const s = C.composeSummary({ tool: 't', lead: 'Plan for "' + 'very long question '.repeat(80) + '"', level: 'preview',
      as_of: '2026-11-24T04:00:00Z', sources: ['EIA-930'], unavailable: [], withheld_fields: ['constraint_score'] });
    expect(s.length).toBeLessThanOrEqual(C.CORE_SUMMARY_MAX);
    expect(s).toContain('Withheld at this access level: constraint_score.');
    expect(s).toContain('As of 2026-11-24T04:00:00Z.');
  });
});

describe('/mcp/core grid_power: a partial result shows what it publishes at the top level', () => {
  it('copies demand, the generation share and the band words into the headline, each with its own hour', async () => {
    const { env } = await run('grid_power', {}, () => asResult(gridPartial()));
    const t = env.sections[0].data.taste;
    expect(env.access.level).toBe('preview');
    expect(env.headline.iso).toBe('PJM');
    expect(env.headline.demand_mw).toBe(91234);
    expect(env.headline.demand_mw).toBe(t.headline.value);
    expect(env.headline.demand_period).toBe(t.headline.window);
    expect(env.headline.demand_as_of).toBe(t.headline.as_of);
    expect(env.headline.renewable_share_pct).toBe(7.9);
    expect(env.headline.generation_mix_period).toBe('2026-11-23T05');
    expect(env.headline.generation_share_as_of).toBe(t.share.as_of);
    expect(env.headline.constraint_band).toBe('TIGHT');
    expect(env.headline.excess_power_band).toBe('MODERATE');
    for (const k of ['demand_mw', 'demand_as_of', 'renewable_share_pct', 'constraint_band', 'excess_power_band']) expect(env.headline_status[k], k).toBe('provided');
    expect(env.summary).toMatch(/^PJM grid: demand in MW 91234, for the hour 2026-11-24T04:00:00Z, renewable share of generation in percent 7\.9, /);
    expect(env.summary).toContain('DCPI constraint band TIGHT, DCPI excess-power band MODERATE.');
  });

  it('keeps every withheld figure null, marked withheld, listed, and out of the summary', async () => {
    const { env, res } = await run('grid_power', {}, () => asResult(gridPartial()));
    const LOCKED = ['excess_power_score', 'constraint_score', 'avg_time_to_power_months', 'queue_depth_gw', 'reserve_margin_pct', 'retail_price_cents_kwh'];
    for (const k of LOCKED) {
      expect(env.headline[k], k).toBeNull();
      expect(env.headline_status[k], k).toBe('withheld');
      expect(env.access.withheld_fields, k).toContain(k);
    }
    // None of the withheld values appears anywhere in the result.
    for (const v of ['61.5', '44.5', '250.1', '48.5', '17.2', '12.4', '90111']) expect(res.content[0].text, v).not.toContain(v);
    expect(summaryProblems(env), env.summary).toEqual([]);
    expect(env.summary).toContain('Withheld at this access level: avg_time_to_power_months, constraint_score,');
  });

  it('copies only the fixed list: a score placed in the partial headline slot is not lifted', () => {
    const hl = C.headlineFrom({}, { demand_mw: 'demand_mw', constraint_score: 'constraint_score', constraint_band: 'constraint_band', excess_power_band: 'excess_power_band' }, ['constraint_score']);
    C.promoteGridTaste(hl, { taste: { headline: { name: 'constraint_score', value: 61.5, as_of: '2026-11-24T04:00:00Z' }, share: { name: 'queue_depth_gw', value: 250.1 }, band: { constraint: null } } });
    expect(hl.headline).toEqual({ demand_mw: null, constraint_score: null, constraint_band: null, excess_power_band: null });
    expect(hl.headline_status.constraint_score).toBe('withheld');
  });

  it('does not overwrite a figure the full result already carries', async () => {
    const { env } = await run('grid_power', { iso: 'PJM' }, () => asResult({ ...GRID_FULL, taste: { headline: { name: 'demand_mw', value: 1, as_of: 'x' } } }));
    expect(env.headline.demand_mw).toBe(91234);
    expect(env.headline.constraint_score).toBe(61.5);
    expect(env.access.level).toBe('full');
    expect(env.summary).toContain('constraint score 61.5');
  });

  it('with no demand reading, the headline carries the share the result fell back to, and no demand figure', async () => {
    const { env } = await run('grid_power', {}, () => asResult(gridPartial({ demand_mw: null, demand_period: null, demand_24h: null })));
    expect(env.headline.demand_mw).toBeNull();
    expect(env.headline.demand_as_of).toBeNull();
    expect(env.headline.renewable_share_pct).toBe(7.9);
    expect(env.headline.generation_share_as_of).toBe('2026-11-23T05:00Z');
    expect(env.summary).not.toMatch(/demand in MW/);
    expect(summaryProblems(env), env.summary).toEqual([]);
  });
});

describe('/mcp/core: the per-caller daily limit is a request limit', () => {
  it('the section says rate_limited, and the summary says why nothing was served', async () => {
    const { env } = await run('grid_power', {}, () => WALL);
    expect(env.sections[0].status).toBe('rate_limited');
    expect(env.unavailable).toEqual([{ factor: 'get_grid_intelligence', status: 'rate_limited', reason: 'rate_limited' }]);
    expect(env.headline.demand_mw).toBeNull();
    expect(env.summary).toBe('PJM grid: no headline figures are available in this response. Not served: grid intelligence (request limit reached for this caller, try again later). The source gave no as_of date.');
  });
  it('an ordinary tool error still reads as an error', () => {
    expect(C.classify({ isError: true }, { error: 'upstream_failed' }).status).toBe('error');
    expect(C.classify({ isError: true }, { error: 'anon_daily_cap' }).status).toBe('rate_limited');
    expect(C.classify({ isError: true }, { error: 'pro_required' }).status).toBe('withheld');
  });
});
