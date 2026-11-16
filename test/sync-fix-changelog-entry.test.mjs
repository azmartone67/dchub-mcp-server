// sync-fix-changelog-entry.test.mjs (Grok Note P follow-up, 2026-11-16).
//
// changelog-and-publish-gate (hard gate) requires a CHANGELOG.md entry for the version every
// publish surface carries. `sync-tools-manifest --fix` can patch-bump that version on its own
// (the server.json version fence), and the daily manifest sync runs the hard gate on the healed
// tree before it pushes. Without an entry, a bump holds the day's heal. Pinned here:
//   1. a --fix run that bumps writes exactly one `## <version> (<YYYY-MM-DD>)` entry with one
//      user-facing bullet, at the top of the version list, and nothing else in the file moves;
//   2. a --fix run that does not bump leaves CHANGELOG.md byte-identical, and a re-run after a
//      bump does not stack a second entry;
//   3. daily-manifest-sync.yml stages CHANGELOG.md ($OWNED), else the UNOWNED gate fails the job.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addChangelogEntry, SYNC_ENTRY_LINE, todayUTC } from '../scripts/changelog-entry.mjs';
import { createRepoSandbox } from './helpers/repo-sandbox.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The heading regex and the copy rule changelog-and-publish-gate.test.mjs applies.
const HEADING = /^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/gm;
const NO_PLAN_COPY = /\b(?:paid|upgrades?|upgrading|trials?|pricing)\b|\bfree[- ]tiers?\b|\$\s?\d|\/pricing\b|\b(?:Pro|Starter|Enterprise|Founding)\b|\bdeveloper plan\b/;
const entriesFor = (text, v) => [...text.matchAll(HEADING)].filter((m) => m[1] === v);

describe('addChangelogEntry', () => {
  const LOG = '# Changelog\n\nIntro.\n\n## 1.0.1 (2026-01-02)\n\n- b\n\n## 1.0.0 (2026-01-01)\n\n- a\n\n## How releases are cut\n\nRules.\n';

  it('puts the entry above the newest version, in the gate format, and moves nothing else', () => {
    const out = addChangelogEntry(LOG, '1.0.2', '2026-11-16');
    const top = [...out.matchAll(HEADING)][0];
    expect(top[1]).toBe('1.0.2');
    expect(top[2]).toBe('2026-11-16');
    expect(out).toBe(LOG.replace('## 1.0.1 ', `## 1.0.2 (2026-11-16)\n\n- ${SYNC_ENTRY_LINE}\n\n## 1.0.1 `));
  });

  it('is a no-op when the version already has an entry', () => {
    expect(addChangelogEntry(LOG, '1.0.1', '2026-11-16')).toBe(LOG);
    const once = addChangelogEntry(LOG, '1.0.2', '2026-11-16');
    expect(addChangelogEntry(once, '1.0.2', '2026-11-17')).toBe(once);
  });

  it('with no version entries yet, goes above the first section; with no section, at the end', () => {
    expect(addChangelogEntry('# C\n\n## How releases are cut\n', '2.0.0', '2026-11-16'))
      .toBe(`# C\n\n## 2.0.0 (2026-11-16)\n\n- ${SYNC_ENTRY_LINE}\n\n## How releases are cut\n`);
    expect(addChangelogEntry('# C\n', '2.0.0', '2026-11-16')).toBe(`# C\n\n## 2.0.0 (2026-11-16)\n\n- ${SYNC_ENTRY_LINE}\n`);
  });

  it('refuses a non x.y.z version or a non YYYY-MM-DD date', () => {
    expect(() => addChangelogEntry(LOG, '1.0.2-rc1', '2026-11-16')).toThrow(/x\.y\.z/);
    expect(() => addChangelogEntry(LOG, '1.0.2', '11/16/2026')).toThrow(/YYYY-MM-DD/);
  });

  it('the line is user-facing copy (passes the CHANGELOG copy rule) and the date is UTC', () => {
    expect(SYNC_ENTRY_LINE).not.toMatch(NO_PLAN_COPY);
    expect(todayUTC(new Date('2026-11-16T20:00:00-08:00'))).toBe('2026-11-17');
  });
});

describe('daily-manifest-sync.yml stages CHANGELOG.md', () => {
  it('$OWNED lists CHANGELOG.md', () => {
    const wf = fs.readFileSync(path.join(REPO, '.github/workflows/daily-manifest-sync.yml'), 'utf8');
    const m = wf.match(/OWNED="([\s\S]*?)"/);
    expect(m, '$OWNED assignment not found').toBeTruthy();
    const owned = new Set(m[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean));
    expect(owned.size).toBeGreaterThan(20);
    expect(owned.has('CHANGELOG.md')).toBe(true);
  });
});

// End to end on a sandbox copy of this repo, the shape registry-version-bump-write-time uses.
describe('sync-tools-manifest --fix and CHANGELOG.md', () => {
  let box;
  const sync = (...args) => {
    try {
      return { code: 0, out: execFileSync('node', [path.join(box.root, 'scripts/sync-tools-manifest.mjs'), ...args],
        { cwd: box.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
    }
  };
  const rd = (f) => fs.readFileSync(path.join(box.root, f), 'utf8');
  const sjVersion = () => JSON.parse(rd('server.json')).version;

  beforeAll(() => {
    box = createRepoSandbox(REPO, 'changelog-bump');
    const g = (...a) => execFileSync('git', a, { cwd: box.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'g@example.com');
    g('config', 'user.name', 'changelog');
    g('add', '-A'); g('commit', '-q', '-m', 'sandbox baseline');
    for (const v of ['9.9.8', '9.9.9']) {
      const sj = JSON.parse(rd('server.json'));
      sj.version = v;
      box.write(path.join(box.root, 'server.json'), JSON.stringify(sj, null, 2) + '\n');
      expect(sync('--fix').code).toBe(0);
      g('add', '-A'); g('commit', '-q', '-m', `publish ${v}`);
    }
  }, 120_000);
  afterAll(() => box?.cleanup());

  it('a --fix that does not bump leaves CHANGELOG.md byte-identical', () => {
    const before = rd('CHANGELOG.md');
    const r = sync('--fix');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\[server\.json version fence\] server\.json unchanged since version 9\.9\.9/);
    expect(sjVersion()).toBe('9.9.9');
    expect(r.out).not.toMatch(/wrote:.*CHANGELOG\.md/);
    expect(rd('CHANGELOG.md')).toBe(before);
  });

  it('a --fix that bumps writes exactly one matching entry at the top, and nothing else moves', () => {
    const before = rd('CHANGELOG.md');
    expect(entriesFor(before, '9.9.10')).toHaveLength(0);
    const src = path.join(box.root, 'server.mjs');
    box.write(src, fs.readFileSync(src, 'utf8')
      + "\nfunction __probeRegistration(srv) { trackedTool(srv, 'zzz_probe_tool', 'A throwaway probe registration.'); }\n");
    const day0 = todayUTC();
    const r = sync('--fix');
    const day1 = todayUTC();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/version bumped to 9\.9\.10/);   // non-vacuity: the bump happened
    expect(sjVersion()).toBe('9.9.10');
    expect(r.out).toMatch(/wrote:.*CHANGELOG\.md/);
    const after = rd('CHANGELOG.md');
    const hits = entriesFor(after, '9.9.10');
    expect(hits).toHaveLength(1);
    expect([day0, day1]).toContain(hits[0][2]);
    expect([...after.matchAll(HEADING)][0][1]).toBe('9.9.10');  // the top entry, as the gate reads it
    const entry = `## 9.9.10 (${hits[0][2]})\n\n- ${SYNC_ENTRY_LINE}\n\n`;
    expect(after).toBe(before.slice(0, hits[0].index) + entry + before.slice(hits[0].index));
  });

  it('a second --fix after the bump adds no second entry', () => {
    const before = rd('CHANGELOG.md');
    expect(sync('--fix').code).toBe(0);
    expect(sjVersion()).toBe('9.9.10');
    expect(rd('CHANGELOG.md')).toBe(before);
    expect(entriesFor(before, '9.9.10')).toHaveLength(1);
  });
});
