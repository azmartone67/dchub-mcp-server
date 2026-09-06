// =============================================================================
// Discovery → onboarding: the scaffold PR must ACTUALLY open.
// -----------------------------------------------------------------------------
// registry-discover.mjs crawls for new curated MCP lists and, when LIVE, opens
// ONE same-repo PR appending a disabled TARGETS stub to registry-pr-submit.mjs.
// That PR is the only bridge from discovery to onboarding.
//
// Measured on run 33369412410 (2026-08-31 07:40Z): five NEW candidates,
// tracking issue #73 refreshed, then
//     ▶ scaffold onboarding PR: ! contents PUT failed 409 — skip
// and job = success. discover/add-target-awesome-mcp-gateways had existed
// since the 2026-08-10 run (its PR closed, the branch never deleted; two more
// like it — awesome-mcp-servers, awesome-mcp-zh — sat beside it with ZERO
// open PRs). The "PR already open?" check passed, POST /git/refs 422'd and
// was treated as fine, and the contents PUT sent MAIN's blob sha
// (f35c410…) against a branch whose file was already 913dbe7… → 409, every
// Monday, forever. `pick` was always the same top candidate, so candidates
// #2..#5 were never tried. Discovery had been "wired" to onboarding for six
// weeks and onboarded nothing, under a green check.
//
// These tests drive openScaffoldPR against an in-memory GitHub that enforces
// the one rule that mattered — a contents PUT whose sha is not the blob on
// THAT branch is a 409 — and assert the four behaviours that fix it:
//   1. the sha is read from the branch immediately before the PUT;
//   2. a stale branch with no open PR is RESET to the base head, then written;
//   3. a candidate whose PR is already open is stepped over, not the end;
//   4. a failed write REJECTS — the job goes red, not "skip".
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { openScaffoldPR, buildStub } from '../scripts/registry-discover.mjs';

const SELF = 'azmartone67/dchub-mcp-server';
const PATH = 'scripts/registry-pr-submit.mjs';
const MAIN_SRC = readFileSync(new URL(`../${PATH}`, import.meta.url), 'utf8');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const quiet = () => {};

// ★2026-09-06 — SYNTHETIC candidates, and that is the whole point.
//
// These used to be two REAL names off issue #73 (e2b-dev/awesome-mcp-gateways,
// AlexMili/Awesome-MCP). The fixture reads the REAL scripts/registry-pr-submit.mjs
// as the file being edited, and openScaffoldPR skips any candidate already
// present in it — so the moment the scaffold PR landed those very names in
// TARGETS, every test here failed on that branch:
//
//     only the genuinely new list is staged: expected [] to deeply equal
//     [ 'AlexMili/Awesome-MCP' ]
//
// The tests were asserting against a file the feature under test MUTATES, using
// the same names the feature puts there. Correct behaviour, self-defeating
// fixture — it went red on the branch that proved the feature works.
//
// Names that can never appear in TARGETS fix it permanently. The real file is
// still what gets edited, so insertStub is still exercised against the true
// TARGETS shape; only the candidate identities are synthetic.
// `test_no_synthetic_name_is_real` below keeps them that way.
const CANDS = [
  { full: 'dchub-test-fixture/awesome-mcp-alpha', stars: 168, url: 'https://github.com/dchub-test-fixture/awesome-mcp-alpha', base: 'main', desc: 'Synthetic list A (test fixture)' },
  { full: 'dchub-test-fixture/awesome-mcp-beta', stars: 145, url: 'https://github.com/dchub-test-fixture/awesome-mcp-beta', base: 'main', desc: 'Synthetic list B (test fixture)' },
];
const branchOf = (c) => `discover/add-target-${buildStub(c).key}`;
// ★2026-09-06: the scaffold now batches EVERY outstanding candidate into ONE PR
// on ONE stable branch. Separate per-candidate PRs were not just slow (five
// candidates = five Mondays, and issue #73 carried five for 48 days) — they were
// UNSOUND: every stub edits the same TARGETS array in the same file, so parallel
// PRs from the same base conflict the moment the first one merges. branchOf()
// stays, because the stale-branch reset still has to cope with the per-candidate
// branches left behind by the old scheme.
const BATCH = 'discover/add-targets';

/**
 * In-memory GitHub REST. `branches` = {name: {sha, fileSha}}, `openPRs` = Set of
 * head branch names. The PUT rule is GitHub's: the sha must be the blob currently
 * on the branch named in the body, else 409.
 */
function fakeGitHub({ branches = {}, openPRs = [], mainFileSha = 'main-file-sha', mainSha = 'main-head-sha' } = {}) {
  const st = { branches: { ...branches }, openPRs: new Set(openPRs), calls: [], prs: [] };
  const res = (status, json = {}) => ({ ok: status >= 200 && status < 300, status, json });
  const gh = async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    st.calls.push({ method, path, body });
    const [route, qs = ''] = path.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs));
    if (method === 'GET' && route === `/repos/${SELF}/contents/${PATH}`) {
      if (!q.ref) return res(200, { sha: mainFileSha, content: b64(MAIN_SRC) });
      const br = st.branches[q.ref];
      return br ? res(200, { sha: br.fileSha, content: b64(MAIN_SRC) }) : res(404, { message: 'Not Found' });
    }
    const refGet = route.match(new RegExp(`^/repos/${SELF}/git/ref/heads/(.+)$`));
    if (method === 'GET' && refGet) {
      if (refGet[1] === 'main') return res(200, { object: { sha: mainSha } });
      const br = st.branches[refGet[1]];
      return br ? res(200, { ref: `refs/heads/${refGet[1]}`, object: { sha: br.sha } }) : res(404, { message: 'Not Found' });
    }
    if (method === 'GET' && route === `/repos/${SELF}/pulls`) {
      const head = (q.head || '').split(':')[1];
      return res(200, st.openPRs.has(head) ? [{ html_url: `https://github.com/${SELF}/pull/1`, head: { ref: head } }] : []);
    }
    if (method === 'POST' && route === `/repos/${SELF}/git/refs`) {
      const name = body.ref.replace('refs/heads/', '');
      if (st.branches[name]) return res(422, { message: 'Reference already exists' });
      st.branches[name] = { sha: body.sha, fileSha: mainFileSha };
      return res(201, { ref: body.ref, object: { sha: body.sha } });
    }
    const refPatch = route.match(new RegExp(`^/repos/${SELF}/git/refs/heads/(.+)$`));
    if (method === 'PATCH' && refPatch) {
      const name = refPatch[1];
      if (!st.branches[name]) return res(422, { message: 'Reference does not exist' });
      if (!body.force && st.branches[name].sha !== body.sha) return res(422, { message: 'Update is not a fast forward' });
      st.branches[name] = { sha: body.sha, fileSha: body.sha === mainSha ? mainFileSha : st.branches[name].fileSha };
      return res(200, { object: { sha: body.sha } });
    }
    if (method === 'PUT' && route === `/repos/${SELF}/contents/${PATH}`) {
      const br = st.branches[body.branch];
      if (!br) return res(404, { message: 'Branch not found' });
      if (body.sha !== br.fileSha) return res(409, { message: `${PATH} does not match ${body.sha}` });
      br.fileSha = `blob-after-put-${st.calls.length}`;
      br.sha = `commit-after-put-${st.calls.length}`;
      return res(200, { content: { sha: br.fileSha }, commit: { sha: br.sha } });
    }
    if (method === 'POST' && route === `/repos/${SELF}/pulls`) {
      const n = 100 + st.prs.length;
      const pr = { number: n, html_url: `https://github.com/${SELF}/pull/${n}`, head: body.head };
      st.prs.push(pr);
      st.openPRs.add(body.head);
      return res(201, pr);
    }
    return res(500, { message: `fake GitHub: unhandled ${method} ${path}` });
  };
  return { gh, st };
}

describe('registry-discover scaffold PR — discovery actually onboards', () => {
  it('fresh repo: creates the branch, PUTs with the sha read from THAT branch, opens the PR', async () => {
    const { gh, st } = fakeGitHub();
    const r = await openScaffoldPR(CANDS, { gh, log: quiet });
    expect(r.opened).toMatch(/\/pull\/\d+$/);
    expect(r.branch).toBe(BATCH);
    // EVERY outstanding candidate lands, in ONE PR — not just the top one.
    expect(r.candidates).toEqual(CANDS.map((c) => c.full));
    expect(st.prs, 'one PR, because the stubs share a file').toHaveLength(1);
    const iRead = st.calls.findIndex((c) => c.method === 'GET' && c.path === `/repos/${SELF}/contents/${PATH}?ref=${BATCH}`);
    const iPut = st.calls.findIndex((c) => c.method === 'PUT');
    expect(iRead, 'the blob sha must be read from the branch').toBeGreaterThan(-1);
    expect(iRead).toBeLessThan(iPut);
    expect(st.calls[iPut].body.sha).toBe('main-file-sha');
    // both stubs are in the single write
    const written = Buffer.from(st.calls[iPut].body.content, 'base64').toString('utf8');
    for (const c of CANDS) expect(written).toContain(c.full);
  });

  it('THE regression: a stale branch (no open PR, diverged file) is reset and the PR opens — never a 409 skip', async () => {
    const stale = BATCH;
    const { gh, st } = fakeGitHub({ branches: { [stale]: { sha: 'commit-0810', fileSha: '913dbe7-diverged' } } });
    const r = await openScaffoldPR(CANDS, { gh, log: quiet });
    expect(r.opened).toBeTruthy();
    const reset = st.calls.find((c) => c.method === 'PATCH' && c.path.endsWith(`/git/refs/heads/${stale}`));
    expect(reset?.body, 'the stale branch must be force-reset to the base head').toMatchObject({ sha: 'main-head-sha', force: true });
    const put = st.calls.find((c) => c.method === 'PUT');
    expect(put.body.branch).toBe(stale);
    expect(put.body.sha, 'the PUT must carry the blob sha on the branch, not a diverged or main-assumed one').toBe('main-file-sha');
    expect(st.prs).toHaveLength(1);
  });

  it('an OPEN batch PR is left alone — a reviewer\'s edits are never force-reset away', async () => {
    // Vetting a stub means a human EDITS this branch: filling in the real
    // section header, flipping enabled:true. A weekly force-reset would delete
    // that work and read as the bot fighting the reviewer.
    const { gh, st } = fakeGitHub({ branches: { [BATCH]: { sha: 'x', fileSha: 'y' } }, openPRs: [BATCH] });
    const r = await openScaffoldPR(CANDS, { gh, log: quiet });
    expect(r.preexisting, 'an already-open batch PR is reported, not recreated').toBe(true);
    expect(r.opened).toMatch(/\/pull\/\d+$/);
    expect(st.calls.some((c) => c.method !== 'GET'),
      'nothing may be written while the batch PR is open').toBe(false);
    expect(st.prs, 'no second PR is opened').toHaveLength(0);
  });

  it('a fixture name can never collide with a real TARGETS entry', () => {
    // The guard on the guard: if someone swaps a synthetic name back for a real
    // discovery candidate, these tests start failing the moment that candidate
    // is scaffolded — which is exactly the breakage this fixture change fixes.
    for (const c of CANDS) {
      expect(MAIN_SRC.includes(c.full),
        `${c.full} appears in the real TARGETS file — fixture names must be synthetic`)
        .toBe(false);
    }
  });

  it('candidates already present in TARGETS are excluded from the batch', async () => {
    const { gh, st } = fakeGitHub();
    const already = { ...CANDS[0], full: 'punkpeye/awesome-mcp-servers' };
    const r = await openScaffoldPR([already, CANDS[1]], { gh, log: quiet });
    expect(r.candidates, 'only the genuinely new list is staged').toEqual([CANDS[1].full]);
    expect(r.skipped.join(' ')).toContain('already scaffolded');
    const put = st.calls.find((c) => c.method === 'PUT');
    const written = Buffer.from(put.body.content, 'base64').toString('utf8');
    expect(written).toContain(CANDS[1].full);
  });

  it('a failed write REJECTS (the job goes red) instead of logging "skip"', async () => {
    const { gh } = fakeGitHub();
    const conflict = async (path, opts = {}) =>
      (opts.method === 'PUT' ? { ok: false, status: 409, json: { message: 'does not match' } } : gh(path, opts));
    await expect(openScaffoldPR(CANDS, { gh: conflict, log: quiet })).rejects.toThrow(/409/);

    const { gh: gh2 } = fakeGitHub();
    const prBlocked = async (path, opts = {}) =>
      (opts.method === 'POST' && path.endsWith('/pulls') ? { ok: false, status: 403, json: { message: 'blocked' } } : gh2(path, opts));
    await expect(openScaffoldPR(CANDS, { gh: prBlocked, log: quiet })).rejects.toThrow(/403/);
  });

  it('every candidate already scaffolded → no writes at all', async () => {
    const { gh, st } = fakeGitHub();
    const already = [{ ...CANDS[0], full: 'MobinX/awesome-mcp-list' }]; // present in TARGETS today
    const r = await openScaffoldPR(already, { gh, log: quiet });
    expect(r.opened).toBeNull();
    expect(st.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('the crawl does not swallow the throw: no fail-soft "skip" in code, and the entry catch exits 1', () => {
    const src = readFileSync(new URL('../scripts/registry-discover.mjs', import.meta.url), 'utf8');
    expect(src).toContain('await openScaffoldPR(candidates);');
    expect(src).toMatch(/\.catch\(\(e\) => \{[^}]*process\.exit\(1\)/);
    const code = src.replace(/^\s*\/\/.*$/gm, ''); // a comment may QUOTE the old line; code may not
    expect(code).not.toMatch(/PUT failed .*— skip/);
    expect(code).not.toMatch(/scaffold PR create failed .*\)\); *$/m);
  });
});
