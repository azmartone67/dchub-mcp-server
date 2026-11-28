// permitting-in-effect-1127.test.mjs — Grok fix-all 2026-11-27 item 7: an enacted moratorium that took effect in the
// last 30 days is named in the lead even when five newer reports outrank it by source date (Loudoun County 3990).
import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildPermittingAnswer } from '../lib/permitting-answer.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const rec = (j, st, stage, d, eff) => ({ class: 'moratorium', jurisdiction: j, state: st, stage, as_of: d,
  effective_date: eff, source_url: `https://example.org/${j.replace(/\W+/g, '-').toLowerCase()}` });
const ROWS = [
  rec('Horn Lake', 'MS', 'proposed', '2026-11-25', null),
  rec('East Fishkill', 'NY', 'enacted', '2026-11-25', null),
  rec('Marshalltown', 'IA', 'enacted', '2026-11-24', null),
  rec('Aurora', 'CO', 'enacted', '2026-11-24', null),
  rec('Alpena Township', 'MI', 'enacted', '2026-11-24', null),
  rec('Loudoun County', 'VA', 'enacted', '2026-11-18', '2026-11-17'),
  rec('Virginia (statewide)', 'VA', 'speculative', '2026-11-12', '2026-11'),
  rec('Old Town', 'OH', 'enacted', '2026-09-01', '2026-09-01'),
  rec('Future Town', 'TX', 'enacted', '2026-11-20', '2027-01-01'),
  rec('Proposed Place', 'GA', 'proposed', '2026-11-19', '2026-11-20'),
];
const run = (rows = ROWS, intent = 'Which US jurisdictions have enacted data center moratoriums recently?') =>
  buildPermittingAnswer({ intent, intent_class: 'permitting' }, [
    ex(1, 'get_permitting_intel', { class: 'moratorium' }, { ok: true, class: 'moratorium', count: 100, records: rows }),
  ]);

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-28T02:20:00Z')); });
afterAll(() => { vi.useRealTimers(); });

it('names Loudoun County in the lead as enacted and in effect', () => {
  const a = run();
  expect(a.headline).toContain('Most recent by source date: Horn Lake, MS');
  expect(a.headline).toContain('Enacted and in effect within the last 30 days: Loudoun County, VA (enacted, effective 2026-11-17)');
});

it('skips non-enacted, future, stale, month-only and already-listed rows', () => {
  const line = run().headline.split('Enacted and in effect within the last 30 days: ')[1];
  for (const j of ['Old Town', 'Future Town', 'Proposed Place', 'Virginia (statewide)', 'East Fishkill']) {
    expect(line).not.toContain(j);
  }
});

it('adds the in-effect row to Record sources', () => {
  const src = run().evidence.find((t) => t.startsWith('Record sources: '));
  expect(src).toContain('https://example.org/loudoun-county');
});

it('prints no in-effect line when nothing qualifies', () => {
  const a = run(ROWS.filter((r) => r.jurisdiction !== 'Loudoun County'));
  expect(a.headline).not.toContain('in effect within the last 30 days');
});
