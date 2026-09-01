#!/usr/bin/env node
// ============================================================================
// Installs the repo's git hooks into .git/hooks on `npm install` (via the
// "prepare" script). Git hooks live OUTSIDE version control (.git/hooks is not
// committed), so without this every clone silently loses the manifest-drift
// guard and re-discovers drift only after CI goes red. This copies the tracked
// scripts/hooks/* into place and makes them executable.
//
// Fail-SAFE by design: if there is no .git dir (tarball install, CI checkout
// with hooks disabled, npm-in-node_modules), it no-ops with exit 0 — never
// block an install because hooks couldn't be wired.
//
// The "prepare" script that calls this is suffixed `2>/dev/null || exit 0` for
// the same reason, and that suffix is load-bearing: the Dockerfile runs
// `npm ci` after copying ONLY package.json + package-lock.json, so this file
// does not exist yet at that layer and node exits MODULE_NOT_FOUND before any
// guard below can run. Without `|| exit 0` the image build fails; without the
// redirect it still dumps a stack trace that reads like a failure. (.git is
// dockerignored, so there is nothing to install in a container anyway.)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitDir = path.join(ROOT, '.git');
const hooksSrc = path.join(ROOT, 'scripts', 'hooks');

// Skip quietly when this isn't a git working tree (installed as a dependency,
// shallow tarball, etc.) — nothing to install, and it must not fail the install.
if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory() || !fs.existsSync(hooksSrc)) {
  process.exit(0);
}

const hooksDst = path.join(gitDir, 'hooks');
fs.mkdirSync(hooksDst, { recursive: true });

let installed = 0;
for (const name of fs.readdirSync(hooksSrc)) {
  const src = path.join(hooksSrc, name);
  const dst = path.join(hooksDst, name);
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
  installed++;
}
console.log(`✓ installed ${installed} git hook(s) → .git/hooks`);
