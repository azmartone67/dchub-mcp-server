// plan-header-phoenix-1124.test.mjs — execute_plan's fact_header prints America/Phoenix, never a raw UTC stamp.
//
// Owner daily recheck 2026-11-24 00:55 Phoenix: Q-a's header read
//   "AS_OF: 2026-11-24T06:25Z | AS_OF_BASIS: DCPI verdict | ... | OLDEST_INPUT_AS_OF: 2026-11-23T04:00:00.000Z"
// beside spoken lines in Phoenix time ("2026-11-24 00:00 MST"). Every printed header date now goes through phoenixStamp.
import { describe, it, expect, afterEach } from 'vitest';
import { buildPlanFactHeader, phoenixStamp } from '../lib/plan-fact-header.mjs';

afterEach(() => { delete process.env.DCHUB_PLAN_HEADER_PHOENIX; });

describe('phoenixStamp', () => {
  it('a timestamp is its Phoenix minute with the offset written out; a date stays a date', () => {
    expect(phoenixStamp('2026-11-24T06:25Z')).toBe('2026-11-23T23:25-07:00');
    expect(phoenixStamp('2026-11-23T04:00:00.000Z')).toBe('2026-11-22T21:00-07:00');
    expect(phoenixStamp('2026-11-24T06:25:35.12+00:00')).toBe('2026-11-23T23:25-07:00');
    expect(phoenixStamp('2026-11-24 06:25:35')).toBe('2026-11-23T23:25-07:00');   // no zone: read as UTC
    expect(phoenixStamp('2026-11-19')).toBe('2026-11-19');
    expect(phoenixStamp('2026-10-31T00:00:00Z')).toBe('2026-10-31');               // a date serialized as a timestamp
    expect(phoenixStamp(null)).toBeNull();
  });
  it('the result is still ISO-8601 and the same instant', () => {
    const v = phoenixStamp('2026-11-24T06:25Z');
    expect(Date.parse(v)).toBe(Date.parse('2026-11-24T06:25Z'));
  });
  it('kill switch prints the raw value', () => {
    process.env.DCHUB_PLAN_HEADER_PHOENIX = '0';
    expect(phoenixStamp('2026-11-24T06:25Z')).toBe('2026-11-24T06:25Z');
  });
});

describe('buildPlanFactHeader prints Phoenix', () => {
  const plan = {
    _entity: 'plan_execution', intent_class: 'colocation', constraint_iso: ['PJM'],
    provenance: { as_of: '2026-11-23T04:00:00.000Z' },
    dcpi_verdict: { verdict: 'AVOID', composite_score: 20, market_slug: 'ashburn' },
    executed: [
      { step: 1, tool: 'get_market_dcpi_rank', status: 'executed', args: { market_slug: 'ashburn' },
        result: { verdict: 'AVOID', composite_score: 20, market_slug: 'ashburn', computed_at: '2026-11-24T06:25:10Z' } },
      { step: 2, tool: 'get_grid_intelligence', status: 'executed', args: { iso: 'PJM' }, as_of: '2026-11-23T04:00:00.000Z', result: {} },
    ],
  };
  it('AS_OF and OLDEST_INPUT_AS_OF carry no Z', () => {
    const h = buildPlanFactHeader(plan);
    const l0 = h.split('\n')[0];
    expect(l0).toContain('AS_OF: 2026-11-23T23:25-07:00 | AS_OF_BASIS: DCPI verdict');
    expect(l0).toContain('OLDEST_INPUT_AS_OF: 2026-11-22T21:00-07:00');
    expect(l0).not.toMatch(/\dZ\b/);
  });
});
