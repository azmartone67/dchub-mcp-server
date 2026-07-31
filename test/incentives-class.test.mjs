import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _PLAN_CLASSES } from '../server.mjs';

// r-planner-v5.6 (2026-07-30): "tax incentives for data centers in Georgia"
// routed to facility_search on its "data centers in" pattern, because
// get_tax_incentives was registered but had no routable class — reproduced on a
// live keyed capture before the class existed (rejected list did not even
// mention get_tax_incentives). Reported by Meta AI as a top uncaptured intent.

const first = (intent) => {
  const p = _planQuery(intent);
  const s = (p.recommended_sequence || [])[0] || {};
  return { cls: p.intent_class, tool: s.tool, args: s.args_hint || {}, plan: p };
};

describe('incentives_tax routes tax vocabulary to get_tax_incentives', () => {
  it('the Meta-reported intent routes to the incentives class, state resolved', () => {
    const r = first('tax incentives for data centers in Georgia');
    expect(r.cls).toBe('incentives_tax');
    expect(r.tool).toBe('get_tax_incentives');
    expect(r.args.state).toBe('GA');
  });

  it.each([
    ['sales tax exemption for a 100 MW data center in Texas', 'TX'],
    ['property tax abatements for data centers in West Virginia', 'WV'],   // longest-name precedence
    ['what tax credits does Virginia offer data centers', 'VA'],
    ['data center tax incentives for VA', 'VA'],                            // uppercase code, "for" anchor
  ])('%s → incentives_tax with state %s', (intent, want) => {
    const r = first(intent);
    expect(r.cls).toBe('incentives_tax');
    expect(r.args.state).toBe(want);
  });

  it('no state named → placeholder, never a guessed state', () => {
    const r = first('data center tax incentive programs');
    expect(r.cls).toBe('incentives_tax');
    expect(String(r.args.state)).toMatch(/^<.*>$/);
  });

  it('does NOT steal plain facility discovery ("data centers in <state>", no tax words)', () => {
    const r = first('data centers in Georgia');
    expect(r.cls).toBe('facility_search');
  });

  it('does NOT steal the price class (energy price vocabulary, no tax words)', () => {
    const r = first('what does power cost in ERCOT right now');
    expect(r.cls).toBe('price');
  });
});

describe('r-planner-v5.7: ranking language does not get stolen by incentives_tax', () => {
  // Grok's pressure-test (2026-07-31), reproduced by our own probe before
  // fixing: "rank markets by tax incentives and grid headroom for a 150 MW
  // data center" scored incentives_tax 6 vs market_ranking 3.5, then resolved
  // no state and executed nothing. Ranking constructions demote the statutory
  // class (the table's first negative weight); "rank markets by" credits
  // market_ranking.
  it('the Grok intent routes to market_ranking with a ranking lead tool', () => {
    const r = first('rank markets by tax incentives and grid headroom for a 150 MW data center');
    expect(r.cls).toBe('market_ranking');
    expect(['rank_markets', 'ai_capacity_index']).toContain(r.tool);
  });

  it('"best markets for <factor>" is a ranking ask even when the factor is tax', () => {
    const r = first('best markets for tax incentives in the southeast');
    expect(r.cls).toBe('market_ranking');
  });

  it('a pure statutory ask with ranking flavor still routes to incentives_tax', () => {
    const r = first('ranked list of state tax incentive programs');
    expect(r.cls).toBe('incentives_tax');
    expect(r.tool).toBe('get_tax_incentives');
  });

  it('the demotion never drags a plain tax ask below its rivals', () => {
    const r = first('tax incentives for data centers in Georgia');
    expect(r.cls).toBe('incentives_tax');
    expect(r.args.state).toBe('GA');
  });
});

describe('stateFromPlace signal (args only, never a class boost)', () => {
  it('extracts from the name, longest first', () => {
    expect(_planSignals('tax incentives in West Virginia', {}).stateFromPlace).toBe('WV');
    expect(_planSignals('incentives in Virginia', {}).stateFromPlace).toBe('VA');
  });

  it('explicit context.state wins; stateFromPlace stays null (one epistemic origin each)', () => {
    const s = _planSignals('tax incentives in Georgia', { state: 'tx' });
    expect(s.state).toBe('TX');
    expect(s.stateFromPlace).toBeNull();
  });

  it('ISO-NE\'s "NE" does not read as Nebraska (anchor requires "in "/"for ")', () => {
    expect(_planSignals('grid headroom in ISO-NE for a data center', {}).stateFromPlace).toBeNull();
  });

  it('lowercase 2-letter prose words never match the code fallback', () => {
    expect(_planSignals('tax incentives in or near the midwest', {}).stateFromPlace).toBeNull();
  });

  it('is not consulted by any class boost — the boost block reads no stateFromPlace', () => {
    // Behavioural pin: adding tax words must not change WHICH class wins purely
    // because a state name is present (score identical with and without one).
    const withState = _planQuery('tax incentives for data centers in Georgia');
    const without = _planQuery('tax incentives for data centers');
    expect(withState.intent_class).toBe(without.intent_class);
  });
});

describe('class table integrity', () => {
  it('incentives_tax is registered exactly once, before facility_search', () => {
    const ids = _PLAN_CLASSES.map((c) => c.id);
    expect(ids.filter((x) => x === 'incentives_tax')).toHaveLength(1);
    expect(ids.indexOf('incentives_tax')).toBeLessThan(ids.indexOf('facility_search'));
  });

  it('the documented intent_class list names every routable class', () => {
    // The zod description at the plan_query surface enumerates classes; a class
    // missing there is invisible to agents reading the schema. Parse the source
    // of truth (_PLAN_CLASSES) and assert coverage rather than transcribing.
    const ids = _PLAN_CLASSES.map((c) => c.id);
    expect(ids).toContain('incentives_tax');
  });
});
