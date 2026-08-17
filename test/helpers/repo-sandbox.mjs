// ============================================================================
// Isolated working-tree sandbox for tests that MUTATE repo files.
//
// WHY THIS EXISTS (2026-08-17): smithery-canon-guard rewrote server.mjs,
// smithery.yaml, canonical/canon_phrases.json and REGISTRY-LISTINGS.md IN THE
// SHARED WORKING TREE — mutate, shell out to the sync script, restore. vitest
// runs test FILES in parallel, and several siblings readFileSync server.mjs at
// MODULE LOAD and assert on its source (anon-seat-fence, execute-plan-cohort,
// oauth-first-copy, mpp-consent, mpp-funnel-split, wall-exits).
//
// Measured on this repo at 3e73cd0, by sampling server.mjs from a separate
// process while six canon-guard runs went by:
//
//     {samples: 8233, zeroByte: 1, staleClaimSamples: 307, readErrors: 0,
//      staleSeen: ["12,650+ global data center facilities", "190+ countries"]}
//
// 307 of 8,233 reads saw the guard's injected stale claims — the exact strings
// anon-seat-fence asserts against canon — and one read caught the file at ZERO
// BYTES, because fs.writeFileSync is NOT atomic: it opens with O_TRUNC and then
// writes, and server.mjs is ~1 MB. Both windows are real; the stale-content one
// is ~300x wider than the truncation one.
//
// Downstream, that put anon-seat-fence red in 2 of 3 full-suite runs on the
// unfixed tree and 0 of 3 after this change. The zero-byte window is the same
// shape CI hit on PR #180 (run 31653502482): execute-plan-cohort reported
// `expected -1 to be greater than -1` (indexOf on an empty string) and
// `expected '' to match /_normalizeCohort\(args\.cohort\)/`, then went green on
// `gh run rerun --failed` at the identical commit — the race is scheduling, not
// content.
//
// The direction nobody notices is worse than the flake: if the guard's own
// mutation is clobbered — or its restore lands early — its must-fail controls
// pass VACUOUSLY, and real canon drift ships green.
//
// So the mutation no longer happens on the shared tree at all. Every mutating
// test operates on a private throwaway copy of the working tree under
// os.tmpdir(). The sync script derives its ROOT from its OWN location
// (scripts/sync-tools-manifest.mjs, line 22) and never reads process.cwd, so
// invoking the SANDBOX copy of the script roots the entire check inside the
// sandbox with no other plumbing.
//
// The copy is of the WORKING TREE (not `git show`), so a dirty tree is still
// what gets checked — a dev editing server.mjs must see their own edit fail.
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * List the repo's tracked files. Under-listing FAILS RED, never green — the
 * required-surfaces check below throws on a short copy, and a sandbox missing
 * server.json / server.mjs would make the sync script throw anyway. The
 * failure mode to avoid is a sandbox that comes up thin and reports a clean
 * tree because there was nothing in it to find.
 */
function trackedFiles(repoRoot) {
  const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

/**
 * Materialize a private copy of the repo working tree in a temp dir.
 * node_modules is deliberately NOT copied — sync-tools-manifest.mjs imports
 * only node:fs / node:path / node:url.
 *
 * @returns {{root: string, files: string[], inside: (p: string) => boolean,
 *            write: (file: string, content: string) => void, cleanup: () => void}}
 */
export function createRepoSandbox(repoRoot, label = 'dchub-canon') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  let files;
  try {
    files = trackedFiles(repoRoot);

    for (const rel of files) {
      const src = path.join(repoRoot, rel);
      if (!fs.existsSync(src)) continue;          // tracked-but-deleted in a dirty tree
      const dest = path.join(root, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }

    // Non-vacuity: a sandbox that silently came up empty must not be mistaken
    // for a clean tree. Assert the surfaces the canon guard depends on.
    for (const need of ['server.mjs', 'server.json', 'smithery.yaml',
                        'canonical/canon_phrases.json', 'REGISTRY-LISTINGS.md',
                        'scripts/sync-tools-manifest.mjs']) {
      if (!fs.existsSync(path.join(root, need))) {
        throw new Error(`repo sandbox is missing ${need} — the copy did not take, ` +
                        `so anything checked against it would be vacuous`);
      }
    }
  } catch (e) {
    // Constructed at module scope, so a throw here means the caller never got
    // a handle to clean up with. Take the temp dir down on the way out.
    fs.rmSync(root, { recursive: true, force: true });
    throw e;
  }

  const inside = (p) => {
    const abs = path.resolve(p);
    return abs === root || abs.startsWith(root + path.sep);
  };

  return {
    root,
    files,
    inside,
    /**
     * The ONLY write allowed by a mutating test. Refusing at the write site is
     * what makes the isolation deterministic, and it is the only control that
     * acts BEFORE the damage: a tree comparison can only report a window that
     * has already been open, and by then a sibling worker may already have read
     * through it. Verified 2026-08-17 — re-aiming the server.mjs mutation at
     * the real repo throws here and never opens the window at all.
     */
    write(file, content) {
      if (!inside(file)) {
        throw new Error(
          `refusing to write OUTSIDE the sandbox: ${file}\n` +
          `Mutating tests must operate on the sandbox copy (${root}); writing to the ` +
          `shared working tree lets a parallel test file observe the path mid-write.`);
      }
      fs.writeFileSync(file, content);
    },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

/**
 * Fingerprint every tracked file so a test can PROVE it never wrote to the
 * shared working tree.
 *
 * Content (size + digest) AND write-identity (mtime/ctime/inode). The
 * timestamps are the load-bearing half: a mutate-and-restore leaves content
 * identical, so a content-only fingerprint would report clean on exactly the
 * shape that tears a sibling reader. Verified 2026-08-17 — bypassing
 * SANDBOX.write() with a raw fs.writeFileSync aimed at the real server.mjs is
 * caught here, restore and all.
 *
 * It remains a BACKSTOP, for two reasons. It is sampled: it can only see
 * writes that happen between two calls in THIS file's own run window, so a
 * sibling test file's mutate-and-restore is invisible to it (that is what the
 * static write-scan in smithery-canon-guard covers). And it is after the fact:
 * by the time it reports, the window has already been open and a parallel
 * reader may already have gone red. Only the write-site refusal prevents.
 */
export function fingerprintTree(repoRoot) {
  const fp = new Map();
  for (const rel of trackedFiles(repoRoot)) {
    const abs = path.join(repoRoot, rel);
    let buf, st;
    try { buf = fs.readFileSync(abs); st = fs.statSync(abs, { bigint: true }); }
    catch { fp.set(rel, 'ABSENT'); continue; }
    // FNV-1a over the bytes — no crypto import, collision risk irrelevant for
    // "did a 1 MB file get truncated and rewritten".
    let h = 0x811c9dc5;
    for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    fp.set(rel, `${buf.length}:${h.toString(16)}:${st.mtimeNs}:${st.ctimeNs}:${st.ino}`);
  }
  return fp;
}

/** @returns {string[]} tracked paths whose CONTENT differs between two fingerprints. */
export function fingerprintDiff(before, after) {
  const changed = [];
  for (const [rel, sig] of before) if (after.get(rel) !== sig) changed.push(rel);
  for (const rel of after.keys()) if (!before.has(rel)) changed.push(`${rel} (new)`);
  return changed;
}
