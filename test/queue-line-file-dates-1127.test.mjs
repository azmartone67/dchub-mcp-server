// queue-line-file-dates-1127.test.mjs — Grok fix-all 2026-11-27 item 9 (owner: "Print both file dates"): the state queue
// line for AZ names CAISO's newest and oldest source-file dates, not the oldest file's date alone.
import fs from 'node:fs';
import { it, expect } from 'vitest';
import { buildCrossDomainAnswer, queueFileDatesClause } from '../lib/cross-domain-answer.mjs';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/xd-energy-1118/${n}.json`, import.meta.url), 'utf8'));
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const asMap = (rows) => new Map(rows.map((e) => [e, e.result]));
const OLD_URL = 'https://www.caiso.com/documents/cluster-15-interconnection-requests.xlsx';
// get_refined_queue state=AZ, read live 2026-11-28 02:43Z (trimmed).
const STALENESS = { stale_after_days: 45, stale_isos: { CAISO: { age_days: 135, newest_file_date: '2026-11-26T09:02:58+00:00',
  oldest_file: { age_days: 135, file_date: '2026-07-16T21:57:50+00:00', url: OLD_URL }, source_as_of: '2026-07-16T21:57:50+00:00', stale: true } } };
const refined = (extra = {}) => ({ ok: true, count_returned: 2, count_total_matching: 26, filters_applied: { iso: null, state: 'AZ', status: 'active' },
  freshness_by_iso: { CAISO: { source_as_of: '2026-07-16T21:57:50+00:00' } }, summary: { by_iso: { CAISO: 2 } },
  results: [{ iso: 'CAISO', state: 'AZ', county: 'LA PAZ' }, { iso: 'CAISO', state: 'AZ', county: 'LA PAZ' }], ...extra });
const phx = (r) => {
  const rows = [
    ex(1, 'get_market_dcpi_rank', { market_slug: 'phoenix-az' }, { verdict: 'CAUTION', market_name: 'Phoenix', composite_score: 43.5, computed_at: '2026-11-18T00:30:00Z' }),
    ex(2, 'get_refined_queue', { state: 'AZ' }, r),
    ex(3, 'get_power_availability_timeline', { state: 'AZ', mw: 100 }, fx('timeline-az-keyless')),
  ];
  return buildCrossDomainAnswer({ intent: 'What does the grid look like for a 100 MW data center in Phoenix?', intent_class: 'dc_power_place',
    requested_mw: 100, place: { label: 'Phoenix', state: 'AZ', iso: null, market: 'phoenix' } }, rows, asMap(rows));
};

it('the AZ line names both CAISO file dates and keeps the not-AZ\'s-own-queue wording', () => {
  const a = phx(refined({ source_staleness: STALENESS }));
  expect(a.headline).toContain("located in AZ (not AZ's own queue) (CAISO source files: newest dated 2026-11-26, oldest cluster-15-interconnection-requests.xlsx dated 2026-07-16)");
  expect(a.headline).not.toMatch(/own queue\) \(as of 2026-07-16\)/);
});

it('without a staleness block the line is as before', () => {
  const a = phx(refined());
  expect(a.headline).toMatch(/Power: 26 requests from the CAISO queue file located in AZ \(not AZ's own queue\)/);
  expect(a.headline).not.toContain('source files:');
});

it('queueFileDatesClause: null on equal dates, junk, or a missing ISO', () => {
  const same = { stale_isos: { CAISO: { newest_file_date: '2026-07-16', oldest_file: { file_date: '2026-07-16' } } } };
  expect(queueFileDatesClause({ source_staleness: same }, 'CAISO')).toBe(null);
  expect(queueFileDatesClause(null, 'CAISO')).toBe(null);
  expect(queueFileDatesClause({ source_staleness: { stale_isos: { CAISO: STALENESS.stale_isos.CAISO, PJM: {} } } }, 'MISO')).toBe(null);
  expect(queueFileDatesClause({ source_staleness: STALENESS }, null)).toMatch(/^ \(CAISO source files: newest dated 2026-11-26/);
});
