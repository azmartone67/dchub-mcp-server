// =============================================================================
// Every test/*.test.mjs must be NAMED by a workflow — the meta-guard
// -----------------------------------------------------------------------------
// `npm test` is invoked by NO workflow in this repo. CI names its test files
// EXPLICITLY, so a file absent from every workflow is executed by nothing: it
// passes locally, certifies nothing, and reports SILENTLY GREEN forever.
//
// This is not a hypothetical and it is not a one-off. test.yml's own comment
// block restates the rule FOUR times, each restatement added after the trap bit
// again — 2026-08-05 (smithery-canon-guard's must-fail controls had never run),
// 2026-08-28, and 2026-08-29 ("they were written for #248/#249 and then sat
// OUTSIDE this line for a day: green locally, executed by nothing"). A rule
// restated four times in prose is a rule prose cannot hold.
//
// Measured 2026-08-30, before this file existed: SEVEN test files, 63 tests,
// were named by no workflow at all — analyst-path-selftag, arg-aliases,
// as-of-record-scope, claude-passive-arrivals, invalid-key-anon,
// recommendation-returns-contract, recommendation-returns-truth. All seven
// passed when finally run, so nothing was broken — but nothing was guarded
// either, which is the whole point: a guard nobody runs is indistinguishable
// from a guard that does not exist.
//
// So the rule is now a TEST rather than a comment. Add a test file, add it to a
// workflow, in the same commit — or this fails and tells you which one.
//
// ★It deliberately checks NAMED-BY-A-WORKFLOW, not named-by-test.yml: some
// files are legitimately run elsewhere (free-tier-claims is gated by
// daily-manifest-sync.yml). Scanning every workflow is what keeps this honest
// instead of merely strict.
//
// ★No allowlist, on purpose. A file that should not run should be DELETED, not
// exempted — an exemption list is the same silent-green with extra steps.
//
// ★2026-09-12 — the hard gate's files moved off test.yml's one `vitest run`
// line into test/hard-gate.txt, which that step expands (and which
// daily-manifest-sync.yml reads). A file on that list counts as named only
// while some workflow still expands the list: take the expansion away and
// every file on it is an orphan again, exactly as deleting the line was.
//
// ★COMMENTS DO NOT NAME A FILE. `# Pinned by test/x.test.mjs` runs nothing, but
// it satisfied the old substring match. Measured at 68670da with this guard as
// it was: six gate files were also mentioned in a workflow comment
// (ecosystem-sync, every-test-file-runs itself, free-tier-claims,
// github-description-push-behaviour, registry-cron-order,
// registry-publish-ref-gated), and deleting any one of them from the gate line
// left this guard GREEN; deleting gating.test.mjs, mentioned nowhere else,
// turned it red. Nothing had gone unrun, since all six were on the line, but a
// removal would not have been caught.
//
// ★EVERY LINE OF THE LIST MUST BE A TEST FILE. vitest 2.1.9 silently ignores a
// file filter that matches nothing while another one matches: a real file plus
// test/no-such-file.test.mjs exits 0 having run one file. So a typo, or a name
// left behind by a rename, would drop a guard without a sound.
//
// ★AND THE LIST STAYS SORTED. Two PRs that insert different names into a sorted
// list edit different lines and merge cleanly; two PRs that both append at the
// end conflict exactly as the one-line list did.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const testDir = new URL('./', import.meta.url);
const wfDir = new URL('../.github/workflows/', import.meta.url);
const LIST = 'test/hard-gate.txt';

const testFiles = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

// Whole-line comments are dropped: YAML comments, and shell comments in run: blocks.
const workflowText = readdirSync(wfDir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .flatMap((f) => readFileSync(new URL(f, wfDir), 'utf8').split('\n'))
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

// Read the way both workflows read it: every non-blank line is one path.
const listEntries = readFileSync(new URL('./hard-gate.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '');

const listExpanded = workflowText.includes(LIST);
const isNamed = (p) => workflowText.includes(p) || (listExpanded && listEntries.includes(p));

describe('every test file is executed by CI', () => {
  it('found the test files, the workflows and the hard-gate list at all', () => {
    // A silently-empty scan would make every assertion below pass vacuously —
    // the exact failure mode this file exists to prevent, in this file.
    expect(testFiles.length).toBeGreaterThan(50);
    expect(workflowText.length).toBeGreaterThan(1000);
    expect(listEntries.length).toBeGreaterThan(50);
  });

  it('names every test/*.test.mjs in at least one workflow', () => {
    const orphans = testFiles.filter((f) => !isNamed(`test/${f}`));
    expect(
      orphans,
      `these test files are named by NO workflow, so nothing runs them — add ` +
        `each to ${LIST} (in sorted position) or to a workflow's own file list, ` +
        `in the same commit that adds the file:\n` +
        orphans.map((f) => `  test/${f}`).join('\n'),
    ).toEqual([]);
  });

  it('names ITSELF, so the guard cannot be the thing that goes unrun', () => {
    expect(isNamed('test/every-test-file-runs.test.mjs')).toBe(true);
  });

  it(`lists only real test files in ${LIST}`, () => {
    const real = new Set(testFiles.map((f) => `test/${f}`));
    const bogus = listEntries.filter((e) => !real.has(e));
    expect(
      bogus,
      `these lines of ${LIST} are not test/*.test.mjs files. vitest skips a ` +
        `filter that matches nothing without a word, so each is a guard you ` +
        `believe runs and does not — fix the name, or drop the line:\n` +
        bogus.map((e) => `  ${JSON.stringify(e)}`).join('\n'),
    ).toEqual([]);
  });

  it(`keeps ${LIST} sorted and duplicate-free, so concurrent additions merge`, () => {
    const at = listEntries.findIndex((e, i) => i > 0 && !(listEntries[i - 1] < e));
    expect(
      at,
      `${LIST} is out of order at entry ${at + 1}: ${JSON.stringify(listEntries[at - 1])} ` +
        `then ${JSON.stringify(listEntries[at])}. Insert names in sorted position ` +
        `rather than appending. Fix: LC_ALL=C sort -u -o ${LIST} ${LIST}`,
    ).toBe(-1);
  });
});
