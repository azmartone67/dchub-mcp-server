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
import { execFileSync, spawn } from 'node:child_process';
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

// ★ 2026-09-03 — THE ESCALATION MUST DESCRIBE WHAT THE LOOP WILL ACTUALLY DO.
//
// The shell learned to decline staging when nothing is pending. The monitor's
// escalation did not learn anything, so one live run under launchd printed:
//
//   🚨 ESCALATE: ... FIX: paste the canonical listing ... the local loop also
//      stages it to ~/Downloads/smithery-description-CURRENT.txt
//   NO PASTE PENDING — ... A paste would change nothing; not staging a file.
//
// ...four lines apart, in the same log, from the same run. It also named a path
// macOS TCC had been refusing to let a launchd agent write for 516 consecutive
// attempts, so the advice pointed at a location with no file at it. An escalation
// that prescribes a remedy the same run refuses to prepare teaches the reader to
// stop believing escalations, which is worse than saying nothing.
describe('the escalation says what the loop will actually do', () => {
  const msg = (pending, terms = []) => execFileSync('python3', ['-c',
    'import importlib.util\n'
    + "spec=importlib.util.spec_from_file_location('rm','scripts/registry_monitor.py')\n"
    + 'm=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n'
    + `print(m.escalate_message('fiber', ${pending}, ${JSON.stringify(terms)}))`],
    { encoding: 'utf8' }).trim();

  it('pending=False: does NOT prescribe a paste, and says none is staged', () => {
    const m = msg('False');
    expect(m).not.toMatch(/FIX: paste/);
    expect(m).toMatch(/NOT a copy gap/);
    expect(m).toMatch(/none is staged/);
  });

  it('pending=False: still reports the slip as a real regression', () => {
    // "no paste needed" must never soften into "no problem".
    expect(msg('False')).toMatch(/ESCALATE.*slipped ≥2 checks.*RELEVANCE loss/);
  });

  it('pending=True: prescribes the paste AND names what live is missing', () => {
    const m = msg('True', ['fiber', 'utility']);
    expect(m).toMatch(/FIX: paste/);
    expect(m).toMatch(/Live is missing: fiber, utility/);
  });

  it('pending=None: says UNKNOWN and that a paste is staged anyway', () => {
    const m = msg('None');
    expect(m).toMatch(/UNKNOWN/);
    expect(m).toMatch(/precaution/);
  });

  it('no state names ~/Downloads — the path with no file at it', () => {
    for (const p of ['False', 'None', 'True']) {
      expect(msg(p, ['fiber']),
        'the escalation names ~/Downloads again; macOS TCC denies a launchd agent '
        + 'that folder, so it is advice pointing at nothing').not.toMatch(/Downloads/);
    }
  });

  it('the staged path is stated in ONE place, matching the shell default', () => {
    const mon = readFileSync('scripts/registry_monitor.py', 'utf8');
    expect(mon).toMatch(/^PASTE_STAGE_HINT = /m);
    expect(msg('True', ['fiber'])).toContain('DCHUB_STAGE_DIR');
    expect(codeOnly(readFileSync(SHELL, 'utf8'))).toContain('DCHUB_STAGE_DIR');
  });
});

// ★ 2026-09-03 — THE AGENT MUST BEAT THE LEDGER IT IS WATCHED BY.
//
// Everything above tests what the shell does locally. None of it would have
// helped, because the failure nobody saw for 516 runs was invisible OFF this
// machine: /api/v1/ops/deadman tracked 203 feeds and not one was a LaunchAgent.
// These assert the wiring that makes a silent death observable.
describe('the rank-defense agent beats the dead-man ledger', () => {
  it('names its own feed, and says so loudly when it cannot beat', () => {
    // No key in env and no key file -> agent_beat returns 2 and the shell logs it.
    // "unconfigured" must never look like "beat fine".
    writeStatus({ paste_pending: 'false' });
    const log = run({ AGENT_BEAT_ENV: join(repo, 'no-such-file.env'), DCHUB_ADMIN_KEY: '' });
    expect(log).toMatch(/BEAT SKIPPED/);
    expect(log).toMatch(/agent:rank-defense/);
    expect(log).toMatch(/INVISIBLE/);
  });

  // Record the beat with an HTTP server in a SEPARATE PROCESS.
  //
  // Two dead ends first, both worth naming: shadowing `curl` on PATH does not
  // work because the shells do `export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"`,
  // which puts the real curl ahead of any fake — the first attempt silently sent a
  // beat to production. And an in-process server cannot answer, because
  // execFileSync blocks Node's event loop. So: real server, own process, real POST.
  function withRecorder(fn) {
    const recFile = join(repo, 'beats.jsonl');
    const portFile = join(repo, 'port.txt');
    const srcFile = join(repo, 'recorder.mjs');
    writeFileSync(srcFile, `
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
const s = createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; });
  req.on('end', () => { appendFileSync(${JSON.stringify(recFile)}, b + '\\n');
    res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); });
});
s.listen(0, '127.0.0.1', () => writeFileSync(${JSON.stringify(portFile)}, String(s.address().port)));
`);
    const child = spawn(process.execPath, [srcFile], { stdio: 'ignore', detached: false });
    try {
      const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      for (let i = 0; i < 100 && !existsSync(portFile); i++) sleep(50);
      if (!existsSync(portFile)) throw new Error('recorder never bound a port');
      const port = readFileSync(portFile, 'utf8').trim();
      fn(`http://127.0.0.1:${port}/beat`);
      for (let i = 0; i < 40 && !existsSync(recFile); i++) sleep(25);
      return existsSync(recFile)
        ? readFileSync(recFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
        : [];
    } finally { child.kill(); }
  }

  const beatsFor = (statusFields, env = {}) => withRecorder((url) => {
    writeStatus(statusFields);
    run({ AGENT_BEAT_URL: url, DCHUB_ADMIN_KEY: 'test-key', ...env });
  });

  it('beats success with its real cadence when the loop worked', () => {
    const [body] = beatsFor({ paste_pending: 'false' });
    expect(body).toBeDefined();
    expect(body.feed).toBe('agent:rank-defense');
    expect(body.status).toBe('success');
    // NOT the 5400s tick interval. tools/deadman/watch.py documents a 1.5h floor
    // (watcher runs every 2h, overdue at 2x), and this is a laptop agent that
    // sleeps — so cadence declares when ABSENCE MEANS DEAD, ~a day.
    expect(body.cadence_hours).toBe(12);
    expect(body.cadence_hours,
      'a cadence at or under the 1.5h floor false-REDs on ordinary drift')
      .toBeGreaterThan(1.5);
  });

  it('a rank SLIP still beats success — the loop ran, the product slipped', () => {
    // The ledger answers "did the loop run and do its job". Beating red on a slip
    // would make a working watcher cry wolf about a product problem.
    const [body] = beatsFor({ paste_pending: 'false', remediate: ['fiber'] });
    expect(body.status).toBe('success');
    expect(body.note).toMatch(/slip:fiber/);
  });

  it('a FAILED staging write beats run_failed — the 516-silent-failures case', () => {
    // run_failed is in _RED_KINDS in routes/ingest_runs.py, so this surfaces as a
    // red feed on /api/v1/ops/deadman instead of 516 lines in a local err log.
    mkdirSync(stage, { recursive: true });
    chmodSync(stage, 0o500);                       // unwritable
    let beats;
    try { beats = beatsFor({ paste_pending: 'true', remediate: ['fiber'] }); }
    finally { chmodSync(stage, 0o700); }
    expect(beats[0].status).toBe('run_failed');
  });
});
