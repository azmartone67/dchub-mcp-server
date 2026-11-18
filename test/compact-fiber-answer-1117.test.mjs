// compact-fiber-answer-1117.test.mjs — Grok, live 2026-11-17 night (planner 5.38): keyless execute_plan
// {intent:"Which carrier hotels in Dallas have the most fiber carriers?", detail:"compact"} led with "DC Hub ran 3
// lookups for ...", had no intent_answer and no step results, and answer_guide still said "Compose the answer from
// executed[].result". Two causes, both covered here:
//   1. buildIntentAnswer had no answer for the fiber class (only power timing, market check, siting), so the
//      facilities get_peering_intel returned (connectivity.top_facilities, each with net_count) reached no answer block;
//   2. both compactions (lib/plan-compact.mjs, and the keyless first full answer in lib/keyless-first-full.mjs) strip
//      executed[].result but kept the guide sentence that says to compose from it.
// Step results below are stubs shaped like the live run's (backend peeringdb_layer.py connectivity_summary,
// main.py metro fiber payload); the facility names and counts are fixtures, not DC Hub data.
import { describe, it, expect } from 'vitest';
import { _planQuery, _execAnswerGuide } from '../server.mjs';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';
import { buildFiberAnswer, NETWORK_COUNT_NOTE } from '../lib/fiber-answer.mjs';
import { compactPlanObject, planCompactStep, compactAnswerGuide } from '../lib/plan-compact.mjs';
import { compactFirstPlan } from '../lib/keyless-first-full.mjs';
import { planLeadText } from '../lib/plan-lead-text.mjs';

const Q = 'Which carrier hotels in Dallas have the most fiber carriers?';
const METRO = {
  market: 'Dallas-Fort Worth', success: true,
  baseline: { as_of: '2026-03-17', as_of_kind: 'seed_date' },
  summary: { market: 'Dallas-Fort Worth', state: 'TX', tier: 'Tier 1', fiber_density_score: 100, total_carriers: 4,
    total_on_net_buildings: 730, total_route_miles: 5300, key_carrier_hotels: ['Hotel Alpha', 'Hotel Beta', 'Hotel Gamma'] },
  presence_carriers: { status: 'ok', total_carriers: 519, total_facilities: 450, as_of: '2026-11-15T04:03:47.963717',
    carriers: [{ carrier: 'Carrier One', facilities: 30 }] },
  carriers: [{ carrier: 'Carrier One', route_miles_approx: 1800, on_net_buildings: 260 }],
};
const PEERING = {
  success: true, source: 'PeeringDB',
  location: { lat: 32.7767, lng: -96.797, radius_deg: 0.5 },
  connectivity: { score: 100, level: 'Excellent', facilities_nearby: 50, total_networks: 909, total_ix_presence: 78,
    top_facilities: [
      { name: 'Facility B', city: 'Dallas', net_count: 120, ix_count: 4 },
      { name: 'Facility A', city: 'Dallas', net_count: 210, ix_count: 9 },
      { name: 'Facility C', city: 'Richardson', net_count: 64, ix_count: 2 },
    ] },
  freshness: { live: true, served_at: '2026-11-18T03:47:34.792Z' },
};
const FIBER = { type: 'FeatureCollection', total: 500, features: [{ type: 'Feature', properties: { carrier: 'X' } }] };
const executed = () => [
  { step: 1, tool: 'get_metro_fiber', args: { market: 'Dallas-Fort Worth' }, status: 'executed', ms: 300, result: structuredClone(METRO) },
  { step: 2, tool: 'get_peering_intel', args: { lat: 32.7767, lon: -96.797 }, status: 'executed', ms: 200, result: structuredClone(PEERING) },
  { step: 3, tool: 'get_fiber_intel', args: { route_type: 'metro', market: 'dallas' }, status: 'executed', ms: 400, result: structuredClone(FIBER) },
];
// The envelope execute_plan assembles (server.mjs), with the intent answer it now builds.
const planOf = (ex = executed()) => ({
  _entity: 'plan_execution', ok: true, intent: Q, intent_class: 'fiber', planner_version: '5.38',
  intent_answer: buildIntentAnswer({ intent: Q, intent_class: 'fiber', constraint_iso: ['ERCOT'] }, ex, null),
  answer_guide: _execAnswerGuide(ex, ['ERCOT']),
  executed: ex, totals: { steps_run: 3 }, replay: { planner_version: '5.38', decisions: [] }, _source: 'DC Hub — dchub.cloud',
});
const wire = (sc) => ({ content: [{ type: 'text', text: 'lead' }, { type: 'text', text: JSON.stringify(sc) }], structuredContent: sc });

describe('the Dallas carrier-hotel plan', () => {
  it('routes to the fiber class and reads metro fiber + peering (the plan Grok ran)', () => {
    const p = _planQuery(Q, {});
    expect(p.intent_class).toBe('fiber');
    expect(p.recommended_sequence.map((s) => s.tool)).toEqual(expect.arrayContaining(['get_metro_fiber', 'get_peering_intel']));
  });

  it('intent_answer names the facilities with the most networks, most first, each count as returned', () => {
    const ia = planOf().intent_answer;
    expect(ia).toBeTruthy();
    expect(ia.kind).toBe('fiber');
    expect(ia.headline).toBe('Carrier hotels and facilities near Dallas-Fort Worth with the most networks on PeeringDB: '
      + 'Facility A (210 networks, 9 IXs); Facility B (120 networks, 4 IXs); Facility C (64 networks, 2 IXs) (PeeringDB, read live on 2026-11-18).');
    expect(ia.ranked_facilities.map((r) => r.name)).toEqual(['Facility A', 'Facility B', 'Facility C']);
    expect(ia.evidence).toContain(NETWORK_COUNT_NOTE);
    expect(ia.evidence.join(' ')).toMatch(/PeeringDB within about 56 km of 32\.7767, -96\.797: 50 facilities, 78 IX presences, 909 networks/);
    expect(ia.evidence.join(' ')).toMatch(/PeeringDB lists 519 carriers present across 450 facilities in Dallas-Fort Worth's cities/);
    expect(ia.evidence.join(' ')).toMatch(/Key carrier hotels in DC Hub's curated Dallas-Fort Worth profile: Hotel Alpha, Hotel Beta, Hotel Gamma/);
    // "carriers" asked, networks answered: said, not blurred; the 50-row read cap is named
    expect(ia.not_established.join(' ')).toMatch(/count of fiber carriers per building is not in DC Hub/);
    expect(ia.not_established.join(' ')).toMatch(/stops at 50 facilities/);
    expect(ia.as_of).toBe('2026-11-18');   // 5.41: the ranking is dated by its live PeeringDB read; the baseline keeps its date in evidence
    expect(ia.source).toMatch(/^Source: DC Hub \(dchub\.cloud/);
  });

  it('a withheld count stays withheld: the facility is named without a number, and the gap is said', () => {
    const ex = executed();
    // the live keyless preview shape: counts null, the first rows of the ranked list, and how many the full read has
    ex[1].result.connectivity = { facilities_nearby: 50, total_networks: null, total_ix_presence: null, _top_facilities_total_available: 5,
      top_facilities: [{ name: 'Facility A', city: 'Dallas', net_count: null, ix_count: null },
                       { name: 'Facility B', city: 'Dallas', net_count: null, ix_count: null }] };
    const ia = planOf(ex).intent_answer;
    expect(JSON.stringify(ia)).not.toMatch(/\b(210|120|909|78)\b/);
    expect(ia.ranked_facilities).toEqual([{ name: 'Facility A', city: 'Dallas' }, { name: 'Facility B', city: 'Dallas' }]);
    expect(ia.headline).toBe('Carrier hotels and facilities near Dallas-Fort Worth that PeeringDB lists with the most networks, most first: '
      + 'Facility A; Facility B (PeeringDB, read live on 2026-11-18; the per-facility network counts are withheld at this access level).');
    expect(ia.evidence).not.toContain(NETWORK_COUNT_NOTE);
    expect(ia.not_established.join(' ')).toMatch(/No network count for Facility A, Facility B/);
    expect(ia.not_established.join(' ')).toMatch(/3 more ranked facilities are in the full read/);
  });
  it('no peering rows at all: the curated carrier-hotel list leads, and says no per-facility count came back', () => {
    const ex = executed();
    ex[1].result.connectivity.top_facilities = [];
    const ia = planOf(ex).intent_answer;
    expect(ia.headline).toMatch(/^Key carrier hotels in Dallas-Fort Worth: Hotel Alpha, Hotel Beta, Hotel Gamma \(DC Hub curated profile, baseline as of 2026-03-17\)/);
    expect(ia.headline).toMatch(/No per-facility carrier or network count was returned/);
  });

  it('compact (the default for a keyless caller): intent_answer rides, and the guide points at what is present', () => {
    const out = planCompactStep(wire(planOf()));
    const sc = out.structuredContent;
    expect(sc.detail).toBe('compact');
    expect(sc.executed.some((e) => 'result' in e)).toBe(false);
    expect(sc.intent_answer.headline).toMatch(/Facility A \(210 networks/);
    expect(sc.answer_guide).not.toContain('executed[].result');
    expect(sc.answer_guide).toMatch(/^Compose the answer from intent_answer[^(]* \(tier-honest; detail:"full" adds step bodies\)\. Quote concrete numbers/);
    expect(JSON.parse(out.content[1].text)).toEqual(sc);
  });

  it('the live path (keyless first full answer, then compact): facilities lead, no "ran 3 lookups", no executed[].result', () => {
    const plan = planOf();
    const first = compactFirstPlan(plan, new Map(), { cap: 1 });
    expect(first.answer).toBe(plan.intent_answer.headline);
    expect(first.answer_guide).not.toContain('executed[].result');
    expect(first.answer_guide).toMatch(/executed\[\]\.figures/);
    const sc = compactPlanObject(first);
    expect(sc.answer).toBe(plan.intent_answer.headline);   // used to be dropped by the second compaction
    expect(sc.intent_answer.headline).toMatch(/^Carrier hotels and facilities near Dallas-Fort Worth/);
    expect(sc.answer_guide).not.toContain('executed[].result');
    const lead = planLeadText(sc);
    expect(lead).toMatch(/^Carrier hotels and facilities near Dallas-Fort Worth with the most networks on PeeringDB: Facility A/);
    expect(lead).not.toMatch(/DC Hub ran \d+ lookups?/);
  });

  it('detail:"full" is untouched: every step body and the original guide', () => {
    const r = wire(planOf());
    expect(planCompactStep(r, { detail: 'full' })).toBe(r);
    expect(r.structuredContent.answer_guide).toMatch(/^Compose the answer from executed\[\]\.result/);
  });
});

describe('other plans are unchanged', () => {
  it('a non-fiber class gets the same intent answer as before (power timing, and none for facility search)', () => {
    const ex = [{ step: 1, tool: 'get_grid_intelligence', args: { iso: 'ERCOT' }, status: 'executed',
      result: { iso: 'ERCOT', avg_time_to_power_months: 32.6 } }];
    const t = buildIntentAnswer({ intent: 'how soon can I get 100 MW in ERCOT', intent_class: 'grid_headroom', constraint_iso: ['ERCOT'] }, ex, null);
    expect(t.kind).toBe('power_timing');
    expect(buildIntentAnswer({ intent: 'data centers in Dallas', intent_class: 'facility_search' }, ex, null)).toBe(null);
  });
  it('a fiber plan none of whose steps returned data has no answer block (nothing to say)', () => {
    expect(buildFiberAnswer({ intent: Q, intent_class: 'fiber' }, [{ step: 1, tool: 'get_peering_intel', status: 'failed', result: { error: 'x' } }], null)).toBe(null);
  });
  it('a guide without the compose sentence is left as it is; a compact guide is rewritten once, for the fields present', () => {
    expect(compactAnswerGuide('NO DATA: no step returned data in this run.', {})).toBe('NO DATA: no step returned data in this run.');
    const g = compactAnswerGuide('LEAD WITH THE VERDICT — x. Compose the answer from executed[].result (each already tier-honest). Quote concrete numbers.',
      { intent_answer: {}, citations: [{}] });
    expect(g).toBe('LEAD WITH THE VERDICT — x. Compose the answer from intent_answer and citations '
      + '(tier-honest; detail:"full" adds step bodies). Quote concrete numbers.');
    expect(compactAnswerGuide(g, { citations: [{}] })).toBe(g.replace('intent_answer and citations', 'citations'));
  });
});
