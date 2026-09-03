// Guard: the rank-defense shell's STAGE 3, exercised for real.
//
// WHY THIS EXISTS (2026-09-03). Stage 3 shipped three defects at once, and every
// one of them is invisible to a test that only reads the source:
//
//   1. It staged a paste file and told the owner "open, select-all, paste" on
//      EVERY CORE slip. The live Smithery window already carried every monitored
//      term the repo did, so the paste was a no-op — asked of a human every 90
//      minutes for weeks.
//   2. The write failed SILENTLY 516 times between 2026-07-12 and 2026-09-03.
//      macOS TCC denies a launchd agent ~/Downloads, and the old form
//      `{ ... } > "$STAGED" 2>/dev/null && log "REMEDY staged"` short-circuits on
//      a failed redirect: no "staged" line, and no warning either.
//   3. Because of (2) the file froze at a pre-#301 copy — "82 live MCP tools",
//      "20,100+ data centers", and a TITLE from scripts/smithery_title.txt, a
//      second source of truth that had gone stale. Following the instruction
//      would have REVERTED the listing and dropped "Power" and "Energy" from the
//      displayName, two terms we hold #1 on.
//
// So this runs the actual script against a synthetic repo. It asserts BEHAVIOUR:
// what gets written, what does not, and what the log says when it cannot write.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHELL = join(process.cwd(), 'scripts/rank_defense_master_shell.sh');

// Assertions below are about CODE, not prose. The script carries a history note
// naming the removed file and the removed pattern on purpose — that note is how the
// next person learns why they are gone. Strip comment lines so the guard fails on a
// reintroduced BEHAVIOUR and not on a sentence describing it.
const codeOnly = (src) => src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
let repo, stage, logFile;

function writeStatus(fields) {
  writeFileSync(join(repo, 'state/rank_status.json'), JSON.stringify({
    core_one: 9, core_total: 11, remediate: ['fiber'], escalated: [],
    regression: true, paste_pending_terms: [], ...fields,
  }));
}

function run(env = {}) {
  execFileSync('bash', [SHELL], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RANK_DEFENSE_REPO: repo,
      RANK_DEFENSE_LOG: logFile,
      DCHUB_STAGE_DIR: stage,
      RANK_AUTOHEAL_DISABLE: '1',   // never fire the auto-PR from a test
      HOME: repo,                   // keep the ~/Downloads copy inside the sandbox
      ...env,
    },
  });
  return readFileSync(logFile, 'utf8');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'rankdef-'));
  stage = join(repo, 'stage');
  logFile = join(repo, 'run.log');
  mkdirSync(join(repo, 'state'), { recursive: true });
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'Downloads'), { recursive: true });
  // stage 1 must not reach the network
  writeFileSync(join(repo, 'scripts/registry_monitor.py'), 'import sys; sys.exit(0)\n');
  writeFileSync(join(repo, 'scripts/smithery_description.txt'), 'CANON DESCRIPTION BODY\n');
  writeFileSync(join(repo, 'smithery.yaml'),
    'name: dchub\ndisplayName: "DC Hub — Power, Energy & Data Center Intelligence"\n');
  writeFileSync(logFile, '');
});
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch {} });

const staged = () => join(stage, 'smithery-description-CURRENT.txt');

describe('stage 3 does not ask for a paste that would change nothing', () => {
  it('paste_pending=false: stages NO file and says why', () => {
    writeStatus({ paste_pending: 'false' });
    const log = run();
    expect(existsSync(staged()),
      'a paste file was staged even though the live window already carries every '
      + 'monitored term — this is the every-90-minutes no-op ask').toBe(false);
    expect(log).toMatch(/NO PASTE PENDING/);
  });

  it('paste_pending=false still reports the slip (it is a relevance loss, not "fine")', () => {
    writeStatus({ paste_pending: 'false' });
    expect(run()).toMatch(/SLIP — CORE/);
  });

  it('paste_pending=true: stages the file', () => {
    writeStatus({ paste_pending: 'true', paste_pending_terms: ['fiber'] });
    run();
    expect(existsSync(staged())).toBe(true);
    expect(readFileSync(staged(), 'utf8')).toContain('CANON DESCRIPTION BODY');
  });

  it('paste_pending=unknown stages ANYWAY — an unmade paste is silent', () => {
    // The three-state field exists for exactly this: unknown must not read as false.
    writeStatus({ paste_pending: 'unknown' });
    const log = run();
    expect(existsSync(staged())).toBe(true);
    expect(log).toMatch(/UNKNOWN/);
  });

  it('a MISSING paste_pending key stages anyway (fail-safe, not fail-silent)', () => {
    // read_status prints "" for an absent key. "" must not equal "false".
    writeStatus({});
    expect(existsSync(staged()) || run().includes('REMEDY')).toBe(true);
  });
});

describe('stage 3 takes its title from the file that matches the live listing', () => {
  it('uses smithery.yaml displayName, keeping the terms we hold #1 on', () => {
    writeStatus({ paste_pending: 'true' });
    run();
    const body = readFileSync(staged(), 'utf8');
    expect(body).toContain('DC Hub — Power, Energy & Data Center Intelligence');
    for (const term of ['Power', 'Energy', 'Data Center']) expect(body).toContain(term);
  });

  it('the second source of truth is gone and unreferenced', () => {
    // scripts/smithery_title.txt was read ONLY by this block, went stale, and would
    // have dropped Power + Energy from the displayName.
    expect(existsSync(join(process.cwd(), 'scripts/smithery_title.txt')),
      'scripts/smithery_title.txt is back — it is a duplicate of smithery.yaml '
      + 'displayName and drifted last time').toBe(false);
    expect(codeOnly(readFileSync(SHELL, 'utf8'))).not.toContain('smithery_title.txt');
  });
});

describe('a staging write that fails is LOUD', () => {
  it('reports failure instead of short-circuiting into silence', () => {
    writeStatus({ paste_pending: 'true' });
    mkdirSync(stage, { recursive: true });
    chmodSync(stage, 0o500);            // readable + executable, NOT writable
    let log;
    try { log = run(); } finally { chmodSync(stage, 0o700); }
    expect(existsSync(staged())).toBe(false);
    expect(log, 'the write failed and the log said nothing — the 516-failure bug')
      .toMatch(/REMEDY NOT STAGED/);
  });

  it('the silent-failure form is not reintroduced', () => {
    // The exact shape of the bug: a redirect whose failure is swallowed by &&.
    expect(codeOnly(readFileSync(SHELL, 'utf8')))
      .not.toMatch(/>\s*"\$STAGED"\s*2>\/dev\/null\s*\\?\s*\n?\s*&&/);
  });
});

// ★ The producer side of the same contract. `paste_pending` is THREE-state and is
// serialised as a STRING on purpose: the shell reads it with a helper that prints ""
// for a missing key, and "" is falsy there — so an unknown serialised as null or
// false would read as "no paste needed", which is precisely the state this whole
// change exists to stop being invisible.
describe('the paste_pending contract, produced', () => {
  const py = (body) => execFileSync('python3', ['-c',
    'import importlib.util, json, os, tempfile\n'
    + "spec=importlib.util.spec_from_file_location('rm','scripts/registry_monitor.py')\n"
    + 'm=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n'
    + body], { encoding: 'utf8' }).trim();

  it('an unreadable live blurb is UNKNOWN, never "nothing pending"', () => {
    expect(py('m._BLURB_MEMO.append(None)\nprint(m.smithery_paste_pending())'))
      .toBe('(None, [])');
  });

  it('a term the repo carries and live lacks is PENDING, and is named', () => {
    // CORE[0] is whatever the monitor currently defends first; build a blurb that
    // omits it while the repo file (read from disk) contains it.
    const out = py(
      'core0 = m.CORE[0]\n'
      + "repo = open('scripts/smithery_description.txt', encoding='utf-8').read().lower()\n"
      + "assert core0.lower() in repo, 'fixture assumes CORE[0] is in the canon text'\n"
      + "m._BLURB_MEMO.append('a blurb that mentions nothing in particular')\n"
      + 'p, t = m.smithery_paste_pending()\n'
      + 'print(p, core0 in t)');
    expect(out).toBe('True True');
  });

  it('a live blurb carrying everything is NOT pending', () => {
    const out = py(
      "repo = open('scripts/smithery_description.txt', encoding='utf-8').read()\n"
      + 'm._BLURB_MEMO.append(repo + " " + " ".join(m.CORE + m.RECLAIM))\n'
      + 'print(m.smithery_paste_pending())');
    expect(out).toBe('(False, [])');
  });

  it('serialises as a STRING the shell can distinguish, never a bool or null', () => {
    const out = py(
      'import json, os, tempfile\n'
      + 'd = tempfile.mkdtemp(); os.chdir(d)\n'
      + 'for val in (None, True, False):\n'
      + '    m.smithery_paste_pending = (lambda v: (lambda: (v, [])))(val)\n'
      + "    m._write_status(9, ['fiber'], [], True)\n"
      + "    got = json.load(open('state/rank_status.json'))['paste_pending']\n"
      + '    print(repr(got), end=" ")');
    expect(out).toBe(`'unknown' 'true' 'false'`);
  });
});
