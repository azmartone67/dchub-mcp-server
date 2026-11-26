// gdl-permitting-sources-1125.test.mjs — Grok daily MCP leadership note 2026-11-25, item 1c: each moratorium record
// the lead lists as "Most recent" carries its own source link in the evidence.
import { it, expect } from 'vitest';
import { buildPermittingAnswer } from '../lib/permitting-answer.mjs';

const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const rec = (j, st, d, url) => ({ class: 'moratorium', jurisdiction: j, state: st, stage: 'enacted', as_of: d, source_url: url });
const ROWS = [
  rec('Suffolk', 'VA', '2026-10-23', 'https://example.org/suffolk'),
  rec('Clackamas County', 'OR', '2026-10-20', 'https://example.org/clackamas'),
  rec('Howell Township', 'MI', '2026-10-10', null),
  rec('Colfax County', 'NM', '2026-10-05', 'javascript:alert(1)'),
  rec('Milwaukee', 'WI', '2026-10-01', 'https://example.org/milwaukee'),
  rec('Beloit', 'WI', '2026-09-01', 'https://example.org/beloit-not-top5'),
];
const ctx = (intent) => ({ intent, intent_class: 'permitting' });
const run = (intent) => buildPermittingAnswer(ctx(intent), [
  ex(1, 'get_permitting_intel', { class: 'moratorium' }, { ok: true, class: 'moratorium', count: 54, records: ROWS }),
  ex(3, 'get_permitting_intel', { class: 'zoning' }, { ok: true, count: 0, records: [] }),
]);

it('lists a source link for each top-5 record that has one, and only those', () => {
  const a = run('Which US counties have data center moratoriums right now?');
  const line = a.evidence.find((t) => t.startsWith('Record sources: '));
  expect(line).toBeTruthy();
  expect(line).toContain('Suffolk, VA (enacted, as of 2026-10-23) https://example.org/suffolk');
  expect(line).toContain('https://example.org/clackamas');
  expect(line).toContain('https://example.org/milwaukee');
  expect(line).not.toContain('beloit-not-top5');
  expect(line).not.toContain('javascript:');
  expect(line).not.toContain('Howell');
});

it('keeps the zoning clause in the headline', () => {
  expect(run('Which US counties have data center moratoriums right now?').headline).toMatch(/No zoning-restriction record is published/);
});

it('no linked record means no sources line', () => {
  const a = buildPermittingAnswer(ctx('any data center moratoriums?'), [
    ex(1, 'get_permitting_intel', { class: 'moratorium' }, { ok: true, class: 'moratorium', count: 1, records: [rec('X Town', 'TX', '2026-10-01', null)] }),
  ]);
  expect(a.evidence.some((t) => t.startsWith('Record sources'))).toBe(false);
});
