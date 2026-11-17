// Grok colocation head-to-head 2026-11-17 midday, item 3: execute_plan's structuredContent is compact by default
// (lead, dated facts, citations, replay ids; no step bodies) and detail:"full" returns every step's result.
// Fixture: the six keyless head-to-head answers recorded live 2026-11-17 08:47Z (re-run tokens redacted).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { compactPlanObject, planCompactStep, planDetailRequested, PLAN_COMPACT_BUDGET, FULL_DETAIL_LINE, KEEP_KEYS }
  from '../lib/plan-compact.mjs';

const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/h2h-plans-1117.json', import.meta.url), 'utf8'));
const NAMES = Object.keys(FIX);
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
// The wire shape after the lead step: block 0 the plain-language lead, block 1 the plan's JSON.
const resultOf = (k) => {
  const sc = structuredClone(FIX[k].structuredContent);
  return { content: [{ type: 'text', text: FIX[k].lead }, { type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
};

describe('compact execute_plan answers (the six head-to-head questions)', () => {
  it('the fixture is the six recorded answers, each well over the budget before', () => {
    expect(NAMES).toHaveLength(6);
    for (const k of NAMES) expect(bytes(FIX[k].structuredContent)).toBeGreaterThan(20000);
  });

  for (const k of NAMES) {
    it(`${k}: structuredContent under 10 KB, same lead, no step bodies`, () => {
      const before = resultOf(k);
      const out = planCompactStep(resultOf(k));
      const sc = out.structuredContent;
      expect(bytes(sc)).toBeLessThanOrEqual(PLAN_COMPACT_BUDGET);
      expect(bytes(sc)).toBeLessThan(10000);
      // the same lead: block 0, and every answer key the plan composed
      expect(out.content[0].text).toBe(before.content[0].text);
      for (const key of ['fact_header', 'dcpi_verdict', 'intent_answer', 'answer_guide', 'intent', 'intent_class']) {
        expect(sc[key]).toEqual(before.structuredContent[key]);
      }
      // every step is still listed, with its status, and none carries its body
      expect(sc.executed.map((e) => [e.step, e.tool, e.status]))
        .toEqual(before.structuredContent.executed.map((e) => [e.step, e.tool, e.status]));
      expect(sc.executed.some((e) => 'result' in e)).toBe(false);
      // citations with a date for steps that named one, replay ids, the one line on how to get the bodies
      expect(Array.isArray(sc.citations) && sc.citations.length).toBeTruthy();
      expect(sc.citations.every((c) => c.step && c.tool)).toBe(true);
      expect(sc.replay.decisions.every((d) => d.id && d.status)).toBe(true);
      expect(sc.detail).toBe('compact');
      expect(sc.full_detail).toBe(FULL_DETAIL_LINE);
      // block 1 is the same object as structuredContent
      expect(JSON.parse(out.content[1].text)).toEqual(sc);
    });
  }

  it('a step that returned a dated result carries its as_of on the step and in citations', () => {
    const sc = compactPlanObject(FIX.qb.structuredContent);
    const dcpi = sc.executed.find((e) => e.tool === 'get_market_dcpi_rank');
    expect(dcpi.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sc.citations.find((c) => c.tool === 'get_market_dcpi_rank').as_of).toBe(dcpi.as_of);
  });

  it('a step that did not run keeps its manual-continue note and status_note', () => {
    const plan = structuredClone(FIX.qf.structuredContent);
    plan.executed.push({ step: 9, tool: 'get_facility', status: 'not_run', status_note: 'step limit (max_steps reached)', note: 'call get_facility directly' });
    const e = compactPlanObject(plan).executed.find((x) => x.step === 9);
    expect(e).toEqual({ step: 9, tool: 'get_facility', status: 'not_run', status_note: 'step limit (max_steps reached)', note: 'call get_facility directly' });
  });

  it('only answer keys and the caller\'s continue path survive: no next_session, quota or identity', () => {
    const sc = compactPlanObject(FIX.qa.structuredContent);
    for (const k of ['next_session', 'quota', 'identity', 'upsell_deduped', 'agent_instruction']) expect(sc[k]).toBeUndefined();
    const allowed = new Set([...KEEP_KEYS, 'detail', 'full_detail', 'executed', 'facts', 'citations', 'licences', 'provenance', 'replay']);
    for (const k of Object.keys(sc)) expect(allowed.has(k)).toBe(true);
  });
});

describe('when the full answer is returned instead', () => {
  it('detail:"full" returns the result untouched', () => {
    const r = resultOf('qb');
    expect(planCompactStep(r, { detail: 'full' })).toBe(r);
  });
  it('a paid caller keeps the full answer by default, and can ask for compact', () => {
    const r = resultOf('qb');
    expect(planCompactStep(r, { paid: true })).toBe(r);
    expect(planCompactStep(resultOf('qb'), { paid: true, detail: 'compact' }).structuredContent.detail).toBe('compact');
  });
  it('skip (loopback step, directory profiles) and the kill switch return the result untouched', () => {
    const r = resultOf('qc');
    expect(planCompactStep(r, { skip: true })).toBe(r);
    expect(planCompactStep(r, { env: { DCHUB_PLAN_COMPACT: '0' } })).toBe(r);
  });
  it('a result that is not a plan envelope is untouched', () => {
    const r = { content: [{ type: 'text', text: '{"error":"anon_hard_wall"}' }], structuredContent: { error: 'anon_hard_wall' } };
    expect(planCompactStep(r)).toBe(r);
  });
  it('detail parses only "full" and "compact"', () => {
    expect(planDetailRequested({ detail: 'FULL' })).toBe('full');
    expect(planDetailRequested({ detail: ' compact ' })).toBe('compact');
    expect(planDetailRequested({ detail: 'everything' })).toBe(null);
    expect(planDetailRequested({})).toBe(null);
    expect(planDetailRequested(null)).toBe(null);
  });
});
