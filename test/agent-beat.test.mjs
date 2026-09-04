// Guard: the local LaunchAgents actually reach the dead-man ledger.
//
// WHY THIS EXISTS (2026-09-03). /api/v1/ops/deadman tracks 203 feeds and alarms
// when one stops beating. NOT ONE was a local LaunchAgent, so the three agents on
// the owner's Mac sat outside every watcher the project has. Measured cost:
// rank_defense_master_shell.sh failed to write its staged file 516 consecutive
// times (macOS TCC denies a launchd agent ~/Downloads) and nothing noticed. The
// shell wrote state/rank_defense_heartbeat.json "so a stalled loop is itself
// detectable (dead-man sentinel)" — a grep of both repos found NO READER.
//
// These tests run the REAL helper against a REAL local HTTP server, because the
// thing that failed last time was never the logic — it was the assumption that a
// write had happened.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

// ★ execFileSync BLOCKS the Node event loop, so an in-process HTTP server can
// never answer the request the child makes — every call times out at -m 12 and
// looks exactly like a broken helper. Anything that talks to the stub server
// must await the ASYNC form. (Cost me one debugging round; the helper was fine.)
const execFileAsync = promisify(execFile);
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HELPER = join(process.cwd(), 'scripts/agent_beat.sh');
let server, port, received, tmp;

beforeEach(async () => {
  received = [];
  tmp = mkdtempSync(join(tmpdir(), 'beat-'));
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ method: req.method, headers: req.headers, body });
      if (req.url.includes('/boom')) { res.writeHead(500); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

// Run agent_beat in a real bash, with a controllable environment.
async function beat(args, env = {}) {
  const script = `set -u; . "${HELPER}"; agent_beat ${args}; echo "RC=$?"`;
  const { stdout } = await execFileAsync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH, HOME: tmp,
      AGENT_BEAT_URL: `http://127.0.0.1:${port}/beat`,
      AGENT_BEAT_ENV: join(tmp, 'agent.env'),
      ...env,
    },
  });
  return stdout;
}

describe('agent_beat reaches the ledger', () => {
  it('POSTs the feed, status and cadence, and reports success', async () => {
    const out = await beat('rank-defense-probe success 1.5 "fiber slipped"',
      { DCHUB_ADMIN_KEY: 'test-key-123' });
    expect(out).toMatch(/RC=0/);
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe('POST');
    const body = JSON.parse(received[0].body);
    expect(body.feed).toBe('rank-defense-probe');
    expect(body.status).toBe('success');
    expect(body.cadence_hours).toBe(1.5);
    expect(body.note).toBe('fiber slipped');
  });

  it('sends the admin key as a header the ledger accepts', async () => {
    await beat('f success 24', { DCHUB_ADMIN_KEY: 'test-key-123' });
    // routes/ingest_runs.py:_admin_ok() reads X-Admin-Key / X-Internal-Key.
    expect(received[0].headers['x-admin-key']).toBe('test-key-123');
  });

  it('sets a User-Agent — Cloudflare 1010s the default one', async () => {
    await beat('f success 24', { DCHUB_ADMIN_KEY: 'k' });
    expect(received[0].headers['user-agent']).toMatch(/dchub-agent-beat/);
  });
});

describe('the key never reaches the process table', () => {
  it('is passed on stdin, not in argv', () => {
    // Behavioural, not a source grep: shadow curl with a recorder and inspect
    // what it was ACTUALLY invoked with. `curl -H "X-Admin-Key: $k"` would put
    // the admin key in `ps` output for every user on the machine.
    const argvLog = join(tmp, 'argv.txt'), stdinLog = join(tmp, 'stdin.txt');
    const fakeBin = join(tmp, 'bin');
    execFileSync('mkdir', ['-p', fakeBin]);
    const fakeCurl = join(fakeBin, 'curl');
    writeFileSync(fakeCurl,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argvLog}"\ncat > "${stdinLog}"\nprintf '200'\n`);
    chmodSync(fakeCurl, 0o755);

    const out = execFileSync('bash', ['-c',
      `set -u; . "${HELPER}"; agent_beat f success 24 note; echo "RC=$?"`], {
      encoding: 'utf8',
      env: { PATH: `${fakeBin}:${process.env.PATH}`, HOME: tmp,
             AGENT_BEAT_URL: `http://127.0.0.1:${port}/beat`,
             AGENT_BEAT_ENV: join(tmp, 'agent.env'),
             DCHUB_ADMIN_KEY: 'SUPER-SECRET-KEY' },
    });
    expect(out).toMatch(/RC=0/);
    const argv = readFileSync(argvLog, 'utf8');
    const stdin = readFileSync(stdinLog, 'utf8');
    expect(argv, 'the admin key appeared in curl argv — visible in `ps` to every '
      + 'user on the machine').not.toContain('SUPER-SECRET-KEY');
    expect(stdin, 'the key should travel on stdin via `curl --config -`')
      .toContain('SUPER-SECRET-KEY');
  });
});

describe('an unconfigured or failing beat is LOUD, never silent', () => {
  it('unconfigured: returns 2, says the agent is INVISIBLE, and sends nothing', async () => {
    const out = await beat('f success 24');            // no key in env, no file
    expect(out).toMatch(/RC=2/);
    expect(out).toMatch(/BEAT SKIPPED/);
    expect(out).toMatch(/INVISIBLE/);
    expect(received).toHaveLength(0);
  });

  it('reads the key from the owner-placed file when the env has none', async () => {
    // launchd gives an agent no shell profile, so env-only would never work.
    writeFileSync(join(tmp, 'agent.env'), 'DCHUB_ADMIN_KEY=from-file\n');
    const out = await beat('f success 24');
    expect(out).toMatch(/RC=0/);
    expect(received[0].headers['x-admin-key']).toBe('from-file');
  });

  it('a 500 returns 1 and says the agent is UNWATCHED', async () => {
    // Was `expect(out).toMatch(/RC=(0|1)/)` — which passes on either outcome and
    // therefore asserted nothing. The stub now 500s on /boom, so this can fail.
    const script = `set -u; . "${HELPER}"; agent_beat f success 24; echo "RC=$?"`;
    const { stdout: out } = await execFileAsync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: tmp,
             AGENT_BEAT_URL: `http://127.0.0.1:${port}/boom`,
             AGENT_BEAT_ENV: join(tmp, 'agent.env'), DCHUB_ADMIN_KEY: 'k' },
    });
    expect(out).toMatch(/RC=1/);
    expect(out).toMatch(/BEAT FAILED/);
    expect(out).toMatch(/UNWATCHED/);
    expect(received).toHaveLength(1);      // it really did reach the server
  });

  it('never exits the calling shell — a dead ledger must not kill the loop', () => {
    const out = execFileSync('bash', ['-c',
      `set -eu; . "${HELPER}"; agent_beat f success 24 || true; echo REACHED_END`], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: tmp,
             AGENT_BEAT_URL: 'http://127.0.0.1:9/never',   // discard port
             AGENT_BEAT_ENV: join(tmp, 'agent.env'), DCHUB_ADMIN_KEY: 'k' },
    });
    expect(out).toMatch(/REACHED_END/);
  });
});
