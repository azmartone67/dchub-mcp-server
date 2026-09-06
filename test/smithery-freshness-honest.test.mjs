// =============================================================================
// The Smithery freshness lane must be able to FAIL — and must stop hammering.
// -----------------------------------------------------------------------------
// MEASURED 2026-09-05, on the owner's Mac, from
// ~/Library/Logs/dchub-smithery-freshness.log and the rank-defense log:
//
//   · 639 runs since 2026-06-21. 637 of 637 releases report {"status":"PENDING"}.
//     No terminal status has EVER been observed. PENDING is the release being
//     ACCEPTED, not the listing being UPDATED — and scripts/smithery-freshness-
//     heartbeat.sh beat the dead-man ledger `success` off the CLI's exit code.
//     The lane could not fail. (.github/workflows/smithery-freshness.yml learned
//     this on 2026-07-28 and verifies the outcome; the local lane never did.)
//
//   · 17-21 `smithery mcp publish` calls PER DAY, every day, for weeks, against
//     a script whose own header said "~2x/week" and a CI lane that republishes
//     daily. Cause: registry_monitor._reflex_kick() fires whenever ANY CORE term
//     is off #1 — 2-4 of them are, most of the time — on a 90-minute probe.
//     560 reflex kicks are in the log. The function's own docstring already said
//     a republish does NOT move rank; nothing capped how often it was spent.
//
//   · useCount read 4,328 on 08-20, 3,573 on 08-21, then EXACTLY 3,573 for 16
//     days. That was read as "Smithery traffic stopped, what did we block?" and
//     cost a serving-path investigation. A counter that goes DOWN is a vendor
//     recompute; nothing we serve can remove past calls.
//
// These tests run the REAL script, the REAL shell and the REAL python. Every
// group carries a must-fail control, because the failure being fixed here is
// precisely a check that was structurally unable to go red.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ★ execFileSync BLOCKS the Node event loop, so an in-process HTTP server can
// never answer the child's request — it times out and looks like a broken
// script. Anything that talks to a stub server must await the ASYNC form.
// (Recorded in test/agent-beat.test.mjs; it cost a debugging round there.)
const run = promisify(execFile);
const REPO = process.cwd();
const VERIFY = join(REPO, 'scripts/verify_smithery_converged.py');
const HEARTBEAT = join(REPO, 'scripts/smithery-freshness-heartbeat.sh');
const MONITOR = join(REPO, 'scripts/registry_monitor.py');

/** Run a command, returning {code, stdout, stderr} instead of throwing. */
async function tryRun(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await run(cmd, args, { encoding: 'utf8', ...opts });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A: verify_smithery_converged.py — three outcomes, not two
// ─────────────────────────────────────────────────────────────────────────────
describe('verify_smithery_converged.py — the listing is compared, not the exit code', () => {
  let server, port, hits;
  // What the LIVE server serves, and what the REGISTRY serves. The test mutates
  // `registryTools` per case; `liveTools` is the fixed truth.
  const liveTools = [
    { name: 'plan_query', description: 'INSPECT-ONLY. Explain how a query would be answered.' },
    { name: 'get_facility', description: 'One facility by id or name.' },
  ];
  let registryTools;

  beforeAll(async () => {
    hits = { mcp: 0, registry: 0 };
    server = createServer((req, res) => {
      if (req.url.startsWith('/registry')) {
        hits.registry += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ tools: registryTools }));
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        hits.mcp += 1;
        const m = JSON.parse(body || '{}').method;
        if (m === 'initialize') {
          res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' });
          return res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: {} } }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: liveTools } }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); });

  const verify = (extra = []) => tryRun('python3', [
    VERIFY, '--checks', '1', '--interval', '1',
    '--mcp', `http://127.0.0.1:${port}/mcp`,
    '--registry', `http://127.0.0.1:${port}/registry`,
    ...extra,
  ]);

  it('MUST-FAIL CONTROL: the harness really drives the script and the stubs answer', async () => {
    registryTools = liveTools;
    const before = hits.mcp + hits.registry;
    const r = await verify();
    expect(hits.mcp, 'the script never called our stub MCP endpoint').toBeGreaterThan(0);
    expect(hits.registry, 'the script never called our stub registry').toBeGreaterThan(0);
    expect(hits.mcp + hits.registry).toBeGreaterThan(before);
    expect(r.stdout).toContain('live tools/list: 2 tools');
  });

  it('exit 0 when the listing serves what we serve', async () => {
    registryTools = liveTools;
    const r = await verify();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/converged after 1 check/);
  });

  it('exit 1 when a tool is MISSING from the listing', async () => {
    registryTools = [liveTools[0]];
    const r = await verify();
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/missing=\['get_facility'\]/);
  });

  // ★ The 2026-07-28 defect had the right COUNT for days while plan_query still
  // read "START HERE". Membership alone would call this converged.
  it('exit 1 when the COUNT matches but a description is stale', async () => {
    registryTools = [
      { name: 'plan_query', description: 'START HERE. Plan your query first.' },
      liveTools[1],
    ];
    const r = await verify();
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/stale_desc=\['plan_query'\]/);
  });

  it('exit 2 — INCONCLUSIVE — when our own tools/list is unreadable', async () => {
    registryTools = liveTools;
    const r = await tryRun('python3', [
      VERIFY, '--checks', '1', '--interval', '1',
      '--mcp', `http://127.0.0.1:1/mcp`,          // nothing listens on port 1
      '--registry', `http://127.0.0.1:${port}/registry`,
    ]);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/cannot read our own tools\/list/);
  });

  it('the reported budget is the wait actually taken, not checks x interval', async () => {
    registryTools = [liveTools[0]];
    const r = await tryRun('python3', [
      VERIFY, '--checks', '3', '--interval', '2',
      '--mcp', `http://127.0.0.1:${port}/mcp`,
      '--registry', `http://127.0.0.1:${port}/registry`,
    ]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/within 0m04s/);   // 2 sleeps of 2s, not 3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B: the local heartbeat's dead-man beat reflects the OUTCOME
// ─────────────────────────────────────────────────────────────────────────────
describe('smithery-freshness-heartbeat.sh — the beat can go red', () => {
  let server, port, beats, tmp;

  beforeAll(async () => {
    beats = [];
    tmp = mkdtempSync(join(tmpdir(), 'freshness-'));
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        beats.push(JSON.parse(body || '{}'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  /**
   * Run the real heartbeat with a stub CLI and a stub verifier.
   * ★ SMITHERY_BIN exists for exactly this: the script PREPENDS /usr/local/bin
   * to PATH, where the real `smithery` lives, so a PATH-only stub would publish
   * for real against the live listing.
   */
  async function heartbeat({ publishRc, convergeRc }) {
    const bin = join(tmp, `smithery-${publishRc}`);
    writeFileSync(bin, `#!/bin/sh\necho '{"status":"PENDING"}'\nexit ${publishRc}\n`);
    chmodSync(bin, 0o755);
    const py = join(tmp, `py-${convergeRc}`);
    writeFileSync(py, `#!/bin/sh\necho "stub converge"\nexit ${convergeRc}\n`);
    chmodSync(py, 0o755);
    const log = join(tmp, `log-${publishRc}-${convergeRc}.txt`);
    const before = beats.length;
    const r = await tryRun('bash', [HEARTBEAT], {
      env: {
        PATH: process.env.PATH,
        HOME: tmp,
        SMITHERY_BIN: bin,
        SMITHERY_HEARTBEAT_PY: py,
        SMITHERY_HEARTBEAT_REPO: REPO,
        SMITHERY_HEARTBEAT_LOG: log,
        AGENT_BEAT_URL: `http://127.0.0.1:${port}/beat`,
        AGENT_BEAT_ENV: join(tmp, 'nonexistent.env'),
        DCHUB_ADMIN_KEY: 'test-key',
      },
    });
    return { ...r, log: readFileSync(log, 'utf8'), beat: beats[before] };
  }

  it('MUST-FAIL CONTROL: the stubs are actually reached and a beat is actually sent', async () => {
    const r = await heartbeat({ publishRc: 0, convergeRc: 0 });
    expect(r.log, 'the stub CLI never ran').toContain('{"status":"PENDING"}');
    expect(r.beat, 'no beat reached the ledger stub').toBeTruthy();
    expect(r.beat.feed).toBe('agent:smithery-freshness');
  });

  it('publish accepted AND listing converged → success, exit 0', async () => {
    const r = await heartbeat({ publishRc: 0, convergeRc: 0 });
    expect(r.beat.status).toBe('success');
    expect(r.code).toBe(0);
  });

  // THE DEFECT: this is the case that used to beat `success`.
  it('publish ACCEPTED but listing never converged → run_failed, exit 1', async () => {
    const r = await heartbeat({ publishRc: 0, convergeRc: 1 });
    expect(r.beat.status).toBe('run_failed');
    expect(r.beat.note).toMatch(/did not converge/);
    expect(r.code).toBe(1);
  });

  it('publish failed → run_failed, and convergence is NOT consulted', async () => {
    const r = await heartbeat({ publishRc: 3, convergeRc: 0 });
    expect(r.beat.status).toBe('run_failed');
    expect(r.beat.note).toMatch(/rc=3/);
    // Verifying after a failed publish would read the PREVIOUS release's
    // (correct) listing and call a broken run green.
    expect(r.log).not.toContain('stub converge');
    expect(r.code).toBe(1);
  });

  it('published but unverifiable → awaiting_upstream: neither green nor a page', async () => {
    const r = await heartbeat({ publishRc: 0, convergeRc: 2 });
    expect(r.beat.status).toBe('awaiting_upstream');
    expect(r.beat.note).toMatch(/UNVERIFIED/);
    expect(r.code).toBe(0);
  });

  it('the four outcomes are DISTINCT — no two collapse to the same status', async () => {
    const seen = [];
    for (const c of [{ publishRc: 0, convergeRc: 0 }, { publishRc: 0, convergeRc: 1 },
                     { publishRc: 0, convergeRc: 2 }, { publishRc: 3, convergeRc: 0 }]) {
      seen.push((await heartbeat(c)).beat.status);
    }
    expect(new Set(seen).size, `statuses collapsed: ${seen.join(',')}`).toBeGreaterThan(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C: the reflex is capped, and D: useCount is read honestly
// ─────────────────────────────────────────────────────────────────────────────
describe('registry_monitor — the insurance reflex is rate-capped', () => {
  /**
   * Drive the real functions in a throwaway cwd (state/ is written relative to
   * cwd, as rank_defense_master_shell.sh guarantees by cd-ing to the repo).
   * ★ `import subprocess` INSIDE _reflex_kick() resolves through sys.modules, so
   * pre-seeding a fake there records the launchctl calls instead of firing them
   * at the owner's real LaunchAgent.
   */
  async function py(script) {
    const r = await tryRun('python3', ['-c',
      'import importlib.util,json,os,sys,tempfile,time,types\n' +
      `spec=importlib.util.spec_from_file_location('rm', ${JSON.stringify(MONITOR)})\n` +
      'rm=importlib.util.module_from_spec(spec); spec.loader.exec_module(rm)\n' +
      'os.chdir(tempfile.mkdtemp())\n' +
      'CALLS=[]\n' +
      "sys.modules['subprocess']=types.SimpleNamespace(run=lambda *a, **k: CALLS.append(a))\n" +
      "os.environ.pop('RANK_AUTOHEAL_DISABLE', None); os.environ.pop('GITHUB_OUTPUT', None)\n" +
      script]);
    expect(r.code, `python harness failed: ${r.stderr}`).toBe(0);
    return JSON.parse(r.stdout.trim().split('\n').pop());
  }

  it('MUST-FAIL CONTROL: a cold reflex really does kick (so "suppressed" is not vacuous)', async () => {
    const out = await py('a=rm._reflex_kick()\nprint(json.dumps({"msg":a,"calls":len(CALLS)}))');
    expect(out.msg).toMatch(/^kicked /);
    expect(out.calls, 'the fake launchctl was never called — the cold path is not exercised').toBe(1);
  });

  it('a second slip inside the cooldown does NOT publish again', async () => {
    const out = await py(
      'rm._reflex_kick()\n' +
      'b=rm._reflex_kick()\n' +
      'print(json.dumps({"msg":b,"calls":len(CALLS)}))');
    expect(out.msg).toMatch(/^suppressed/);
    expect(out.calls, 'the reflex published a second time inside the cooldown').toBe(1);
    // It must say WHY, and point at the remedy that actually works.
    expect(out.msg).toMatch(/cooldown is 48h/);
    expect(out.msg).toMatch(/does not move rank/);
    expect(out.msg).toMatch(/owner paste/i);
  });

  it('RANK_REFLEX_COOLDOWN_H overrides it, in BOTH directions', async () => {
    const off = await py(
      'rm._reflex_kick()\n' +
      "os.environ['RANK_REFLEX_COOLDOWN_H']='0'\n" +
      'b=rm._reflex_kick()\n' +
      'print(json.dumps({"msg":b,"calls":len(CALLS)}))');
    expect(off.msg).toMatch(/^kicked /);
    expect(off.calls).toBe(2);

    const on = await py(
      'rm._reflex_kick()\n' +
      "os.environ['RANK_REFLEX_COOLDOWN_H']='999'\n" +
      'b=rm._reflex_kick()\n' +
      'print(json.dumps({"msg":b,"calls":len(CALLS)}))');
    expect(on.msg).toMatch(/^suppressed/);
    expect(on.calls).toBe(1);
  });

  it('the cooldown clock starts only after a kick that did not throw', async () => {
    const out = await py(
      "sys.modules['subprocess']=types.SimpleNamespace(run=lambda *a, **k: (_ for _ in ()).throw(OSError('boom')))\n" +
      'a=rm._reflex_kick()\n' +
      'print(json.dumps({"msg":a,"state":os.path.exists(rm._REFLEX_STATE)}))');
    expect(out.msg).toMatch(/^kick failed/);
    expect(out.state, 'a throwing kick started a cooldown during which nothing runs').toBe(false);
  });

  it('useCount: a DROP is named as a vendor recompute, not our traffic', async () => {
    const out = await py(
      'rm.usecount_note({"useCount": 4328})\n' +
      'a=rm.usecount_note({"useCount": 3573})\n' +
      'print(json.dumps({"msg":a}))');
    expect(out.msg).toMatch(/FELL 4328 . 3573 \(-755\)/);
    expect(out.msg).toMatch(/vendor recompute/);
    expect(out.msg).toMatch(/Do NOT debug a serving path/);
  });

  it('useCount: flat is silent for a quiet week, then names whose counter it is', async () => {
    const out = await py(
      'rm.usecount_note({"useCount": 3573})\n' +
      'quiet=rm.usecount_note({"useCount": 3573})\n' +
      'h=json.load(open(rm._USECOUNT_STATE)); h[-1]["ts"] -= 16*86400\n' +
      'json.dump(h, open(rm._USECOUNT_STATE,"w"))\n' +
      'aged=rm.usecount_note({"useCount": 3573})\n' +
      'print(json.dumps({"quiet":quiet,"aged":aged}))');
    expect(out.quiet, 'a counter flat for minutes is not news').toBe(null);
    expect(out.aged).toMatch(/FLAT at 3573 for 16d/);
    // The whole point: it is THEIR gateway's counter, so it is not evidence
    // about our reachability. Name the thing that IS evidence.
    expect(out.aged).toMatch(/SMITHERY's gateway/);
    expect(out.aged).toMatch(/verify_smithery_converged\.py/);
  });

  it('useCount: a rise reports the delta, and a non-integer says nothing', async () => {
    const out = await py(
      'rm.usecount_note({"useCount": 3573})\n' +
      'up=rm.usecount_note({"useCount": 3600})\n' +
      'junk=rm.usecount_note({"useCount": None})\n' +
      'print(json.dumps({"up":up,"junk":junk}))');
    expect(out.up).toMatch(/3573 . 3600 \(\+27\)/);
    expect(out.junk).toBe(null);
  });
});
