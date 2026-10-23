// sync-tools-manifest --fix heals README's EU-zone count from canonical/mcp_facts.json
// (2026-10-23). Canon moved 24 -> 30 (be#7609); the daily mcp-facts-export wrote 30
// but its PR stopped at the facts drift guard because README.md still said "24
// European ENTSO-E zones", a number --fix would not touch. Run in a private copy.
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoSandbox } from './helpers/repo-sandbox.mjs';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = createRepoSandbox(REAL_ROOT, 'dchub-eu-heal');
afterAll(() => SANDBOX.cleanup());
const ROOT = SANDBOX.root;
const SCRIPT = path.join(ROOT, 'scripts', 'sync-tools-manifest.mjs');
const README = path.join(ROOT, 'README.md');
const FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'canonical', 'mcp_facts.json'), 'utf8'));
const CANON = FACTS.grid_coverage.eu_entsoe_zones;

const run = (args = []) => {
  try { return { ok: true, out: execFileSync('node', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

describe('README EU-zone count follows canon under --fix', () => {
  const original = fs.readFileSync(README, 'utf8');
  const stale = CANON - 6;
  it('the committed README states the canon count (precondition)', () => {
    expect(original).toMatch(new RegExp(`\\b${CANON}\\+? EU bidding zones`));
  });

  it('a stale count fails CHECK, --fix heals it keeping the "+", and CHECK passes again', () => {
    const drifted = original.replace(new RegExp(`\\b${CANON}(\\+? EU bidding zones)`), `${stale}$1`);
    expect(drifted).not.toBe(original);
    SANDBOX.write(README, drifted);
    try {
      const before = run();
      expect(before.ok).toBe(false);
      expect(before.out).toMatch(new RegExp(`README\\.md: EU-zone count ${stale} != canonical ${CANON}`));
      run(['--fix']);
      const healed = fs.readFileSync(README, 'utf8');
      expect(healed).toContain(`${CANON}+ EU bidding zones (ENTSO-E)`);
      expect(healed).not.toMatch(new RegExp(`\\b${stale}\\+? EU bidding zones`));
      expect(run().ok).toBe(true);
    } finally {
      SANDBOX.write(README, original);
    }
  });

  it('a price drift is still never rewritten by --fix', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const block = src.slice(src.indexOf("if (FIX && euZones)"), src.indexOf("if (FIX && euZones)") + 900);
    expect(block).not.toMatch(/proPrice/);
  });
});
