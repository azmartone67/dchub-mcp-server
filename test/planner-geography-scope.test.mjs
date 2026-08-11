// planner-geography-scope.test.mjs — r-planner-v5.11 (2026-08-10)
//
// THE WRONG ANSWER THIS GUARDS
// Live, keyless, against dchub.cloud/mcp — the canonical example from our own
// server instructions, with a geography added:
//
//   execute_plan(intent="rank markets for a 200 MW AI campus in Texas
//                        within 24 months")
//   → executed[0] = ai_capacity_index {horizon: 90, limit: 10}
//   → markets[0]  = Ashburn, VA        minted.iso = ["PJM"]
//
// The planner extracted the capacity ("capacity detected: 200 MW") and dropped
// the state on the floor. The args_hint for "…in Texas" and "…in Ohio" were
// byte-identical, which is the tell: this was never a ranking-quality miss, it
// was a national answer to a state question.
//
// Two independent causes, both fixed here:
//   1. NO RANKING TOOL COULD CARRY THE STATE. ai_capacity_index accepts only
//      {horizon, limit}; rank_markets' region accepts only
//      global|us|canada|eu|apac|americas. site_selection_canvas is the one
//      ranking path with a state parameter — verified against the live origin:
//      region=TX → Midland–Odessa, TX · ERCOT · BUILD.
//   2. _execConstraintIsoSet RESOLVED CITIES BUT NOT STATES, so a state-phrased
//      intent produced an EMPTY constraint set — and the C1 constraint_check
//      that exists to catch exactly this could not fire, because it is
//      predicated on `constraintIsoSet.length`. The invariant was blind on the
//      very intents it most needed to see.
import { describe, it, expect } from 'vitest';
import { _planQuery, _planSignals, _planStateScope, _execConstraintIsoSet,
         _STATE_ISO_META, _EXEC_RTOS, PLANNER_VERSION } from '../server.mjs';

const plan = (intent) => _planQuery(intent, {});
const isoSet = (intent) => _execConstraintIsoSet(intent, null, _planSignals(intent));

describe('the reported defect', () => {
  const INTENT = 'rank markets for a 200 MW AI campus in Texas within 24 months';

  it('routes the Texas intent to a tool that can express Texas', () => {
    const p = plan(INTENT);
    expect(p.intent_class).toBe('market_ranking');
    expect(p.best_tool).toBe('site_selection_canvas');
    expect(p.recommended_sequence[0].tool).toBe('site_selection_canvas');
  });

  it('passes the state through as a real argument, not just prose', () => {
    const step1 = plan(INTENT).recommended_sequence[0];
    expect(step1.args_hint.region).toBe('TX');
    expect(step1.args_hint.capacity_mw).toBe(200);   // capacity still extracted
  });

  it('no longer leads with a tool that has no geography parameter', () => {
    // The precise regression: ai_capacity_index's entire arg surface is
    // {horizon, limit}. If it ever leads a state-scoped intent again, the
    // answer is national by construction.
    expect(plan(INTENT).recommended_sequence[0].tool).not.toBe('ai_capacity_index');
  });

  it('the Texas and Ohio plans are no longer byte-identical', () => {
    // This equality WAS the bug, stated as an assertion.
    const tx = JSON.stringify(plan(INTENT).recommended_sequence[0].args_hint);
    const oh = JSON.stringify(
      plan('rank markets for a 200 MW AI campus in Ohio').recommended_sequence[0].args_hint);
    expect(tx).not.toBe(oh);
    expect(tx).toContain('TX');
    expect(oh).toContain('OH');
  });

  it('resolves Texas to an ISO set, so C1 constraint_check can fire', () => {
    const s = isoSet(INTENT);
    expect(s.length).toBeGreaterThan(0);          // was [] — C1 was unreachable
    expect(s).toContain('ERCOT');
    // The out-of-geography mint from the live failure must now be rejectable.
    expect(s).not.toContain('PJM');
  });
});

describe('geography resolution', () => {
  it('resolves a named state to its ISO set', () => {
    expect(isoSet('rank markets in Ohio')).toEqual(['PJM']);
    expect(isoSet('best markets in Georgia')).toEqual(['SERC']);
  });

  it('keeps a CITY narrower than its state — a city is more specific', () => {
    // "Dallas, Texas" must stay ERCOT, not widen to all four Texas markets.
    expect(isoSet('rank markets for a 200 MW AI campus in Dallas')).toEqual(['ERCOT']);
  });

  it('scopes a city-named ranking intent via the state in its slug', () => {
    const step1 = plan('rank markets for a 200 MW AI campus in Dallas').recommended_sequence[0];
    expect(step1.tool).toBe('site_selection_canvas');
    expect(step1.args_hint.region).toBe('TX');
  });

  it('leaves an ungeographed intent on the national AI route', () => {
    // r-planner-v4 behaviour must be untouched when no geography is named.
    const p = plan('rank markets for a 200 MW AI campus');
    expect(p.best_tool).toBe('ai_capacity_index');
    expect(p.recommended_sequence[0].args_hint.region).toBeUndefined();
    expect(isoSet('rank markets for a 200 MW AI campus')).toEqual([]);
  });

  it('falls through nationally for a state we cannot resolve', () => {
    // Better to answer nationally than to pass a region filter that returns
    // zero rows and reads as "no markets exist there".
    expect(_planStateScope({ state: 'ZZ' })).toBeNull();
    expect(_planStateScope({ stateFromPlace: null })).toBeNull();
    expect(_planStateScope({ __citySlug: 'northern-virginia' })).toBeNull();
    expect(_planStateScope({})).toBeNull();
    expect(_planStateScope(null)).toBeNull();
  });
});

describe('_STATE_ISO_META honesty contract', () => {
  it('emits a SET for states that genuinely span several markets', () => {
    // Claiming TX == ERCOT would be the same class of error as answering
    // Texas with Virginia: confidently wrong about real geography.
    expect(_STATE_ISO_META.TX.length).toBeGreaterThan(1);
    expect(_STATE_ISO_META.TX).toContain('ERCOT');
    expect(_STATE_ISO_META.TX).toContain('SPP');
    for (const st of ['IL', 'IN', 'MI', 'MO', 'ND', 'SD', 'VA', 'NC', 'KY', 'NM']) {
      expect(_STATE_ISO_META[st].length).toBeGreaterThan(1);
    }
  });

  it('never injects a non-RTO constraint as a tool argument', () => {
    // SERC/WECC work as constraints but are not RTOs, so they must never be
    // passed as an `iso` arg. Matches the existing atlanta→SERC precedent.
    for (const st of ['GA', 'AL', 'SC', 'FL', 'TN', 'WA', 'OR', 'AZ', 'CO', 'NV']) {
      for (const iso of _STATE_ISO_META[st]) {
        expect(_EXEC_RTOS.has(iso)).toBe(false);
      }
    }
  });

  it('only ever injects when the state names exactly one market', () => {
    // execute_plan injects `constraintIso` only at length === 1. Assert the
    // single-entry states are all genuine RTOs, so injection is always safe.
    for (const [st, isos] of Object.entries(_STATE_ISO_META)) {
      if (isos.length !== 1) continue;
      const only = isos[0];
      if (_EXEC_RTOS.has(only)) continue;
      // Non-RTO singles (SERC/WECC states) are allowed — they simply never
      // satisfy the _EXEC_IS_RTO check at the injection site.
      expect(['SERC', 'WECC']).toContain(only);
      expect(st).toBeTruthy();
    }
  });

  it('carries no duplicate ISOs within a state', () => {
    for (const [st, isos] of Object.entries(_STATE_ISO_META)) {
      expect(new Set(isos).size, `${st} has duplicates`).toBe(isos.length);
    }
  });
});

describe('version', () => {
  it('bumped the planner version for the routing change', () => {
    // Routing changed, so planner_version must move; schema_version must not
    // (the replay SHAPE is untouched).
    expect(PLANNER_VERSION).toBe('5.11');
  });
});
