// =============================================================================
// The listing copy-check must survive an eventually-consistent read.
// -----------------------------------------------------------------------------
// MEASURED 2026-09-05, two lines apart in one workflow log:
//
//   00:47:18.078  ::notice:: white-glove wrote the Smithery description and
//                            CONFIRMED it on api.smithery.ai (2243 chars)
//   00:47:18.346  ::error::  Smithery listing DESCRIPTION drifted from
//                            scripts/smithery_description.txt
//
// 268 milliseconds. Same authoritative store. Opposite answers — the confirming
// read and the checking read landed on different edges. The listing was correct
// throughout (2,243 chars, byte-identical, verified from outside), and the lane
// beat the dead-man ledger RED: `lane FAILED at: copycheck`.
//
// The 2026-08-22 mitigation was "read api.smithery.ai instead of the public
// projection, which flaps". That was the right diagnosis of the wrong scope: the
// AUTHORITATIVE store flaps too. A SINGLE READ OF AN EVENTUALLY-CONSISTENT STORE
// IS A COIN FLIP. The sibling `converge` step already polls with a budget for
// exactly this reason; this step never got the lesson.
//
// A false red is worse than no check: it teaches the operator to ignore the lane
// that exists to tell them the published copy is wrong.
//
// These tests EXECUTE the step's real python (extracted from the YAML, which a
// source-reading test cannot exercise) against scripted reads. Rewrite the step
// and this runs the rewrite.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const run = (scenario) => JSON.parse(execFileSync(
  'python3', ['test/helpers/run_copycheck.py', scenario],
  { encoding: 'utf8', env: { ...process.env, SMITHERY_API_KEY: 'stub' } },
));

describe('copycheck — replication lag is not drift', () => {
  it('MUST-FAIL CONTROL: the step python is really extracted and executed', () => {
    const r = run('match');
    // exit 99 / EXTRACT_FAILED means the harness found no block — every other
    // assertion here would then be about nothing.
    expect(r.exit, 'the copycheck python could not be extracted from the workflow').not.toBe(99);
    expect(r.reads, 'the stub was never consulted — the block did not run').toBeGreaterThan(0);
    expect(r.out).toMatch(/matches scripts\/smithery_description\.txt/);
  });

  it('THE DEFECT: a stale read followed by a correct one PASSES', () => {
    const r = run('flap');
    expect(r.exit, 'a sub-second edge flap still fails the lane').toBe(0);
    expect(r.reads, 'it did not retry at all').toBeGreaterThan(1);
    expect(r.out).toMatch(/after 2 read\(s\)/);
  });

  it('a genuinely drifted listing still FAILS, after the budget', () => {
    const r = run('drift');
    expect(r.exit).toBe(1);
    expect(r.reads).toBeGreaterThan(4);
    expect(r.out).toMatch(/still differs/);
    // the old message blamed the write step; the write is often green when this fires
    expect(r.out).toMatch(/NOT the sub-second edge flap/);
  });

  it('a STALE MARKER fails immediately — retrying cannot fix published copy', () => {
    const r = run('stale');
    expect(r.exit).toBe(1);
    expect(r.reads, 'it wasted the whole budget on copy that will never change').toBe(1);
    expect(r.out).toMatch(/STALE MARKERS/);
    expect(r.out).toMatch(/not replication lag/);
  });

  it('unreadable and empty are UNMEASURED, not drift — they must not page', () => {
    for (const s of ['unreadable', 'empty']) {
      const r = run(s);
      expect(r.exit, `${s} turned into a red`).toBe(0);
      expect(r.out).toMatch(/UNMEASURED/);
    }
  });
});
