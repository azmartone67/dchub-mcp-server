// npm-launcher-start-hint.test.mjs (Grok Note P item 5, 2026-11-16).
//
// The npm launcher prints ONE line to stderr on start, telling a person reading the client log
// where it connected and what to call first. stdout is the MCP stdio transport: a single stray
// byte there corrupts the JSON-RPC stream, so the launcher must never write to it. The package
// must keep no install-time scripts (nothing runs on `npx` but the bin itself).
//
// The launcher runs here against a stand-in mcp-remote that writes one JSON-RPC line to stdout,
// so the test sees exactly what an MCP client would read.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createScratchRepo } from './helpers/repo-sandbox.mjs';

const LAUNCHER_DIR = fileURLToPath(new URL('../npm-launcher/', import.meta.url));
const REAL_BIN = path.join(LAUNCHER_DIR, 'bin', 'dchub-mcp-server.mjs');
const PROTOCOL_LINE = '{"jsonrpc":"2.0","id":0,"result":{"stub":true}}\n';
const HINT = /Connected to (\S+)\. No key needed for previews\. Start with execute_plan\. Save a key from claim_free_key or https:\/\/dchub\.cloud\/connect\./g;
const NO_PLAN_COPY = /\b(?:paid|upgrades?|upgrading|trials?|pricing)\b|\bfree[- ]tiers?\b|\$\s?\d|\/pricing\b|\b(?:Pro|Starter|Enterprise|Founding)\b/;

let box;
const run = (env = {}) => {
  const r = spawnSync(process.execPath, [path.join(box.root, 'bin', 'dchub-mcp-server.mjs')], {
    env: { PATH: process.env.PATH, ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}), ...env },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

beforeAll(() => {
  box = createScratchRepo('dchub-launcher-hint', { git: false });
  box.write('bin/dchub-mcp-server.mjs', fs.readFileSync(REAL_BIN, 'utf8'));
  box.write('node_modules/mcp-remote/package.json', JSON.stringify({ name: 'mcp-remote', version: '0.0.0-stub' }));
  box.write('node_modules/mcp-remote/dist/proxy.js', `process.stdout.write(${JSON.stringify(PROTOCOL_LINE)});\n`);
  box.write('package.json', JSON.stringify({ name: 'probe', type: 'module' }));
});
afterAll(() => box.cleanup());

describe('npm launcher start-up hint', () => {
  it('stdout carries nothing but the protocol stream', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(PROTOCOL_LINE);
  });

  it('prints the hint exactly once, on stderr, as one line, naming the endpoint', () => {
    const { stderr } = run();
    const hits = [...stderr.matchAll(HINT)];
    expect(hits).toHaveLength(1);
    expect(hits[0][1]).toBe('https://dchub.cloud/mcp');
    const lines = stderr.split('\n').filter((l) => l.includes('Connected to'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(HINT.source));
  });

  it('names an overridden endpoint (DCHUB_MCP_URL) and never the API key', () => {
    const key = 'dch_live_hint_probe_91c2';
    const { stderr, stdout } = run({ DCHUB_MCP_URL: 'https://example.test/mcp', DCHUB_API_KEY: key });
    expect([...stderr.matchAll(HINT)].map((m) => m[1])).toEqual(['https://example.test/mcp']);
    expect(stderr + stdout).not.toContain(key);
    expect(stdout).toBe(PROTOCOL_LINE);
  });

  it('DCHUB_QUIET=1 turns it off', () => {
    const { stderr, stdout } = run({ DCHUB_QUIET: '1' });
    expect(stderr).not.toContain('Connected to');
    expect(stdout).toBe(PROTOCOL_LINE);
  });

  it('names no plan, price, paid/upgrade/trial', () => {
    const { stderr } = run();
    expect(stderr).not.toMatch(NO_PLAN_COPY);
  });
});

describe('npm launcher package: nothing runs at install', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(LAUNCHER_DIR, 'package.json'), 'utf8'));
  const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preprepare', 'postprepare'];

  it('package.json declares no install/preinstall/postinstall/prepare script', () => {
    for (const s of LIFECYCLE) expect(pkg.scripts?.[s], s).toBeUndefined();
  });

  it('npm pack --dry-run --json: the four expected files, no install scripts in the packed manifest', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: LAUNCHER_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' },
    });
    const [packed] = JSON.parse(out);
    expect(packed.files.map((f) => f.path).sort()).toEqual(['LICENSE', 'README.md', 'bin/dchub-mcp-server.mjs', 'package.json']);
    expect(packed.name).toBe('dchub-mcp-server');
    // the packed package.json is the one on disk (npm pack copies it); re-read it from the pack list
    expect(packed.files.find((f) => f.path === 'package.json').size).toBe(fs.statSync(path.join(LAUNCHER_DIR, 'package.json')).size);
  });

  it('the bin does not write to stdout itself', () => {
    const src = fs.readFileSync(REAL_BIN, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/console\.(log|info)\(|process\.stdout\.write/);
  });
});
