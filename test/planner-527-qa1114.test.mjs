// planner-527-qa1114.test.mjs — planner 5.27, live QA sweep of 2026-11-14 (execute_plan).
//
// Bug 1: "Rank markets for a 200 MW AI campus" led with ai_capacity_index (market depth; its top two
//   were DCPI AVOID). A ranking by suitability is rank_markets criteria=ai_ready, and the answer
//   (ranked_answer, answer_guide) leads with the best buildable market, never an AVOID one.
// Bug 2: "this week" ran a 24h window and the named grid/market was dropped. The window binds
//   since= / date_from=; the place reaches get_news query= (and get_facility_risk_delta market=).
// Bug 3: "water risk and tax incentives for a data center in Phoenix": no water step, and both
//   steps carried a '<2-letter US state>' placeholder. Now get_water_risk location=phoenix and
//   get_tax_incentives state=AZ.
// Bug 4: the queue answer said "the queue tool has no state filter" on a read the backend had
//   filtered by state= (5.15 added it).
// Bug 5: one time-to-power value on every queue row read as a range ("32.6-32.6 months").
//
// Planner-level and pure-function tests, no network. The execute_plan runs are in
// test/planner-527-qa1114-e2e.test.mjs.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planRelativeWindow, _planChangesPlace, _planSignals, _planWaterWhere,
  _execAnswerGuide, PLANNER_VERSION } from '../server.mjs';
import { buildRankedAnswer } from '../lib/ranked-answer.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';

const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint]));
const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const step = (p, tool) => p.recommended_sequence.find((s) => s.tool === tool);

describe('planner 5.27', () => {
  it('PLANNER_VERSION is 5.27', () => { expect(PLANNER_VERSION).toBe('5.27'); });
});

describe('bug 1: an AI-campus ranking leads with rank_markets criteria=ai_ready', () => {
  for (const q of ['Rank markets for a 200 MW AI campus', 'rank markets for a 200 MW AI campus',
    'best markets for a GPU cluster', 'top markets for AI training']) {
    it(q, () => {
      const p = _planQuery(q, {});
      expect(p.intent_class, show(p)).toBe('market_ranking');
      expect(tools(p)[0], show(p)).toBe('rank_markets');
      expect(p.recommended_sequence[0].args_hint, show(p)).toMatchObject({ criteria: 'ai_ready' });
      expect(tools(p), show(p)).not.toContain('ai_capacity_index');
      expect(tools(p), show(p)).toContain('get_market_dcpi_rank');
    });
  }
  it('the campus size is not passed as min_capacity_mw (a market\'s EXISTING capacity)', () => {
    const p = _planQuery('Rank markets for a 200 MW AI campus', {});
    expect(p.recommended_sequence[0].args_hint.min_capacity_mw).toBeUndefined();
  });
  it('a stated deployment horizon keeps ai_capacity_index', () => {
    const p = _planQuery('where can 100 MW of AI capacity land in the next 90 days', {});
    expect(tools(p)[0], show(p)).toBe('ai_capacity_index');
  });
  it('a state-scoped AI ranking still leads with site_selection_canvas', () => {
    const p = _planQuery('rank markets for a 200 MW AI campus in Texas', {});
    expect(tools(p)[0], show(p)).toBe('site_selection_canvas');
  });
  it('a non-AI ranking is unchanged (best_overall)', () => {
    const p = _planQuery('rank the best data center markets', {});
    expect(p.recommended_sequence[0].args_hint, show(p)).toMatchObject({ criteria: 'best_overall' });
  });
});

describe('bug 1: ranked_answer from rank_markets ai_ready never leads with AVOID', () => {
  const rk = { step: 1, tool: 'rank_markets', status: 'executed', args: { criteria: 'ai_ready', limit: 10 } };
  const dc = (slug, verdict, score) => ({ step: 2, tool: 'get_market_dcpi_rank', status: 'executed',
    args: { market_slug: slug }, _full: { verdict, composite_score: score, time_to_power_months: 12 } });
  const RANK = { criteria: 'ai_ready', results: [
    { rank: 1, market: 'Ashburn', slug: 'ashburn', state: 'VA', dcpi_verdict: 'AVOID', score: 30 },
    { rank: 2, market: 'Boise', slug: 'boise', state: 'ID', dcpi_verdict: 'BUILD', score: 71.22 },
    { rank: 3, market: 'Reno', slug: 'reno', state: 'NV', dcpi_verdict: 'CAUTION', score: 44.08 },
  ] };
  function run(rows, dcpi = []) {
    const executed = [rk, ...dcpi];
    const full = new Map([[rk, rows], ...dcpi.map((s) => [s, s._full])]);
    return buildRankedAnswer('Rank markets for a 200 MW AI campus', 'market_ranking', executed, full);
  }
  it('headline leads with the best BUILD market and the list puts AVOID last', () => {
    const r = run(RANK);
    expect(r, 'ranked_answer built from rank_markets').toBeTruthy();
    expect(r.source).toBe('rank_markets_ai_ready');
    expect(r.headline.startsWith('Best checked market: Boise, ID, DCPI BUILD (71.22)'), r.headline).toBe(true);
    expect(r.markets[0].verdict).toBe('BUILD');
    expect(r.markets.map((m) => m.verdict)).toEqual(['BUILD', 'CAUTION', 'AVOID']);
    expect(r.markets[2].rank).toBe(1);   // the source rank is kept
  });
  it('a DCPI card read in the run overrides the row verdict', () => {
    const r = run(RANK, [dc('ashburn', 'BUILD', 80)]);
    expect(r.markets[0].market).toBe('ashburn');
    expect(r.markets[0].composite_score).toBe(80);
  });
  it('the capacity-index source also lists AVOID last and leads with the best', () => {
    const idx = { step: 1, tool: 'ai_capacity_index', status: 'executed', args: {} };
    const markets = [{ market: 'ashburn-va', rank: 1, city: 'Ashburn', state: 'VA', score: 450, deployable_mw: { value: 500 } },
      { market: 'columbus-oh', rank: 2, city: 'Columbus', state: 'OH', score: 300, deployable_mw: { value: 400 } }];
    const d1 = dc('ashburn-va', 'AVOID', 26.7), d2 = dc('columbus-oh', 'BUILD', 71.2);
    const r = buildRankedAnswer('rank markets for a 200 MW AI campus', 'market_ranking', [idx, d1, d2],
      new Map([[idx, { markets }], [d1, d1._full], [d2, d2._full]]));
    expect(r.headline.startsWith('Best checked market: Columbus, OH'), r.headline).toBe(true);
    expect(r.markets[0].market).toBe('columbus-oh');
  });
});

describe('bug 1: answer_guide of a ranking lists the buildable verdict first', () => {
  const ex = [
    { step: 2, tool: 'get_market_dcpi_rank', status: 'executed', result: { market_slug: 'ashburn', verdict: 'AVOID', composite_score: 26.7 } },
    { step: 2, tool: 'get_market_dcpi_rank', status: 'executed', result: { market_slug: 'northern-virginia', verdict: 'AVOID', composite_score: 28 } },
    { step: 2, tool: 'get_market_dcpi_rank', status: 'executed', result: { market_slug: 'columbus', verdict: 'BUILD', composite_score: 71 } },
  ];
  it('rankForBuild leads with BUILD and names AVOID as not the pick', () => {
    const g = _execAnswerGuide(ex, [], null, null, true);
    expect(g).toMatch(/best first: columbus: BUILD \(71\) · ashburn: AVOID/);
    expect(g).toMatch(/never as the pick/);
  });
  it('a non-ranking run keeps read order', () => {
    expect(_execAnswerGuide(ex)).toMatch(/this run returned: ashburn: AVOID \(26\.7\) · northern-virginia: AVOID/);
  });
});

describe('bug 2: relative windows bind, and the named place is carried', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  it('_planRelativeWindow: this week 7d, this month 30d, today 24h', () => {
    expect(_planRelativeWindow('what changed in PJM this week', now)).toMatchObject({ days: 7, since: '7d', date_from: '2026-11-07' });
    expect(_planRelativeWindow('deals this month', now)).toMatchObject({ days: 30, since: '30d', date_from: '2026-10-15' });
    expect(_planRelativeWindow('what changed today', now)).toMatchObject({ days: 1, since: '24h' });
    expect(_planRelativeWindow('news in the past 3 days', now)).toMatchObject({ days: 3, since: '3d' });
    expect(_planRelativeWindow('what changed since my last check', now)).toBeNull();
  });
  it('"what changed in PJM this week": since=7d and get_news query=PJM from 7 days back', () => {
    const p = _planQuery('what changed in PJM this week', {});
    expect(p.intent_class, show(p)).toBe('changes_delta');
    expect(step(p, 'get_changes').args_hint, show(p)).toEqual({ since: '7d' });
    const news = step(p, 'get_news');
    expect(news, show(p)).toBeTruthy();
    expect(news.args_hint.query).toBe('PJM');
    expect(news.args_hint.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('"data center news this week": get_news with the 7-day date_from', () => {
    const p = _planQuery('data center news this week', {});
    expect(step(p, 'get_changes').args_hint.since, show(p)).toBe('7d');
    expect(step(p, 'get_news'), show(p)).toBeTruthy();
    expect(step(p, 'get_news').args_hint.date_from).toBe(_planRelativeWindow('this week').date_from);
  });
  it('"what changed in Dallas this month": 30d, news about Dallas, and the market risk delta', () => {
    const p = _planQuery('what changed in Dallas this month', {});
    expect(step(p, 'get_changes').args_hint.since, show(p)).toBe('30d');
    expect(step(p, 'get_news').args_hint.query, show(p)).toBe('Dallas');
    expect(step(p, 'get_facility_risk_delta').args_hint, show(p)).toEqual({ market: 'dallas', since: '30d' });
  });
  it('a typed context.since still wins', () => {
    const p = _planQuery('what changed this week', { since: '2026-11-10' });
    expect(step(p, 'get_changes').args_hint.since).toBe('2026-11-10');
  });
  it('no window named: unchanged (24h, no news step)', () => {
    const p = _planQuery('what has changed since my last check', {});
    expect(step(p, 'get_changes').args_hint).toEqual({ since: '24h' });
    expect(tools(p)).not.toContain('get_news');
  });
  it('deals this month: list_transactions gets date_from', () => {
    const p = _planQuery('data center deals this month in Texas', {});
    expect(step(p, 'list_transactions').args_hint.date_from, show(p)).toBe(_planRelativeWindow('this month').date_from);
  });
  it('_planChangesPlace: grid, market, state', () => {
    expect(_planChangesPlace(_planSignals('what changed in PJM this week', {}))).toMatchObject({ kind: 'iso', query: 'PJM' });
    expect(_planChangesPlace(_planSignals('what changed in Dallas', {}))).toMatchObject({ kind: 'market', market: 'dallas' });
    expect(_planChangesPlace(_planSignals('what changed in Ohio this week', {}))).toMatchObject({ kind: 'state', query: 'Ohio' });
  });
});

describe('bug 3: water + tax for Phoenix binds both reads to the place', () => {
  const q = 'water risk and tax incentives for a data center in Phoenix';
  it('get_tax_incentives state=AZ and a get_water_risk step at Phoenix', () => {
    const p = _planQuery(q, {});
    expect(step(p, 'get_tax_incentives').args_hint, show(p)).toEqual({ state: 'AZ' });
    expect(step(p, 'get_energy_prices').args_hint.state, show(p)).toBe('AZ');
    const w = step(p, 'get_water_risk');
    expect(w, show(p)).toBeTruthy();
    expect(w.args_hint, show(p)).toEqual({ location: 'phoenix' });
    const placeholders = p.recommended_sequence.filter((s) => Object.values(s.args_hint || {}).some((v) => typeof v === 'string' && /^</.test(v)));
    expect(placeholders.map((s) => s.tool), show(p)).toEqual([]);
  });
  it('"water risk in Phoenix" reads the Phoenix market, not a state placeholder', () => {
    const p = _planQuery('water risk in Phoenix', {});
    expect(step(p, 'get_water_risk').args_hint, show(p)).toEqual({ location: 'phoenix' });
  });
  it('a state named: water reads the state', () => {
    const p = _planQuery('tax incentives and water for data centers in Georgia', {});
    expect(step(p, 'get_water_risk').args_hint, show(p)).toEqual({ state: 'GA' });
  });
  it('_planWaterWhere: point first, then market, then state, else null', () => {
    expect(_planWaterWhere({ coords: { lat: 1, lon: 2 } })).toEqual({ lat: 1, lon: 2 });
    expect(_planWaterWhere(_planSignals('in Phoenix', {}))).toEqual({ location: 'phoenix' });
    expect(_planWaterWhere(_planSignals('in Texas', {}))).toEqual({ state: 'TX' });
    expect(_planWaterWhere(_planSignals('somewhere', {}))).toBeNull();
  });
});

describe('bug 4 + 5: queue answer text', () => {
  const ex = (queue, args = {}) => {
    const e = { step: 1, tool: 'get_refined_queue', status: 'executed', args };
    return [[e], new Map([[e, queue]])];
  };
  const ia = (queue, args, intent = 'how soon can I get 100 MW in Texas') => {
    const [executed, full] = ex(queue, args);
    return buildIntentAnswer({ intent, intent_class: 'grid_headroom', constraint_iso: ['ERCOT'] }, executed, full,
      Date.parse('2026-11-14T00:00:00Z'));
  };
  it('server-side state filter: says it was filtered, never "no state filter"', () => {
    const r = ia({ count_total_matching: 42, results: [{ state: 'TX' }], filters_applied: { state: 'TX' },
      scope: { state: 'TX', kept: 1, filtered_server_side: true } }, { state: 'TX' });
    const txt = r.evidence.join(' ') + ' ' + r.not_established.join(' ');
    expect(txt).not.toMatch(/no state filter/);
    expect(txt).toMatch(/42 active interconnection-queue projects in TX \(the queue was filtered to TX server-side\)/);
  });
  it('cut after the call: says state= was not applied, not that the tool has no filter', () => {
    const r = ia({ results: [{ state: 'TX' }], scope: { state: 'TX', kept: 1, dropped_out_of_state: 3, dropped_state_unreadable: 0 } }, { state: 'TX' });
    const txt = r.evidence.join(' ');
    expect(txt).not.toMatch(/no state filter/);
    expect(txt).toMatch(/state=TX was asked but not applied/);
  });
  it('one ISO-wide time-to-power on every row is a single value, not "32.6-32.6"', () => {
    const r = ia({ count_total_matching: 3, results: [{ estimated_ttp_months: 32.6 }, { estimated_ttp_months: 32.6 }, { estimated_ttp_months: 32.6 }] }, {},
      'how soon can a 100 MW load get power in ERCOT');
    const txt = r.evidence.join(' ');
    expect(txt).not.toMatch(/32\.6-32\.6/);
    expect(txt).toMatch(/32\.6 months on every queue row shown \(3 rows\), an ISO-wide estimate/);
  });
  it('a real spread is still a range', () => {
    const r = ia({ count_total_matching: 2, results: [{ estimated_ttp_months: 12 }, { estimated_ttp_months: 36 }] }, {},
      'how soon can a 100 MW load get power in ERCOT');
    expect(r.evidence.join(' ')).toMatch(/12-36 months/);
  });
});
