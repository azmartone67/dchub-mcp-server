// ★HARD GATE, NO NETWORK. Pins the hard-gate step's no-network rule, which
// lives in two files: test/helpers/no-network-preload.cjs refuses and logs every
// socket connect off loopback in each node process of the step, and
// scripts/hard-gate-no-network.mjs fails the step on that log. Why the rule
// moved from the files into the step: see the preload's header.
//
// Every connect this file attempts on purpose goes to 192.0.2.1 (TEST-NET-1,
// RFC 5737, never routed), so a broken preload times out here instead of
// reaching anyone. Those attempts run in child processes with their own log and
// an empty NODE_OPTIONS, so they never land in the step's log.
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = path.join(ROOT, 'test', 'helpers', 'no-network-preload.cjs');
const VERDICT = path.join(ROOT, 'scripts', 'hard-gate-no-network.mjs');
const DIR = mkdtempSync(path.join(tmpdir(), 'hg-no-network-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

let seq = 0;
const node = (args, log) => spawnSync(process.execPath, args, {
  env: { ...process.env, NODE_OPTIONS: '', DCHUB_NO_NETWORK_LOG: log },
  encoding: 'utf8',
  timeout: 25_000,
});

// Runs an async CommonJS body under the preload; returns what it returned and what it logged.
function underPreload(body) {
  const log = path.join(DIR, `run-${++seq}.jsonl`);
  const code = `
    const net = require('node:net');
    const settle = (s) => new Promise((done) => {
      s.on('error', (e) => done(\`\${e.code ?? '-'} \${e.message}\`));
      s.on('connect', () => { s.destroy(); done('CONNECTED'); });
      s.setTimeout(3000, () => { s.destroy(); done('TIMEOUT'); });
    });
    const loopbackServer = async () => {
      const server = net.createServer((c) => c.end()).listen(0, '127.0.0.1');
      await new Promise((r) => server.once('listening', r));
      return server;
    };
    (async () => { ${body} })().then(
      (r) => console.log(JSON.stringify(r)),
      (e) => console.log(JSON.stringify({ crashed: String(e) })));`;
  const r = node(['--require', PRELOAD, '-e', code], log);
  const logged = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return {
    out: JSON.parse(r.stdout.trim().split('\n').pop() || JSON.stringify({ stderr: r.stderr })),
    attempts: logged.filter((e) => e.ev === 'connect').map((e) => `${e.host}:${e.port}`),
    loaded: logged.filter((e) => e.ev === 'loaded'),
  };
}

const REFUSED = /^ECONNREFUSED hard gate: network refused by test\/helpers\/no-network-preload\.cjs \(192\.0\.2\.1:8080\)$/;

describe('the preload refuses and logs every connect off loopback', () => {
  it('net.connect (normalized form), socket.connect(port, host) and fetch are refused; loopback connects', () => {
    const { out, attempts, loaded } = underPreload(`
      const netConnect = await settle(net.connect({ host: '192.0.2.1', port: 8080 }));
      const socketConnect = await settle(new net.Socket().connect(8080, '192.0.2.1'));
      const fetched = await fetch('http://192.0.2.1:8080/x', { signal: AbortSignal.timeout(3000) })
        .then(() => 'RESPONDED', (e) => e.cause?.code ?? e.name);
      const server = await loopbackServer();
      const loopback = await settle(net.connect(server.address().port, '127.0.0.1'));
      server.close();
      return { netConnect, socketConnect, fetched, loopback };`);
    expect(out.netConnect).toMatch(REFUSED);
    expect(out.socketConnect).toMatch(REFUSED);
    expect(out.fetched).toBe('ECONNREFUSED');
    expect(out.loopback).toBe('CONNECTED');
    expect(attempts).toEqual(['192.0.2.1:8080', '192.0.2.1:8080', '192.0.2.1:8080']);
    expect(loaded).toHaveLength(1);
  });
});

describe('a file that installs its own recorder keeps it, and the preload stays outermost', () => {
  it('logs what the file refuses, refuses what it passes through, does not recurse, and survives the restore', () => {
    const { out, attempts } = underPreload(`
      const realConnect = net.Socket.prototype.connect;
      const seen = [];
      // The hard-gate files' own pattern: record, and refuse anything off loopback.
      net.Socket.prototype.connect = function connect(...args) {
        let o = args[0];
        if (Array.isArray(o)) o = o[0];
        seen.push(\`file:\${o.host}\`);
        if (o.host !== '127.0.0.1') { process.nextTick(() => this.destroy(new Error('refused by the file'))); return this; }
        return realConnect.apply(this, args);
      };
      const fileRefused = await settle(net.connect({ host: '192.0.2.1', port: 8080 }));
      // A recorder that hands everything to the connect it saved as real.
      net.Socket.prototype.connect = function passThrough(...args) { seen.push('pass'); return realConnect.apply(this, args); };
      const passedThrough = await settle(net.connect({ host: '192.0.2.1', port: 8080 }));
      const server = await loopbackServer();
      const loopback = await settle(net.connect(server.address().port, '127.0.0.1'));
      server.close();
      net.Socket.prototype.connect = realConnect;            // the files' afterAll
      const restored = await settle(net.connect({ host: '192.0.2.1', port: 8080 }));
      return { fileRefused, passedThrough, loopback, restored, seen };`);
    expect(out.fileRefused).toBe('- refused by the file');
    expect(out.passedThrough).toMatch(REFUSED);
    expect(out.loopback).toBe('CONNECTED');
    expect(out.restored).toMatch(REFUSED);
    expect(out.seen).toEqual(['file:192.0.2.1', 'pass', 'pass']);
    // One line per attempt, the one the file refused itself included; the re-entry is not a second line.
    expect(attempts).toEqual(['192.0.2.1:8080', '192.0.2.1:8080', '192.0.2.1:8080']);
  });
});

describe('scripts/hard-gate-no-network.mjs', () => {
  const verdict = (lines) => {
    const log = path.join(DIR, `verdict-${++seq}.jsonl`);
    if (lines) writeFileSync(log, lines.map((l) => `${typeof l === 'string' ? l : JSON.stringify(l)}\n`).join(''));
    const r = node([VERDICT, log], path.join(DIR, 'unused.jsonl'));
    return { status: r.status, text: r.stdout + r.stderr };
  };
  const main = { ev: 'loaded', pid: 1, worker: false };
  const worker = { ev: 'loaded', pid: 2, worker: true };

  it('passes a log in which a vitest worker loaded the preload and nothing was attempted', () => {
    expect(verdict([main, worker]).status).toBe(0);
  });

  it('fails an attempt, naming the file and the host', () => {
    const r = verdict([main, worker, { ev: 'connect', pid: 2, host: 'dchub.cloud', port: 443, file: 'test/x.test.mjs' }]);
    expect(r.status).toBe(1);
    expect(r.text).toMatch(/::error file=test\/x\.test\.mjs::hard gate: test\/x\.test\.mjs tried to reach dchub\.cloud:443/);
  });

  it('fails when no vitest worker loaded the preload, because zero attempts then proves nothing', () => {
    for (const lines of [null, [], [main]]) {
      const r = verdict(lines);
      expect(r.status, JSON.stringify(lines)).toBe(1);
      expect(r.text).toMatch(/::error::/);
    }
  });

  it('fails a log it cannot parse', () => {
    expect(verdict([worker, '{"ev":"conn']).status).toBe(1);
  });
});

describe('the hard-gate step wires both', () => {
  it('loads the preload into vitest with a log, runs the verdict on that log, and keeps vitest\'s own status', () => {
    const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
    const parts = yml.split('- name: Unit gate — gating logic (HARD gate, no network)\n');
    expect(parts).toHaveLength(2);
    const run = parts[1].split(/\n\s*- name: /)[0]
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(run).toMatch(/NODE_OPTIONS="[^"\n]*--require \$PWD\/test\/helpers\/no-network-preload\.cjs" DCHUB_NO_NETWORK_LOG="\$log" npx vitest run \$files \|\| status=\$\?\n/);
    expect(run).toMatch(/\n\s*node scripts\/hard-gate-no-network\.mjs "\$log" \|\| status=1\n\s*exit \$status\n/);
  });
});
