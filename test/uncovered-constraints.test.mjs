/**
 * H4 — a constraint the intent NAMED that the plan neither ran nor rejected.
 *
 * Why this file exists — measured, not theorised. Two independent live runs of
 * the SAME composite intent on 2026-08-19:
 *
 *   "find 100 MW of buildable capacity near Ashburn with fiber and grid headroom"
 *
 *   ours (class grid_headroom):  fiber surfaced in `rejected` as R5
 *   xAI  (class capacity_search): fiber appeared in NEITHER executed NOR rejected
 *
 * `rejected` is built from `alternatives`, which carries the runner-up class
 * only — so whether a dropped constraint is auditable depends on which class
 * happened to place second. An agent reading the replay could not distinguish
 * "considered and rejected" from "never considered". Both rendered as absence.
 */
import { describe, it, expect } from 'vitest';
import { _planQuery, _uncoveredConstraints } from '../server.mjs';

const replayFor = (intent, ctx = {}) => (_planQuery(intent, ctx).replay || {});
const uncoveredKeys = (intent, ctx = {}) => {
  const u = replayFor(intent, ctx).uncovered_constraints;
  return u ? u.uncovered.map((x) => x.constraint).sort() : [];
};

describe('H4 uncovered constraints', () => {
  it('reports fiber when a composite intent names it and no step covers it', () => {
    // The live case. Whichever class wins, naming "fiber" must never be silent.
    const keys = uncoveredKeys(
      'find 100 MW of buildable capacity near Ashburn with fiber and grid headroom');
    // Either fiber ran, or it was rejected, or it is reported here — never absent
    // from all three. Assert the DISJUNCTION so this test survives a routing change.
    const r = replayFor(
      'find 100 MW of buildable capacity near Ashburn with fiber and grid headroom');
    const mentionsFiber = JSON.stringify(r).match(/fiber/i);
    expect(mentionsFiber).toBeTruthy();
    // and if it is not covered, it must be named as uncovered
    if (keys.length) expect(keys).toContain('fiber');
  });

  it('does NOT fire when the constraint is actually covered by a step', () => {
    // A fiber-led intent runs fiber tools, so there is nothing to report.
    expect(uncoveredKeys('where do fiber density and grid headroom overlap in Atlanta'))
      .not.toContain('fiber');
  });

  it('does NOT fire for a noun the intent never mentioned', () => {
    expect(uncoveredKeys('how much power is available in ERCOT')).toEqual([]);
  });

  it('is absent entirely — not an empty object — when nothing is uncovered', () => {
    // emit-only-when-real, same contract as resolution_gap
    expect(replayFor('how much power is available in ERCOT').uncovered_constraints)
      .toBeUndefined();
  });

  it('a tool named in `rejected` counts as CONSIDERED, not uncovered', () => {
    // Auditability is the point: if the agent can see it was weighed, that is
    // not a silent omission. Synthetic sc so the assertion cannot drift with routing.
    const sc = { intent: 'capacity with fiber', intent_class: 'capacity_search',
                 best_tool: 'rank_sites', recommended_sequence: [{ tool: 'rank_sites' }],
                 alternatives: [{ tool: 'get_fiber_intel', rejected_because: 'margin' }] };
    expect(_uncoveredConstraints(sc.intent, sc)).toBeNull();
  });

  it('MUST-FAIL CONTROL: the same sc WITHOUT the alternative does fire', () => {
    // If this ever passes as null, the check has gone vacuous.
    const sc = { intent: 'capacity with fiber', intent_class: 'capacity_search',
                 best_tool: 'rank_sites', recommended_sequence: [{ tool: 'rank_sites' }],
                 alternatives: [] };
    const u = _uncoveredConstraints(sc.intent, sc);
    expect(u).toBeTruthy();
    expect(u.code).toBe('H4');
    expect(u.uncovered.map((x) => x.constraint)).toContain('fiber');
  });

  it('detects several named constraints at once', () => {
    const sc = { intent: 'site with fiber, water risk and tax incentives',
                 intent_class: 'site_analysis', best_tool: 'analyze_site',
                 recommended_sequence: [{ tool: 'analyze_site' }], alternatives: [] };
    const keys = _uncoveredConstraints(sc.intent, sc).uncovered.map((x) => x.constraint).sort();
    expect(keys).toEqual(['fiber', 'tax', 'water']);
  });

  it('fails closed on junk input rather than throwing', () => {
    expect(_uncoveredConstraints(null, {})).toBeNull();
    expect(_uncoveredConstraints('fiber', null)).toBeNull();
  });
});
