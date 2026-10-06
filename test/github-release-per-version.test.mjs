// github-release-per-version.test.mjs — (2026-10-06)
//
// Pins .github/workflows/github-release.yml, which cuts a GitHub Release for
// every version that lands on main. Glama's listing reads this repo's GitHub
// Releases (latestRelease 2.12.24 on 2026-10-06 while main was 2.12.29), so a
// version without a release looks unshipped there. The properties that keep it
// safe and useful are easy to lose in an edit:
//   - GITHUB_TOKEN only: contents: write, no secrets.* anywhere;
//   - main-only, on the version-file push (plus dispatch);
//   - version parity across server.json / package.json / npm-launcher before
//     anything is tagged;
//   - skip-if-already-released, and the create step gated on it;
//   - the tag targets github.sha;
//   - dchub.dxt goes through scripts/verify-release-bundle.mjs before it is
//     attached (release-assets.yml never fires for a GITHUB_TOKEN release), and
//     a withheld bundle fails the job;
//   - no ${{ }} inside run: blocks.
//
// No YAML parser on purpose, same as npm-publish-trusted.test.mjs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const WORKFLOW = new URL('../.github/workflows/github-release.yml', import.meta.url);
const text = readFileSync(WORKFLOW, 'utf8');

/** Drop comment-only lines so a mention in a comment cannot satisfy a check. */
const code = text
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

/** The steps of the release job, each as { name, body }. */
function steps(src) {
  const out = [];
  const parts = src.split(/\n {6}- /).slice(1);
  for (const p of parts) {
    const m = p.match(/^name:\s*(.+)$/m) || p.match(/^uses:\s*(.+)$/m);
    out.push({ name: m ? m[1].trim() : '', body: `- ${p}` });
  }
  return out;
}
const allSteps = steps(code);
const find = (re) => allSteps.findIndex((s) => re.test(s.name));

/** Bodies of every `run: |` block. */
function runBlocks(src) {
  const blocks = [];
  let cur = null, indent = null;
  for (const raw of src.split('\n')) {
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

describe('github-release.yml — a GitHub Release per version', () => {
  it('extraction finds the steps it claims to read', () => {
    expect(allSteps.length).toBeGreaterThanOrEqual(6);
    expect(find(/^Create the release/)).toBeGreaterThan(-1);
    expect(runBlocks(code).length).toBeGreaterThanOrEqual(5);
  });

  it('grants contents: write and nothing else, and uses no secret', () => {
    const perms = code.match(/^permissions:\n((?: {2}.+\n)+)/m);
    expect(perms, 'top-level permissions block').not.toBeNull();
    expect(perms[1]).toMatch(/^ {2}contents:\s*write\b/m);
    expect(perms[1].trim().split('\n')).toHaveLength(1);
    expect(code).not.toMatch(/secrets\./);
  });

  it('runs only from main, on a version-file push or dispatch', () => {
    expect(code).toMatch(/^ {4}if:\s*github\.ref == 'refs\/heads\/main'\s*$/m);
    expect(code).toMatch(/push:\n {4}branches:\n {6}- main\n/);
    for (const p of ['server.json', 'package.json', 'npm-launcher/package.json']) {
      expect(code).toContain(`- '${p}'`);
    }
    expect(code).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it('checks version parity before anything else touches the release', () => {
    const i = find(/^Version parity/);
    expect(i).toBeGreaterThan(-1);
    const body = allSteps[i].body;
    for (const f of ['server.json', 'package.json', 'npm-launcher/package.json']) expect(body).toContain(f);
    expect(body).toMatch(/exit 1/);
    expect(i).toBeLessThan(find(/^Skip if/));
    expect(i).toBeLessThan(find(/^Create the release/));
  });

  it('skips a version that already has a release, and gates creation on it', () => {
    const i = find(/^Skip if/);
    expect(i).toBeGreaterThan(-1);
    expect(allSteps[i].body).toContain('gh release view "v$VERSION"');
    const c = allSteps[find(/^Create the release/)].body;
    expect(c).toMatch(/if:\s*steps\.exists\.outputs\.skip == 'false'/);
  });

  it('tags github.sha with a v-prefixed tag and marks it latest', () => {
    const c = allSteps[find(/^Create the release/)].body;
    expect(c).toContain('gh release create "v$VERSION"');
    expect(c).toMatch(/SHA:\s*\$\{\{\s*github\.sha\s*\}\}/);
    expect(c).toContain('--target "$SHA"');
    expect(c).toContain('--latest');
  });

  it('verifies dchub.dxt before attaching it, and fails red when it is withheld', () => {
    const v = find(/^Verify dchub\.dxt/);
    expect(v).toBeGreaterThan(-1);
    expect(allSteps[v].body).toContain('node scripts/verify-release-bundle.mjs "v$VERSION"');
    expect(v).toBeLessThan(find(/^Create the release/));
    const c = allSteps[find(/^Create the release/)].body;
    expect(c).toMatch(/if \[ "\$ATTACH" = "true" \]; then ASSETS=\(dchub\.dxt\); fi/);
    const f = find(/^Fail if dchub\.dxt was withheld/);
    expect(f).toBeGreaterThan(find(/^Create the release/));
    expect(allSteps[f].body).toMatch(/exit 1/);
  });

  it('never interpolates ${{ }} inside a run: block', () => {
    for (const b of runBlocks(code)) expect(b).not.toMatch(/\$\{\{/);
  });
});
