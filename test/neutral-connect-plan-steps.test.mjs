// Option A: execute_plan step results get the same neutral rewrite as a direct call. Measured live 2026-11-17 after
// #1507: get_market_intel said "A key with a bound email gets full answers", but the same tool as an execute_plan step
// kept "... gets 10 full answers a day." in executed[2].result.quota.full_answers_unavailable_reason, because every
// array element was treated as a data row.
import { describe, it, expect } from 'vitest';
import { neutralConnectStep, STEP_RESULT_LIST_KEYS } from '../lib/neutral-connect.mjs';

const STAMP = 'NOT APPLICABLE: `get_market_intel` is a preview for anonymous callers and keys without a bound email; '
  + 'no daily full-answer budget is charged here. A key with a bound email gets 10 full answers a day.';
const plan = () => ({
  intent_class: 'colocation',
  executed: [
    { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'northern-virginia' }, result: { verdict: 'AVOID' } },
    { step: 2, tool: 'search_facilities', status: 'executed', args: { query: 'Northern Virginia' },
      result: { note: 'Free tier preview — up to 3 rows shown per list; each list\'s full length is in its _<field>_total_available sibling. Call claim_free_key (no email) for the free tier, or relay the link in human_url to your human for full results.',
        data: [{ name: 'Campus offering 10 full answers a day', notes: ['up to 10 full rankings a day'] }] } },
    { step: 3, tool: 'get_market_intel', status: 'executed', args: { market: 'northern-virginia' }, result: { quota: { full_answers_unavailable_reason: STAMP } } },
  ],
});
const run = (sc) => neutralConnectStep({ content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc });

describe('execute_plan step results are tool output, not data rows', () => {
  it('a step\'s quota stamp loses the allowance, in structuredContent and in the text block', () => {
    const r = run(plan());
    const want = 'NOT APPLICABLE: `get_market_intel` is a preview for anonymous callers and keys without a bound email; '
      + 'no daily full-answer budget is charged here. A key with a bound email gets full answers.';
    expect(r.structuredContent.executed[2].result.quota.full_answers_unavailable_reason).toBe(want);
    expect(JSON.parse(r.content[0].text).executed[2].result.quota.full_answers_unavailable_reason).toBe(want);
  });
  it('a step\'s preview note is neutral too', () => {
    const note = run(plan()).structuredContent.executed[1].result.note;
    expect(note).toMatch(/^Preview — up to 3 rows shown per list/);
    expect(note).not.toMatch(/free tier/i);
  });
  it('data rows inside a step result are still data', () => {
    const row = run(plan()).structuredContent.executed[1].result.data[0];
    expect(row).toEqual({ name: 'Campus offering 10 full answers a day', notes: ['up to 10 full rankings a day'] });
  });
  it('step metadata is untouched', () => {
    const e = run(plan()).structuredContent.executed;
    expect(e.map((x) => [x.step, x.tool, x.status])).toEqual([[1, 'get_market_dcpi_rank', 'executed'], [2, 'search_facilities', 'executed'], [3, 'get_market_intel', 'executed']]);
    expect(e[0]).toEqual(plan().executed[0]);
  });
  it('only executed[] is a step-result list', () => {
    expect([...STEP_RESULT_LIST_KEYS]).toEqual(['executed']);
    const sc = { rows: [{ quota: { full_answers_unavailable_reason: STAMP } }] };
    expect(run(sc).structuredContent.rows[0].quota.full_answers_unavailable_reason).toBe(STAMP);
  });
  it('kill switch: byte for byte', () => {
    const sc = plan();
    const res = { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
    expect(neutralConnectStep(res, { env: { DCHUB_NEUTRAL_CONNECT: '0' } })).toBe(res);
  });
});
