// ★2026-09-15 — THE WATCHED REGISTRY NAME MUST BE DERIVED, NOT TYPED.
//
// #338 renamed the official listing to cloud.dchub/datacenter-power-grid-fiber.
// #390 reverted it. A rename does not move a listing — it creates a new server
// and orphans the old one — so the namespace now holds two names, and exactly
// one of them is published to. Every consumer that TYPED the name kept pointing
// at the orphan after the revert:
//
//   scripts/registry_monitor.py    read 2.12.9 / None off a deprecated listing
//                                  and alarmed that it "≠ repo canonical" — a
//                                  standing FALSE drift alarm (monitor_report.md)
//   scripts/registry-autopublish.mjs  compared the repo against a version list
//                                  frozen at 2.12.9, so its publish-only +1 —
//                                  the branch that avoids a duplicate-version
//                                  400 — became unreachable code
//
// scripts/ecosystem-sync.mjs was never wrong, and the only thing it does
// differently is read serverJson.name. That is the rule this file pins.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SERVER_JSON = JSON.parse(readFileSync('server.json', 'utf8'));

/** Strip comments so the assertion reads CODE, not the rationale above it.
 *  Every file here explains the orphan by NAME, and a raw substring scan would
 *  match that prose and fail on a correct file — the same trap as a guard whose
 *  anchor is satisfied by its own comment, pointed the other way. */
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripPy = (s) => s.replace(/^\s*#.*$/gm, '');

// The ORPHANED name. No consumer may point at it in code, ever again.
const ORPHAN = 'cloud.dchub/datacenter-power-grid-fiber';

const SOURCES = [
  ['scripts/registry-autopublish.mjs', stripJs],
  ['scripts/registry_monitor.py', stripPy],
];

describe('the official-registry name has ONE source: server.json', () => {
  for (const [file, strip] of SOURCES) {
    it(`${file} does not point at the orphaned listing`, () => {
      const code = strip(readFileSync(file, 'utf8'));
      // FLOOR: a stripper that ate the file would pass this vacuously.
      expect(code.length, `${file} stripped to nothing — the scan has no subject`)
        .toBeGreaterThan(2000);
      expect(code, `${file} still names the deprecated ${ORPHAN}`).not.toContain(ORPHAN);
    });
  }

  it('registry-autopublish types no listing name at all', () => {
    // Unlike the monitor, this file has no connector-slug list, so ANY
    // cloud.dchub/* literal in its code is a name that should have been read
    // from server.json.
    const code = stripJs(readFileSync('scripts/registry-autopublish.mjs', 'utf8'));
    expect(code).not.toMatch(/cloud\.dchub\/[a-z0-9-]+/);
  });

  it('REGISTRY_NAME is never assigned a string literal', () => {
    // The monitor DOES legitimately type connector-directory slugs — those
    // listings are not discoverable and must be named. This narrows the rule to
    // the one name that is discoverable: the one server.json publishes under.
    const code = stripPy(readFileSync('scripts/registry_monitor.py', 'utf8'));
    expect(code).toMatch(/^REGISTRY_NAME = _registry_name\(\)$/m);
    expect(code).not.toMatch(/^REGISTRY_NAME\s*=\s*["']/m);
  });

  it('registry-autopublish derives the live name from server.json', async () => {
    const mod = await import(`${process.cwd()}/scripts/registry-autopublish.mjs`);
    // publishedName is module-private on purpose; assert through the file's own
    // behaviour instead — the name it filters on must be server.json's.
    const src = readFileSync('scripts/registry-autopublish.mjs', 'utf8');
    expect(src).toMatch(/JSON\.parse\(fs\.readFileSync\('server\.json', 'utf8'\)\)\.name/);
    expect(src).toMatch(/x\.server\.name === name/);
    expect(typeof mod.choosePublishVersion).toBe('function');
  });

  it('registry_monitor derives REGISTRY_NAME from server.json', () => {
    const out = execFileSync('python3', ['-c',
      "import importlib.util\n"
      + "spec=importlib.util.spec_from_file_location('rm','scripts/registry_monitor.py')\n"
      + "rm=importlib.util.module_from_spec(spec); spec.loader.exec_module(rm)\n"
      + "print(rm.REGISTRY_NAME)\n"], { encoding: 'utf8' }).trim();
    expect(out).toBe(SERVER_JSON.name);
  });
});

// ── official_registry(): the three verdicts, none of them "clean by default" ──
const drive = (fixture) => {
  const out = execFileSync('python3', ['-c',
    "import importlib.util, json, sys\n"
    + "spec=importlib.util.spec_from_file_location('rm','scripts/registry_monitor.py')\n"
    + "rm=importlib.util.module_from_spec(spec); spec.loader.exec_module(rm)\n"
    + "rm._get = lambda *a, **k: json.loads(sys.argv[1])\n"
    + "v,t,n = rm.official_registry()\n"
    + "print(json.dumps({'version': v, 'tools': t, 'notes': n}))\n",
    JSON.stringify(fixture)], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
};

const entry = (name, version, isLatest, status, toolCount) => ({
  server: {
    name, version,
    _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { toolCount } },
  },
  _meta: { 'io.modelcontextprotocol.registry/official': { isLatest, status } },
});

describe('official_registry reads the live entry, and says so honestly', () => {
  it('reads toolCount off the SERVER object, not the wrapper', () => {
    // Reading it off the wrapper returned None every time, which made the
    // toolCount parity gate dead code. A fixture that carries the real nesting
    // is the only thing that tells the two apart.
    const r = drive({ servers: [
      entry(SERVER_JSON.name, '2.12.17', true, 'active', 91),
      entry('cloud.dchub/datacenter-power-grid-fiber', '2.12.9', true, 'deprecated', 88),
    ] });
    expect(r).toMatchObject({ version: '2.12.17', tools: 91, notes: [] });
  });

  it('a deprecated orphan beside us is a note, not a regression', () => {
    const r = drive({ servers: [
      entry(SERVER_JSON.name, '2.12.17', true, 'active', 91),
      entry('cloud.dchub/datacenter-power-grid-fiber', '2.12.9', true, 'deprecated', 88),
    ] });
    expect(r.notes).toEqual([]);
  });

  it('OUR entry not being active IS a regression', () => {
    const r = drive({ servers: [entry(SERVER_JSON.name, '2.12.17', true, 'deprecated', 91)] });
    expect(r.notes.join(' ')).toMatch(/is \*\*deprecated\*\*, not active/);
  });

  it('a SECOND active name is a regression — two canonical entries', () => {
    const r = drive({ servers: [
      entry(SERVER_JSON.name, '2.12.17', true, 'active', 91),
      entry('cloud.dchub/datacenter-power-grid-fiber', '2.12.9', true, 'active', 88),
    ] });
    expect(r.notes.join(' ')).toMatch(/SECOND ACTIVE name/);
  });

  it('our name missing from the response is UNCHECKED, never clean', () => {
    const r = drive({ servers: [entry('io.github.someone/other', '9.9.9', true, 'active', 5)] });
    expect(r.version).toBeNull();
    expect(r.notes.join(' ')).toMatch(/UNCHECKED, not clean/);
  });
});
