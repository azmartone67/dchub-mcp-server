// The verdict logic for "did our registry submission actually land".
//
// The weekly lane reported `success` four weeks running while two of three
// targets were not listed. "Success" meant a branch was prepared — never that a
// maintainer accepted it. These tests pin the distinction the verdicts encode:
// what is OUR failure vs what is a human elsewhere not having acted yet.
import { describe, it, expect } from 'vitest';
import { verdictFor } from '../scripts/registry-verify-listed.mjs';

const pr = (n, state, merged = null, daysAgo = 1) => ({
  number: n,
  state,
  merged_at: merged,
  created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
});

describe('verdictFor — ours vs theirs', () => {
  it('listed is LISTED', () => {
    expect(verdictFor(true, []).state).toBe('LISTED');
  });

  it('★ not listed with an OPEN pr is PENDING, never a failure', () => {
    // We do not control merges. Failing the build on a maintainer's inbox would
    // train everyone to ignore this step, and the real breakage would go too.
    const v = verdictFor(false, [pr(346, 'open', null, 27)]);
    expect(v.state).toBe('PENDING');
    expect(v.why).toContain('#346');
  });

  it('flags an open pr that has gone stale, without failing it', () => {
    expect(verdictFor(false, [pr(346, 'open', null, 27)]).stale).toBe(true);
    expect(verdictFor(false, [pr(999, 'open', null, 2)]).stale).toBe(false);
  });

  it('★ not listed with only CLOSED-unmerged prs is DECLINED, not MISSING', () => {
    // A maintainer saying no is not our lane malfunctioning. Conflating them
    // would send someone to debug code when the answer is "go talk to them".
    const v = verdictFor(false, [pr(8016, 'closed'), pr(8198, 'closed')]);
    expect(v.state).toBe('DECLINED');
  });

  it('★ not listed and NO pr at all is MISSING — the only one that is ours', () => {
    // MUTATION: return PENDING here -> this fails, and the one genuinely broken
    // state becomes invisible.
    expect(verdictFor(false, []).state).toBe('MISSING');
  });

  it('a merged pr does not count as a decline', () => {
    const v = verdictFor(false, [pr(1136, 'closed', '2026-07-01T00:00:00Z')]);
    expect(v.state).toBe('MISSING');   // merged yet absent => something else broke
  });

  it('★ unreadable is never absent', () => {
    // "I could not look" is not "it is not there" — the rule this whole harness
    // is built on.
    expect(verdictFor(null, []).state).toBe('UNREADABLE');
    expect(verdictFor(false, null).state).toBe('UNREADABLE');
  });

  it('★ a LISTED refresh target still surfaces repeated declines', () => {
    // punkpeye lists us AND has closed 15 refresh PRs unmerged. A bare "LISTED"
    // hides the part needing a decision: the counts are frozen and
    // re-submitting is not working.
    const declines = [pr(9013, 'closed'), pr(8200, 'closed'), pr(8198, 'closed')];
    const v = verdictFor(true, declines, 'refresh');
    expect(v.state).toBe('LISTED');
    expect(v.refreshDeclined).toBe(3);
    expect(v.why).toContain('closed unmerged');
  });

  it('does not nag an ADD target about one historical decline', () => {
    // Only refresh targets, and only at 2+, or every list with any history
    // reads as a problem.
    const v = verdictFor(true, [pr(1, 'closed')], 'add');
    expect(v.why).toBe('our entry is in the file');
  });
});
