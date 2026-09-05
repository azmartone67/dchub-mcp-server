// =============================================================================
// No workflow may `git push` straight to a protected main — the guard
// -----------------------------------------------------------------------------
// main here is moving to required status checks. A `git push` to such a branch
// is rejected with GH006 ("N of N required status checks are expected"), and a
// [skip ci] commit reports none of those checks, so the push can NEVER succeed
// — it fails identically every run while the job around it exits 0.
//
// ★ Measured cost of this exact shape, in the sibling repo: dchub-backend's
// mcp-facts-export.yml records SEVENTEEN DAYS of daily red from one such push,
// ignored the whole time because the remediation text shipped alongside it said
// the failure was cosmetic. A wrong remediation is worse than none — it turns a
// real alarm into a known-ignorable one.
//
// VIOLATION, per `run:` block:
//   * bare `git push` in a block that never created a branch — the checkout is
//     on main, so it targets main;
//   * any push naming main (`origin main`, `HEAD:main`, `:main`).
// FINE: pushing a branch the block just created, including via HEAD, or an
// explicit branch variable.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const wfDir = new URL('../.github/workflows/', import.meta.url);
const PUSH = /\bgit\s+push\b([^\n|;&]*)/g;
const MADE_BRANCH = /\bgit\s+(?:switch\s+-c|checkout\s+-b)\b/;

export function violations(block, where) {
  const out = [];
  const madeBranch = MADE_BRANCH.test(block);
  for (const m of block.matchAll(PUSH)) {
    const args = m[1].split(/\s+/).filter((a) => a && !a.startsWith('-'));
    const line = block.slice(0, m.index).split('\n').length;
    if (args.length < 2) {
      if (!madeBranch) out.push(`${where}:~${line} bare \`git push\` with no branch created — targets a protected main`);
      continue;
    }
    const dest = args[1].replace(/['"]/g, '');
    if (dest === 'main' || dest.endsWith(':main')) {
      out.push(`${where}:~${line} pushes to main (${dest}) — rejected with GH006 every run`);
    }
  }
  return out;
}

/** `run: |` block bodies, text-scanned: the YAML embeds ${{ }} templating. */
function runBlocks(text) {
  const blocks = [];
  let cur = null, indent = null;
  for (const raw of text.split('\n')) {
    if (indent !== null) {
      const width = raw.length - raw.trimStart().length;
      if (raw.trim() === '' || width > indent) { cur.push(raw); continue; }
      blocks.push(cur.join('\n')); cur = null; indent = null;
    }
    const m = raw.match(/^(\s*)-?\s*run:\s*[|>]/);
    if (m) { indent = m[1].length; cur = []; }
  }
  if (cur) blocks.push(cur.join('\n'));
  return blocks;
}

const files = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

describe('no workflow pushes directly to a protected main', () => {
  it('found workflows to scan (never pass by scanning nothing)', () => {
    expect(files.length).toBeGreaterThan(3);
    const totalBlocks = files.reduce((n, f) => n + runBlocks(readFileSync(new URL(f, wfDir), 'utf8')).length, 0);
    expect(totalBlocks, 'no `run:` blocks parsed — the guard is blind').toBeGreaterThan(5);
  });

  it('no workflow targets main', () => {
    const hits = files.flatMap((f) => runBlocks(readFileSync(new URL(f, wfDir), 'utf8')).flatMap((b) => violations(b, f)));
    expect(hits.join('\n')).toBe('');
  });

  // ── must-fail controls ──
  it('FAILS a bare push with no branch created', () => {
    expect(violations('  git commit -m x\n  git push\n', 'x.yml')).toHaveLength(1);
  });
  it('FAILS an explicit `origin main`', () => {
    expect(violations('  git push origin main\n', 'x.yml')[0]).toMatch(/pushes to main/);
  });
  it('FAILS a HEAD:main refspec', () => {
    expect(violations('  git push -u origin HEAD:main\n', 'x.yml')[0]).toMatch(/pushes to main/);
  });
  it('PASSES HEAD after switch -c, and an explicit branch var', () => {
    expect(violations('  git switch -c "chore/x"\n  git push -u origin HEAD\n', 'x.yml')).toEqual([]);
    expect(violations('  git checkout -b "$B"\n  git push -q -u origin "$B"\n', 'x.yml')).toEqual([]);
  });
});
