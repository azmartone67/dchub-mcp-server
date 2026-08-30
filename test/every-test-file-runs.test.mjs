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
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const testDir = new URL('./', import.meta.url);
const wfDir = new URL('../.github/workflows/', import.meta.url);

const testFiles = readdirSync(testDir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

const workflowText = readdirSync(wfDir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => readFileSync(new URL(f, wfDir), 'utf8'))
  .join('\n');

describe('every test file is executed by CI', () => {
  it('found the test files and the workflows at all', () => {
    // A silently-empty scan would make every assertion below pass vacuously —
    // the exact failure mode this file exists to prevent, in this file.
    expect(testFiles.length).toBeGreaterThan(50);
    expect(workflowText.length).toBeGreaterThan(1000);
  });

  it('names every test/*.test.mjs in at least one workflow', () => {
    const orphans = testFiles.filter((f) => !workflowText.includes(`test/${f}`));
    expect(
      orphans,
      `these test files are named by NO workflow, so nothing runs them — add ` +
        `each to a workflow's file list in the same commit that adds the file:\n` +
        orphans.map((f) => `  test/${f}`).join('\n'),
    ).toEqual([]);
  });

  it('names ITSELF, so the guard cannot be the thing that goes unrun', () => {
    expect(workflowText).toContain('test/every-test-file-runs.test.mjs');
  });
});
