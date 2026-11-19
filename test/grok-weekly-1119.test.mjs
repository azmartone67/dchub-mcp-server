// grok-weekly-1119.test.mjs — Grok weekly leadership check 2026-11-19 (keyless /mcp), items 1-4.
//
//   1. one human link: with the relay in the URL fields, the wall sentences name no /connect URL of their own and
//      point at that link (lib/plan-one-link.mjs); live Ohio carried /upgrade/h in human_url and /connect in
//      human_message + prose. The relay never goes into prose (M1.2).
//   2. the intent answer's Source line always carries "as of <date>" (live Ohio: "Source: DC Hub (dchub.cloud/grid/pjm)").
//   3. a verdict dated differently from the oldest input labels both (live Dallas: 2026-09-26 under a 2026-11-19
//      verdict); the fact header names the layer that is oldest (Phoenix: the utilities layer, 2026-09-30).
//   4. a preview that drops target_mw on the retirement read says so.
import { describe, it, expect } from 'vitest';
import { planOneLinkStep, oneLinkString, theRelayLink } from '../lib/plan-one-link.mjs';
import { buildIntentAnswer, datedSource } from '../lib/intent-answers.mjs';
import { oldestInputOf } from '../lib/plan-fact-header.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const RELAY = 'https://dchub.cloud/upgrade/h/YS1hYmN8ZXhlY3V0ZV9wbGFu.0123456789abcdef0123456789abcdef?via=mcp-wall&wall=anon_daily_cap&src=get_power_availability_timeline';
const MSG = 'Your AI assistant ran 4 DC Hub lookups for your question; 4 returned previews at your access level. Open https://dchub.cloud/connect for more detail.';
const HUMAN_LINKS = /https:\/\/dchub\.cloud\/(?:connect|upgrade\/h\/)[^\s"'<>)\]\\]*|(?<![\w/.])dchub\.cloud\/connect/g;
const linksIn = (s) => new Set((s.match(HUMAN_LINKS) || []).map((u) => u.replace(/[.,;:!?]+$/, '')));

// The shape served live for "when can I get power in Ohio" (2026-11-19 17:37Z, keyless), cut to the link fields.
function ohioResult() {
  const sc = {
    _entity: 'plan_execution', intent_class: 'power_timeline',
    intent_answer: { kind: 'power_timing', as_of: '2026-11-19', relay: { url: RELAY, text: MSG }, source: 'Source: DC Hub (dchub.cloud/grid/pjm), as of 2026-11-19' },
    human_url: RELAY, human_message: MSG, for_your_human: { text: MSG, url: RELAY },
    references: ['https://dchub.cloud/data-sources'],
  };
  return { content: [
    { type: 'text', text: 'Time to power for PJM (ISO): no time-to-power figure in this read.' },
    { type: 'text', text: JSON.stringify(sc) },
    { type: 'text', text: 'This answer is partial; the full answer is at https://dchub.cloud/connect' },
    { type: 'text', text: 'More detail is available at dchub.cloud/connect.' },
  ], structuredContent: sc };
}

describe('item 1: one human link per execute_plan answer', () => {
  it('control: the served shape carries two human links', () => {
    expect(linksIn(JSON.stringify(ohioResult())).size).toBe(3);   // relay, https /connect, scheme-less /connect
  });
  it('after the step the relay in the URL fields is the only human link, and no prose carries it', () => {
    const out = planOneLinkStep(ohioResult(), { env: {} });
    expect([...linksIn(JSON.stringify(out))]).toEqual([RELAY]);
    expect(out.structuredContent.human_message).toBe(MSG.replace('Open https://dchub.cloud/connect for more detail.', 'Open the link for more detail.'));
    expect(out.structuredContent.human_url).toBe(RELAY);
    expect(out.structuredContent.intent_answer.relay.text).toBe(out.structuredContent.human_message);
    expect(out.content[2].text).toBe('This answer is partial; the full answer is behind the link in human_url');
    expect(out.content[3].text).toBe('More detail is behind the link in human_url.');
    for (const b of [out.content[0], out.content[2], out.content[3]]) expect(b.text).not.toContain('upgrade/h');
    expect(JSON.parse(out.content[1].text).for_your_human.text).toContain('Open the link for more detail.');
  });
  it('reference pages, data and other /connect paths are untouched', () => {
    const out = planOneLinkStep(ohioResult(), { env: {} });
    expect(out.structuredContent.references).toEqual(['https://dchub.cloud/data-sources']);
    expect(out.content[0].text).toBe('Time to power for PJM (ISO): no time-to-power figure in this read.');
    expect(oneLinkString('see https://dchub.cloud/connectors and More detail is available at dchub.cloud/connect/x'))
      .toBe('see https://dchub.cloud/connectors and More detail is available at dchub.cloud/connect/x');
  });
  it('tagged /connect in prose goes too', () => {
    expect(oneLinkString('Open https://dchub.cloud/connect?via=mcp-wall&wall=connect&src=execute_plan for more detail.')).toBe('Open the link for more detail.');
  });
  it('relay off (URL fields are /connect), no link, kill switch, skip: unchanged (same object)', () => {
    const tagged = 'https://dchub.cloud/connect?via=mcp-wall&wall=connect&src=execute_plan';
    const r0 = ohioResult(); r0.structuredContent.human_url = tagged; r0.structuredContent.for_your_human.url = tagged;
    expect(planOneLinkStep(r0, { env: {} })).toBe(r0);
    const r = ohioResult(); delete r.structuredContent.human_url; delete r.structuredContent.for_your_human;
    expect(planOneLinkStep(r, { env: {} })).toBe(r);
    const r2 = ohioResult();
    expect(planOneLinkStep(r2, { env: { DCHUB_PLAN_ONE_LINK: '0' } })).toBe(r2);
    expect(planOneLinkStep(r2, { env: {}, skip: true })).toBe(r2);
    expect(theRelayLink({ human_url: 'https://evil.example/upgrade/h/x' })).toBe(null);
  });
});

describe('item 2: the Source line always carries "as of <date>"', () => {
  it('undated line gets the answer\'s date', () => {
    expect(datedSource('Source: DC Hub (dchub.cloud/grid/pjm)', '2026-11-19', null)).toBe('Source: DC Hub (dchub.cloud/grid/pjm), as of 2026-11-19');
    expect(datedSource('Source: DC Hub (dchub.cloud).', null, null, Date.parse('2026-11-19T12:00:00Z'))).toBe('Source: DC Hub (dchub.cloud), as of 2026-11-19');
  });
  it('a dated line is kept as it is', () => {
    expect(datedSource('Source: DC Hub (dchub.cloud/markets/phoenix), as of 2026-11-12', '2026-11-12', null)).toBe('Source: DC Hub (dchub.cloud/markets/phoenix), as of 2026-11-12');
  });
  it('Ohio-shaped plan (grid step states no date) leads to a dated Source line', () => {
    const grid = { ok: true, iso: 'PJM', demand_mw: 94069 };
    const ia = buildIntentAnswer({ intent: 'when can I get power in Ohio', intent_class: 'power_timeline', constraint_iso: ['PJM'], state: 'OH', states: [] },
      [ex(1, 'get_grid_intelligence', { iso: 'PJM' }, grid)], null, Date.parse('2026-11-19T17:00:00Z'));
    expect(ia.kind).toBe('power_timing');
    expect(ia.source).toMatch(/^Source: DC Hub \(dchub\.cloud[^)]*\), as of \d{4}-\d{2}-\d{2}/);
  });
});

describe('item 3: a verdict dated differently from the oldest input labels both', () => {
  it('Dallas: oldest input 2026-09-26, verdict 2026-11-19', () => {
    expect(datedSource('Source: DC Hub (dchub.cloud/markets/dallas), as of 2026-09-26', '2026-09-26',
      { value: 'CAUTION', source: 'Source: DC Hub (dchub.cloud/markets/dallas), as of 2026-11-19' }))
      .toBe('Source: DC Hub (dchub.cloud/markets/dallas), as of 2026-09-26 (oldest input); DCPI verdict as of 2026-11-19');
  });
  it('same day: one date', () => {
    expect(datedSource('Source: DC Hub (dchub.cloud/markets/x), as of 2026-11-19', '2026-11-19',
      { source: 'Source: DC Hub (dchub.cloud/markets/x), as of 2026-11-19' })).toBe('Source: DC Hub (dchub.cloud/markets/x), as of 2026-11-19');
  });
  it('fact header names the oldest layer inside market intel', () => {
    const plan = { _entity: 'plan_execution', executed: [
      ex(1, 'get_market_intel', { market: 'phoenix' }, { as_of: '2026-11-12T21:03:17', provenance: { as_of: '2026-09-30' },
        siting: { mw: { as_of: '2026-11-12T21:03:17' }, utilities: { as_of: '2026-09-30' }, dcpi: { as_of: '2026-11-19T17:13:21+00:00' } } }),
    ], provenance: { as_of: '2026-09-30' } };
    const name = oldestInputOf(plan, '2026-09-30');
    expect(name).toContain('Phoenix');
    expect(name).toContain('(utilities layer)');
  });
});

describe('item 4: a preview that drops target_mw says so', () => {
  const ctx = { intent: 'where can I get 200 MW of power for a data center in Texas', intent_class: 'capacity_search',
    constraint_iso: ['ERCOT'], state: 'TX', states: [], requested_mw: 200 };
  const ret = (fa) => ex(1, 'get_retirement_headroom', { target_mw: 200, horizon_months: 24 },
    { ok: true, count_returned: 0, data: [], _total_available: 10, total_retiring_mw: null, filters_applied: fa, meta: {} });
  it('target_mw null in filters_applied: the answer says it was not applied', () => {
    const ia = buildIntentAnswer(ctx, [ret({ target_mw: null, limit: 10 })], null);
    expect(ia.not_established.join(' ')).toContain('The 200 MW target was not applied to the retirement read at this access level (it ran at the backend default).');
  });
  it('control: applied target, no such line', () => {
    const ia = buildIntentAnswer(ctx, [ret({ target_mw: 200, limit: 10 })], null);
    expect(ia.not_established.join(' ')).not.toContain('target was not applied');
  });
});
