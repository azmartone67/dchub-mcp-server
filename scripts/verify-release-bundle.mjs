#!/usr/bin/env node
// Release-time guard for the dchub.dxt asset.
//
// WHY (★2026-08-30). #270 made the committed bundle self-healing: it is repacked
// from dxt/ by --fix, and manifest-consistency.yml fails when it drifts from
// source. That holds the bundle to CANON. It says nothing about the TAG it gets
// published under, and a release asset is the one place those can disagree
// silently — a v2.12.0 release carrying a 2.12.1 bundle downloads fine, installs
// fine, and misreports itself forever.
//
// That pairing was a live possibility, not a hypothetical: when this guard was
// written the latest release was v2.12.0 while canon and the bundle were both
// 2.12.1, and no release carried any asset at all. Attaching the bundle to the
// existing release was the fast option and would have shipped exactly that lie.
//
// Run by .github/workflows/release-assets.yml BEFORE the upload, so a mismatched
// asset is never published rather than published and corrected.
//
//   node scripts/verify-release-bundle.mjs v2.12.1
//
// Exits 0 when the bundle may be published under that tag, 1 with a reason
// otherwise. Checks BOTH directions of "is this asset honest":
//   1. the bundle carries the current source (it is not a stale binary), and
//   2. the version it declares matches the tag it will be published under.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZipEntries, bundleDrift } from './dxt-bundle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'dchub.dxt');

const raw = process.argv[2];
if (!raw) {
  console.error('usage: verify-release-bundle.mjs <tag>   (e.g. v2.12.1)');
  process.exit(2);
}
// Tags are written `v2.12.1`; manifests carry a bare semver.
const tag = raw.trim().replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(tag)) {
  console.error(`refusing to verify against a non-semver tag: "${raw}". `
    + 'The asset guard compares the bundle version to the release tag, so a tag it '
    + 'cannot parse would make this check vacuous.');
  process.exit(2);
}

const problems = [];

let bundle;
try { bundle = fs.readFileSync(BUNDLE); }
catch { problems.push('dchub.dxt is MISSING from the tree — there is nothing to publish'); }

if (bundle) {
  // 1. the bundle must carry the CURRENT source, not a stale binary. Same
  //    contents-not-bytes rule as the sync guard; see scripts/dxt-bundle.mjs.
  const drift = bundleDrift(bundle, (f) => fs.readFileSync(path.join(ROOT, f)));
  for (const d of drift) problems.push(`dchub.dxt ${d}`);

  // 2. and it must not misreport the release it ships under.
  if (!drift.some((d) => d.startsWith('unreadable'))) {
    let declared = null;
    try {
      declared = JSON.parse(readZipEntries(bundle).get('manifest.json')).version;
    } catch (e) {
      problems.push(`dchub.dxt: could not read a version from the embedded manifest (${e.message})`);
    }
    if (declared !== null && declared !== tag) {
      problems.push(`dchub.dxt declares version ${declared} but would be published under tag ${raw} `
        + '— an asset that misreports its own version is worse than a missing one, because it '
        + 'installs cleanly and lies for as long as it is downloaded. Tag the release to match '
        + 'the bundle, or repack the bundle (node scripts/sync-tools-manifest.mjs --fix).');
    }
  }
}

if (problems.length) {
  console.error(`REFUSING to attach dchub.dxt to ${raw}:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ dchub.dxt carries current source and declares ${tag} — safe to publish under ${raw}`);
