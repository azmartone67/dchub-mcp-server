// ── execute_plan: a live-export queue step is labelled COLLECTED, not UNDATED (5.17 follow-up) ──
//
// Owner 2026-11-09 ("Yes, label collected"). SPP, PJM, MISO and ISO-NE generate their
// interconnection queue export on request and send no report date, so the backend keeps
// as_of null (10-12 rule: a fetch time is not a data date) and says so in
// provenance.as_of_basis ("UNMEASURED at collection level: … live feeds …"), with the
// collection time in provenance.fetched_at. The power-evidence check named every such
// step UNDATED ("do not present as current"), which hid a real, timed reading. Now a
// queue step with that shape carries collected_at, and the guide says to quote it as
// "collected <time>", never as an as_of. The data's as_of stays null.
//
// What fails here:
//   - the live SPP shape staying UNDATED, or gaining an as_of;
//   - a non-queue tool, or a queue step with no UNMEASURED basis or no fetched_at,
//     being labelled collected (they stay UNDATED);
//   - answer_guide not carrying the COLLECTED sentence for a live SPP queue step
//     (end to end, real server.mjs on loopback against a stub backend);
//   - a report-dated queue step (ERCOT) gaining a collected label.
// No network: the end-to-end case runs behind fenceNetwork.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';

// The harness sets PORT before server.mjs loads, so server.mjs is imported lazily.
let _execPowerEvidence, _execUndatedSentence, _execCollectedSentence;
let H, fence;

const FETCHED = '2026-11-09T06:05:07.999349+00:00';
const BASIS = 'UNMEASURED at collection level: SPP are live feeds with no published report date. fetched_at is when DC Hub last collected them, not a data date; per-ISO report dates are in source_as_of on each row.';
// The live keyless get_interconnection_queue iso=SPP shape, 2026-11-09 (fields read only).
const SPP = { step: 3, tool: 'get_interconnection_queue', status: 'gated_preview', args: { iso: 'SPP' },
  result: { as_of: null, provenance: { source: 'US ISO public interconnection queues (ERCOT GIS / PJM NSQ / MISO GI / SPP / CAISO / NYISO / ISO-NE)',
                                       as_of: null, as_of_basis: BASIS, fetched_at: FETCHED } } };
const ERCOT = { step: 3, tool: 'get_interconnection_queue', status: 'executed', args: { iso: 'ERCOT' },
  result: { as_of: '2026-11-09', provenance: { source: 'US ISO public interconnection queues', as_of: '2026-10-31',
                                               as_of_basis: 'OLDEST report date among the rows served', fetched_at: FETCHED } } };
beforeAll(async () => {
  fence = fenceNetwork();
  // The live keyless /interconnection-queue/by-iso?iso=SPP shape (fields read only).
  const routes = (p) => (/interconnection-queue\/by-iso/.test(p)
    ? { status: 200, body: { iso: 'SPP', as_of: null, projects: [],
                             provenance: { source: SPP.result.provenance.source, as_of: null, as_of_basis: BASIS, fetched_at: FETCHED } } }
    : undefined);
  H = await startHarness({ extraRoutes: routes });
  ({ _execPowerEvidence, _execUndatedSentence, _execCollectedSentence } = await import('../server.mjs'));
}, 240_000);
afterAll(async () => {
  if (H) await H.stop();
  if (fence) fence.restore();
});

const clone = (e, patch) => { const c = structuredClone(e); patch(c.result); return c; };

describe('_execPowerEvidence: live-export queue steps', () => {
  it('labels the live SPP shape collected: ok, as_of still null, collected_at = fetched_at', () => {
    const [ev] = _execPowerEvidence([SPP]);
    expect(ev).toEqual({ step: 3, tool: 'get_interconnection_queue', iso: 'SPP', source: SPP.result.provenance.source,
                         as_of: null, collected_at: FETCHED, as_of_kind: 'collected', ok: true });
    expect(_execUndatedSentence([ev])).toBe('');
  });

  it('get_refined_queue with the same shape is labelled too', () => {
    const [ev] = _execPowerEvidence([{ ...SPP, tool: 'get_refined_queue' }]);
    expect(ev).toMatchObject({ collected_at: FETCHED, ok: true });
  });

  it('stays UNDATED without the UNMEASURED basis, without fetched_at, or on a non-queue tool', () => {
    const noBasis = clone(SPP, (r) => { delete r.provenance.as_of_basis; });
    const noFetch = clone(SPP, (r) => { delete r.provenance.fetched_at; });
    // A basis that only MENTIONS unmeasured feeds (a dated read naming what it excluded) is not one.
    const mention = clone(SPP, (r) => { r.provenance.as_of_basis = 'OLDEST report date; UNMEASURED live feeds excluded'; });
    const grid = { ...SPP, tool: 'get_grid_intelligence' };
    for (const e of [noBasis, noFetch, mention, grid]) {
      const [ev] = _execPowerEvidence([e]);
      expect(ev.ok).toBe(false);
      expect(ev.missing).toContain('as_of');
      expect(ev.collected_at).toBeUndefined();
    }
  });

  it('a report-dated queue step keeps its as_of and gets no collected label', () => {
    const [ev] = _execPowerEvidence([ERCOT]);
    expect(ev).toMatchObject({ as_of: '2026-11-09', ok: true });
    expect(ev.collected_at).toBeUndefined();
    expect(ev.as_of_kind).toBeUndefined();
  });
});

describe('_execCollectedSentence', () => {
  it('names the step, its grid and its collection time, and forbids an as_of reading', () => {
    expect(_execCollectedSentence(_execPowerEvidence([SPP]))).toBe(
      'COLLECTED, NOT REPORT-DATED — get_interconnection_queue (step 3, SPP) was collected by DC Hub at '
      + FETCHED + '; the ISO publishes no report date for it. Quote those figures as "collected <time>", '
      + 'never as "as of" or as a report date.');
  });

  it('says nothing when no step is collected', () => {
    expect(_execCollectedSentence(_execPowerEvidence([ERCOT]))).toBe('');
  });
});

describe('execute_plan end to end: a live SPP queue step', () => {
  it('power_evidence labels the queue step collected and answer_guide says how to quote it', async () => {
    const r = await H.call('/mcp', 'execute_plan', { intent: 'evaluate 100 MW power headroom for a GPU cluster in SPP' },
                           { 'user-agent': 'test-client' });
    const sc = r.msg && r.msg.result && r.msg.result.structuredContent;
    const o = sc || JSON.parse(r.msg.result.content[0].text);
    const q = o.executed.find((e) => e.tool === 'get_interconnection_queue');
    expect(q && q.args.iso).toBe('SPP');
    const ev = (o.power_evidence || []).find((x) => x.tool === 'get_interconnection_queue');
    expect(ev).toMatchObject({ iso: 'SPP', as_of: null, collected_at: FETCHED, ok: true });
    expect(o.answer_guide).toContain(`COLLECTED, NOT REPORT-DATED — get_interconnection_queue (step ${q.step}, SPP) was collected by DC Hub at ${FETCHED}`);
    expect(o.answer_guide).not.toMatch(/UNDATED — get_interconnection_queue/);
    expect(fence.foreign).toEqual([]);
  }, 120_000);
});
