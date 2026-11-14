// keyless-first-full-lib.test.mjs — the pure parts of lib/keyless-first-full.mjs: who is seated, the first-plan
// step token, the direct answer, and the first-plan budget. The HTTP behaviour is in keyless-first-full.test.mjs.
import { describe, it, expect } from 'vitest';
import {
  keylessFirstFullOn, keylessFirstFullSeat, KEYLESS_FIRST_FULL_TOOLS, KEYLESS_FIRST_PLAN_STEP, KEYLESS_PLAN_STEP,
  mintKeylessFirstPlanToken, consumeKeylessFirstPlanToken, directAnswer, stepFacts, firstPlanAnswer, FIRST_PLAN_BUDGET_BYTES,
} from '../lib/keyless-first-full.mjs';

const ON = { DCHUB_KEYLESS_FIRST_FULL: '1' };
const deps = (env = ON) => ({ env, directoryProfile: 'chatgpt', allowedProfiles: ['claude', 'core'],
  isQa: (c) => c.qa === true, isBot: (c) => c.bot === true });
const caller = (x = {}) => ({ client_ip: '203.0.113.7', ...x });

describe('the switch', () => {
  it('only 1/on/true/yes turn it on; unset is off', () => {
    for (const v of ['1', 'on', 'true', 'YES']) expect(keylessFirstFullOn({ DCHUB_KEYLESS_FIRST_FULL: v })).toBe(true);
    for (const v of [undefined, '', '0', 'off', 'no', 'false', 'maybe']) expect(keylessFirstFullOn({ DCHUB_KEYLESS_FIRST_FULL: v })).toBe(false);
  });
  it('the lane is the five tools the owner approved', () => {
    expect([...KEYLESS_FIRST_FULL_TOOLS].sort()).toEqual(['execute_plan', 'get_energy_prices', 'get_grid_data',
      'get_grid_intelligence', 'get_interconnection_queue']);
  });
});

describe('the seat', () => {
  it('a keyless caller on a lane tool is charged; off, a key, or another tool is not seated', () => {
    for (const t of KEYLESS_FIRST_FULL_TOOLS) expect(keylessFirstFullSeat(t, caller(), deps())).toBe('charge');
    expect(keylessFirstFullSeat('get_grid_intelligence', caller(), deps({}))).toBe(null);
    expect(keylessFirstFullSeat('get_grid_intelligence', caller({ api_key: 'dch_live_x' }), deps())).toBe(null);
    expect(keylessFirstFullSeat('get_market_intel', caller(), deps())).toBe(null);
  });
  it('never /mcp/chatgpt, a bot, a missing or loopback IP; a QA caller only through the test override', () => {
    expect(keylessFirstFullSeat('get_grid_data', caller({ profile: 'chatgpt' }), deps())).toBe(null);
    expect(keylessFirstFullSeat('get_grid_data', caller({ legacy_wall_copy: true }), deps())).toBe(null);
    expect(keylessFirstFullSeat('get_grid_data', caller({ bot: true }), deps())).toBe(null);
    expect(keylessFirstFullSeat('get_grid_data', { client_ip: '' }, deps())).toBe(null);
    expect(keylessFirstFullSeat('get_grid_data', { client_ip: '127.0.0.1' }, deps())).toBe(null);
    expect(keylessFirstFullSeat('get_grid_data', caller({ qa: true }), deps())).toBe(null);
    expect(keylessFirstFullSeat('get_grid_data', caller({ qa: true, keyless_full_trial_qa_override: true }), deps())).toBe('observe');
    expect(keylessFirstFullSeat('get_grid_data', caller({ profile: 'claude' }), deps())).toBe('charge');
    expect(keylessFirstFullSeat('get_grid_data', caller({ profile: 'core' }), deps())).toBe('charge');
  });
  it('a plan step never spends the caller\'s own answer; a first-plan step is served full on the four tools only', () => {
    expect(keylessFirstFullSeat('get_grid_intelligence', caller({ [KEYLESS_PLAN_STEP]: true }), deps())).toBe(null);
    const step = caller({ [KEYLESS_PLAN_STEP]: true, [KEYLESS_FIRST_PLAN_STEP]: true });
    for (const t of ['get_grid_intelligence', 'get_interconnection_queue', 'get_grid_data', 'get_energy_prices']) {
      expect(keylessFirstFullSeat(t, step, deps())).toBe('step');
    }
    expect(keylessFirstFullSeat('execute_plan', step, deps())).toBe(null);
    expect(keylessFirstFullSeat('get_refined_queue', step, deps())).toBe(null);
    expect(keylessFirstFullSeat('get_grid_intelligence', step, deps({}))).toBe(null);
  });
});

describe('the first-plan step token', () => {
  it('single use, unknown refused, expired refused', () => {
    const t = mintKeylessFirstPlanToken();
    expect(consumeKeylessFirstPlanToken('nope')).toBe(false);
    expect(consumeKeylessFirstPlanToken(t)).toBe(true);
    expect(consumeKeylessFirstPlanToken(t)).toBe(false);
    const old = mintKeylessFirstPlanToken(Date.now() - 10 * 60_000);
    expect(consumeKeylessFirstPlanToken(old)).toBe(false);
    expect(consumeKeylessFirstPlanToken(undefined)).toBe(false);
  });
});

const NM = 'Time to 100 MW of power for PJM (ISO) is not measurable from this run: time-to-power and queue wait are withheld at this tier.';
const STEPS = [
  { step: 1, tool: 'get_grid_intelligence', args: { iso: 'PJM' }, status: 'executed', result: { demand_mw: 93825, avg_time_to_power_months: null } },
  { step: 2, tool: 'get_interconnection_queue', args: { iso: 'PJM' }, status: 'executed', result: { queued_generation_gw: 373.6, project_count: 1242 } },
  { step: 3, tool: 'get_refined_queue', args: { iso: 'PJM' }, status: 'executed', depth: 'preview', result: { count_total_matching: 1174 } },
];

describe('the direct answer', () => {
  it('a "not measurable" headline is never the lead: what was measured leads', () => {
    const a = directAnswer({ intent: 'how soon can a 100 MW load get power in PJM', constraint_iso: ['PJM'], executed: STEPS,
      intent_answer: { headline: NM, geography: 'PJM (ISO)', evidence: ['1174 active interconnection-queue projects.'], as_of: '2026-11-14' } });
    expect(a).not.toMatch(/not measurable/i);
    expect(a).toMatch(/^PJM \(ISO\): live demand 93,825 MW; 374 GW of generation in the interconnection queue \(1,242 projects\)/);
    expect(a).toMatch(/2026-11-14/);
  });
  it('a "see ... below" pointer is replaced by the figures it points at', () => {
    const a = directAnswer({ executed: STEPS, intent_answer: { headline: 'Time to power for PJM (ISO): see the time-to-power figures below.',
      evidence: ['PJM average time-to-power: 48 months.'] } });
    expect(a).toMatch(/^Time to power for PJM \(ISO\): /);
    expect(a).not.toMatch(/below/);
    expect(a).toMatch(/48 months/);
  });
  it('a preview step\'s figure is not quoted as the answer', () => {
    expect(stepFacts(STEPS).join(' ')).not.toMatch(/1174|1,174/);
    expect(stepFacts([{ ...STEPS[1], depth: 'preview' }])).toEqual([]);
  });
  it('with nothing measured, it says what ran instead of "not measurable"', () => {
    const a = directAnswer({ intent: 'power in PJM', executed: [{ tool: 'get_grid_intelligence', status: 'executed', result: {} }],
      intent_answer: { headline: NM } });
    expect(a).not.toMatch(/not measurable/i);
    expect(a).toMatch(/^DC Hub ran get_grid_intelligence for "power in PJM"/);
  });
});

describe('the first plan answer', () => {
  const big = () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: 'row_' + i, name: 'A long queue project name number ' + i, mw: i }));
    const sc = {
      _entity: 'plan_execution', ok: true, intent: 'how soon can a 100 MW load get power in PJM', intent_class: 'grid_headroom',
      planner_version: '5.27', constraint_iso: ['PJM'],
      executed: STEPS.map((e) => ({ ...e, result: { ...e.result, rows } })),
      replay: { decisions: rows }, answer_guide: { text: 'x'.repeat(20_000) }, provenance: { blob: 'y'.repeat(5000) },
      intent_answer: { kind: 'power_timing', headline: NM, geography: 'PJM (ISO)', evidence: ['1174 projects.'], not_established: ['ttp'], as_of: '2026-11-14', relay: null, source: 'Source: DC Hub (dchub.cloud/grid/pjm), as of 2026-11-14' },
      cite_as: 'DC Hub (dchub.cloud), as of 2026-11-14',
    };
    return { content: [{ type: 'text', text: JSON.stringify(sc) }, { type: 'text', text: 'Next session: call get_changes ...' }], structuredContent: sc };
  };
  it('leads with the answer, keeps the steps and the citation, and the whole result fits the budget', () => {
    const input = big();
    expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(100_000);
    const out = firstPlanAnswer(input);
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(FIRST_PLAN_BUDGET_BYTES);
    const b0 = JSON.parse(out.content[0].text);
    expect(Object.keys(b0)[0]).toBe('answer');
    expect(b0.answer).not.toMatch(/not measurable/i);
    expect(b0.intent_answer.headline).not.toMatch(/not measurable/i);
    expect(b0.intent_answer.not_established).toEqual(['ttp']);   // the gap is kept, not headlined
    expect(b0.executed.map((e) => e.tool)).toEqual(STEPS.map((e) => e.tool));
    expect(b0.cite_as).toMatch(/DC Hub/);
    expect(b0.as_of).toBe('2026-11-14');
    expect(b0.replay).toBeUndefined();
    expect(b0.shaped_for_first_answer.dropped).toEqual(expect.arrayContaining(['replay', 'answer_guide', 'provenance']));
    expect(out.structuredContent).toEqual(b0);
    expect(out.content[1].text).toMatch(/^Source: DC Hub/);
  });
  it('anything it cannot read passes through untouched', () => {
    const err = { isError: true, content: [{ type: 'text', text: '{}' }] };
    expect(firstPlanAnswer(err)).toBe(err);
    const notPlan = { content: [{ type: 'text', text: 'hello' }] };
    expect(firstPlanAnswer(notPlan)).toBe(notPlan);
  });
});
