/**
 * test/registry-reflex-honesty.test.mjs — a declared auto-heal must be WIRED.
 *
 * WHAT THIS PINS
 * ──────────────
 * scripts/registry_monitor.py opens/refreshes the "🔻 Registry rank/drift alert"
 * issue and, on a CORE-term slip, prints an `auto-heal reflex:` line. In CI it
 * printed, for weeks:
 *
 *     auto-heal reflex: ci (workflow fires gh workflow run smithery-freshness.yml)
 *
 * No such step existed. The workflow step that dispatched a freshness run was
 * REMOVED on 2026-07-13 — correctly, with a note in
 * .github/workflows/registry-rank-monitor.yml explaining that a Smithery
 * RELEVANCE slip is not fixed by a republish. _reflex_kick() was never updated.
 *
 * This is worse than a stale comment. The alert is read by a human deciding
 * whether to act, and that line says the system is already handling it — so the
 * owner-gated remedy (pasting the canonical description into the Smithery owner
 * UI, the only input to Smithery's `score`) never gets done. CORE term `energy`
 * sat at #2/#3 across many consecutive checks under that reassurance.
 *
 * MEASURED while writing this guard, and worth recording because it kills the
 * obvious wrong fix: the ESCALATE text tells the reader to add the slipping term
 * to scripts/smithery_description.txt "if it's missing". `energy` is NOT missing
 * — it appears twice. And `data center`, `data centers`, `power grid` and
 * `grid interconnection` appear ZERO times in that 407-char file while all four
 * rank #1. So that file's term content is not the lever the escalation implies,
 * and stuffing it is not the remedy.
 *
 * THE CONTRACT
 * ────────────
 *   R1. If any reflex string claims a workflow FIRES, that workflow file must
 *       exist AND the rank-monitor workflow must actually dispatch it.
 *   R2. The CI branch of _reflex_kick() must not claim an automated reflex while
 *       the rank-monitor workflow contains no dispatch step at all.
 *   R3. A reflex string must never name a workflow file that does not exist.
 *
 * EXPECTED PASS/FAIL — MEASURED, not predicted.
 * ─────────────────────────────────────────────
 * UNPATCHED (origin/main @ ef16c2d):  3 failed, 1 passed  (R1/R3, R2, R2b)
 * PATCHED   (this branch):            0 failed, 4 passed
 *
 * The unpatched failure quotes the defect verbatim:
 *   reflex reports "ci (workflow fires gh workflow run smithery-freshness.yml)"
 *   but registry-rank-monitor.yml dispatches none of it
 *   (found: no dispatch steps at all)
 *
 * There is no xfail in vitest; R4 below is the equivalent must-fail control — it
 * asserts the harness can actually read both files and find the reflex branch, so
 * a rename that makes the greps match nothing fails loudly instead of passing
 * vacuously.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MON = path.join(REPO, 'scripts', 'registry_monitor.py');
const WF = path.join(REPO, '.github', 'workflows', 'registry-rank-monitor.yml');

const monSrc = fs.readFileSync(MON, 'utf8');
const wfSrc = fs.readFileSync(WF, 'utf8');

/** The body of _reflex_kick(), comments stripped — claims live in CODE, not prose. */
function reflexBody() {
  const at = monSrc.indexOf('def _reflex_kick(');
  if (at === -1) return null;
  // to the next top-level def
  const rest = monSrc.slice(at + 1);
  const end = rest.search(/\ndef [A-Za-z_]/);
  const body = end === -1 ? rest : rest.slice(0, end);
  // drop the docstring and # comments so a comment explaining the history
  // cannot satisfy a check about what the code returns
  return body
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/^\s*#[^\n]*$/gm, ' ');
}

/** Every string literal the reflex can RETURN. */
function reflexStrings() {
  const body = reflexBody();
  if (!body) return [];
  const out = [];
  for (const m of body.matchAll(/return\s*\(?\s*((?:"[^"]*"|'[^']*')(?:\s*(?:"[^"]*"|'[^']*'))*)/g)) {
    out.push(m[1].replace(/["']/g, '').replace(/\s+/g, ' ').trim());
  }
  return out;
}

/** Workflow files the rank-monitor workflow actually dispatches. */
function dispatchedWorkflows() {
  const out = new Set();
  for (const m of wfSrc.matchAll(/gh\s+workflow\s+run\s+([\w.-]+\.ya?ml)/g)) out.add(m[1]);
  return out;
}

describe('registry monitor — a declared auto-heal must be wired', () => {
  // ── R4: must-fail control (vitest has no xfail) ──────────────────────────
  it('R4 harness can read both files and locate the reflex branch', () => {
    expect(monSrc.length).toBeGreaterThan(500);
    expect(wfSrc.length).toBeGreaterThan(200);
    const body = reflexBody();
    expect(body, '_reflex_kick() not found — every check below would be vacuous').toBeTruthy();
    expect(body.length).toBeGreaterThan(40);
    const strs = reflexStrings();
    expect(strs.length, 'no return strings parsed out of _reflex_kick()').toBeGreaterThan(1);
    // the CI branch must still be identifiable
    expect(body).toMatch(/GITHUB_OUTPUT/);
  });

  // ── R1 + R3 ──────────────────────────────────────────────────────────────
  it('R1/R3 a reflex that claims a workflow fires must name a wired, existing workflow', () => {
    const dispatched = dispatchedWorkflows();
    for (const s of reflexStrings()) {
      const named = [...s.matchAll(/([\w.-]+\.ya?ml)/g)].map((m) => m[1]);
      for (const wf of named) {
        // R3 — the file must exist
        expect(
          fs.existsSync(path.join(REPO, '.github', 'workflows', wf)),
          `reflex string names ${wf}, which does not exist`,
        ).toBe(true);
        // R1 — if the string says it FIRES/RUNS it, it must actually be dispatched
        if (/\b(fires?|runs?|dispatch(es)?|kick(s|ed)?)\b/i.test(s)) {
          expect(
            dispatched.has(wf),
            `reflex reports "${s}" but registry-rank-monitor.yml dispatches ` +
              `none of it (found: ${[...dispatched].join(', ') || 'no dispatch steps at all'}). ` +
              `An alert that claims the system is self-healing stops the owner ` +
              `from applying the only remedy that works.`,
          ).toBe(true);
        }
      }
    }
  });

  // ── R2 ───────────────────────────────────────────────────────────────────
  // ★ Asserted POSITIVELY (the string must declare no-reflex) rather than by
  // banning words like "fires"/"dispatch". The first draft banned those words and
  // failed on the CORRECT replacement, because an honest string has to be able to
  // say "the freshness DISPATCH WAS REMOVED" — a negation containing the banned
  // word. A keyword blocklist cannot tell an assertion from its denial; requiring
  // the explicit no-reflex marker can, and R1 already catches the real defect
  // shape (naming a workflow AND claiming it fires).
  it('R2 the CI branch declares no reflex when nothing is dispatched', () => {
    const body = reflexBody();
    const idx = body.indexOf('GITHUB_OUTPUT');
    expect(idx).toBeGreaterThan(-1);
    const after = body.slice(idx, idx + 900);
    const ret = after.match(/return\s*\(?\s*((?:"[^"]*"|'[^']*')(?:\s*(?:"[^"]*"|'[^']*'))*)/);
    expect(ret, 'CI branch has no return string').toBeTruthy();
    const claim = ret[1].replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    if (dispatchedWorkflows().size === 0) {
      expect(
        /\b(none|no automated|nothing fires|not automated)\b/i.test(claim),
        `registry-rank-monitor.yml dispatches NOTHING, so the CI reflex must say ` +
          `so explicitly. It reports: "${claim}". An alert that implies the system ` +
          `is self-healing stops the owner applying the only remedy that works.`,
      ).toBe(true);
    }
  });

  it('R2b the CI reflex points the reader at a remedy rather than implying none is needed', () => {
    const body = reflexBody();
    const idx = body.indexOf('GITHUB_OUTPUT');
    const after = body.slice(idx, idx + 700);
    if (dispatchedWorkflows().size === 0) {
      expect(
        /owner|paste|smithery_description|ESCALATE/i.test(after),
        'with no automated reflex, the CI branch must name the owner-gated remedy',
      ).toBe(true);
    }
  });
});
