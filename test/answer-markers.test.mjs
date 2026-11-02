// answer-markers.test.mjs — guided first query (owner 2026-11-02): a gated call's mcp_call_log row says
// what the FINAL result gave (_answer) and whether it showed the email ask (_email_ask), so the
// session-ordered log can count emails captured after a first answer. Pinned:
//   M1  answerMarkers reads the final result: figure / verdict / rows / partial / none, and the email ask
//       as after_answer only when the answer-first line comes before it;
//   M2  withAnswerMarkers puts the markers first (params are cut at 4000 chars), after _via_next_ask;
//   M3  over the real app: keyless grid's row carries _answer figure + _email_ask after_answer, keyless
//       rank_markets' row (stub: no rows) carries _answer partial and no email ask; DCHUB_ANSWER_MARKERS=0
//       is the control.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, fenceNetwork } from './helpers/claude-directory-harness.mjs';
import { answerMarkers, withAnswerMarkers } from '../lib/answer-markers.mjs';
import { flushWallTracks, parkWallTrack } from '../lib/wall-link-track.mjs';
import { EMAIL_ASK, ANSWER_FIRST_LEAD } from '../lib/claim-handoff.mjs';

const r = (text, sc = {}) => ({ content: [{ type: 'text', text: JSON.stringify(sc) }, { type: 'text', text }], structuredContent: sc });

describe('lib/answer-markers', () => {
  it('M1 names what the final result gave, and where the email ask sits', () => {
    expect(answerMarkers(r(ANSWER_FIRST_LEAD + 'PJM demand 1 MW.\n\n' + EMAIL_ASK))).toEqual({ _answer: 'figure', _email_ask: 'after_answer' });
    expect(answerMarkers(r(EMAIL_ASK + '\n\n' + ANSWER_FIRST_LEAD + 'x'))).toEqual({ _answer: 'figure', _email_ask: 'shown' });
    expect(answerMarkers(r(EMAIL_ASK, { preview_is_partial: true }))).toEqual({ _answer: 'partial', _email_ask: 'shown' });
    expect(answerMarkers(r('x', { verdict: 'BUILD' }))).toEqual({ _answer: 'verdict' });
    expect(answerMarkers(r('x', { results: [{ market: 'a' }] }))).toEqual({ _answer: 'rows' });
    expect(answerMarkers(r('x', { transactions: [{ id: 1 }], preview_is_partial: true }))).toEqual({ _answer: 'rows' });
    expect(answerMarkers(r('x', { results: [] }))).toEqual({ _answer: 'none' });
    expect(answerMarkers(r('x', { results: ['not a row'] }))).toEqual({ _answer: 'none' });
    expect(answerMarkers(null)).toBeNull();
  });
  it('M2 markers go first, after _via_next_ask; non-object params become an object', () => {
    const m = { _answer: 'rows' };
    expect(Object.keys(withAnswerMarkers({ iso: 'PJM', _via_next_ask: 'rank_markets' }, m))).toEqual(['_via_next_ask', '_answer', 'iso']);
    expect(withAnswerMarkers(undefined, m)).toEqual(m);
    const p = { iso: 'PJM' };
    expect(withAnswerMarkers(p, null)).toBe(p);
  });
  it('flushWallTracks merges markFn into the parked row\'s params; without markFn the row is unchanged', () => {
    const sent = [];
    const c = {};
    parkWallTrack(c, { tool: 't', status: 'trial_used', params: { iso: 'PJM' } }, () => {}, { fallbackMs: 60_000 });
    flushWallTracks(c, 't', {}, () => null, (p) => sent.push(p), () => (p) => withAnswerMarkers(p, { _answer: 'figure' }));
    expect(sent[0].params).toEqual({ _answer: 'figure', iso: 'PJM' });
    const c2 = {};
    parkWallTrack(c2, { tool: 't', status: 'trial_used', params: { iso: 'PJM' } }, () => {}, { fallbackMs: 60_000 });
    flushWallTracks(c2, 't', {}, () => null, (p) => sent.push(p));
    expect(sent[1].params).toEqual({ iso: 'PJM' });
  });
});

let H, fence;
async function settle(quietMs = 400, maxMs = 8000) {
  const t0 = Date.now();
  let n = H.hits.length, last = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((res) => setTimeout(res, 50));
    if (H.hits.length !== n) { n = H.hits.length; last = Date.now(); }
    else if (Date.now() - last >= quietMs) return;
  }
}
async function rowFor(tool, args) {
  await settle();
  const before = H.hits.length;
  let hdr = { 'user-agent': 'Claude-User' };
  const init = await H.init('/mcp', 'probe-client', hdr);
  const sid = init.headers.get('mcp-session-id');
  if (sid) hdr = { ...hdr, 'mcp-session-id': sid };
  const res = await H.call('/mcp', tool, args, hdr);
  await settle();
  const rows = H.hits.slice(before).filter((h) => h.path === '/api/v1/mcp/track' && h.body && h.body.tool === tool);
  return { result: res.msg && res.msg.result, rows };
}
beforeAll(async () => { fence = fenceNetwork(); H = await startHarness({}); }, 60_000);
afterAll(async () => { delete process.env.DCHUB_ANSWER_MARKERS; if (H) await H.stop(); if (fence) fence.restore(); });

describe('M3 over the real app (stub backend, no network)', () => {
  it('keyless grid: _answer figure, _email_ask after_answer, first in params', async () => {
    const { result, rows } = await rowFor('get_grid_intelligence', { iso: 'ERCOT' });
    expect(result.structuredContent.human_url, 'control: the stub walls grid').toBeTruthy();
    expect(rows.length).toBe(1);
    const p = rows[0].body.params;
    expect(p._answer).toBe('figure');
    expect(p._email_ask).toBe('after_answer');
    expect(Object.keys(p).slice(0, 2)).toEqual(['_answer', '_email_ask']);
    expect(p.iso).toBe('ERCOT');
  });
  // The stub backend returns no market rows, so its rank_markets preview is 'partial' (rows: M1 + live).
  it('keyless rank_markets (stub: no rows): _answer partial, no email ask', async () => {
    const { result, rows } = await rowFor('rank_markets', { criteria: 'ai_ready', limit: 10 });
    expect(result.structuredContent.human_url, 'control: the stub walls rank_markets').toBeTruthy();
    expect(result.structuredContent.results, 'control: the stub has no rows').toBeUndefined();
    expect(rows.length).toBe(1);
    expect(rows[0].body.params._answer).toBe('partial');
    expect(rows[0].body.params._email_ask).toBeUndefined();
  });
  it('DCHUB_ANSWER_MARKERS=0: no markers (control)', async () => {
    process.env.DCHUB_ANSWER_MARKERS = '0';
    try {
      const { rows } = await rowFor('get_grid_intelligence', { iso: 'ERCOT' });
      expect(rows.length).toBe(1);
      expect(rows[0].body.params._answer).toBeUndefined();
      expect(rows[0].body.params._email_ask).toBeUndefined();
    } finally { delete process.env.DCHUB_ANSWER_MARKERS; }
  });
});
