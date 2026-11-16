// changelog-and-publish-gate.test.mjs (Grok Note P item 4, 2026-11-16).
//
// npm saw 8 versions in one week (2.12.46-2.12.54, five within ~8h on 2026-11-14) and ~90% of the
// week's downloads landed on publish days. This pins the release cadence rules:
//   1. CHANGELOG.md exists, its top entry is the version every publish surface carries, and it is
//      user-facing copy (no plan names, prices, paid/upgrade/trial).
//   2. npm-publish.yml and github-release.yml start only on version files / the launcher: a docs-,
//      directories- or canonical-only merge never starts them, a launcher or version change does.
//   3. A docs-only PR that bumps the version is refused by scripts/version-bump-justified.mjs (the
//      required `check`), and a launcher change still justifies a bump.
//   4. github-release.yml takes the release body from the CHANGELOG entry for that version.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { judge } from '../scripts/version-bump-justified.mjs';
import { createScratchRepo } from './helpers/repo-sandbox.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const CHANGELOG = read('CHANGELOG.md');
const VERSION = JSON.parse(read('package.json')).version;

// Same rule the README guard uses: no plan names, prices or paid/upgrade/trial wording.
const NO_PLAN_COPY = /\b(?:paid|upgrades?|upgrading|trials?|pricing)\b|\bfree[- ]tiers?\b|\$\s?\d|\/pricing\b|\b(?:Pro|Starter|Enterprise|Founding)\b|\bdeveloper plan\b/;

describe('CHANGELOG.md', () => {
  const entries = [...CHANGELOG.matchAll(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/gm)];

  it('the top entry is the version in package.json, server.json and npm-launcher/package.json', () => {
    expect(entries.length).toBeGreaterThan(0);
    const top = entries[0][1];
    expect(top).toBe(VERSION);
    expect(JSON.parse(read('server.json')).version).toBe(top);
    expect(JSON.parse(read('npm-launcher/package.json')).version).toBe(top);
  });

  it('entries run newest first and the top entry has at least one bullet', () => {
    const nums = entries.map((m) => m[1].split('.').map(Number));
    for (let i = 1; i < nums.length; i++) {
      const [a, b] = [nums[i - 1], nums[i]];
      const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      expect(newer, `${entries[i - 1][1]} must be above ${entries[i][1]}`).toBeGreaterThan(0);
    }
    const body = CHANGELOG.slice(entries[0].index).split(/\n(?=## )/)[0];
    expect(body).toMatch(/^- \S/m);
  });

  it('is user-facing copy: no plan names, prices, paid/upgrade/trial', () => {
    const hit = CHANGELOG.match(NO_PLAN_COPY);
    expect(hit, hit && hit[0]).toBeNull();
  });
});

// GitHub `on.push.paths` globs: `**` crosses directories, `*` does not.
function pushPaths(workflow) {
  const text = read(`.github/workflows/${workflow}`);
  const block = text.match(/^on:\n {2}push:\n(?: {4}.*\n)*/m);
  expect(block, `${workflow}: on.push block`).not.toBeNull();
  const paths = block[0].split('paths:\n')[1];
  expect(paths, `${workflow}: on.push.paths`).toBeTruthy();
  return [...paths.matchAll(/^ {6}- '([^']+)'$/gm)].map((m) => m[1]);
}
const globRx = (g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
const triggers = (globs, files) => files.some((f) => globs.some((g) => globRx(g).test(f)));

const DOCS_ONLY = [
  ['README only', ['README.md']],
  ['CHANGELOG only', ['CHANGELOG.md']],
  ['docs + social preview', ['docs/quick-start.md', 'docs/social-preview.png']],
  ['directories only', ['canonical/directories.json']],
  ['canonical only', ['canonical/canon_phrases.json', 'canonical/directories.json']],
  ['llms.txt + REGISTRY-LISTINGS.md', ['llms.txt', 'REGISTRY-LISTINGS.md']],
];

describe.each(['npm-publish.yml', 'github-release.yml'])('%s path filter', (wf) => {
  const globs = pushPaths(wf);

  it('lists only version files, the launcher and its own workflow (no catch-all)', () => {
    expect(globs.length).toBeGreaterThan(0);
    for (const g of globs) {
      expect(g === 'server.json' || g === 'package.json' || g.startsWith('npm-launcher/')
        || g === `.github/workflows/${wf}`, g).toBe(true);
    }
  });

  it.each(DOCS_ONLY)('a %s merge does not start it', (_label, files) => {
    expect(triggers(globs, files)).toBe(false);
  });

  it('a version bump (the shape every tool change ships with) starts it', () => {
    expect(triggers(globs, ['server.mjs', 'mcp-server.json', 'server.json', 'package.json', 'npm-launcher/package.json'])).toBe(true);
  });
});

describe('npm-publish.yml: launcher changes start it', () => {
  const globs = pushPaths('npm-publish.yml');
  it.each([['npm-launcher/bin/dchub-mcp-server.mjs'], ['npm-launcher/README.md'], ['npm-launcher/package.json']])('%s', (f) => {
    expect(triggers(globs, [f])).toBe(true);
  });
  it('publishes only a version that is not on npm yet (an unchanged version is a no-op)', () => {
    const wf = read('.github/workflows/npm-publish.yml');
    expect(wf).toContain('npm view "dchub-mcp-server@$VERSION" version');
    expect(wf).toMatch(/- name: Publish \(trusted publishing, provenance\)\n {8}id: publish\n {8}if: steps\.published\.outputs\.skip == 'false'/);
  });
});

// ---- 3. the bump gate: a docs-only PR may not bump --------------------------------------------
const PPK = 'io.modelcontextprotocol.registry/publisher-provided';
const repos = [];
afterAll(() => { for (const d of repos) d.cleanup(); });
function tree(d, v, { bin = 'console.log(1)\n', readme = '# R\n', changelog = '# C\n' } = {}) {
  d.write('server.json', JSON.stringify({ name: 'cloud.dchub/mcp-server', title: 'T', version: v,
    remotes: [{ type: 'streamable-http', url: 'https://dchub.cloud/mcp' }],
    packages: [{ registryType: 'npm', identifier: 'dchub-mcp-server', version: v }],
    _meta: { [PPK]: { toolCount: 1 } } }, null, 2));
  d.write('mcp-server.json', JSON.stringify({ name: 'dchub', version: v, tools: [{ name: 'a', description: 'A.' }] }, null, 2));
  d.write('package.json', JSON.stringify({ name: 'dchub-mcp-server', version: v, description: 'D' }, null, 2));
  d.write('npm-launcher/package.json', JSON.stringify({ name: 'dchub-mcp-server', version: v, description: 'D', bin: { x: 'bin/x.mjs' } }, null, 2));
  d.write('npm-launcher/bin/x.mjs', bin);
  d.write('README.md', readme);
  d.write('CHANGELOG.md', changelog);
  d.write('docs/quick-start.md', readme);
  d.write('canonical/directories.json', JSON.stringify({ rows: [readme] }));
}
function bumpVerdict(change) {
  const d = createScratchRepo('notep-bump'); repos.push(d);
  tree(d, '1.0.0'); d.commit('v1.0.0');
  const base = d.git('rev-parse', 'HEAD').trim();
  tree(d, '1.0.1', change); d.commit('change + bump');
  return judge(d.root, base);
}

describe('version-bump-justified: what may and may not carry a bump', () => {
  it('RED: a docs-only PR (README, CHANGELOG, docs/, canonical/directories.json) that bumps the version', () => {
    const v = bumpVerdict({ readme: '# R, reworded\n', changelog: '# C\n\n## 1.0.1\n- x\n' });
    expect(v.ran).toBe(true);
    expect(v.ok).toBe(false);
  });
  it('green: a launcher change carries a bump', () => {
    const v = bumpVerdict({ bin: 'console.log(2)\n' });
    expect(v.ok).toBe(true);
    expect(v.changed).toContain('npm_launcher_bin');
  });
});

// ---- 4. the release body is the CHANGELOG entry -----------------------------------------------
describe('github-release.yml: release summary from CHANGELOG.md', () => {
  const wf = read('.github/workflows/github-release.yml');
  const steps = wf.split(/\n(?= {6}- name:)/);
  const summary = steps.find((s) => s.includes('- name: Release summary from CHANGELOG.md')) || '';
  const create = steps.find((s) => s.includes('- name: Create the release')) || '';
  const runBlock = (summary.split('run: |\n')[1] || '').split('\n').map((l) => l.slice(10)).join('\n');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'notep-relnotes-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const runSummary = (version) => {
    const out = path.join(tmp, `out-${version}`);
    writeFileSync(out, '');
    execFileSync('bash', ['-eo', 'pipefail', '-c', runBlock], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { PATH: process.env.PATH, VERSION: version, RUNNER_TEMP: tmp, GITHUB_OUTPUT: out, GITHUB_REPOSITORY: 'azmartone67/dchub-mcp-server' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { output: readFileSync(out, 'utf8'), notes: (() => { try { return readFileSync(path.join(tmp, 'release-notes.md'), 'utf8'); } catch { return ''; } })() };
  };

  it('runs before Create the release, which uses its notes file when found', () => {
    expect(summary).not.toBe('');
    expect(wf.indexOf('- name: Release summary from CHANGELOG.md')).toBeLessThan(wf.indexOf('- name: Create the release'));
    expect(create).toMatch(/FOUND:\s*\$\{\{\s*steps\.summary\.outputs\.found\s*\}\}/);
    expect(create).toContain('--notes-file "$RUNNER_TEMP/release-notes.md"');
  });

  it('the current version: body is exactly that entry\'s bullets, plus the remote/npm line', () => {
    const { output, notes } = runSummary(VERSION);
    expect(output).toContain('found=true');
    const entry = CHANGELOG.split(new RegExp(`^## ${VERSION.replace(/\./g, '\\.')} \\(.*\\)$`, 'm'))[1].split(/\n## /)[0].trim();
    expect(entry.length).toBeGreaterThan(0);
    expect(notes).toBe(`${entry}\n\nRemote server: https://dchub.cloud/mcp · npm: dchub-mcp-server@${VERSION} · `
      + '[CHANGELOG](https://github.com/azmartone67/dchub-mcp-server/blob/main/CHANGELOG.md)\n');
  });

  it('a version with no entry falls back (found=false), and a prefix version does not match', () => {
    expect(runSummary('9.9.9').output).toContain('found=false');
    const [maj, min, pat] = VERSION.split('.');
    expect(pat.length).toBeGreaterThan(1);
    expect(runSummary(`${maj}.${min}.${pat.slice(0, -1)}`).output).toContain('found=false');
  });
});
