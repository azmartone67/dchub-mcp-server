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

// ═══════════════════════════════════════════════════════════════════════════
// THE INDEX LAG — why run 34097298531 went red on a PR it had just opened
// ---------------------------------------------------------------------------
// MEASURED, one workflow run, 2026-09-07:
//     07:48:41  ✅ PR opened: AlexMili/Awesome-MCP#191
//     07:48:46  ✅ PR opened: AIAnytime/Awesome-MCP-Server#85
//     07:48:49  ⏳ PENDING  AlexMili/Awesome-MCP — PR #191 open 0d     (+8.4s)
//     07:48:50  ❌ MISSING  AIAnytime/Awesome-MCP-Server               (+5.6s)
//                  "not listed and no PR of ours exists"     → exit 1
// Both PRs were open the entire time (API: #191 created 07:48:41Z, #85 created
// 07:48:45Z, both by azmartone67). The only difference between the two verdicts
// was four seconds of GitHub search-index latency.
//
// MISSING is defined as "the lane believes it submitted and did not". Here the
// lane HAD submitted, seconds earlier, in the same job. The verdict logic was
// never wrong — it was fed an answer from a source that cannot speak about the
// present. So these controls drive the LOOKUP, not the verdict.
// ═══════════════════════════════════════════════════════════════════════════
import { ourPullRequests, headBranch } from '../scripts/registry-pr-submit.mjs';

const UPSTREAM = 'AIAnytime/Awesome-MCP-Server';
const ME = 'azmartone67';
const T85 = { key: 'awesome-mcp-server' };

/** search item shape (merged_at nested) vs pulls item shape (top level). */
const idx = (number, state, merged_at = null) =>
  ({ number, state, created_at: '2026-09-07T07:48:45Z', pull_request: { merged_at } });
const store = (number, state, merged_at = null) =>
  ({ number, state, created_at: '2026-09-07T07:48:45Z', merged_at });

/**
 * @param index  what /search/issues returns — may be BEHIND reality
 * @param head   what /repos/…/pulls?head=… returns — the primary store
 */
const api = (index, head, { indexStatus = 200, headStatus = 200 } = {}) => async (_m, path) => {
  const d = decodeURIComponent(path);
  if (d.startsWith('/search/issues')) {
    return indexStatus < 300
      ? { ok: true, status: 200, json: { items: index } }
      : { ok: false, status: indexStatus, json: {} };
  }
  if (d.startsWith(`/repos/${UPSTREAM}/pulls?head=`)) {
    return headStatus < 300
      ? { ok: true, status: 200, json: head }
      : { ok: false, status: headStatus, json: {} };
  }
  throw new Error(`unexpected endpoint: ${d}`);
};
const heads = [headBranch(T85, 'add'), headBranch(T85, 'refresh')];
const look = (index, head, o) => ourPullRequests(UPSTREAM, { api: api(index, head, o), owner: ME, heads });

describe('ourPullRequests — the index is not the only source', () => {
  it('★ finds a PR the search index has not indexed yet', async () => {
    // The exact 2026-09-07 state: index empty, PR #85 open in the primary store.
    const prs = await look([], [store(85, 'open')]);
    expect(prs.map((p) => p.number)).toEqual([85]);
    // …and the verdict that used to be MISSING is now PENDING.
    expect(verdictFor(false, prs).state).toBe('PENDING');
  });

  it('★ MUTATION GUARD: search alone would still call that PR missing', async () => {
    // Drop the head source and the old bug returns, in one line, visibly.
    const searchOnly = await ourPullRequests(UPSTREAM, { api: api([], [store(85, 'open')]), owner: ME, heads: [] });
    expect(searchOnly).toEqual([]);
    expect(verdictFor(false, searchOnly).state).toBe('MISSING');
  });

  it('says out loud that the PR is not in the index yet', async () => {
    const prs = await look([], [store(85, 'open')]);
    expect(verdictFor(false, prs).why).toContain('not yet in GitHub');
    // and stays quiet once the index has caught up
    const caught = await look([idx(85, 'open')], [store(85, 'open')]);
    expect(verdictFor(false, caught).why).not.toContain('not yet in GitHub');
  });

  it('keeps the reach the author search exists for — a PR on a head we never push', async () => {
    // #12454 was hand-opened on a different head. The head lookup cannot see it;
    // dropping the search to "fix" the lag would lose it. Both, or neither works.
    const prs = await look([idx(12454, 'open')], []);
    expect(prs.map((p) => p.number)).toEqual([12454]);
  });

  it('does not double-count a PR both sources return', async () => {
    const prs = await look([idx(85, 'open')], [store(85, 'open')]);
    expect(prs).toHaveLength(1);
    expect(prs[0].indexed).toBe(true);
  });

  it('normalises merged_at across the two API shapes', async () => {
    const fromIndex = await look([idx(7462, 'closed', '2026-06-11T06:10:21Z')], []);
    const fromStore = await look([], [store(7462, 'closed', '2026-06-11T06:10:21Z')]);
    expect(fromIndex[0].merged_at).toBe('2026-06-11T06:10:21Z');
    expect(fromStore[0].merged_at).toBe('2026-06-11T06:10:21Z');
    // a merged PR is not a decline in either shape
    expect(verdictFor(false, fromIndex).state).toBe('MISSING');
    expect(verdictFor(false, fromStore).state).toBe('MISSING');
  });

  it('★ never asserts absence with a blind source — either one', async () => {
    // "I could not look" is not "it is not there", now applied to BOTH sources.
    expect(await look([], [], { indexStatus: 403 })).toBeNull();
    expect(await look([], [], { headStatus: 500 })).toBeNull();
    expect(verdictFor(false, await look([], [], { headStatus: 500 })).state).toBe('UNREADABLE');
  });

  it('★ a blind source is blind even when the other one returned SOMETHING', async () => {
    // MEASURED against 8f564dc, the commit that added the guard above. That
    // guard asked `!all.length` — "did we end up with nothing?" — when the
    // question is "could every source speak?". The two differ exactly when the
    // readable source returns history that settles nothing.
    //
    //   search: one old MERGED pr (#1136 is this shape) · head lookup: 500
    //     -> all = [#1136 closed+merged], non-empty, guard silent
    //     -> no open pr, no closed-UNMERGED pr -> verdictFor: MISSING -> exit 1
    //
    // …while the ONLY source that can see a PR opened moments ago had failed.
    // That is the same false red as the index lag, reached by a different door:
    // a partial API failure instead of a slow index.
    const merged = await look([idx(1136, 'closed', '2026-07-02T00:00:00Z')], [], { headStatus: 500 });
    expect(merged).toBeNull();
    expect(verdictFor(false, merged).state).toBe('UNREADABLE');
    expect(verdictFor(false, merged).state).not.toBe('MISSING');
  });

  it('…but readable evidence that SETTLES the question still stands alone', async () => {
    // The widening must not swallow the verdicts we can already justify, or
    // every partial failure becomes UNREADABLE and the step stops saying
    // anything. An open pr (PENDING) and a closed-unmerged one (DECLINED) are
    // both conclusions a blind second source cannot overturn.
    expect((await look([idx(99, 'open')], [], { headStatus: 500 })).map((p) => p.number)).toEqual([99]);
    const declined = await look([idx(8016, 'closed')], [], { headStatus: 500 });
    expect(verdictFor(false, declined).state).toBe('DECLINED');
  });

  it('★ MISSING stays reachable when both sources DID speak and found nothing', async () => {
    // The negative control for the widening. If "no verdict-settling pr" alone
    // returned null, MISSING could never fire again and the step would be
    // incapable of reporting the failure it exists for.
    const none = await look([], []);
    expect(none).toEqual([]);
    expect(verdictFor(false, none).state).toBe('MISSING');
  });

  it('…but one blind source does not hide a PR the other found', async () => {
    expect((await look([idx(99, 'open')], [], { headStatus: 500 })).map((p) => p.number)).toEqual([99]);
    expect((await look([], [store(85, 'open')], { indexStatus: 403 })).map((p) => p.number)).toEqual([85]);
  });

  it('newest first, across both sources', async () => {
    const older = { ...store(1, 'closed'), created_at: '2026-01-01T00:00:00Z' };
    const newer = { ...idx(2, 'open'), created_at: '2026-09-01T00:00:00Z' };
    const prs = await look([newer], [older]);
    expect(prs.map((p) => p.number)).toEqual([2, 1]);
  });
});

describe('head-branch names have ONE spelling', () => {
  it('is what the submitter pushes and what the verifier looks up', () => {
    expect(headBranch({ key: 'punkpeye' }, 'add')).toBe('add-dchub-punkpeye');
    expect(headBranch({ key: 'punkpeye' }, 'refresh')).toBe('refresh-dchub-punkpeye');
    expect(headBranch({ key: 'punkpeye' })).toBe('add-dchub-punkpeye');   // default
  });

  it('the submitter uses the helper — no literal branch names left', async () => {
    // A second spelling would make the verifier look up a branch nobody pushes
    // and report our own PR missing. That is the defect this file documents,
    // re-entering through the back door.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../scripts/registry-pr-submit.mjs', import.meta.url), 'utf8');
    const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // Non-vacuity: the detector must fire on a literal we deliberately construct.
    expect(/['"`](?:add|refresh)-dchub-/.test("const x = 'add-dchub-mcp';")).toBe(true);
    expect(code).not.toMatch(/['"`](?:add|refresh)-dchub-/);
    expect(code).toMatch(/headBranch\(t, 'refresh'\)/);
    expect(code).toMatch(/headBranch\(t, 'add'\)/);
  });
});
