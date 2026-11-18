// engine-grade.test.mjs -- every rubric check in lib/engine-grade.mjs can go RED, stays PASS on a good answer,
// and a walled or errored answer is BLIND, never RED. Pure: no network.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { gradeAnswer, gradeRun, diffRuns, leadOf, figuresIn, CHECKS, PASS, RED, NA, BLIND } from '../lib/engine-grade.mjs';
import { loadQuestions, summaryMarkdown, MAX_CALLS } from '../scripts/engine-bench.mjs';

const msg = (lead, sc = {}) => ({ result: {
  content: [{ type: 'text', text: `${lead} Source: DC Hub (dchub.cloud), as of 2026-08-31. Full answer: the JSON in the next content block.` }],
  structuredContent: { _entity: 'plan_execution', intent_class: 'site_power', planner_version: '5.38',
    executed: [{ step: 1, tool: 'get_energy_prices', status: 'executed' }, { step: 2, tool: 'search_facilities', status: 'executed' }],
    facts: [], ...sc },
} });

const Q = { id: 'q1', set: 'cross_domain', intent: 'For a 100 MW data center in Northern Virginia, what is PJM like?',
  place_groups: [['Northern Virginia', 'Ashburn'], ['PJM']], sides: ['dc', 'energy'], not_classes: ['interconnection_queue'] };

const GOOD_LEAD = 'Northern Virginia: DC Hub tracks 412 data centers in the Ashburn metro (as of 2026-11-01). ' +
  'PJM demand was 98,450 MW and the Virginia retail electricity rate is 9.87 cents/kWh (as of 2026-08-31).';
const GOOD_FACTS = [
  { tool: 'search_facilities', as_of: '2026-11-01', text: '412 data centers in the Ashburn metro (as of 2026-11-01).', entity: 'Ashburn' },
  { tool: 'get_grid_data', as_of: '2026-11-18', text: 'PJM demand 98,450 MW (as of 2026-11-18).', entity: 'PJM' },
  { tool: 'get_energy_prices', as_of: '2026-08-31', text: 'Virginia retail electricity rate 9.87 cents/kWh.', entity: 'VA' },
];

describe('engine-grade: a good answer passes every applicable check', () => {
  it('scores full marks', () => {
    const r = gradeAnswer(Q, msg(GOOD_LEAD, { facts: GOOD_FACTS }));
    expect(r.verdict).toBe('graded');
    for (const [k, c] of Object.entries(r.checks)) expect([k, c.status]).toEqual([k, PASS]);
    expect(r.points).toBe(r.possible);
    expect(r.possible).toBe(Object.keys(CHECKS).length);
  });
});

describe('engine-grade: each check can go RED', () => {
  const red = (q, m, k) => { const r = gradeAnswer(q, m); expect(r.checks[k].status, JSON.stringify(r.checks[k])).toBe(RED); return r; };

  it('routing: a not_class or an off-list class', () => {
    red(Q, msg(GOOD_LEAD, { facts: GOOD_FACTS, intent_class: 'interconnection_queue' }), 'routing');
    red({ ...Q, not_classes: undefined, classes: ['site_power'] }, msg(GOOD_LEAD, { facts: GOOD_FACTS, intent_class: 'price' }), 'routing');
  });
  it('names_place: a missing group, and an open question naming too few places', () => {
    red(Q, msg(GOOD_LEAD.replace(/PJM/g, 'the grid'), { facts: GOOD_FACTS }), 'names_place');
    red({ ...Q, place_groups: undefined, open_places_min: 2 }, msg('Retail electricity averages 13.04 cents/kWh (as of 2026-08-31).',
      { facts: [{ text: '13.04 cents/kWh' }] }), 'names_place');
  });
  it('names_place: "PJM" inside another word is not a hit', () => {
    red({ ...Q, place_groups: [['PJM']] }, msg('XPJMX tracks 412 data centers (as of 2026-11-01).', { facts: GOOD_FACTS }), 'names_place');
  });
  it('figure_as_of: no figure, or a figure with no date', () => {
    red(Q, msg('Northern Virginia and PJM are busy data center markets.', { facts: GOOD_FACTS }), 'figure_as_of');
    red(Q, msg('Northern Virginia has 412 data centers on PJM.', { facts: GOOD_FACTS }), 'figure_as_of');
  });
  it('figure_as_of: numbers copied from the question do not count as figures', () => {
    red(Q, msg('For 100 MW in Northern Virginia on PJM, see below (as of 2026-08-31).', { facts: GOOD_FACTS }), 'figure_as_of');
  });
  it('dc_side and energy_side: one side missing', () => {
    red(Q, msg('Northern Virginia on PJM: retail electricity is 9.87 cents/kWh (as of 2026-08-31).', { facts: GOOD_FACTS }), 'dc_side');
    red(Q, msg('Northern Virginia: 412 data centers in Ashburn (as of 2026-11-01), all on PJM.', { facts: GOOD_FACTS }), 'energy_side');
  });
  it('no_lookup_lead: a step-count opening', () => {
    red(Q, msg(`DC Hub ran 3 lookups for your question. ${GOOD_LEAD}`, { facts: GOOD_FACTS }), 'no_lookup_lead');
    red(Q, msg(`Your assistant ran 4 DC Hub lookups. ${GOOD_LEAD}`, { facts: GOOD_FACTS }), 'no_lookup_lead');
  });
  it('grounded: a lead figure that is in no fact', () => {
    const r = red(Q, msg(GOOD_LEAD.replace('412', '450'), { facts: GOOD_FACTS }), 'grounded');
    expect(r.checks.grounded.evidence).toContain('450');
  });
  it('no_contradiction: "no figure for PJM" while facts[] holds a PJM figure', () => {
    const lead = 'Northern Virginia: 412 data centers in Ashburn (as of 2026-11-01). No price figure came back for PJM; retail electricity is 9.87 cents/kWh.';
    red(Q, msg(lead, { facts: GOOD_FACTS }), 'no_contradiction');
    red(Q, msg(lead.replace('No price figure came back for PJM', 'PJM: no figure'), { facts: GOOD_FACTS }), 'no_contradiction');
  });
  it('no_contradiction: "no figure" is fine when facts[] really has none for that place', () => {
    const lead = 'Northern Virginia: 412 data centers in Ashburn (as of 2026-11-01). No price figure came back for PJM; retail electricity is 9.87 cents/kWh.';
    const facts = GOOD_FACTS.filter((f) => f.entity !== 'PJM');
    expect(gradeAnswer(Q, msg(lead, { facts })).checks.no_contradiction.status).toBe(PASS);
  });
});

describe('engine-grade: NA and BLIND', () => {
  it('a check the question does not ask for is NA, not a free PASS', () => {
    const r = gradeAnswer({ id: 'c', set: 'colocation', intent: 'colo pricing?', require_figure: false, sides: [] },
      msg('DC Hub does not publish colocation pricing.', {}));
    for (const k of ['routing', 'names_place', 'figure_as_of', 'dc_side', 'energy_side', 'grounded']) expect(r.checks[k].status).toBe(NA);
    expect(r.possible).toBe(2);
  });
  it('a wall, an rpc error, a non-plan answer and no body are BLIND with zero possible points', () => {
    const walled = { result: { content: [{ text: 'limit' }], structuredContent: { error: 'anon_hard_wall' } } };
    for (const m of [walled, { error: { code: -32600, message: 'bad' } }, { result: { structuredContent: { _entity: 'x' } } }, null]) {
      const r = gradeAnswer(Q, m);
      expect(r.verdict).toBe(BLIND);
      expect(r.possible).toBe(0);
    }
  });
});

describe('engine-grade: helpers', () => {
  it('leadOf drops the source and JSON boilerplate', () => {
    expect(leadOf(msg('Answer 1.'))).toBe('Answer 1.');
  });
  it('figuresIn skips dates and years, keeps decimals and comma groups, ignores digits inside names', () => {
    expect(figuresIn('98,450 MW, 9.87 c, 2026 average, as of 2026-08-31, DC11 Ashburn').map((f) => f.v)).toEqual([98450, 9.87]);
    expect(figuresIn('DCPI CAUTION 42/100, 43.5/100').map((f) => f.v)).toEqual([42, 43.5]);
  });
});

describe('engine-grade: run totals and day-over-day diff', () => {
  const qs = [Q, { ...Q, id: 'q2' }];
  const good = msg(GOOD_LEAD, { facts: GOOD_FACTS });
  const bad = msg(`DC Hub ran 3 lookups. ${GOOD_LEAD}`, { facts: GOOD_FACTS });
  it('totals per set, BLIND rows counted apart', () => {
    const run = gradeRun(qs, { q1: good, q2: null });
    expect(run.totals.cross_domain).toMatchObject({ graded: 1, blind: 1, points: 8, possible: 8 });
  });
  it('a PASS that turns RED is a regression; a first sighting is new_red; RED to PASS is recovered', () => {
    const d1 = diffRuns(gradeRun(qs, { q1: good, q2: null }), gradeRun(qs, { q1: bad, q2: bad }));
    expect(d1.regressed.map((x) => x.key)).toEqual(['q1:no_lookup_lead']);
    expect(d1.new_red.map((x) => x.key)).toEqual(['q2:no_lookup_lead']);
    const d2 = diffRuns(gradeRun(qs, { q1: bad, q2: bad }), gradeRun(qs, { q1: good, q2: bad }));
    expect(d2.recovered.map((x) => x.key)).toEqual(['q1:no_lookup_lead']);
    expect(d2.still_red.map((x) => x.key)).toEqual(['q2:no_lookup_lead']);
  });
  it('points compare only the questions graded in both runs (a --only run vs a full baseline)', () => {
    const d = diffRuns(gradeRun(qs, { q1: good, q2: good }), gradeRun([Q], { q1: bad }));
    expect(d.points).toEqual({ compared: 1, before: 8, now: 7, possible_now: 8 });
  });
});

describe('engine questions file', () => {
  const qs = loadQuestions();
  it('ids are unique, sets are known, and the run fits the call cap', () => {
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    for (const q of qs) expect(['cross_domain', 'colocation']).toContain(q.set);
    expect(qs.length).toBeLessThanOrEqual(MAX_CALLS);
  });
  it('every question asks for at least one gradeable thing beyond the always-on checks', () => {
    for (const q of qs) expect(Boolean((q.place_groups && q.place_groups.length) || q.open_places_min || (q.sides && q.sides.length)), q.id).toBe(true);
  });
  it('the baseline scores file, when present, grades the same question ids', () => {
    const dir = new URL('../engine/baselines/', import.meta.url);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const s = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
      expect(s.rows.map((r) => r.id).sort(), f).toEqual(qs.map((q) => q.id).sort());
    }
  });
  it('summary.md names every check', () => {
    const md = summaryMarkdown(gradeRun(qs.slice(0, 1), {}), { date: 'd' });
    for (const k of Object.keys(CHECKS)) expect(md).toContain(`| ${k} |`);
  });
});
