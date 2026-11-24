// planner-538-pairs.test.mjs — planner 5.38 (owner via Grok, 2026-11-17): both sides of the place. Pure functions,
// no network. The end-to-end run (real server, stub backend, compact answer) is planner-538-pairs-e2e.test.mjs.
//
// The owner's acceptance test: ten questions, five data-center-first and five power-first. Pass = the plan holds at
// least one facility / capacity / DCPI step AND at least one grid / energy step for the same geography (the same
// market, or the market's ISO or state), each bound to a concrete value (a placeholder covers nothing).
import { describe, it, expect } from 'vitest';
import { _planQuery, PLANNER_VERSION } from '../server.mjs';
import { pairStepFor, pairHeldBack, pairHeldNote, pairLines, sidesOf, DC_SIDE_TOOLS, POWER_SIDE_TOOLS } from '../lib/plan-pairs.mjs';

const steps = (p) => p.recommended_sequence;
const show = (p) => JSON.stringify(steps(p).map((s) => [s.step, s.tool, s.args_hint]));
const concrete = (v) => typeof v === 'string' && v.trim() !== '' && !v.startsWith('<');

// dc / power: the values a step bound to this place may carry (market slug or metro search word, state, ISO).
const TEN = [
  { q: 'colocation in Dallas for 2 MW', cls: 'colocation', dc: ['dallas', 'Dallas'], power: ['ERCOT', 'TX'], before: 'paired' },
  { q: 'Equinix facilities in Ashburn', cls: 'facility_search', dc: ['Northern Virginia', 'ashburn', 'Ashburn'], power: ['PJM', 'VA'], before: 'needed power', tool: 'get_grid_intelligence' },
  { q: 'data center pipeline in Phoenix', cls: 'dc_capacity', dc: ['phoenix', 'AZ'], power: ['AZ'], before: 'paired' },
  { q: 'is Atlanta a good data center market', cls: 'market_outlook', dc: ['atlanta'], power: ['GA'], before: 'routing' },
  { q: 'colo options in Chicago 500 kW', cls: 'colocation', dc: ['chicago', 'Chicago'], power: ['PJM', 'IL'], before: 'paired' },
  { q: 'PJM headroom for 200 MW in Northern Virginia', cls: 'grid_headroom', dc: ['northern-virginia'], power: ['PJM', 'VA'], before: 'needed dc', tool: 'get_market_intel' },
  { q: 'how soon can 100 MW get power in Texas', cls: 'capacity_search', dc: ['TX'], power: ['TX'], before: 'needed dc', tool: 'get_pipeline' },
  { q: 'interconnection queue in ERCOT near Dallas', cls: 'interconnection_queue', dc: ['dallas'], power: ['ERCOT', 'TX'], before: 'needed dc', tool: 'get_market_intel' },
  { q: 'power prices in Arizona for a data center', cls: 'price', dc: ['AZ'], power: ['AZ'], before: 'needed dc', tool: 'get_pipeline' },
  { q: 'grid capacity in Columbus Ohio', cls: 'grid_headroom', dc: ['columbus'], power: ['PJM', 'OH'], before: 'needed dc', tool: 'get_market_intel' },
];
const DC_KEYS = ['market_slug', 'market', 'query', 'city', 'state'];
const POWER_KEYS = ['iso', 'state'];
const boundTo = (s, keys, want) => keys.some((k) => concrete(s.args_hint && s.args_hint[k]) && want.includes(s.args_hint[k]));

describe('planner 5.38: both sides of the place', () => {
  it('PLANNER_VERSION is the current one (5.40)', () => { expect(PLANNER_VERSION).toBe('5.63'); });

  describe('the owner\'s ten questions: a data-center step and a power step for the same place', () => {
    for (const t of TEN) {
      it(t.q, () => {
        const p = _planQuery(t.q, {});
        expect(p.intent_class, show(p)).toBe(t.cls);
        const dc = steps(p).filter((s) => DC_SIDE_TOOLS.has(s.tool) && boundTo(s, DC_KEYS, t.dc));
        const pw = steps(p).filter((s) => POWER_SIDE_TOOLS.has(s.tool) && boundTo(s, POWER_KEYS, t.power));
        expect(dc.length, `data-center step for ${t.dc}: ${show(p)}`).toBeGreaterThan(0);
        expect(pw.length, `power step for ${t.power}: ${show(p)}`).toBeGreaterThan(0);
        // the pairing record says what the plan did, and replay carries it as P1
        const p1 = p.replay.decisions.find((d) => d.id === 'P1');
        if (t.tool) {
          expect(p.pairing).toMatchObject({ status: 'added', tool: t.tool, side: t.before === 'needed power' ? 'power' : 'data_center' });
          const ps = steps(p).find((s) => s.pair_side);
          expect(ps).toMatchObject({ step: p.pairing.step, tool: t.tool, depends_on: [] });
          expect(ps.why).toMatch(/^Pairing \(both sides of the place\)/);
          expect(p1).toMatchObject({ kind: 'pairing', step: ps.step, status: 'planned', decision: expect.stringContaining(t.tool) });
        } else {
          expect(p.pairing.status).toBe('already_paired');
          expect(steps(p).some((s) => s.pair_side)).toBe(false);
          expect(p1).toMatchObject({ kind: 'pairing', status: 'already_paired' });
          expect(p1.step).toBeUndefined();
        }
        expect(p.recommended_sequence.length).toBeLessThanOrEqual(6);
      });
    }
  });

  it('a pairing step comes right after the class\'s own steps, ahead of the runner-up and constraint leads', () => {
    const p = _planQuery('how soon can 100 MW get power in Texas', {});
    const ts = steps(p).map((s) => s.tool);
    expect(ts.indexOf('get_pipeline')).toBeLessThan(ts.indexOf('get_power_availability_timeline'));   // the timeline is a constraint lead
    expect(steps(p).find((s) => s.tool === 'get_power_availability_timeline').constraint).toBe('dcpi_time_to_power');
  });

  it('an already-paired record names the read by its final step number (the Capacity Source step moves last)', () => {
    const p = _planQuery('available data center capacity to buy in Dallas by 2027', {});
    const t = steps(p).find((s) => s.tool === 'get_power_availability_timeline');
    expect(steps(p)[steps(p).length - 1].tool).toBe('source_capacity');
    expect(p.pairing).toMatchObject({ side: 'power', status: 'already_paired', step: t.step, tool: 'get_power_availability_timeline' });
    expect(p.pairing.note).toContain(`(step ${t.step}, get_power_availability_timeline)`);
  });

  it('"is Atlanta a good data center market" reads Atlanta (market_outlook), not Georgia\'s ranked finalists', () => {
    const p = _planQuery('is Atlanta a good data center market', {});
    expect(p.intent_class).toBe('market_outlook');
    expect(show(p)).not.toContain('site_selection_canvas');
    expect(show(p)).not.toMatch(/"</);
    // a ranking ask stays a ranking
    expect(_planQuery('what are good data center markets in Georgia', {}).intent_class).not.toBe('market_outlook');
  });

  describe('rules', () => {
    it('never on a placeholder: an ISO with no place adds no data-center step, and says so', () => {
      const p = _planQuery('PJM interconnection queue depth', {});
      expect(steps(p).some((s) => s.pair_side)).toBe(false);
      expect(p.pairing).toMatchObject({ side: 'data_center', status: 'not_added' });
      expect(p.pairing.note).toMatch(/names a grid but no place/);
      expect(p.replay.decisions.find((d) => d.id === 'P1')).toMatchObject({ status: 'not_added' });
    });

    it('an unbound "<the market named ...>" placeholder covers nothing; a market the question named fills it', () => {
      const unbound = [{ step: 1, tool: 'get_market_dcpi_rank', args_hint: { market_slug: '<the market named in the intent, e.g. dallas>' } }];
      expect(sidesOf(unbound, false).dc).toEqual([]);
      expect(sidesOf(unbound, true).dc).toHaveLength(1);
      expect(sidesOf([{ step: 1, tool: 'get_grid_intelligence', args_hint: { iso: '<ISO serving the state>' } }]).power).toEqual([]);
      // Texas names no market: the plan's DCPI step stays a placeholder, so the pipeline is added for TX
      expect(_planQuery('how soon can 100 MW get power in Texas', {}).pairing).toMatchObject({ status: 'added', tool: 'get_pipeline' });
      // Dallas fills it: the DCPI step is the data-center side, nothing is added
      expect(_planQuery('find 50 MW in Dallas', {}).pairing).toMatchObject({ status: 'already_paired', tool: 'get_market_dcpi_rank' });
    });

    it('never a market or state on a step whose grid does not serve it', () => {
      const a = _planQuery('ERCOT headroom in Columbus Ohio', {});
      expect(steps(a).some((s) => s.pair_side)).toBe(false);
      expect(a.pairing.note).toBe('ERCOT does not serve Columbus (its grid is PJM), so no data-center step was added for it.');
      const b = _planQuery('PJM headroom in Columbus, GA', {});
      expect(steps(b).some((s) => s.pair_side)).toBe(false);
      expect(b.pairing.note).toBe('PJM does not serve GA, so no data-center step was added for it.');
      // the grid that does serve the place pairs
      expect(_planQuery('PJM headroom in Columbus Ohio', {}).pairing).toMatchObject({ status: 'added', tool: 'get_market_intel' });
    });

    it('more than one place: no single-place pairing step', () => {
      const p = _planQuery('grid headroom in Texas and Ohio for 100 MW', {});
      expect(steps(p).some((s) => s.pair_side)).toBe(false);
      expect(p.pairing).toMatchObject({ status: 'not_added' });
      expect(p.pairing.note).toMatch(/more than one place/);
    });

    it('a market on no US RTO gets its state\'s power timeline, never a grid label as iso', () => {
      const d = { __outlook: { slug: 'phoenix', intel: 'phoenix', name: 'Phoenix', state: 'AZ', iso: 'WECC', rto: null }, states: [] };
      const h = { rtos: new Set(['ERCOT', 'PJM', 'MISO', 'SPP', 'CAISO', 'NYISO', 'ISONE', 'ISO-NE']), stateIso: { AZ: ['WECC'] },
        usMarketState: (o) => o.state, stateScope: () => null };
      const r = pairStepFor('facility_search', d, [{ step: 1, tool: 'search_facilities', args_hint: { query: 'Phoenix', state: 'AZ' } }], h);
      expect(r.step).toMatchObject({ tool: 'get_power_availability_timeline', args_hint: { state: 'AZ' }, pair_side: 'power' });
      expect(JSON.stringify(r.step)).not.toContain('WECC');
    });

    it('a class outside the pairing sets gets no record', () => {
      expect(_planQuery('compare Phoenix vs Columbus for hyperscale', {}).pairing).toBeUndefined();
    });

    it('a non-US country plan is re-read: its own reads cover the side, or it says no US step was added', () => {
      expect(_planQuery('power outlook for Germany', {}).pairing).toMatchObject({ status: 'already_paired', tool: 'get_grid_data' });
      expect(_planQuery('grid headroom in Ireland', {}).pairing).toMatchObject({ status: 'already_paired', tool: 'search_facilities' });
    });
  });

  describe('the step budget', () => {
    const seq = [
      { step: 1, tool: 'get_interconnection_queue', depends_on: [] },
      { step: 2, tool: 'get_refined_queue', depends_on: [] },
      { step: 3, tool: 'analyze_site', depends_on: [2] },
      { step: 4, tool: 'get_market_intel', depends_on: [], pair_side: 'data_center', args_hint: { market: 'dallas' } },
      { step: 5, tool: 'get_tax_incentives', depends_on: [] },
      { step: 6, tool: 'source_capacity', depends_on: [1, 2, 3, 4, 5], routing: 'capacity_procurement' },
    ];
    const pair = seq[3];
    it('held back when the slots left would not cover the class steps still to run (analyze_site waits on wave 2)', () => {
      expect(pairHeldBack(seq, pair, new Set([1, 2]), 2, 3)).toBe(true);    // analyze_site still needs the third slot
      expect(pairHeldBack(seq, pair, new Set([1, 2]), 2, 4)).toBe(false);   // room for both
      expect(pairHeldBack(seq, pair, new Set([1, 2, 3]), 3, 4)).toBe(false);
      // later steps (a constraint lead, the capacity step) are not protected ahead of it
      expect(pairHeldBack(seq, pair, new Set([1, 2, 3]), 3, 5)).toBe(false);
    });
    it('the held-back note names the side, the call and max_steps', () => {
      expect(pairHeldNote(pair, 3)).toBe('pairing step held back: max_steps 3 leaves no room after the steps that answer the question. '
        + 'The data-center side was not read: call get_market_intel {"market":"dallas"} directly, or raise max_steps (up to 8).');
    });
  });

  describe('the answer lines', () => {
    it('each side is dated by its own step; a step with no as_of is said to be undated, never given another\'s date', () => {
      const executed = [
        { step: 1, tool: 'get_grid_intelligence', status: 'executed', args: { iso: 'PJM' },
          result: { iso: 'PJM', avg_time_to_power_months: 40, dcpi_computed_at: '2026-11-16T00:41:02Z', retail_price_cents_kwh: 9.1, as_of: '2026-11-16T00:00:00Z' } },
        { step: 2, tool: 'get_interconnection_queue', status: 'executed', args: { iso: 'PJM' }, result: { iso: 'PJM' } },
        { step: 4, tool: 'get_market_intel', status: 'executed', pair_side: 'data_center', args: { market: 'columbus' },
          result: { market: { name: 'Columbus' }, as_of: '2026-10-13T21:06:18', stats: { facility_count: 112 }, siting: { dcpi: { verdict: 'AVOID', as_of: '2026-11-15T00:00:00Z' } } } },
      ];
      const r = pairLines(executed);
      expect(r.data_center.line).toBe('DATA CENTER SIDE (step 4, get_market_intel): Columbus: 112 facilities tracked (as of 2026-10-13); '
        // DCPI dates are said as the America/Phoenix day (lib/cite-day.mjs): 00:00Z on 11-15 is 11-14 there.
        + 'Data Center Power Index (DCPI) verdict AVOID (as of 2026-11-14). Source: DC Hub (dchub.cloud).');
      expect(r.power.line).toBe('POWER SIDE (step 1, get_grid_intelligence): PJM: average time to power 40 months (as of 2026-11-16); '
        + 'retail electricity 9.1 cents/kWh (as of 2026-11-16). Source: DC Hub (dchub.cloud).');
      expect(r.lines).toEqual([r.data_center.line, r.power.line]);
      // only the queue step on the power side, and it names no date
      const r2 = pairLines([executed[1], executed[2]]);
      expect(r2.power.line).toBe('POWER SIDE (step 2, get_interconnection_queue): PJM: no figure this caller can read came back (undated: the step names no as_of). Source: DC Hub (dchub.cloud).');
      expect(r2.power.as_of).toBeUndefined();
    });
    it('a pairing step that did not run says so on its side', () => {
      const r = pairLines([{ step: 4, tool: 'get_market_intel', status: 'not_run', pair_side: 'data_center', note: 'pairing step held back: x' }]);
      expect(r.data_center.line).toBe('DATA CENTER SIDE (step 4, get_market_intel): not read in this run (pairing step held back: x).');
      expect(r.power).toBeUndefined();
    });
    it('the DCPI card is named in full', () => {
      const r = pairLines([{ step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'dallas' },
        result: { market_slug: 'dallas', verdict: 'CAUTION', composite_score: 42, computed_at: '2026-11-14T00:39:23Z' } }]);
      // computed_at 00:39Z on 11-14 is 11-13 in America/Phoenix (lib/cite-day.mjs).
      expect(r.data_center.line).toBe('DATA CENTER SIDE (step 1, get_market_dcpi_rank): dallas: Data Center Power Index (DCPI) verdict CAUTION, composite score 42 (as of 2026-11-13). Source: DC Hub (dchub.cloud).');
    });
  });
});
