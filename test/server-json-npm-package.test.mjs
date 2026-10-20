// server.json links the npm launcher (2026-10-19, registry audit item 3).
//
// The official MCP registry showed `packages: []` for cloud.dchub/mcp-server,
// so nothing tied the registry entry to the npm package dchub-mcp-server
// (npm-launcher/). The entry now carries one npm package whose version IS the
// server.json version: npm-publish.yml publishes exactly that version on the
// merge, and the registry refuses a publish whose npm version does not exist or
// whose package.json lacks mcpName == server.json name.
//
// scripts/sync-tools-manifest.mjs owns the version (heals it on --fix, fails on
// a mismatch in check mode). The must-fail controls below run the sandbox copy
// of that script, so they never touch the shared tree.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRepoSandbox } from './helpers/repo-sandbox.mjs';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(REAL_ROOT, rel), 'utf8'));
const SJ = readJSON('server.json');
const LAUNCHER = readJSON('npm-launcher/package.json');
const npmEntries = (sj) => (sj.packages || []).filter((p) => p.registryType === 'npm');

describe('server.json packages: the npm launcher', () => {
  it('lists exactly one npm package, the launcher, at the server.json version', () => {
    const npm = npmEntries(SJ);
    expect(npm).toHaveLength(1);
    expect(npm[0].identifier).toBe(LAUNCHER.name);
    expect(npm[0].version).toBe(SJ.version);
    expect(LAUNCHER.version).toBe(SJ.version);
    expect(npm[0].transport).toEqual({ type: 'stdio' });
  });

  it('the launcher declares mcpName == server.json name (the registry validates it)', () => {
    expect(LAUNCHER.mcpName).toBe(SJ.name);
  });

  it('the only env var is the optional key the launcher reads, marked secret', () => {
    const vars = npmEntries(SJ)[0].environmentVariables || [];
    expect(vars.map((v) => v.name)).toEqual(['DCHUB_API_KEY']);
    expect(vars[0].isRequired).toBe(false);
    expect(vars[0].isSecret).toBe(true);
    const bin = fs.readFileSync(path.join(REAL_ROOT, 'npm-launcher', 'bin', 'dchub-mcp-server.mjs'), 'utf8');
    expect(bin).toContain('process.env.DCHUB_API_KEY');
  });

  it('server.json title and description stay within 100 chars and lead with the search terms', () => {
    expect(SJ.title.length).toBeLessThanOrEqual(100);
    expect(SJ.description.length).toBeLessThanOrEqual(100);
    const d = SJ.description.toLowerCase();
    for (const k of ['data center', 'energy', 'electricity', 'power grid', 'dcpi', 'query and cite', 'capacity to buy or lease']) expect(d, k).toContain(k);
    for (const k of ['data center', 'energy', 'electricity', 'power grid', 'site selection']) expect(SJ.title.toLowerCase(), k).toContain(k);
    expect(d.startsWith('data center')).toBe(true);
    expect(SJ.description).not.toMatch(/\$|\bpro\b|\bpricing\b|\bplan\b/i);
  });
});

describe('sync-tools-manifest owns the npm package version (must-fail controls)', () => {
  const SANDBOX = createRepoSandbox(REAL_ROOT);
  afterAll(() => SANDBOX.cleanup());
  const R = (...p) => path.join(SANDBOX.root, ...p);
  const SCRIPT = R('scripts', 'sync-tools-manifest.mjs');
  const run = (args = []) => {
    try { return { ok: true, out: execFileSync('node', [SCRIPT, ...args], { cwd: SANDBOX.root, encoding: 'utf8' }) }; }
    catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; }
  };
  const mutate = (rel, fn, body) => {
    const orig = fs.readFileSync(R(rel), 'utf8');
    const next = fn(orig);
    expect(next, `mutation of ${rel} did not apply; the control would be vacuous`).not.toBe(orig);
    try { SANDBOX.write(R(rel), next); return body(); } finally { SANDBOX.write(R(rel), orig); }
  };
  const editServerJson = (fn) => (s) => { const o = JSON.parse(s); fn(o); return JSON.stringify(o, null, 2) + '\n'; };

  it('the committed tree passes the check', () => {
    const { ok, out } = run();
    expect(out).not.toMatch(/packages npm/);
    expect(ok, out).toBe(true);
  });

  it('a stale npm package version fails the check, and --fix heals it to the server.json version', () => {
    mutate('server.json', editServerJson((o) => { npmEntries(o)[0].version = '0.0.1'; }), () => {
      const bad = run();
      expect(bad.ok).toBe(false);
      expect(bad.out).toMatch(/packages npm dchub-mcp-server version 0\.0\.1 != /);
      run(['--fix']);
      const healed = JSON.parse(fs.readFileSync(R('server.json'), 'utf8'));
      expect(npmEntries(healed)[0].version).toBe(healed.version);
    });
  });

  it('an identifier that is not the launcher fails the check', () => {
    mutate('server.json', editServerJson((o) => { npmEntries(o)[0].identifier = 'some-other-package'; }), () => {
      const { ok, out } = run();
      expect(ok).toBe(false);
      expect(out).toMatch(/packages npm identifier "some-other-package" != npm-launcher\/package\.json name/);
    });
  });
});
