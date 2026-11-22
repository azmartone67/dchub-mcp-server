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

// ★2026-11-22 (owner): the skill files name no deal or market count any more
// ("tracked M&A deals", "markets scored daily"), so the heal path is exercised on
// the canon count they still carry, countries. Same bug class: --fix must heal
// canonical/skill.md, or the skill block re-renders the old figure into every copy.
describe('a canon count move heals canonical/skill.md and every rendered copy', () => {
  const original = fs.readFileSync(PHRASES, 'utf8');
  const was = JSON.parse(original).countries;                   // e.g. "170+"
  const n = Number(String(was).replace(/[^\d]/g, ''));
  const now = `${n - 10}+`;                                     // canon moves DOWN, as on 11-01
  const COUNT = /\b\d[\d,]*\+?\s+(?:(?:DC\s+Hub|DCPI|metro|scored)\s+)?markets?\b|\b\d[\d,]*\+?\s+(?:tracked\s+)?(?:M&A\s+)?(?:deals?|transactions?)\b/i;

  it('the committed skill files state the committed canon and no market or deal count (precondition)', () => {
    expect(n).toBeGreaterThan(20);
    for (const f of SKILL_FILES) {
      const t = read(f);
      expect(t, f).toContain(`${was} countries`);
      expect(t, f).not.toMatch(COUNT);
      expect(t, f).toContain('tracked M&A deals');
    }
  });

  it('--fix carries the new canon into all four skill files, and CHECK then passes', () => {
    SANDBOX.write(PHRASES, original.replace(`"countries": "${was}"`, `"countries": "${now}"`));
    try {
      expect(JSON.parse(fs.readFileSync(PHRASES, 'utf8')).countries).toBe(now);   // the mutation applied
      run(['--fix']);
      for (const f of SKILL_FILES) {
        const t = read(f);
        expect(t, `${f} kept the old canon`).not.toContain(`${was} countries`);
        expect(t, `${f} did not take the new canon`).toContain(`${now} countries`);
        expect(t, `${f} gained a market or deal count`).not.toMatch(COUNT);
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
