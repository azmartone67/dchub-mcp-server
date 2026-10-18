#!/usr/bin/env node
/**
 * prepush-gate.mjs - run on the laptop what CI would run for this diff.
 *
 * WHY. 2026-10-18: PRs here found out in CI (a round trip each) about failures a local
 * run shows in seconds. Stages, FAIL only on a definite failure; "could not run"
 * (vitest not installed, timeout) is a loud WARN and the push goes through, because a
 * gate that misfires and blocks every push is worse than one that sometimes misses:
 *   1. syntax    node --check on each changed .mjs/.js file
 *   2. tests     the test/hard-gate.txt files that are in the diff or name a changed file,
 *                run with CI's no-network preload (max 25; CI runs the rest)
 *
 * Usage: node scripts/prepush-gate.mjs [--list] [--base origin/main] [--self-test]
 * Bypass: DCHUB_PUSH_FORCE=1 or DCHUB_PREPUSH_GATE=0. Install: scripts/install-prepush-gate.sh
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TESTS_TIMEOUT_MS = 240_000;

export const isJs = (f) => /\.(mjs|js|cjs)$/.test(f);
export const isCode = (f) => isJs(f) && !f.startsWith('node_modules/');

function git(...a) { return execFileSync('git', a, { encoding: 'utf8' }).trim(); }

function stageSyntax(files) {
  const bad = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}\n${(r.stderr || '').split('\n').slice(0, 4).join('\n')}`);
  }
  return bad.length ? { status: 'FAIL', detail: bad.join('\n') } : { status: 'PASS', detail: '' };
}

const MAX_TEST_FILES = 25;

/** Hard-gate files (test/hard-gate.txt: what CI runs, nothing else) related to the diff. */
export function selectTests(gateList, changed, readText) {
  const gate = gateList.split('\n').map((l) => l.trim()).filter(Boolean);
  const inDiff = gate.filter((t) => changed.includes(t));
  const named = gate.filter((t) => {
    if (inDiff.includes(t)) return false;
    const text = readText(t);
    return text != null && changed.some((f) => isCode(f) && (text.includes(f) || (f.length > 8 && text.includes(f.split('/').pop()))));
  });
  return { picked: [...inDiff, ...named].slice(0, MAX_TEST_FILES), over: Math.max(0, inDiff.length + named.length - MAX_TEST_FILES) };
}

function stageTests(files) {
  // ★ Only files listed in test/hard-gate.txt: that is what CI runs (`npm test` is invoked by no
  // workflow), and `vitest related` would sweep in live-prod suites that fail offline.
  if (!existsSync('node_modules/.bin/vitest')) return { status: 'WARN', detail: 'vitest not installed (npm ci); CI will run the tests' };
  if (!existsSync('test/hard-gate.txt')) return { status: 'WARN', detail: 'test/hard-gate.txt not found' };
  const { picked, over } = selectTests(readFileSync('test/hard-gate.txt', 'utf8'), files, (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null));
  if (!picked.length) return { status: 'SKIP', detail: 'no hard-gate test names a changed file' };
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + ' ' : ''}--require ${process.cwd()}/test/helpers/no-network-preload.cjs` };
  const r = spawnSync('node_modules/.bin/vitest', ['run', ...picked], { encoding: 'utf8', timeout: TESTS_TIMEOUT_MS, env });
  const out = `${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(-25).join('\n');
  const note = `${picked.length} hard-gate file(s)${over ? `, +${over} not run locally` : ''}`;
  if (r.error && r.error.code === 'ETIMEDOUT') return { status: 'WARN', detail: `timed out (${note})` };
  if (r.status === 0) return { status: 'PASS', detail: note };
  return { status: 'FAIL', detail: `${note}\n${out}` };
}

function selfTest() {
  const ok = (c, m) => { if (!c) { console.error('SELF-TEST FAIL:', m); process.exit(1); } };
  ok(isCode('lib/a.mjs') && isCode('server.js') && !isCode('README.md') && !isCode('node_modules/x/y.js'), 'isCode');
  ok(stageSyntax(['/definitely/not/here.mjs']).status === 'PASS', 'a deleted file is skipped');
  const rd = (p) => ({ 'test/a.test.mjs': "import '../lib/siting.mjs'", 'test/b.test.mjs': 'x' })[p] ?? null;
  const sel = selectTests('test/a.test.mjs\ntest/b.test.mjs\n\n', ['lib/siting.mjs'], rd);
  ok(sel.picked.length === 1 && sel.picked[0] === 'test/a.test.mjs', 'selects only the gate file naming the change');
  ok(selectTests('test/b.test.mjs', ['test/b.test.mjs'], rd).picked[0] === 'test/b.test.mjs', 'a changed gate test selects itself');
  ok(selectTests('test/a.test.mjs', ['README.md'], rd).picked.length === 0, 'unrelated change selects nothing');
  console.log('self-test ok');
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
  if (process.env.DCHUB_PUSH_FORCE === '1' || process.env.DCHUB_PREPUSH_GATE === '0') { console.log('pre-push gate: bypassed by env.'); return 0; }
  const bi = argv.indexOf('--base');
  const base = bi >= 0 ? argv[bi + 1] : 'origin/main';
  let changed;
  try {
    const mb = git('merge-base', base, 'HEAD');
    changed = git('diff', '--name-only', '--diff-filter=ACMR', `${mb}..HEAD`).split('\n').filter(Boolean);
  } catch (e) { console.error(`pre-push gate: WARN - cannot compute the diff (${e.message.split('\n')[0]}); allowing the push.`); return 0; }
  const code = changed.filter(isCode);
  console.log(`pre-push gate: ${changed.length} file(s) changed vs ${base}; ${code.length} JS file(s).`);
  if (!code.length) return 0;
  if (argv.includes('--list')) { code.forEach((f) => console.log(`  ${f}`)); return 0; }
  let failed = 0;
  for (const [name, fn] of [['syntax', () => stageSyntax(code)], ['tests', () => stageTests(code)]]) {
    const r = fn();
    console.log(`  [${r.status}] ${name}`);
    if (r.detail) console.log(r.detail.split('\n').map((l) => `      ${l}`).join('\n'));
    if (r.status === 'FAIL') failed++;
  }
  if (failed) { console.error('\npre-push gate: BLOCKED. Fix it, or push anyway with DCHUB_PUSH_FORCE=1 git push (CI still runs these).'); return 1; }
  console.log('pre-push gate: ok to push.');
  return 0;
}

if (fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exit(main(process.argv.slice(2)) || 0);
