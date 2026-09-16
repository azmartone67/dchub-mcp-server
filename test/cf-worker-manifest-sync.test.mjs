// =============================================================================
// scripts/sync_cf_worker_manifest.py — the CF zone worker's manifest push
// -----------------------------------------------------------------------------
// The worker that serves /.well-known/mcp.json and /mcp/manifest lives OUTSIDE
// this repo and hardcodes its tool array. This script is the only push: it pulls
// the live tools/list, rebuilds MCP_FALLBACK_TOOLS, and hands back the whole
// worker to paste into the CF editor. Nothing else regenerates it, and nothing
// in CI can see the result — the only review it gets is this file.
//
// Three defects, all found running it against the REAL worker (402KB, 91 tools):
//
// 1. THE SCANNER WAS STRING-AWARE BUT NOT COMMENT-AWARE. MCP_FALLBACK_TOOLS is
//    wrapped in `//` comments containing apostrophes ("this array's length",
//    "that branch's"). The apostrophe flipped the scanner into string mode, the
//    closing `]` was never seen, and the script died with "unbalanced array for
//    MCP_FALLBACK_TOOLS" — it could not run at all.
//
// 2. THE COUNT REWRITE EDITED HISTORY. A blanket s/\d{2,3} tools/NN tools/ over
//    the whole file rewrote the worker's own changelog: " * v4.4.2:
//    /.well-known/mcp.json returns all 72 tools." became "all 91 tools", and
//    "description '70 tools' → '72 tools'" collapsed into "'91 tools' → '91
//    tools'". Measured on the real worker at n=91: 20 lines changed, every one
//    of them a comment, and ZERO served strings. A changelog that rewrites
//    itself is worse than a stale one — it destroys the record of when each
//    count actually moved.
//
// 3. IT REPORTED A VERSION UPDATE IT DID NOT MAKE. The summary said "updated
//    count + version tokens" while WORKER_VERSION sat untouched. x-dc-worker-version
//    is the ONLY way to tell whether a paste reached production, so a silent
//    no-op there means a deploy nobody can verify — announced as done.
//
// ★ THE FIXTURE CARRIES THE HAZARDS ON PURPOSE, and the first test asserts that
// it still does. A fixture that loses its apostrophe-in-a-comment still passes
// every assertion below while proving nothing, which is the same silent green
// the script itself shipped.
//
// ★ NO NETWORK. The helper stubs exactly one function — `_fetch_live_tools`,
// whose body is a urllib POST — and runs the real main() for everything else.
// =============================================================================
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'scripts', 'sync_cf_worker_manifest.py');
const RUNNER = path.join(REPO, 'test', 'helpers', 'run_cf_manifest_sync.py');

// ── the fixture: a miniature worker carrying every hazard the real one has ────
// Escaped for the template literal: \` is a backtick in the fixture, \${ is a
// real ${ interpolation. The integrity test below proves both survived.
const CHANGELOG_LINES = [
  ' *          NAMES from the schema already fetched (342 across 83 tools, ~4.5KB)',
  ' * v4.9.30 CHANGES (Jul 11 2026) — Phase manifest-72-sync:',
  " *   - FIX: MCP_SERVER_INFO description '70 tools' → '72 tools'",
  ' * v4.4.2: /.well-known/mcp.json returns all 72 tools.',
  '// different category, advertising "33 tools" beside the real card\'s 83.',
];

const WORKER = `/**
${CHANGELOG_LINES[0]}
${CHANGELOG_LINES[1]}
${CHANGELOG_LINES[2]}
${CHANGELOG_LINES[3]}
 */
const WORKER_VERSION = '4.9.68-capacity-terms';

// v4.9.33 (2026-07-25): canon sync — 80 tools / 12,650+ floor. All endpoints
${CHANGELOG_LINES[4]}
const MCP_SERVER_INFO = {
  name:        'DC Hub',
  description: 'Real-time data center intelligence for AI agents — 83 tools over the global facility base.',
};

const MCP_LANDING_HTML_V1 = \`<!DOCTYPE html>
<h1>DC Hub</h1><p class="n">83 tools, live.</p>
<p>\${MCP_SERVER_INFO.name /* interpolated code: it isn't a string */}</p>\`;

// ★ Keep this array's length in step with the count above, or delete it — that
//   branch's fallback is what registries read when the origin is down.
/* A block comment immediately above the array, because a scanner that tracks
   only strings walks straight through one: 72 tools, [ and ] included. */
const MCP_FALLBACK_TOOLS = [
  { name: "find_sites", description: "Rank sites by headroom [MW] — don't guess at it." },
  // an element's own comment, with an apostrophe and a stray ] to boot
  { name: "get_news", description: "News for a market" }
];

const SERVED_NOTE = 'full server is \`url\` above (streamable-http, 83 tools).';
const QUOTELESS = String(MCP_FALLBACK_TOOLS.length).replace(/"/g, '');
`;

/** Run a python expression against the module, with the fixture in `src`. */
function py(expr, src = WORKER) {
  const code = [
    'import importlib.util, json, sys',
    `spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(SCRIPT)})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'src = sys.stdin.read()',
    `print(json.dumps(${expr}))`,
  ].join('\n');
  const r = spawnSync('python3', ['-c', code], { input: src, encoding: 'utf8', cwd: REPO });
  expect(r.error, `could not run python3: ${r.error?.message}`).toBeFalsy();
  expect(r.status, `python3 failed:\n${r.stderr}`).toBe(0);
  return JSON.parse(r.stdout);
}

/** Run the real main() over the fixture with `n` synthetic tools. */
function sync(n, args = [], src = WORKER) {
  const r = spawnSync('python3', [RUNNER, String(n), ...args], {
    input: src, encoding: 'utf8', cwd: REPO, maxBuffer: 64 * 1024 * 1024,
  });
  expect(r.error, `could not run python3: ${r.error?.message}`).toBeFalsy();
  expect(r.status, `the runner itself crashed:\n${r.stderr}`).toBe(0);
  return JSON.parse(r.stdout);
}

/** The worker with the MCP_FALLBACK_TOOLS block cut out — the array is rebuilt
 *  every run by design, so everything OUTSIDE it is what must hold still. */
function outsideArray(src) {
  const i = src.indexOf('const MCP_FALLBACK_TOOLS = [');
  const j = src.indexOf('\n];', i);
  expect(i, 'fixture/output lost its MCP_FALLBACK_TOOLS block').toBeGreaterThan(-1);
  expect(j, 'fixture/output lost the array terminator').toBeGreaterThan(i);
  return src.slice(0, i) + src.slice(j + 3);
}

// =============================================================================
describe('the fixture still carries the hazards it exists for', () => {
  it('has a // comment with an apostrophe, a /* */ block, and a [ inside a string', () => {
    expect(WORKER, "no // comment with an apostrophe — bug 1's trigger is gone")
      .toMatch(/^\/\/.*\barray's\b/m);
    expect(WORKER, 'no /* */ block comment around the array').toMatch(/\/\* A block comment/);
    expect(WORKER, 'no [ inside a description string').toMatch(/description: "[^"\n]*\[/);
    // a real backtick template with a real ${…} interpolation, not the escapes
    expect(WORKER).toMatch(/const MCP_LANDING_HTML_V1 = `/);
    expect(WORKER).toMatch(/\$\{MCP_SERVER_INFO\.name/);
    // a regex literal whose body is a quote: worker.js has .replace(/"/g, …) ×3
    expect(WORKER).toContain('.replace(/"/g');
    for (const line of CHANGELOG_LINES) {
      expect(WORKER, `changelog line missing from the fixture: ${line}`).toContain(line);
    }
  });
});

// ── BUG 1 ────────────────────────────────────────────────────────────────────
describe('the array scan is comment-aware', () => {
  it('finds the real span past // comments, /* */ blocks and a [ in a string', () => {
    const [start, end] = py('m._find_array_span(src, "MCP_FALLBACK_TOOLS")');
    const span = WORKER.slice(start, end);
    expect(span.startsWith('MCP_FALLBACK_TOOLS = ['), `span starts at: ${span.slice(0, 40)}`).toBe(true);
    expect(span.endsWith(']'), `span ends with: ${JSON.stringify(span.slice(-40))}`).toBe(true);
    // stopped at neither the ] inside a description nor the one in a comment…
    expect(span, 'the scan stopped early — it lost the last element').toContain('get_news');
    // …and did not run past the array's close into the rest of the worker
    expect(span, 'the scan ran past the array').not.toContain('SERVED_NOTE');
    expect(py('m._count_array_elements(src, src.index("[", '
      + 'm._find_array_span(src, "MCP_FALLBACK_TOOLS")[0]), '
      + 'm._find_array_span(src, "MCP_FALLBACK_TOOLS")[1])')).toBe(2);
  });

  it('classifies the comment counts as comments and the served ones as strings', () => {
    const kinds = py(
      '[[src.count(chr(10), 0, s) + 1, k] for (k, s, e) in m._segments(src) '
      + 'if "83 tools" in src[s:e] or "72 tools" in src[s:e]]');
    const byKind = (k) => kinds.filter((x) => x[1] === k).length;
    expect(byKind('comment'), 'no comment carried a count — the fixture went quiet').toBeGreaterThan(0);
    expect(byKind('string'), 'no served string carried a count').toBeGreaterThan(0);
  });
});

// ── BUG 2 ────────────────────────────────────────────────────────────────────
describe('the count rewrite touches what is served, never what is remembered', () => {
  const r = sync(91);

  it('ran', () => {
    expect(r.exit, `sync failed: ${r.err}`).toBe(0);
    expect(r.out, 'the array was not rebuilt from the injected tool list').toContain('tool_000');
  });

  it('leaves every changelog / comment line byte-identical', () => {
    for (const line of CHANGELOG_LINES) {
      expect(r.out, `a historical line was rewritten — it must stay verbatim:\n  ${line}`)
        .toContain(line);
    }
    expect(r.out, 'the manifest-NN token in the changelog was rewritten')
      .toContain('Phase manifest-72-sync:');
    expect(r.out, 'a // canon-sync note was rewritten').toContain('canon sync — 80 tools');
  });

  it('DOES update the strings the worker serves', () => {
    expect(r.out, 'MCP_SERVER_INFO.description was not synced').toContain('— 91 tools over the global');
    expect(r.out, 'the landing HTML was not synced').toContain('>91 tools, live.<');
    expect(r.out, 'the served note was not synced').toContain('(streamable-http, 91 tools)');
    expect(r.out, 'a stale served count survived').not.toContain('83 tools, live');
  });

  it('changes ONLY those three lines outside the array', () => {
    const before = outsideArray(WORKER).split('\n');
    const after = outsideArray(r.out).split('\n');
    expect(after.length, 'lines were added or removed outside the array').toBe(before.length);
    const moved = before.map((l, i) => [i + 1, l, after[i]]).filter(([, l, a]) => l !== a);
    expect(
      moved.map(([n, l]) => `${n}: ${l}`),
      `these lines outside MCP_FALLBACK_TOOLS changed:\n${moved.map(([n, l, a]) => `  ${n}\n  - ${l}\n  + ${a}`).join('\n')}`,
    ).toHaveLength(3);
    // and each one is a served string, not a comment
    for (const [, l] of moved) expect(l.trimStart().startsWith('//'), `a comment moved: ${l}`).toBe(false);
  });

  it('names the rewritten sites in the summary instead of claiming them wholesale', () => {
    expect(r.err).toMatch(/3 served count string\(s\) at line\(s\) /);
  });
});

// ── BUG 3 ────────────────────────────────────────────────────────────────────
describe('WORKER_VERSION moves only when it is told to', () => {
  it('--version sets it, and the summary reports the move that happened', () => {
    const r = sync(91, ['--version', '4.9.69-capacity-search']);
    expect(r.exit, r.err).toBe(0);
    expect(r.out).toContain("const WORKER_VERSION = '4.9.69-capacity-search';");
    expect(r.out).not.toContain("const WORKER_VERSION = '4.9.68-capacity-terms';");
    expect(r.err).toContain('WORKER_VERSION 4.9.68-capacity-terms -> 4.9.69-capacity-search');
    expect(r.err, 'warned about a version it did in fact change').not.toMatch(/WARNING/);
  });

  it('without --version leaves it untouched AND warns that the paste is unverifiable', () => {
    const r = sync(91);
    expect(r.exit, r.err).toBe(0);
    expect(r.out, 'WORKER_VERSION moved without being asked')
      .toContain("const WORKER_VERSION = '4.9.68-capacity-terms';");
    expect(r.err, 'no WARNING — a silent no-op on the one field that proves a deploy')
      .toMatch(/WARNING: WORKER_VERSION was NOT changed/);
    expect(r.err, 'the warning must say why it matters').toMatch(/x-dc-worker-version/);
    expect(r.err).toMatch(/--version/);
    // and the summary must not claim the update it did not make
    expect(r.err, 'the summary claimed a version update that never happened')
      .not.toMatch(/WORKER_VERSION \S+ -> \S+/);
    expect(r.err).toMatch(/WORKER_VERSION unchanged/);
  });

  it('refuses a --version with no value rather than eating the next argument', () => {
    const r = sync(91, ['--version']);
    expect(r.exit).not.toBe(0);
    expect(r.err).toMatch(/--version needs a value/);
  });
});
