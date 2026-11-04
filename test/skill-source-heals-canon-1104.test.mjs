// A canon move must heal the skill files, not just every surface around them (2026-11-04).
//
// daily-manifest-sync was red from 11-01: canon moved deals 1,800+ -> 1,700+, --fix healed
// skills/dc-hub-data-center-intelligence/SKILL.md in its COVERAGE loop, and then the skill
// block re-rendered that file (and skill.md, kiro-power/…/SKILL.md) from canonical/skill.md,
// which no quantity heal touched. pend() is last-write-wins, so the stale "1,800+ tracked
// deals" came back, the guard called it an OVERCLAIM, and the hard gate refused the heal
// every day (run 41756206822). Run in a private copy: this test moves canon.
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoSandbox } from './helpers/repo-sandbox.mjs';
import { SKILL_SOURCE, SKILL_TARGETS } from '../scripts/listing-canon.mjs';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SANDBOX = createRepoSandbox(REAL_ROOT, 'dchub-skill-heal');
afterAll(() => SANDBOX.cleanup());
const ROOT = SANDBOX.root;
const SCRIPT = path.join(ROOT, 'scripts', 'sync-tools-manifest.mjs');
const PHRASES = path.join(ROOT, 'canonical', 'canon_phrases.json');

const run = (args = []) => {
  try { return { ok: true, out: execFileSync('node', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SKILL_FILES = [SKILL_SOURCE, ...SKILL_TARGETS.map((t) => t.path)];

describe('a canon deal-count move heals canonical/skill.md and every rendered copy', () => {
  const original = fs.readFileSync(PHRASES, 'utf8');
  const was = JSON.parse(original).deals;                       // e.g. "1,800+"
  const n = Number(String(was).replace(/[^\d]/g, ''));
  const now = `${(n - 100).toLocaleString('en-US')}+`;          // canon moves DOWN, as on 11-01

  it('the committed skill files state the committed canon (precondition)', () => {
    expect(n).toBeGreaterThan(100);
    for (const f of SKILL_FILES) expect(read(f), f).toContain(`${was} tracked deals`);
  });

  it('--fix carries the new canon into all four skill files, and CHECK then passes', () => {
    SANDBOX.write(PHRASES, original.replace(`"deals": "${was}"`, `"deals": "${now}"`));
    try {
      expect(JSON.parse(fs.readFileSync(PHRASES, 'utf8')).deals).toBe(now);   // the mutation applied
      run(['--fix']);
      for (const f of SKILL_FILES) {
        const t = read(f);
        expect(t, `${f} kept the old canon`).not.toContain(`${was} tracked deals`);
        expect(t, `${f} did not take the new canon`).toContain(`${now} tracked deals`);
      }
      const after = run();
      expect(after.ok, `guard should pass on the healed tree:\n${after.out}`).toBe(true);
    } finally {
      SANDBOX.write(PHRASES, original);
    }
  });
});

describe('daily-manifest-sync stages every skill file the heal can write', () => {
  it('each SKILL_SOURCE / SKILL_TARGETS path is in $OWNED (else the UNOWNED gate fails the job)', () => {
    const wf = fs.readFileSync(path.join(REAL_ROOT, '.github', 'workflows', 'daily-manifest-sync.yml'), 'utf8');
    const m = wf.match(/OWNED="([\s\S]*?)"/);
    expect(m, '$OWNED assignment not found').toBeTruthy();
    const owned = new Set(m[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean));
    for (const f of SKILL_FILES) expect(owned.has(f), `${f} missing from $OWNED`).toBe(true);
  });
});
