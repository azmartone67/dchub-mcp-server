// =============================================================================
// The registry publish stalls when server.json's CONTENT moves and its version
// does not — WRITE-TIME half
// -----------------------------------------------------------------------------
// registry.modelcontextprotocol.io rejects a duplicate version. That rejection is
// a correct no-op when nothing changed, and a silent staleness bug the moment the
// manifest's content moves without a bump: the publish is refused and the CASCADE
// SOURCE for PulseMCP / mcp.so / Glama / ToolPlex keeps serving the old manifest.
//
// It has stalled twice. 2026-08-31 (toolCount 82 -> 83, no bump —
// scripts/registry_version_bump_guard.py was written that day) and 2026-09-07
// (c5b45b5, 86 -> 88, version left at 2.12.8; registry-refresh failed at 09:02,
// 13:47 and 20:48 UTC and was repaired by hand in #376). a1df751/#370 a week
// earlier is the same shape.
//
// The Python guard is the BACKSTOP and stays exactly as it is — it is the only
// reason either occurrence was noticed. But it judges the COMMITTED tree, so it
// can only go red after the commit exists. These controls pin the half that did
// not exist: the question being asked at the moment the content is written, by
// the one command a contributor is told to run.
//
// ★ EVERY CONTROL MUST BE ABLE TO FAIL. The fence fails OPEN on shallow history
// by design, which means a test that builds the wrong repo shape passes
// vacuously and certifies nothing. So each case below asserts the verdict in
// BOTH directions, and the end-to-end block asserts the RED before it asserts
// the fix.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { versionFence, publishedBaseline, contentKey, nextPatch } from '../scripts/server-json-baseline.mjs';
import { readZipEntries } from '../scripts/dxt-bundle.mjs';
import { choosePublishVersion } from '../scripts/registry-autopublish.mjs';
// ★ EVERY write below goes through these two helpers, never through fs directly.
// smithery-canon-guard's static write-scan flags any test file that so much as
// mentions writeFileSync/rmSync — it cannot tell os.tmpdir() from the
// working tree — and it caught THIS file on its first full-suite run. The
// exemption list has one entry and is not the place to fix that.
import { createRepoSandbox, createScratchRepo } from './helpers/repo-sandbox.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(REPO, 'scripts', 'registry_version_bump_guard.py');
// A closed port: `fetch` refuses in ~10ms, which is how the "registry
// unreadable" branch gets exercised end-to-end with no egress and no listener.
const DEAD_PORT = 'http://127.0.0.1:1/registry-is-unreachable';

// ── synthetic-repo helpers ───────────────────────────────────────────────────
const manifest = (version, extra) => JSON.stringify(
  extra === undefined
    ? { name: 'cloud.dchub/datacenter-power-grid-fiber', version }
    : { name: 'cloud.dchub/datacenter-power-grid-fiber', version, note: extra },
  null, 2) + '\n';

const writeManifest = (repo, version, extra) => repo.write('server.json', manifest(version, extra));
const commit = (repo, msg) => repo.commit(msg, 'server.json');

const diskText = (repo) => fs.readFileSync(path.join(repo.root, 'server.json'), 'utf8');
const diskVersion = (repo) => JSON.parse(diskText(repo)).version;
const fenceOf = (repo) => versionFence(repo.root, diskVersion(repo), diskText(repo));

/** The Python backstop's verdict on the same tree. true = it says DRIFT. */
function backstopSaysDrift(root) {
  try {
    execFileSync('python3', [GUARD], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return false;
  } catch (e) {
    if (e.status === 1) return true;
    throw new Error(`backstop did not run (status ${e.status}): ${e.stderr || e.message}`);
  }
}

// The four repo SHAPES both spellings have to agree on. Built once, reused by
// the fence controls and by the equivalence test, so the two can never be
// pointed at different trees.
const SHAPES = {
  'content moved after the bump, version stood still': (d) => {
    writeManifest(d, '1.0.0'); commit(d, 'v1');
    writeManifest(d, '1.1.0'); commit(d, 'bump to 1.1.0');
    writeManifest(d, '1.1.0', 'toolCount moved 82 -> 83'); commit(d, 'content, no bump');
  },
  'content moved WITH a bump': (d) => {
    writeManifest(d, '1.0.0'); commit(d, 'v1');
    writeManifest(d, '1.1.0', 'new field'); commit(d, 'content + bump together');
  },
  'server.json untouched since the bump': (d) => {
    writeManifest(d, '1.0.0'); commit(d, 'v1');
    writeManifest(d, '1.1.0'); commit(d, 'bump');
    d.write('other.txt', 'x');
    d.commit('unrelated', 'other.txt');
  },
  'drift accumulated over several commits': (d) => {
    writeManifest(d, '2.0.0'); commit(d, 'v2');
    writeManifest(d, '2.1.0'); commit(d, 'bump');
    writeManifest(d, '2.1.0', 'one'); commit(d, 'drift 1');
    writeManifest(d, '2.1.0', 'two'); commit(d, 'drift 2');
  },
};
const DRIFTED = new Set([
  'content moved after the bump, version stood still',
  'drift accumulated over several commits',
]);

describe('server.json version fence — the predicate', () => {
  const repos = [];
  const build = (shape) => {
    const d = createScratchRepo('vfence'); SHAPES[shape](d); repos.push(d); return d;
  };
  afterAll(() => { for (const d of repos) d.cleanup(); });

  for (const shape of Object.keys(SHAPES)) {
    const want = DRIFTED.has(shape);
    it(`${want ? 'RED' : 'green'}: ${shape}`, () => {
      expect(fenceOf(build(shape)).drifted).toBe(want);
    });
  }

  // ── fail-open cases. Each returns drifted:false for a REASON, and the reason
  // is asserted: "declined to judge" and "judged and passed" are the same
  // boolean, and only one of them is a guard.
  it('fails open on a single commit — a lone commit proves nothing', () => {
    const d = createScratchRepo('vfence'); repos.push(d);
    writeManifest(d, '1.0.0'); commit(d, 'only commit');
    const f = fenceOf(d);
    expect(f.drifted).toBe(false);
    expect(f.reason).toMatch(/fewer than two commits/);
  });

  it('fails open when every commit carries one version (shallow-clone shape)', () => {
    const d = createScratchRepo('vfence'); repos.push(d);
    writeManifest(d, '3.0.0'); commit(d, 'a');
    writeManifest(d, '3.0.0', 'x'); commit(d, 'b');
    const f = fenceOf(d);
    expect(f.drifted).toBe(false);
    expect(f.reason).toMatch(/too shallow/);
  });

  it('fails open outside a git repo', () => {
    const d = createScratchRepo('vfence-nogit', { git: false });
    repos.push(d);
    writeManifest(d, '1.0.0');
    // /tmp is not inside a repo on either CI or macOS; if that ever changes the
    // assertion below moves to "fewer than two commits", still a fail-open.
    const f = versionFence(d.root, '1.0.0', diskText(d));
    expect(f.drifted).toBe(false);
  });

  it('does NOT re-bump a version that is already sitting uncommitted', () => {
    // The state --fix leaves behind. Re-running it must not walk the patch
    // number forward on every invocation.
    const d = build('content moved after the bump, version stood still');
    expect(fenceOf(d).drifted).toBe(true);            // before
    writeManifest(d, '1.1.1', 'toolCount moved 82 -> 83');  // the bump, uncommitted
    const f = fenceOf(d);
    expect(f.drifted).toBe(false);
    expect(f.reason).toMatch(/not the one HEAD's newest server\.json commit carries/);
  });

  it('a reordered key is not a content change (no version burned on a reformat)', () => {
    const d = createScratchRepo('vfence'); repos.push(d);
    const obj = (o) => JSON.stringify(o, null, 2) + '\n';
    d.write('server.json', obj({ a: 1, b: 2, version: '1.0.0' })); commit(d, 'v1');
    d.write('server.json', obj({ b: 2, a: 1, version: '1.1.0' })); commit(d, 'bump');
    d.write('server.json', obj({ version: '1.1.0', a: 1, b: 2 }));
    expect(fenceOf(d).drifted).toBe(false);
    // …but a VALUE change through the same reorder still lands.
    d.write('server.json', obj({ version: '1.1.0', a: 9, b: 2 }));
    expect(fenceOf(d).drifted).toBe(true);
  });

  it('contentKey and nextPatch do the narrow jobs they claim', () => {
    expect(contentKey('{"a":1,"version":"1.0.0"}')).toBe(contentKey('{"version":"9.9.9","a":1}'));
    expect(contentKey('{"a":1}')).not.toBe(contentKey('{"a":2}'));
    expect(contentKey('not json')).toBeNull();
    expect(nextPatch('2.12.9')).toBe('2.12.10');
    expect(nextPatch('2.12.9-rc1')).toBeNull();
  });

  it('names the commit a human has to diff against', () => {
    const d = build('content moved after the bump, version stood still');
    const f = fenceOf(d);
    const head = d.git('rev-parse', 'HEAD~1').trim();   // the commit that set 1.1.0
    expect(f.commit).toBe(head);
    expect(publishedBaseline(d.root, '1.1.0').commit).toBe(head);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TWO SPELLINGS, ONE PREDICATE. The write-time fence (JS) and the CI backstop
// (Python) answer the same question in two languages. Nothing but this compares
// them, and a divergence is invisible until the day one of them is the only one
// that runs.
// ─────────────────────────────────────────────────────────────────────────────
describe('the write-time fence and the CI backstop agree', () => {
  const repos = [];
  afterAll(() => { for (const d of repos) d.cleanup(); });

  it('has a runnable backstop to compare against', () => {
    // Not a skip. "python3 was missing" and "the two agreed" are different
    // facts, and only one of them is evidence.
    expect(fs.existsSync(GUARD)).toBe(true);
    expect(() => execFileSync('python3', ['--version'], { stdio: 'ignore' })).not.toThrow();
  });

  for (const shape of Object.keys(SHAPES)) {
    it(`same verdict: ${shape}`, () => {
      const d = createScratchRepo('vfence-eq'); SHAPES[shape](d); repos.push(d);
      // The backstop judges HEAD; the fence judges the working tree. On a CLEAN
      // tree those are the same tree, which is the only condition under which
      // the comparison means anything — so assert the tree is clean first.
      expect(d.git('status', '--porcelain').trim()).toBe('');
      expect(fenceOf(d).drifted).toBe(backstopSaysDrift(d.root));
      // …and that they agreed on the RIGHT answer, not merely with each other.
      expect(backstopSaysDrift(d.root)).toBe(DRIFTED.has(shape));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// END TO END, on a real copy of this repo: does `npm run sync:fix` now produce a
// tree the registry will actually accept, across all EIGHT publish surfaces?
//
// The 2.12.1 note is why the eighth one is counted explicitly: that bump reached
// seven surfaces and missed server.mjs, so the RUNNING server identified as
// 2.12.0 on both surfaces it controls while the registry advertised 2.12.1.
// dchub.dxt is the eighth — a committed binary carrying a COPY of
// dxt/manifest.json, which went a month unrepacked once nobody was watching.
// ─────────────────────────────────────────────────────────────────────────────
describe('sync:fix produces a publishable tree', () => {
  let box;
  const sync = (...args) => {
    try {
      return { code: 0, out: execFileSync('node', [path.join(box.root, 'scripts/sync-tools-manifest.mjs'), ...args],
        { cwd: box.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
    }
  };
  const sjVersion = () => JSON.parse(fs.readFileSync(path.join(box.root, 'server.json'), 'utf8')).version;

  /** Every publish surface's declared version, read the way each one stores it. */
  function surfaceVersions() {
    const rd = (f) => fs.readFileSync(path.join(box.root, f), 'utf8');
    const bundle = readZipEntries(fs.readFileSync(path.join(box.root, 'dchub.dxt')));
    return {
      'server.json': JSON.parse(rd('server.json')).version,
      'server.mjs (SERVER_VERSION)': (rd('server.mjs').match(/const SERVER_VERSION = \{ version: '(\d+\.\d+\.\d+)'/) || [])[1],
      'package.json': JSON.parse(rd('package.json')).version,
      'mcp-server.json': JSON.parse(rd('mcp-server.json')).version,
      'dxt/manifest.json': JSON.parse(rd('dxt/manifest.json')).version,
      'smithery.yaml': (rd('smithery.yaml').match(/^version:[ \t]*"([^"]+)"/m) || [])[1],
      'integrations/copilot/dchub-mcp.yaml': (rd('integrations/copilot/dchub-mcp.yaml').match(/^version:[ \t]*"([^"]+)"/m) || [])[1],
      'dchub.dxt (embedded manifest)': JSON.parse(bundle.get('manifest.json').toString('utf8')).version,
    };
  }

  beforeAll(() => {
    box = createRepoSandbox(REPO, 'version-fence-e2e');
    // Read-only on the shared tree; every WRITE below is box.write().
    const g = (...a) => execFileSync('git', a, {
      cwd: box.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'g@example.com');
    g('config', 'user.name', 'fence');
    g('add', '-A'); g('commit', '-q', '-m', 'sandbox baseline');
    // Two published versions, so the fence has a real history to walk. Each is
    // synced first, so the sandbox starts CONSISTENT and any later red is the
    // fence's, not leftover drift.
    for (const v of ['9.9.8', '9.9.9']) {
      const sj = JSON.parse(fs.readFileSync(path.join(box.root, 'server.json'), 'utf8'));
      sj.version = v;
      box.write(path.join(box.root, 'server.json'), JSON.stringify(sj, null, 2) + '\n');
      expect(sync('--fix').code).toBe(0);
      g('add', '-A'); g('commit', '-q', '-m', `publish ${v}`);
    }
  }, 120_000);

  afterAll(() => box?.cleanup());

  it('starts from a tree the fence judges (not one it declines to judge)', () => {
    const r = sync();
    expect(r.code).toBe(0);
    // Non-vacuity: if this said "did not run", every control below would pass
    // on a fence that was switched off.
    expect(r.out).toMatch(/\[server\.json version fence\] server\.json unchanged since version 9\.9\.9 was set in [0-9a-f]{7}/);
    expect(sjVersion()).toBe('9.9.9');
  });

  it('leaves an UNCHANGED tree alone — an unchanged manifest must burn no version', () => {
    const r = sync('--fix');
    expect(r.code).toBe(0);
    expect(sjVersion()).toBe('9.9.9');
    // --fix must report the fence too. A bump is loud by nature; a fence that
    // quietly declined to judge is the failure that hides, and --fix is the mode
    // a human actually watches.
    expect(r.out).toMatch(/\[server\.json version fence\] server\.json unchanged since version 9\.9\.9/);
  });

  it('CHECK mode goes RED on the 2026-09-07 shape: a new tool, no bump', () => {
    // The occurrence, reproduced: server.mjs gains a registration, so
    // _meta.toolCount moves and the version does not. This is the moment the
    // Python backstop cannot see — nothing is committed yet.
    const src = path.join(box.root, 'server.mjs');
    box.write(src, fs.readFileSync(src, 'utf8')
      + "\nfunction __probeRegistration(srv) { trackedTool(srv, 'zzz_probe_tool', 'A throwaway probe registration.'); }\n");

    const r = sync();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/server\.json CONTENT changed since version 9\.9\.9 was set/);
    expect(r.out).toMatch(/bumps to 9\.9\.10/);
    // The backstop, on the same tree, is silent — that gap IS the defect.
    expect(backstopSaysDrift(box.root)).toBe(false);
  });

  it('--fix bumps the patch and carries it to ALL EIGHT publish surfaces', () => {
    const r = sync('--fix');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/version bumped to 9\.9\.10/);
    const seen = surfaceVersions();
    expect(Object.keys(seen)).toHaveLength(8);          // the count is the claim
    for (const [surface, v] of Object.entries(seen)) {
      expect(v, `${surface} did not follow the bump — this is the 2.12.1 shape`).toBe('9.9.10');
    }
  });

  it('repacked the shipped bundle, not just the manifest beside it', () => {
    const bundle = readZipEntries(fs.readFileSync(path.join(box.root, 'dchub.dxt')));
    const embedded = bundle.get('manifest.json').toString('utf8');
    expect(embedded).toBe(fs.readFileSync(path.join(box.root, 'dxt/manifest.json'), 'utf8'));
    expect(embedded).toMatch(/89 tools/);               // the new count reached the file a user installs
  });

  it('is idempotent — running --fix again does not walk the version forward', () => {
    expect(sync('--fix').code).toBe(0);
    expect(sjVersion()).toBe('9.9.10');
    expect(sync('--fix').code).toBe(0);
    expect(sjVersion()).toBe('9.9.10');
    expect(sync().code).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The daily lane's publish-only bump must not burn a number the repo now owns.
// --fix commits bumps; registry-autopublish.mjs used to publish max(repo,
// registry)+1 unconditionally, so it would jump one past the committed version
// and the repo would collide with it on a later change. That collision reads
// exactly like a1df751/#370, "85 tools cannot publish under a version already
// taken" — the stall, re-created by the helper meant to prevent it.
// ─────────────────────────────────────────────────────────────────────────────
describe('registry-autopublish does not burn the repo version', () => {
  it('publishes the repo version AS IS when it is already above the registry', () => {
    const c = choosePublishVersion('2.12.10', ['2.12.7', '2.12.8', '2.12.9']);
    expect(c.version).toBe('2.12.10');
    expect(c.write).toBe(false);          // nothing written ⇒ nothing to revert
  });

  it('still patch-bumps past the registry when the repo version is already taken', () => {
    // The 2026-09-07 registry state exactly: 2.12.7=83 tools, 2.12.8=85, 2.12.9=88.
    const c = choosePublishVersion('2.12.9', ['2.12.7', '2.12.8', '2.12.9']);
    expect(c.version).toBe('2.12.10');
    expect(c.write).toBe(true);           // publish-only; the caller reverts it
  });

  it('still patch-bumps past a registry that is AHEAD of the repo', () => {
    const c = choosePublishVersion('2.12.9', ['2.12.7', '2.13.4']);
    expect(c.version).toBe('2.13.5');
    expect(c.write).toBe(true);
  });

  it('treats an unreadable registry as "assume taken", never as "nothing published"', () => {
    // [] means the fetch failed. Publishing the repo version as-is here would
    // hand the registry a duplicate on the one path where we cannot check.
    const c = choosePublishVersion('2.12.9', []);
    expect(c.version).toBe('2.12.10');
    expect(c.write).toBe(true);
  });

  // ── and the WIRING, end to end: the real script, a real server.json, a real
  // exit. Pointed at a dead port so the unreadable-registry branch runs in
  // milliseconds with no egress — the branch that WRITES, so a broken write is
  // caught here rather than on the next daily publish.
  it('the script writes the bump it prints, and prints what it wrote', () => {
    const box = createScratchRepo('autopub', { git: false });
    try {
      box.write('server.json',
        JSON.stringify({ name: 'cloud.dchub/datacenter-power-grid-fiber', version: '2.12.9' }, null, 2) + '\n');
      const printed = execFileSync('node', [path.join(REPO, 'scripts/registry-autopublish.mjs')], {
        cwd: box.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MCP_REGISTRY_SEARCH_URL: DEAD_PORT },
      }).trim();
      expect(printed).toBe('2.12.10');
      expect(JSON.parse(fs.readFileSync(path.join(box.root, 'server.json'), 'utf8')).version).toBe('2.12.10');
    } finally {
      box.cleanup();
    }
  });

  it('importing the module publishes nothing (the main guard holds)', () => {
    // choosePublishVersion is imported at the top of THIS file. Without the
    // main guard that import would run the publisher against whatever cwd the
    // test runner happens to be in — this repo's own server.json.
    const box = createScratchRepo('autopub-import', { git: false });
    try {
      const before = JSON.stringify({ name: 'x', version: '2.12.9' }, null, 2) + '\n';
      box.write('server.json', before);
      const url = pathToFileURL(path.join(REPO, 'scripts/registry-autopublish.mjs')).href;
      execFileSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`], {
        cwd: box.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MCP_REGISTRY_SEARCH_URL: DEAD_PORT },
      });
      expect(fs.readFileSync(path.join(box.root, 'server.json'), 'utf8')).toBe(before);
      expect(typeof choosePublishVersion).toBe('function');
    } finally {
      box.cleanup();
    }
  });
});
