// ── execute_plan: one named market is read as itself (#118011, #117816/#117817) ──
//
// Live 2026-11-07 18:07Z, anonymous execute_plan "What is the data center power
// outlook for San Antonio?": intent_class unknown, the fallback ran
// get_dchub_recommendation, and the answer led with "Midland–Odessa: BUILD".
// Phoenix and Las Vegas did the same (#117816/#117817). The #117661 guard drops
// a verdict from another ISO, but San Antonio and Midland–Odessa are both ERCOT,
// so only a market-level check can catch it.
//
// What fails here:
//   - a single-metro outlook question routed to anything but that metro's own reads;
//   - the unknown fallback running get_dchub_recommendation again;
//   - an untracked place swapped for a tracked one instead of reported unresolved;
//   - a head-to-head or a ranking ask captured by the single-market class;
//   - answer_guide leading with a same-ISO verdict for a different market.
// Pure functions, no network. The end-to-end half is
// test/market-outlook-e2e.test.mjs (it must not import server.mjs statically:
// PORT is read at import, before the harness sets it).
import { describe, it, expect } from 'vitest';
import { _planQuery, _execAnswerGuide, _execSameMarket, _execResolveArgs } from '../server.mjs';

const tools = (p) => p.recommended_sequence.map((s) => s.tool);
const step = (p, tool) => p.recommended_sequence.find((s) => s.tool === tool);
// Tools that pick their own markets: none may run for a one-market question.
const stateOf = { 'san-antonio': 'TX', phoenix: 'AZ', 'las-vegas': 'NV' };
const PICKERS = ['get_dchub_recommendation', 'rank_markets', 'site_selection_canvas', 'ai_capacity_index'];

describe('a named tracked metro routes to its own reads', () => {
  const cases = [
    // 5.17: both steps take the index's canonical slug (DCPI accepts it too).
    ['What is the data center power outlook for San Antonio?', 'san-antonio', 'san-antonio', 'ERCOT'],
    ['power outlook for Phoenix', 'phoenix', 'phoenix', null],
    ['What is the data center power outlook for Las Vegas?', 'las-vegas', 'las-vegas', null],
    ['Tell me about the San Antonio data center market', 'san-antonio', 'san-antonio', 'ERCOT'],
  ];
  for (const [q, dcpi, intel, iso] of cases) {
    it(q, () => {
      const p = _planQuery(q, {});
      expect(p.intent_class).toBe('market_outlook');
      expect(step(p, 'get_market_dcpi_rank').args_hint).toEqual({ market_slug: dcpi });
      // get_market_intel 404s on 'san-antonio-tx' and resolves 'san-antonio' (live 2026-11-07).
      expect(step(p, 'get_market_intel').args_hint).toEqual({ market: intel });
      for (const t of PICKERS) expect(tools(p), t).not.toContain(t);
      // The grid step runs only for a real RTO; WECC is not a valid iso arg.
      if (iso) {
        expect(step(p, 'get_grid_intelligence').args_hint).toEqual({ iso });
        expect(tools(p)).not.toContain('get_power_availability_timeline');
      } else {
        expect(tools(p)).not.toContain('get_grid_intelligence');
        // 5.21: a market on no RTO reads the power side for its state instead of nothing.
        expect(step(p, 'get_power_availability_timeline').args_hint).toEqual({ state: stateOf[dcpi] });
      }
      expect(p.unresolved).toBeUndefined();
    });
  }

  it('a caller-typed market wins over the text and passes as typed', () => {
    const p = _planQuery('power outlook for this market', { market: 'reno' });
    expect(p.intent_class).toBe('market_outlook');
    expect(step(p, 'get_market_dcpi_rank').args_hint).toEqual({ market_slug: 'reno' });
    expect(step(p, 'get_market_intel').args_hint).toEqual({ market: 'reno' });
  });
});

describe('a place we do not track is unresolved, never replaced', () => {
  it('"power outlook for Timbuktu" names the phrase and binds nothing', () => {
    const p = _planQuery('power outlook for Timbuktu', {});
    expect(p.intent_class).toBe('market_outlook');
    expect(p.unresolved).toMatchObject({ kind: 'market_not_matched', phrase: 'Timbuktu' });
    expect(p.unresolved.note).toMatch(/does not substitute another market/);
    for (const t of PICKERS) expect(tools(p), t).not.toContain(t);
    // The executor cannot fill the market steps from anywhere: they read
    // skipped_unresolved rather than running for some other market.
    for (const tool of ['get_market_dcpi_rank', 'get_market_intel']) {
      const r = _execResolveArgs(step(p, tool).args_hint, {}, {}, false);
      expect(r.unresolved, tool).toBeTruthy();
    }
  });
});

describe('an unmatched question runs the navigator only', () => {
  for (const q of ['what is going on with data centers', 'hello there']) {
    it(q, () => {
      const p = _planQuery(q, {});
      expect(p.intent_class).toBe('unknown');
      expect(tools(p)).toEqual(['discover_tools']);
      expect(p.unresolved && p.unresolved.kind).toBe('no_intent_match');
      // Still offered, never run.
      expect(p.alternatives.map((a) => a.tool)).toContain('get_dchub_recommendation');
    });
  }
});

describe('multi-market asks keep their own classes', () => {
  it('a head-to-head keeps both sides, outlook wording or not', () => {
    for (const q of ['compare Dallas vs Phoenix', 'power outlook for Dallas vs Phoenix',
                     'compare San Antonio and Phoenix']) {
      const p = _planQuery(q, {});
      expect(p.intent_class, q).toBe('market_comparison');
      expect(p.recommended_sequence.filter((s) => s.tool === 'get_market_dcpi_rank')).toHaveLength(2);
    }
  });

  it('a ranking ask with outlook wording stays a ranking', () => {
    expect(_planQuery('rank markets with the best power outlook', {}).intent_class).toBe('market_ranking');
    const tx = _planQuery('rank markets for a 200 MW AI campus in Texas within 24 months', {});
    expect(tx.intent_class).toBe('market_ranking');
    expect(tools(tx)[0]).toBe('site_selection_canvas');
  });
});

describe('answer_guide holds the market, not just the ISO', () => {
  const run = [
    { step: 1, tool: 'get_market_dcpi_rank', status: 'executed',
      result: { market_slug: 'san-antonio', market_name: 'San Antonio', iso: 'ERCOT', verdict: 'CAUTION', composite_score: 42.3 } },
    { step: 2, tool: 'get_market_intel', status: 'executed',
      result: { nearby: [{ market: 'Midland–Odessa', iso: 'ERCOT', verdict: 'BUILD' }] } },
  ];

  it('drops a same-ISO verdict for another market when one market was asked', () => {
    const g = _execAnswerGuide(run, ['ERCOT'], 'san-antonio-tx');
    expect(g).toMatch(/LEAD WITH THE VERDICT — this run returned: san-antonio: CAUTION \(42\.3\)\./);
    expect(g).not.toMatch(/Midland/);
  });

  it('without a market constraint the old behaviour stands (both kept)', () => {
    expect(_execAnswerGuide(run, ['ERCOT'])).toMatch(/Midland–Odessa: BUILD/);
  });

  it('_execSameMarket matches slug, bare slug and display name; rejects others', () => {
    expect(_execSameMarket('San Antonio', 'san-antonio-tx')).toBe(true);
    expect(_execSameMarket('san-antonio', 'san-antonio-tx')).toBe(true);
    expect(_execSameMarket('las-vegas-nv', 'las-vegas-nv')).toBe(true);
    expect(_execSameMarket('Midland–Odessa', 'san-antonio-tx')).toBe(false);
    expect(_execSameMarket('San Diego', 'san-antonio-tx')).toBe(false);
    expect(_execSameMarket(null, 'san-antonio-tx')).toBe(true);   // no name: nothing to judge
  });
});


describe('5.21: a market on no US RTO gets a state-level power read (orchestration gap, 2026-11-12)', () => {
  it('"power and interconnection outlook for Phoenix" plans DCPI, brief and the Arizona timeline, in one wave', () => {
    const p = _planQuery('What is the power and interconnection outlook for data centers in Phoenix?', {});
    expect(p.intent_class).toBe('market_outlook');
    expect(tools(p)).toEqual(['get_market_dcpi_rank', 'get_market_intel', 'get_power_availability_timeline']);
    const s3 = step(p, 'get_power_availability_timeline');
    expect(s3.args_hint).toEqual({ state: 'AZ' });
    expect(s3.depends_on).toEqual([]);                 // independent: same wave as steps 1 and 2
    expect(s3.why).toMatch(/does not score the market/);
    for (const t of PICKERS) expect(tools(p), t).not.toContain(t);
  });
  it('an RTO market is unchanged: DCPI, brief, grid; no timeline step', () => {
    const p = _planQuery('What is the data center power outlook for San Antonio?', {});
    expect(tools(p)).toEqual(['get_market_dcpi_rank', 'get_market_intel', 'get_grid_intelligence']);
  });
  it('the kill switch DCHUB_OUTLOOK_STATE_TIMELINE=0 restores the two-step plan', () => {
    process.env.DCHUB_OUTLOOK_STATE_TIMELINE = '0';
    try {
      const p = _planQuery('power outlook for Phoenix', {});
      expect(tools(p)).toEqual(['get_market_dcpi_rank', 'get_market_intel']);
    } finally { delete process.env.DCHUB_OUTLOOK_STATE_TIMELINE; }
  });
  it('an untracked place is still unresolved and gets no state step', () => {
    const p = _planQuery('power outlook for Timbuktu', {});
    expect(tools(p)).not.toContain('get_power_availability_timeline');
    expect(p.unresolved).toMatchObject({ kind: 'market_not_matched' });
  });
  it('a non-US market (a country code in the state slot) gets no state step', () => {
    for (const q of ['power outlook for Mexico City', 'power outlook for Singapore']) {
      const p = _planQuery(q, {});
      expect(p.intent_class).toBe('market_outlook');
      expect(tools(p), q).not.toContain('get_power_availability_timeline');
    }
  });
  it('the step arg is a 2-letter state the tool accepts (never a slug or a name)', () => {
    for (const q of ['power outlook for Phoenix', 'power outlook for Las Vegas']) {
      const a = step(_planQuery(q, {}), 'get_power_availability_timeline').args_hint;
      expect(a.state).toMatch(/^[A-Z]{2}$/);
    }
  });
});
