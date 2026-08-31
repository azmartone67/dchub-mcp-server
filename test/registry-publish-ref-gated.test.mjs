// registry-publish-ref-gated.test.mjs — (2026-08-31)
//
// THE DEFECT THIS PINS. registry-refresh.yml's publish job ran on:
//
//     if: github.event_name == 'push' || 'schedule' || 'workflow_dispatch'
//
// A push to ANY ref satisfies that. Nothing tied it to the default branch, so a
// feature branch could publish to the PRODUCTION MCP registry before anyone
// reviewed it — and did. 2.12.2 went out from the draft branch of #282, minutes
// after the push and well before the merge.
//
// That instance landed well (it was the fix for a real two-day staleness), which
// is exactly why it is worth pinning: the outcome hid the mechanism. A published
// registry version CANNOT be withdrawn. An abandoned or rejected PR that bumps
// the version burns a number the default branch never carries, and the registry
// advertises a release that exists on no branch — with the next real bump forced
// to skip past it.
//
// ★ NO YAML PARSER ON PURPOSE. The repo has no yaml dependency and this guard is
// not worth adding one for; test/every-test-file-runs.test.mjs already reads the
// workflows as text. The extraction below is therefore deliberately narrow, and
// control D fails the suite if it ever stops finding the block it claims to read
// — a guard that silently matches nothing is the failure mode this repo keeps
// finding elsewhere.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const WORKFLOW = new URL('../.github/workflows/registry-refresh.yml', import.meta.url);

/** The `if:` expression of the `publish:` job, whitespace-flattened, or null. */
export function publishCondition(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^ {2}publish:\s*$/.test(l));
  if (start === -1) return null;

  // The job block runs until the next 2-space-indented key.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i])) { end = i; break; }
  }
  const block = lines.slice(start, end);

  const ifAt = block.findIndex((l) => /^ {4}if:/.test(l));
  if (ifAt === -1) return null;

  // Either inline (`if: expr`) or a folded scalar (`if: >-` + indented lines).
  const head = block[ifAt].replace(/^ {4}if:\s*/, '');
  const parts = [];
  if (head && !/^[>|]-?$/.test(head)) {
    parts.push(head);
  } else {
    for (let i = ifAt + 1; i < block.length; i += 1) {
      if (!/^ {6}\S/.test(block[i])) break;
      parts.push(block[i].trim());
    }
  }
  const cond = parts.join(' ').replace(/\s+/g, ' ').trim();
  return cond || null;
}

/** Does the condition require the default branch? */
export function isRefGated(cond) {
  if (!cond) return false;
  return /github\.ref\s*==\s*'refs\/heads\/main'/.test(cond);
}

const TEXT = readFileSync(WORKFLOW, 'utf8');

describe('the official-registry publish is gated to the default branch', () => {
  it('★ publishes only from main — a feature branch must not write to the live registry', () => {
    const cond = publishCondition(TEXT);
    expect(cond, 'could not read the publish job condition — the extractor is blind, not the workflow clean')
      .toBeTruthy();
    expect(isRefGated(cond), `publish job is not ref-gated; condition is: ${cond}`).toBe(true);
  });

  it('still publishes on the three events it is meant to — the gate narrows, it does not disable', () => {
    const cond = publishCondition(TEXT);
    for (const ev of ['push', 'schedule', 'workflow_dispatch']) {
      expect(cond, `publish stopped handling ${ev}`).toContain(`'${ev}'`);
    }
  });

  // ── must-fail controls ────────────────────────────────────────────────────
  // Each mutation has to make the check above go red on its own. A guard whose
  // mutant survives is not evidence.
  it('CONTROL A: the pre-fix condition (any ref) is REJECTED', () => {
    const before = TEXT.replace(
      /^ {4}if: >-\n(?: {6}.*\n)+/m,
      "    if: github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'\n",
    );
    expect(before, 'mutation did not apply — control is vacuous').not.toBe(TEXT);
    const cond = publishCondition(before);
    expect(cond, 'mutated workflow still must parse').toBeTruthy();
    expect(isRefGated(cond), 'the exact pre-fix condition must be caught').toBe(false);
  });

  it('CONTROL B: gating to some OTHER branch is REJECTED', () => {
    const cond = "github.ref == 'refs/heads/release' && (github.event_name == 'push')";
    expect(isRefGated(cond)).toBe(false);
  });

  it('CONTROL C: an empty or missing condition is REJECTED, never assumed safe', () => {
    expect(isRefGated(null)).toBe(false);
    expect(isRefGated('')).toBe(false);
    const noJob = TEXT.replace(/^ {2}publish:\s*$/m, '  publish-renamed:');
    expect(publishCondition(noJob), 'a renamed job must read as unknown, not as gated').toBeNull();
  });

  it('CONTROL D: the extractor actually reads the real block (not matching nothing)', () => {
    const cond = publishCondition(TEXT);
    expect(cond.length, 'condition suspiciously short — extractor probably matched a fragment')
      .toBeGreaterThan(60);
    expect(cond).toContain('github.event_name');
  });
});
