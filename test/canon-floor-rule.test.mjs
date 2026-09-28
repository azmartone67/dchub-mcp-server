// The canon FLOOR rule (owner decision 2026-09-26; same rule as
// dchub-desktop-extension#5). One implementation, scripts/canon-floor.mjs, used
// by every canon-number check in this repo:
//   sync-tools-manifest.mjs  (manifest-consistency required check + pre-commit)
//   check-served-manifest.mjs (served-manifest-drift)
//   ecosystem-sync.mjs judge() (hosted listings)
//
// For a "+" count P against canon C:
//   P > C            FAIL (overclaim)
//   C*0.95 <= P < C  PASS with ::warning::
//   P == C           PASS
//   P < C*0.95       FAIL (too stale)
// Tool counts are exact.
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOOR_TOLERANCE, judgeCount } from '../scripts/canon-floor.mjs';
import { judge } from '../scripts/ecosystem-sync.mjs';
import { createRepoSandbox } from './helpers/repo-sandbox.mjs';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fmt = (n) => `${Math.round(n).toLocaleString('en-US')}+`;
const num = (s) => Number(String(s).replace(/[,+]/g, ''));

describe('judgeCount: the rule itself', () => {
  const C = 24800;
  it('the tolerance is 5%, as a fraction below canon', () => {
    expect(FLOOR_TOLERANCE).toBe(0.05);
  });
  it('equal -> pass, no warning', () => {
    expect(judgeCount(C, C, { floor: true })).toEqual({ state: 'ok', pass: true, warn: false });
  });
  it('3% below -> pass, with a warning', () => {
    expect(judgeCount(C * 0.97, C, { floor: true })).toEqual({ state: 'warn', pass: true, warn: true });
  });
  it('exactly 5% below -> still passes (inclusive edge)', () => {
    expect(judgeCount(C * 0.95, C, { floor: true }).pass).toBe(true);
  });
  it('6% below -> fail (too stale)', () => {
    expect(judgeCount(C * 0.94, C, { floor: true })).toMatchObject({ state: 'stale', pass: false });
  });
  it('above canon -> fail, even by one (overclaim has no tolerance)', () => {
    expect(judgeCount(C + 1, C, { floor: true })).toMatchObject({ state: 'overclaim', pass: false });
  });
  it('tool count off by one -> fail, either direction, "+" or not', () => {
    for (const n of [91, 93]) {
      expect(judgeCount(n, 92, { exact: true }).pass).toBe(false);
      expect(judgeCount(n, 92, { exact: true, floor: true }).pass).toBe(false);
    }
    expect(judgeCount(92, 92, { exact: true }).pass).toBe(true);
  });
  it('a count without "+" is not a floor, so it is exact', () => {
    expect(judgeCount(C * 0.97, C, { floor: false }).pass).toBe(false);
  });
  it('the --self-test mode passes and exits 0', () => {
    const r = spawnSync('node', [path.join(REAL_ROOT, 'scripts', 'canon-floor.mjs'), '--self-test'], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/all checks passed/);
    expect(r.stdout).not.toMatch(/FAIL/);
  });
});

// ---- the required check: sync-tools-manifest.mjs CHECK mode -----------------
// Moves the canon SNAPSHOT so the committed tree lands at a chosen distance from
// it — the real "canon moved, prose did not" case, end to end, in a private copy
// of the repo.
//
// ★2026-09-27: the tree-wide cases walk the DEAL floor, not facilities. The
// facility COUNT is withdrawn (owner decision) and is being removed from every
// surface, so a facility-based case here would go vacuous the day the last
// frozen file (server.mjs, until 2026-10-02) loses its number. Deals is the
// same "+" floor rule on a quantity every surface still states.
const SANDBOX = createRepoSandbox(REAL_ROOT, 'dchub-floor');
afterAll(() => SANDBOX.cleanup());
const ROOT = SANDBOX.root;
const SCRIPT = path.join(ROOT, 'scripts', 'sync-tools-manifest.mjs');
const CANON_PATH = path.join(ROOT, 'canonical', 'canon_phrases.json');
const SNAP = JSON.parse(fs.readFileSync(CANON_PATH, 'utf8'));
const TREE_DEALS = num(SNAP.deals);

function check() {
  try {
    return { ok: true, out: execFileSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}
function withFile(file, mutate, fn) {
  const original = fs.readFileSync(file, 'utf8');
  const next = mutate(original);
  // The mutation must actually land, or a "pass" proves nothing.
  expect(next, `mutation did not change ${path.basename(file)}`).not.toBe(original);
  try {
    SANDBOX.write(file, next);
    return fn();
  } finally {
    SANDBOX.write(file, original);
  }
}
const withCanonDeals = (phrase, fn) =>
  withFile(CANON_PATH, (s) => JSON.stringify({ ...JSON.parse(s), deals: phrase }, null, 2) + '\n', fn);

describe('sync-tools-manifest.mjs CHECK applies the floor rule', () => {
  it('snapshot is a real floor phrase (else every case below is vacuous)', () => {
    expect(SNAP.deals).toMatch(/^\d[\d,]*\+$/);
    expect(TREE_DEALS).toBeGreaterThan(1000);
  });

  it('CONTROL: equal to canon -> pass, no warning', () => {
    const r = check();
    expect(r.ok, r.out).toBe(true);
    expect(r.out).not.toMatch(/::warning::.*deal count/);
  });

  it('tree 3% below canon -> pass, with a ::warning:: naming the floor', () => {
    const canon = fmt(TREE_DEALS / 0.97);
    withCanonDeals(canon, () => {
      const r = check();
      expect(r.ok, r.out).toBe(true);
      expect(r.out).toMatch(new RegExp(`::warning::.*${SNAP.deals.replace('+', '\\+')}.*below canon ${canon.replace('+', '\\+')} but within 5%`));
    });
  });

  it('tree 6% below canon -> fail as too stale', () => {
    const canon = fmt(TREE_DEALS / 0.94);
    withCanonDeals(canon, () => {
      const r = check();
      expect(r.ok, 'a floor 6% below canon passed').toBe(false);
      expect(r.out).toMatch(/too stale, more than 5% below canon/);
    });
  });

  it('tree above canon -> fail as an overclaim, even by 1%', () => {
    const canon = fmt(TREE_DEALS * 0.99);
    withCanonDeals(canon, () => {
      const r = check();
      expect(r.ok, 'an overclaim passed').toBe(false);
      expect(r.out).toMatch(/OVERCLAIM/);
    });
  });

  it('tool count off by one -> fail (tools are exact)', () => {
    const readme = path.join(ROOT, 'README.md');
    const tools = SNAP.tools;
    withFile(readme, (s) => s.replace(`all ${tools} tools`, `all ${tools - 1} tools`), () => {
      const r = check();
      expect(r.ok, 'a tool count one below canon passed').toBe(false);
      expect(r.out).toMatch(new RegExp(`tool-count\\(s\\) ${tools - 1} != ${tools}`));
    });
  });

  it('a prose floor 3% under canon in ONE file passes with a warning; 6% under fails', () => {
    const readme = path.join(ROOT, 'README.md');
    const warmer = fmt(TREE_DEALS * 0.97);
    const colder = fmt(TREE_DEALS * 0.94);
    withFile(readme, (s) => s.split(SNAP.deals).join(warmer), () => {
      const r = check();
      expect(r.ok, r.out).toBe(true);
      expect(r.out).toMatch(/::warning::README\.md:.*within 5%/);
    });
    withFile(readme, (s) => s.split(SNAP.deals).join(colder), () => {
      expect(check().ok).toBe(false);
    });
  });

  // ★2026-09-27 the facility COUNT is withdrawn: a facility floor on a
  // non-frozen surface fails CHECK even when it EQUALS canon — "matches canon"
  // is no longer a pass for this one quantity.
  it('a facility floor equal to canon in README fails as withdrawn', () => {
    const readme = path.join(ROOT, 'README.md');
    withFile(readme, (s) => s.replace('300+ markets', `${SNAP.facilities} facilities, 300+ markets`), () => {
      const r = check();
      expect(r.ok, 'a withdrawn facility count passed CHECK').toBe(false);
      expect(r.out).toMatch(/README\.md: .*facility count withdrawn — owner decision 2026-09-27/);
    });
  });
});

// ---- ecosystem-sync judge(): hosted listings ----------------------------------
// Tools use the exact rule; facilities are WITHDRAWN (owner decision 2026-09-27):
// no floor = in_sync, any floor (equal, below or above canon) = drift.
describe('ecosystem-sync judge() on hosted listings', () => {
  const CANON = { tools: 92, facilities: '24,800+', version: '2.12.21' };
  const hosted = (floors, extra = {}) => judge({ read: true, floors, ...extra }, CANON, { kind: 'manual' });
  it('no facility floor -> in_sync, no note', () => {
    expect(hosted([])).toEqual({ state: 'in_sync', reasons: [] });
  });
  for (const f of ['24,800+', fmt(24800 * 0.97), fmt(24800 * 0.94), '24,900+']) {
    it(`a ${f} floor -> drift, count withdrawn`, () => {
      const v = hosted([f]);
      expect(v.state).toBe('drift');
      expect(v.reasons.join(' ')).toMatch(/count withdrawn — owner decision 2026-09-27/);
      expect(v.notes).toBeUndefined();
    });
  }
  it('tool count off by one -> drift', () => {
    expect(hosted([], { tools: 91 }).state).toBe('drift');
  });
});

// ---- check-served-manifest.mjs: network-bound, so pin the wiring -------------
describe('check-served-manifest.mjs routes quantities through the rule', () => {
  const src = fs.readFileSync(path.join(REAL_ROOT, 'scripts', 'check-served-manifest.mjs'), 'utf8');
  it('imports judgeCount and no longer compares floors by string equality', () => {
    expect(src).toMatch(/import \{[^}]*judgeCount[^}]*\} from '\.\/canon-floor\.mjs'/);
    expect(src).not.toMatch(/seen !== expected\) note/);
    expect(src).toMatch(/if \(v\.warn\) console\.log\(ghWarning/);
  });
  it('reports ANY served facility floor as drift (count withdrawn), not by the floor rule', () => {
    expect(src).toMatch(/import \{[^}]*findFacilityFloors[^}]*\} from '\.\/canon-floor\.mjs'/);
    expect(src).toMatch(/findFacilityFloors\(desc\)/);
    expect(src).not.toMatch(/\['facilities', \//);
  });
  it('keeps tool counts exact', () => {
    expect(src).toMatch(/String\(servedTools\) !== String\(canon\.tools\)/);
  });
});
