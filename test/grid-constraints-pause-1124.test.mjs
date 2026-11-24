// grid-constraints-pause-1124.test.mjs — the Loudoun transmission answer says the named county's data-center pause.
//
// Owner daily recheck 2026-11-24 00:55 Phoenix (p5, planner 5.63): get_permitting_intel {state: VA} ran, yet the spoken
// answer never said that Loudoun's supervisors approved a 12-month data-center pause (record dated 2026-11-18), and the
// state read was cut to 16 of 26 rows by the response budget, so Loudoun's enacted moratorium record was not in it at all.
import { describe, it, expect } from 'vitest';
import { buildGridConstraintsAnswer, gridConstraintsSequence } from '../lib/power-rotation-1123.mjs';

const P5 = 'What transmission constraints limit new large loads in Northern Virginia (Loudoun County), and what transmission upgrades are planned?';
const ex = (step, tool, args, result) => ({ step, tool, args, status: 'executed', result });
const PAUSE = { id: 3990, class: 'local_sentiment', jurisdiction: 'Loudoun County', state: 'VA', as_of: '2026-11-18', as_of_basis: 'source_publish_date',
  title: 'Loudoun Supervisors Approve 12-Month Data Center Pause', detail: 'Loudoun Supervisors Approve 12-Month Data Center Pause LoudounNow.com',
  source_publisher_url: 'https://www.loudounnow.com', verified: true, row_status: 'published' };
const MOR = { id: 2445, class: 'moratorium', stage: 'enacted', scope: 'local', jurisdiction: 'Loudoun County', as_of: '2026-09-18', as_of_basis: 'source_publish_date',
  detail: 'Enacted — local data center moratorium, per local news.', title: 'Virginia’s Loudoun County board votes to pause new data center applications' };
const OTHER = { id: 4253, class: 'local_sentiment', jurisdiction: 'Stafford County', state: 'VA', as_of: '2026-11-19', title: 'Stafford County residents push back' };
const SUFFOLK = { id: 2446, class: 'moratorium', stage: 'enacted', scope: 'local', jurisdiction: 'Suffolk', as_of: '2026-10-23' };
const ctx = { intent_class: 'grid_constraints', intent: P5, state: 'VA', place_label: 'Loudoun County, VA' };

describe('grid_constraints: the named jurisdiction pause', () => {
  it('the sequence reads the moratorium class on its own, beside the state read', () => {
    const seq = gridConstraintsSequence({ state: 'VA', coords: { lat: 39.09, lon: -77.64 } }, { VA: ['PJM'] });
    const pis = seq.filter((s) => s.tool === 'get_permitting_intel').map((s) => s.args_hint);
    expect(pis).toEqual([{ state: 'VA' }, { class: 'moratorium', state: 'VA' }]);
  });
  it('the lead names the 2026-11-18 pause; evidence keeps the enacted moratorium with its own date', () => {
    const a = buildGridConstraintsAnswer(ctx, [
      ex(4, 'get_permitting_intel', { state: 'VA' }, { records: [OTHER, PAUSE] }),
      ex(5, 'get_permitting_intel', { class: 'moratorium', state: 'VA' }, { records: [SUFFOLK, MOR] }),
    ]);
    expect(a.headline).toMatch(/Loudoun County: local news record "Loudoun Supervisors Approve 12-Month Data Center Pause" \(loudounnow\.com, source date 2026-11-18, verified\)/);
    const ev = a.evidence.join(' ');
    expect(ev).toMatch(/enacted local moratorium record .*source date 2026-09-18/);
    expect(ev).not.toMatch(/Stafford|Suffolk/);
    expect(a.facts.find((f) => f.tool === 'get_permitting_intel').as_of).toBe('2026-11-18');
  });
  it('a record in another county, or sentiment with no pause word, is not said as a pause', () => {
    const a = buildGridConstraintsAnswer(ctx, [
      ex(4, 'get_permitting_intel', { state: 'VA' }, { records: [OTHER, { ...PAUSE, title: 'Loudoun residents discuss growth', detail: 'x' }] }),
    ]);
    expect(a == null || !/pause|moratorium/i.test(a.headline)).toBe(true);
  });
  it('no permitting step: the answer is unchanged in shape', () => {
    const a = buildGridConstraintsAnswer(ctx, [ex(2, 'get_grid_intelligence', { iso: 'PJM' }, {})]);
    expect(a == null || !/pause/i.test(a.headline)).toBe(true);
  });
});
