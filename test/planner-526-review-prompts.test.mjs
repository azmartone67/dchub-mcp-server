// planner-526-review-prompts.test.mjs — planner 5.26, Grok-relayed live agent reviews of 2026-11-13
// (Claude, Grok and Mistral each ran DC Hub execute_plan).
//
// Item 1: two or more named states run one set of state-scoped steps per state; two or more named
//   grids route to compare_isos; a town that is no tracked market reads its state through find_sites;
//   the stated MW and deadline reach the steps that take them.
// Item 2: data-center capacity asks route to get_pipeline / search_facilities / source_capacity
//   (power only as backup), and a one-town run keeps pipeline and facility rows inside the town.
// Item 8: the prompts live in test/fixtures/planner-review-prompts.mjs (with a slot for the three
//   verbatim review prompts), and this file is on test/hard-gate.txt so every planner PR runs them.
//
// Planner-level only, no network. The execute_plan run (submarket cut end to end) is in
// test/planner-526-submarket-e2e.test.mjs: the harness must set PORT before server.mjs is imported.
import { describe, it, expect } from 'vitest';
import {
  _planQuery, _planSignals, _planNamedStates, _planNamedIsos, _planDeadlineMonths, _planDeadline,
  _planUnmatchedPlace, _planSubmarket, _execConstraintIsoSet, _execSubmarketOut, _planBindIntentArgs,
  _planStateFanout, PLANNER_VERSION,
} from '../server.mjs';
import { cutRowsToSubmarket, placeRow } from '../lib/submarket-scope.mjs';
import { REVIEW_PROMPTS, STAY_PROMPTS, VERBATIM_REVIEW_PROMPTS } from './fixtures/planner-review-prompts.mjs';

// '$months:YYYY-MM' -> calendar months from this month to that one (the planner counts the same way).
function monthsTo(ym, now = new Date()) {
  const [y, m] = ym.split('-').map(Number);
  return (y - now.getUTCFullYear()) * 12 + (m - (now.getUTCMonth() + 1));
}
const resolve = (v) => (typeof v === 'string' && v.startsWith('$months:') ? monthsTo(v.slice(8)) : v);
const resolveArgs = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, resolve(v)]));
const show = (p) => JSON.stringify(p.recommended_sequence.map((s) => [s.step, s.tool, s.args_hint, s.depends_on]));

function checkPlan(entry) {
  const p = _planQuery(entry.prompt, {});
  const e = entry.expect;
  const seq = p.recommended_sequence;
  const tools = seq.map((s) => s.tool);
  const why = `${entry.id}: ${show(p)}`;
  if (e.intent_class) expect(p.intent_class, why).toBe(e.intent_class);
  if (e.lead) expect(tools[0], why).toBe(e.lead);
  if (e.last) expect(tools[tools.length - 1], why).toBe(e.last);
  for (const t of e.tools || []) expect(tools, why).toContain(t);
  for (const t of e.not_tools || []) expect(tools, why).not.toContain(t);
  if (e.per_state) {
    const got = seq.filter((s) => s.tool === e.per_state.tool).map((s) => s.args_hint[e.per_state.key]);
    expect(got, why).toEqual(e.per_state.states);
  }
  for (const want of e.steps || []) {
    const args = resolveArgs(want.args);
    const hit = seq.find((s) => s.tool === want.tool && Object.entries(args).every(([k, v]) => JSON.stringify(s.args_hint[k]) === JSON.stringify(v)));
    expect(hit, `${why}\n wanted ${want.tool} ${JSON.stringify(args)}`).toBeTruthy();
  }
  if (e.waits_on_find_sites) {
    const fs = seq.find((s) => s.tool === 'find_sites');
    expect(fs, why).toBeTruthy();
    for (const t of e.waits_on_find_sites) {
      const s = seq.find((x) => x.tool === t);
      expect(s, why).toBeTruthy();
      expect(Object.values(s.args_hint).some((v) => typeof v === 'string' && /named in the intent/.test(v)), why).toBe(false);
      expect(s.depends_on, why).toContain(fs.step);
    }
  }
  if ('state_fanout' in e) {
    if (e.state_fanout === null) expect(p.state_fanout, why).toBeUndefined();
    else expect(p.state_fanout && p.state_fanout.states, why).toEqual(e.state_fanout);
  }
  if (e.place_fallback) expect(p.place_fallback, why).toMatchObject(e.place_fallback);
  return p;
}

describe('planner 5.26', () => {
  it('PLANNER_VERSION is 5.27 (was 5.26)', () => { expect(PLANNER_VERSION).toBe('5.27'); });
});

describe('review prompts (test/fixtures/planner-review-prompts.mjs)', () => {
  it('covers every failure the reviews named', () => {
    const kinds = new Set(REVIEW_PROMPTS.map((r) => r.failure));
    for (const k of ['multi_state', 'two_isos', 'unmatched_place', 'mw_year', 'dc_capacity']) expect(kinds.has(k), k).toBe(true);
  });
  for (const entry of REVIEW_PROMPTS) {
    it(`${entry.id}: ${entry.prompt}`, () => { checkPlan(entry); });
  }
  for (const entry of STAY_PROMPTS) {
    it(`stays: ${entry.id}: ${entry.prompt}`, () => { checkPlan(entry); });
  }
  // The three verbatim Nov 13 prompts (Claude, Grok, Mistral) go in VERBATIM_REVIEW_PROMPTS.
  for (const entry of VERBATIM_REVIEW_PROMPTS) {
    it(`verbatim: ${entry.id}: ${entry.prompt}`, () => { checkPlan(entry); });
  }
});

describe('item 1a: named states', () => {
  it('reads every state the text names, in order, longest name per span', () => {
    expect(_planNamedStates('Texas, Ohio or Georgia')).toEqual(['TX', 'OH', 'GA']);
    expect(_planNamedStates('Virginia or West Virginia')).toEqual(['VA', 'WV']);
    expect(_planNamedStates('power in TX, OH or GA')).toEqual(['TX', 'OH', 'GA']);
    expect(_planNamedStates('Abilene TX')).toEqual([]);                   // one bare code after a place is _planStateAfterPlace's
    expect(_planNamedStates('gas OR Power for 50 MW')).toEqual([]);        // English-word codes never count in a run
    expect(_planNamedStates('rank markets in Texas')).toEqual(['TX']);
  });
  it('two states bind no single state; one still does', () => {
    expect(_planSignals('Texas, Ohio or Georgia for 100 MW').stateFromPlace).toBe(null);
    expect(_planSignals('rank markets in Texas').stateFromPlace).toBe('TX');
    expect(_planSignals('Texas or Ohio', { state: 'OH' }).states).toEqual([]);   // a typed state wins
  });
  it('a hand-off step shared by every state runs once and waits on every state', () => {
    const p = _planQuery('Where should I build a 100 MW data center: Texas, Ohio or Georgia?', {});
    const canv = p.recommended_sequence.filter((s) => s.tool === 'site_selection_canvas').map((s) => s.step);
    const dcpi = p.recommended_sequence.filter((s) => s.tool === 'get_market_dcpi_rank');
    expect(dcpi).toHaveLength(1);
    expect(dcpi[0].depends_on).toEqual(canv);
    expect(p.recommended_sequence.filter((s) => s.tool === 'site_selection_canvas').map((s) => s.state_fanout)).toEqual(['TX', 'OH', 'GA']);
    expect(p.planner_rationale).toMatch(/names 3 US states \(TX, OH, GA\)/);
  });
  it('a fourth state is listed as not planned, not dropped silently', () => {
    const p = _planQuery('rank markets for 100 MW in Texas, Ohio, Georgia or Arizona', {});
    expect(p.state_fanout.states).toEqual(['TX', 'OH', 'GA']);
    expect(p.state_fanout.not_planned).toEqual(['AZ']);
    expect(_planStateFanout(() => [], { states: ['TX'] })).toBe(null);
  });
  it('the executor constrains to the union of the named states\' grids', () => {
    expect(_execConstraintIsoSet('Texas or Ohio', {}, _planSignals('Texas or Ohio'))).toEqual(['ERCOT', 'SPP', 'MISO', 'WECC', 'PJM']);
    expect(_execConstraintIsoSet('Ohio or Pennsylvania', {}, _planSignals('Ohio or Pennsylvania'))).toEqual(['PJM']);
  });
});

describe('item 1b: two or more named grids', () => {
  it('reads every grid, with its other names, lower case included', () => {
    expect(_planNamedIsos('Compare ERCOT and PJM')).toEqual(['ERCOT', 'PJM']);
    expect(_planNamedIsos('PJM vs MISO')).toEqual(['PJM', 'MISO']);
    expect(_planNamedIsos('texas grid vs pjm')).toEqual(['ERCOT', 'PJM']);
    expect(_planNamedIsos('Southwest Power Pool or ISO New England or New York ISO')).toEqual(['SPP', 'ISONE', 'NYISO']);
    expect(_planNamedIsos('ISO-NE and CAISO')).toEqual(['ISONE', 'CAISO']);
    expect(_planNamedIsos('power in ERCOT')).toEqual(['ERCOT']);
  });
  it('the executor keeps both grids: no single ISO is injected, neither grid\'s mints are rejected', () => {
    const t = 'Compare ERCOT and PJM for a 200 MW AI campus';
    expect(_execConstraintIsoSet(t, {}, _planSignals(t))).toEqual(['ERCOT', 'PJM']);
  });
  it('two grids are not two DCPI markets', () => {
    expect(_planSignals('Compare ERCOT and PJM').comparePair).toBe(null);
    expect(_planSignals('compare Phoenix vs Columbus').comparePair).toBeTruthy();
  });
  it('compare_isos takes four grids; a fifth is named in the rationale', () => {
    const p = _planQuery('Compare PJM, MISO, SPP, ERCOT and CAISO', {});
    expect(p.recommended_sequence[0].args_hint.isos).toBe('PJM,MISO,SPP,ERCOT');
    expect(p.planner_rationale).toMatch(/CAISO is not in this plan/);
  });
});

describe('item 1c: a town that is no tracked market', () => {
  it('names the town and its state; a tracked metro, a region word or two states give nothing', () => {
    expect(_planUnmatchedPlace('find 100 MW near Smalltown, Ohio', _planSignals('find 100 MW near Smalltown, Ohio'))).toEqual({ phrase: 'Smalltown', state: 'OH' });
    expect(_planUnmatchedPlace('Is Okemah, Oklahoma any good', _planSignals('Is Okemah, Oklahoma any good'))).toEqual({ phrase: 'Okemah', state: 'OK' });
    expect(_planUnmatchedPlace('find 100 MW near Columbus, Ohio', _planSignals('find 100 MW near Columbus, Ohio'))).toBe(null);
    expect(_planUnmatchedPlace('find 100 MW in central Ohio', _planSignals('find 100 MW in central Ohio'))).toBe(null);
    expect(_planUnmatchedPlace('find 100 MW in Ohio', _planSignals('find 100 MW in Ohio'))).toBe(null);
  });
  it('the unknown fallback runs find_sites and says what it stands in for', () => {
    const p = _planQuery('Is Okemah, Oklahoma any good for a data center?', {});
    expect(p.unresolved).toMatchObject({ kind: 'market_not_matched', phrase: 'Okemah' });
    expect(p.unresolved.note).toMatch(/not a market DC Hub tracks/);
  });
});

describe('item 1d: MW and target year', () => {
  const now = new Date(Date.UTC(2026, 10, 14));   // 2026-11-14
  it('a dated deadline counts in months from this month', () => {
    expect(_planDeadlineMonths('100 MW by 2028', now)).toBe(25);
    expect(_planDeadlineMonths('200MW in 2027', now)).toBe(13);
    expect(_planDeadlineMonths('by Q3 2028', now)).toBe(22);
    expect(_planDeadlineMonths('by 2025', now)).toBe(null);            // past: no deadline
    expect(_planDeadlineMonths('within 24 months', now)).toBe(24);     // the relative form is unchanged
    expect(_planDeadline('by Q3 2028', now)).toEqual({ months: 22, by: '2028-09' });
    expect(_planDeadline('within 24 months', now)).toEqual({ months: 24, by: '2028-11' });
  });
  it('fills only what a step left unset, and says what it filled', () => {
    const seq = [
      { step: 1, tool: 'site_selection_canvas', args_hint: { region: 'OH', capacity_mw: 80 } },
      { step: 2, tool: 'get_refined_queue', args_hint: { state: 'OH' } },
      { step: 3, tool: 'get_pipeline', args_hint: { country: 'US' } },
      { step: 4, tool: 'get_market_dcpi_rank', args_hint: { market_slug: 'columbus' } },
    ];
    _planBindIntentArgs(seq, { mw: 100, deadline: { months: 22, by: '2028-09' } });
    expect(seq[0].args_hint).toEqual({ region: 'OH', capacity_mw: 80, max_months: 22 });   // its own 80 wins
    expect(seq[0].intent_bound).toEqual(['max_months']);
    expect(seq[1].args_hint).toEqual({ state: 'OH', min_mw: 100 });                         // no max_ttp_months: an ISO-wide hard cut
    expect(seq[2].args_hint).toEqual({ country: 'US', expected_completion_before: '2028-10-01' });   // no project-size filter
    expect(seq[3].intent_bound).toBeUndefined();
  });
});

describe('item 2: data-center capacity, held to the submarket', () => {
  const SUB = { city: 'Ashburn', lat: 39.0438, lon: -77.4874, radius_km: 10 };
  it('Ashburn is a submarket; Dallas, Reno and Loudoun County are not', () => {
    expect(_planSubmarket(_planSignals('capacity coming online in Ashburn'))).toMatchObject({ city: 'Ashburn' });
    expect(_planSubmarket(_planSignals('capacity coming online in Dallas'))).toBe(null);
    expect(_planSubmarket(_planSignals('capacity coming online in Reno'))).toBe(null);
    expect(_planSubmarket(_planSignals('capacity coming online in Loudoun County'))).toBe(null);
  });
  it('places a row by city, then point, then name', () => {
    expect(placeRow({ city: 'Ashburn' }, SUB)).toEqual({ match: 'in' });
    expect(placeRow({ city: 'Manassas' }, SUB)).toEqual({ match: 'out', place: 'Manassas' });
    expect(placeRow({ lat: 38.7509, lon: -77.4753 }, SUB).match).toBe('out');               // Manassas, ~33 km
    expect(placeRow({ lat: 39.03, lon: -77.47 }, SUB).match).toBe('in');
    expect(placeRow({ name: 'QTS Manassas Campus' }, SUB, ['Manassas'])).toEqual({ match: 'out', place: 'Manassas' });
    expect(placeRow({ name: 'Ashburn Campus A' }, SUB, ['Manassas'])).toEqual({ match: 'in' });
    expect(placeRow({ name: 'Campus X' }, SUB, ['Manassas'])).toEqual({ match: 'unverified' });
  });
  it('cuts rows placed elsewhere, marks the unplaceable, and withholds the unscoped total', () => {
    const r = cutRowsToSubmarket('get_pipeline', { total: 40, projects: [
      { name: 'AWS IAD Ashburn', lat: 39.04, lon: -77.48 },
      { name: 'QTS Manassas', lat: 38.75, lon: -77.47, market_slug: 'northern-virginia' },
      { name: 'Campus X' },
    ] }, SUB, ['Manassas']);
    expect(r.result.projects.map((x) => [x.name, x.submarket_match])).toEqual([['AWS IAD Ashburn', 'in'], ['Campus X', 'unverified']]);
    expect(r.result.total).toBe(null);
    expect(r.scope).toMatchObject({ submarket: 'Ashburn', kept: 2, dropped_outside_submarket: 1, unverified: 1, unscoped_totals: { total: 40 } });
    expect(r.scope.basis).toMatch(/never describe them as Ashburn/);
    expect(cutRowsToSubmarket('get_market_intel', { projects: [] }, SUB).scope).toBe(null);
  });
  it('_execSubmarketOut cuts only for a one-town plan', () => {
    const out = () => ({ ok: true, result: { projects: [{ name: 'QTS Manassas', city: 'Manassas' }, { name: 'X', city: 'Ashburn' }] } });
    const o1 = out();
    expect(_execSubmarketOut('get_pipeline', o1, _planSignals('coming online in Ashburn'))).toMatchObject({ dropped_outside_submarket: 1 });
    expect(o1.result.projects).toHaveLength(1);
    const o2 = out();
    expect(_execSubmarketOut('get_pipeline', o2, _planSignals('coming online in Northern Virginia'))).toBe(null);
    expect(o2.result.projects).toHaveLength(2);
  });
});
