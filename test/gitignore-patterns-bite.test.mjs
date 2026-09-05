// =============================================================================
// .gitignore patterns must actually MATCH the paths they name — the guard
// -----------------------------------------------------------------------------
// Measured 2026-09-04. .gitignore carried:
//
//     # Downloaded MCP registry publisher binary (19MB Mach-O) — a tool, not source.
//     mcp-publisherpackage-lock.json
//
// #107 (2026-07-30) appended to the line instead of after it, welding the
// pattern to an unrelated filename. The result matches NOTHING, so for five
// weeks `git add -A` in this repo staged the 18MB Mach-O binary the line exists
// to keep out — and the comment above it went on describing a rule that was no
// longer running. Nothing failed, because a .gitignore line that stops matching
// produces no error, no warning and no diff; it just quietly does nothing.
//
// ★ This is the repo's recurring shape, not a typo: a rule that is PRESENT but
// INERT. The same week produced a canon guard reading a facts file, a heal list
// pointing at redirects, and a live test suite gated on the wrong switch. The
// answer each time is the same — assert the rule BITES, don't read that it exists.
//
// ★ package-lock.json is the negative control on purpose. It is TRACKED, and it
// was never meant to be ignored — it was only ever the text that landed on the
// wrong line. If a future edit "restores" it to .gitignore, that is the same
// mistake wearing the fix's clothes, and this file says so.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;

/**
 * true iff .gitignore's PATTERNS match `p`.
 *
 * ★ --no-index is load-bearing, and was added after this guard shipped a dead
 * assertion. `git check-ignore` skips TRACKED paths by default — ignore rules
 * do not apply to them — so it answers "not ignored" for package-lock.json
 * whether or not .gitignore names it. Measured: adding `package-lock.json` to
 * .gitignore left the default form still reporting "not ignored", so every
 * MUST_NOT_BE_IGNORED case below passed vacuously and could never have failed.
 * --no-index asks the question this file actually means: does the PATTERN SET
 * match this path? That is what .gitignore is, and it is independent of what
 * happens to be tracked on the day the test runs.
 */
function isIgnored(p) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', '--', p], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Local build/tool artifacts that must never reach a commit. Each is a path a
// contributor's working copy really grows; a pattern that stops covering one is
// a >1MB accident waiting for the next `git add -A`.
//
// ★ Directory patterns are probed with a CHILD path ("node_modules/probe"), not
// the bare directory. A trailing-slash pattern matches only a real DIRECTORY,
// so `git check-ignore node_modules/` answers "no" wherever the directory does
// not happen to exist — or, as measured here first, where it is a symlink. That
// makes the bare form a test of the checkout rather than of the pattern. A child
// path is matched by the leading directory component alone, so it answers the
// same in CI, in a worktree, and on a clean clone.
const MUST_BE_IGNORED = [
  'mcp-publisher',              // 18MB Mach-O, the #107 casualty
  'wt-base/probe',              // in-repo git worktree, ~4MB detached base
  'node_modules/probe',
  'state/probe',
  'served-manifest-report.md',
  'monitor_report.md',
];

// Tracked source that must stay visible. If any of these ever reads as ignored,
// a pattern has grown too broad — the opposite failure, and just as silent.
const MUST_NOT_BE_IGNORED = [
  'server.mjs',
  'package.json',
  'package-lock.json',          // ★ the #107 text; tracked, never to be ignored
  'test/gitignore-patterns-bite.test.mjs',
];

describe('.gitignore rules bite', () => {
  it('reads a .gitignore with real content (never pass by scanning nothing)', () => {
    const raw = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
    const patterns = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(patterns.length).toBeGreaterThan(5);
  });

  it.each(MUST_BE_IGNORED)('ignores %s', (p) => {
    expect(isIgnored(p), `.gitignore no longer covers "${p}" — \`git add -A\` will stage it`).toBe(true);
  });

  it.each(MUST_NOT_BE_IGNORED)('does NOT ignore %s', (p) => {
    expect(isIgnored(p), `"${p}" is tracked source but .gitignore now hides it`).toBe(false);
  });

  it('has no pattern that welds two filenames together (the #107 shape)', () => {
    const raw = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
    // A pattern carrying a second extension mid-token is the signature of an
    // append that missed its newline: "mcp-publisherpackage-lock.json".
    const welded = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .filter((l) => /\.[a-z]{2,5}[a-z0-9._-]*\.[a-z]{2,5}$/i.test(l) && !l.includes('*'));
    expect(welded, 'a .gitignore line looks like two entries joined by a missing newline').toEqual([]);
  });
});
