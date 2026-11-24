// intent-answer-noniso-queue-1123.test.mjs: the intent answer's queue line for a state on no US ISO.
// Live 2026-11-23 (server 2.12.63): "How many generation projects are in the interconnection queue in Georgia ...?"
// answered "0 active interconnection-queue projects." Georgia is on no ISO, so DC Hub holds no rows for it; the 0 is
// not Georgia's queue. lib/state-queue-coverage.mjs words it; ISO states keep their count.
import { describe, it, expect } from 'vitest';
import { buildIntentAnswer } from '../lib/intent-answers.mjs';

const NOW = Date.parse('2026-11-24T04:00:00Z');
const step = (tool, args, p) => ({ tool, args, status: 'executed', result: p });
const ctx = (intent, intent_class, extra = {}) => ({ intent, intent_class, constraint_iso: [], resolution_gap: null, ...extra });
const Q = 'How many generation projects are in the interconnection queue in Georgia, and what is the time to power there?';
const ev = (a) => (a ? a.evidence.join(' ') : '');

describe('non-ISO state queue line in the intent answer', () => {
  for (const cls of ['interconnection_queue', 'capacity_search']) {
    it(`${cls}: GA with 0 rows says it is outside ISO coverage, never "0 active"`, () => {
      const q = step('get_refined_queue', { geocoded_only: true, state: 'GA' }, { results: [], count_total_matching: 0, source_as_of: '2026-10-31' });
      const a = buildIntentAnswer(ctx(Q, cls, { state: 'GA', states: ['GA'] }), [q], null, NOW);
      expect(ev(a)).toMatch(/GA is outside ISO queue coverage \(Southern Company/);
      expect(ev(a)).not.toMatch(/\b0 active interconnection-queue projects/);
    });
  }
  it('GA filtered server-side with 0 rows says the same', () => {
    const q = step('get_refined_queue', { state: 'GA' }, { results: [], count_total_matching: 0, source_as_of: '2026-10-31',
      scope: { state: 'GA', filtered_server_side: true, kept: 0 } });
    const a = buildIntentAnswer(ctx(Q, 'interconnection_queue', { state: 'GA', states: ['GA'] }), [q], null, NOW);
    expect(ev(a)).toMatch(/GA is outside ISO queue coverage/);
    expect(ev(a)).not.toMatch(/\b0 active interconnection-queue projects/);
  });
  it('control: an ISO state keeps its count', () => {
    const q = step('get_refined_queue', { iso: 'PJM', state: 'VA' }, { results: [], count_total_matching: 311, source_as_of: '2026-11-05',
      freshness_by_iso: { PJM: { source_as_of: '2026-11-05' } } });
    const a = buildIntentAnswer(ctx('how soon can I get 100 MW in Virginia', 'interconnection_queue', { state: 'VA', states: ['VA'], constraint_iso: ['PJM'] }), [q], null, NOW);
    expect(ev(a)).toMatch(/311 active interconnection-queue projects/);
    expect(ev(a)).not.toMatch(/outside ISO queue coverage/);
  });
});
