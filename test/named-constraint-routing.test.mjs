/**
 * Named-constraint routing — issue #211.
 *
 * "find 100 MW of buildable capacity near Ashburn WITH FIBER and grid headroom"
 * appended get_grid_intelligence because grid_headroom placed second — not
 * because anyone asked about grid — while fiber, a noun the user actually
 * typed, ended up in `uncovered_constraints` and nowhere else.
 *
 * Two mechanisms existed and neither closed it: _CONSTRAINT_NOUNS knew fiber
 * was named but its comment said "Detection only. This does NOT change
 * routing"; the dual-class margin routes but keys on a runner-up CLASS SCORE.
 * Orthogonal, so the 08-18 dual-class fix left the symptom exactly where it was.
 *
 * Pure planner functions + source shape. No network, no DB, no server boot.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { _planQuery, _constraintLeadSteps, _CONSTRAINT_LEAD_CAP } from '../server.mjs';

const SRC = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const REGISTERED = [...SRC.matchAll(/^\s*trackedTool\(srv, '([a-z_0-9]+)'/gm)].map((m) => m[1]);
const ASHBURN = 'find 100 MW of buildable capacity near Ashburn with fiber and grid headroom';

const seqTools = (sc) => sc.recommended_sequence.map((s) => s.tool);
const uncovered = (sc) => (((sc.replay || {}).uncovered_constraints || {}).uncovered || [])
  .map((u) => u.constraint);

describe('named-constraint routing (#211)', () => {
  it('reads a plausible registration inventory (guard against a broken regex)', () => {
    // An empty parse would make the phantom-tool check below pass vacuously.
    expect(REGISTERED.length).toBeGreaterThan(70);
    expect(REGISTERED).toContain('get_fiber_intel');
  });

  it('every constraint lead names a REGISTERED tool', () => {
    // r-mpp-phantom: get_site_capacity_report / get_developer_brief were sold to
    // agents for two months and did not exist. A lead tool that is not
    // registered would hand the caller an unknown-tool at the exact moment the
    // plan claimed to cover their constraint.
    const leads = [...SRC.matchAll(/lead:[\s\S]{0,240}?tool: '([a-z_0-9]+)'/g)].map((m) => m[1]);
    expect(leads.length).toBeGreaterThanOrEqual(10);   // one per constraint row
    for (const t of new Set(leads)) expect(REGISTERED, `lead tool ${t}`).toContain(t);
  });

  it('ROUTES the fiber the user named — the Ashburn defect', () => {
    const sc = _planQuery(ASHBURN, {});
    const tools = seqTools(sc);
    expect(tools.some((t) => /fiber/.test(t))).toBe(true);
    // and the honesty channel must stop reporting what is now covered
    expect(uncovered(sc)).not.toContain('fiber');
  });

  it('marks the appended step with the constraint that caused it', () => {
    const step = _planQuery(ASHBURN, {}).recommended_sequence.find((s) => s.constraint === 'fiber');
    expect(step).toBeTruthy();
    expect(step.why).toMatch(/NAMED/);
    expect(step.args_hint).toHaveProperty('market');   // no coords in the intent
  });

  it('prefers the parcel-level read when coordinates are known', () => {
    // Unit-level on purpose: a coords-bearing INTENT routes to site_analysis,
    // whose own sequence already weighs fiber, so no append is due there — the
    // branch under test is which tool the lead picks once one IS due.
    const leads = _constraintLeadSteps('fiber', { coords: { lat: 39.04, lon: -77.48 } }, []);
    expect(leads).toHaveLength(1);
    expect(leads[0].tool).toBe('get_fiber_readiness');
    expect(leads[0].args_hint).toMatchObject({ lat: 39.04, lon: -77.48 });
    // and without coordinates it falls to the market-level read, not a bad call
    expect(_constraintLeadSteps('fiber', {}, [])[0].tool).toBe('get_fiber_intel');
  });

  it('never appends a tool the plan already considered', () => {
    expect(_constraintLeadSteps('fiber please', {}, ['get_fiber_intel'])).toEqual([]);
    // a tool merely WEIGHED as the runner-up alternative counts as considered,
    // matching the predicate _uncoveredConstraints uses
    expect(_constraintLeadSteps('water risk', {}, ['get_water_risk'])).toEqual([]);
  });

  it('counts ANY tool in the constraint family as covering it, not just the lead', () => {
    // ★ Mutation-found: asserting only on the lead tool passed even with the
    // family guard deleted, because the later "seen.has(step.tool)" check
    // catches that one case by itself. get_metro_fiber is in fiber's tool list
    // but is NOT its lead, so it isolates the family guard — and it is the
    // predicate _uncoveredConstraints uses, so disagreeing here would make the
    // router append a step H4 already considers covered.
    expect(_constraintLeadSteps('fiber please', {}, ['get_metro_fiber'])).toEqual([]);
    expect(_constraintLeadSteps('gas prices', {}, ['get_gas_economics'])).toEqual([]);
  });

  it('caps appended steps, and H4 still reports the overflow', () => {
    const many = 'site with fiber and water and tax and gas';
    const leads = _constraintLeadSteps(many, {}, []);
    expect(leads.length).toBe(_CONSTRAINT_LEAD_CAP);
    expect(_CONSTRAINT_LEAD_CAP).toBeLessThan(4);        // it is a real bound
    // ★ The ones past the cap are NOT silently dropped — H4 still names them.
    // This intent names four constraints its class covers none of, so the cap
    // genuinely binds (the 'fiber and water and tax and gas' case above does
    // not overflow: its class already covers two of the four).
    const sc = _planQuery('compare phoenix vs columbus for fiber, tax, permitting and flood risk', {});
    expect(sc.recommended_sequence.filter((s) => s.constraint)).toHaveLength(_CONSTRAINT_LEAD_CAP);
    expect(uncovered(sc)).toEqual(['permitting', 'hazard']);
  });

  it('does nothing when the intent names no constraint', () => {
    expect(_constraintLeadSteps('rank markets for a 200 MW campus', {}, [])).toEqual([]);
  });

  it('never throws on a hostile signal object', () => {
    // routing must degrade, never fail the user's question
    expect(() => _constraintLeadSteps('fiber', null, null)).not.toThrow();
    expect(_constraintLeadSteps('fiber', null, null).length).toBe(1);
  });
});
