// Guard for the canonical-quantity drift check in scripts/sync-tools-manifest.mjs.
//
// WHY THIS EXISTS (2026-07-28): the Smithery listing sat two revisions stale
// while every mechanism that claimed to keep it fresh reported clean. The
// drift guard's deal rule was a DENYLIST of shapes — /\b[2-9][,.]?000\+/ —
// carrying the comment "never 1,400+ or 12,650+". It was therefore written to
// PERMIT the exact value that later went stale, and it structurally could not
// match "21,000+" at all. smithery.yaml advertised 21,000+ facilities and
// 1,400+ deals against a canon of 12,650+ / 1,500+ and CI stayed green.
//
// A denylist has to predict every wrong answer. The replacement derives from
// canon and only has to know the right one. This test proves that difference
// is REAL rather than asserted: it injects each stale value the old rule let
// through and requires the guard to fail. A guard that cannot be made to fail
// is not a guard — so the must-fail controls are the point of this file, not
// the happy path.
//
// It deliberately does NOT restate the canonical numbers. It reads them from
// the script itself, so raising a floor updates the test automatically and a
// stale copy here can never certify a stale copy there.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'sync-tools-manifest.mjs');
const YAML = path.join(ROOT, 'smithery.yaml');

/** Run the sync script in CHECK mode. Returns {ok, out}. */
function check() {
  try {
    return { ok: true, out: execFileSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Temporarily replace smithery.yaml, run fn, always restore. */
function withMutation(mutate, fn) {
  const original = fs.readFileSync(YAML, 'utf8');
  try {
    fs.writeFileSync(YAML, mutate(original));
    return fn();
  } finally {
    fs.writeFileSync(YAML, original);
  }
}

// Canon read FROM the script + snapshot — never transcribed. Resolution
// mirrors the script exactly (★2026-07-30): canonical/canon_phrases.json
// (the committed snapshot of /api/v1/canon/phrases) wins; the script's
// X_FLOOR constants are the fallback. If a floor constant stops parsing OR
// the snapshot goes unreadable while present, the test fails loudly rather
// than silently mutating a value the guard no longer checks.
const src = fs.readFileSync(SCRIPT, 'utf8');
const SNAP = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'canonical', 'canon_phrases.json'), 'utf8')); }
  catch { return null; }
})();
const isPhrase = (v) => typeof v === 'string' && /^\d[\d,]*\+$/.test(v);
const DEALS = (SNAP && isPhrase(SNAP.deals)) ? SNAP.deals
  : src.match(/const DEALS_FLOOR\s*=\s*'([^']+)'/)?.[1];
const FACILITIES = (SNAP && isPhrase(SNAP.facilities)) ? SNAP.facilities
  : src.match(/const FACILITIES_FLOOR\s*=\s*'([^']+)'/)?.[1];

describe('smithery.yaml canonical-quantity guard', () => {
  it('resolves the canonical floors from the script (not from this test)', () => {
    expect(DEALS, 'DEALS_FLOOR no longer parseable — the guard test is blind').toBeTruthy();
    expect(FACILITIES, 'FACILITIES_FLOOR no longer parseable — the guard test is blind').toBeTruthy();
  });

  it('reports the committed tree as clean', () => {
    const { ok, out } = check();
    expect(ok, `guard should pass on the committed tree:\n${out}`).toBe(true);
  });

  // ── must-fail controls: each is a value the OLD denylist permitted ──
  const CONTROLS = [
    ['21,000+ facilities', (s) => s.replace(`${FACILITIES} facilities`, '21,000+ facilities')],
    ['21k+ facilities',    (s) => s.replace(`${FACILITIES} facilities`, '21k+ facilities')],
    ['1,400+ tracked M&A deals',
      (s) => s.replace(`${DEALS} tracked M&A deals`, '1,400+ tracked M&A deals')],
  ];

  for (const [label, mutate] of CONTROLS) {
    it(`FAILS when smithery.yaml claims "${label}"`, () => {
      withMutation((orig) => {
        const next = mutate(orig);
        // If the mutation was a no-op the control proves nothing — catch that
        // rather than passing a test that never changed the input.
        expect(next, `mutation "${label}" did not alter smithery.yaml`).not.toBe(orig);
        return next;
      }, () => {
        const { ok, out } = check();
        expect(ok, `guard did NOT catch "${label}" — it is permitting stale canon`).toBe(false);
        expect(out).toMatch(/stale (facility|deal) count/);
      });
    });
  }

  it('a canon:frozen line is exempt (historical statements stay historical)', () => {
    withMutation(
      (orig) => orig.replace(`${FACILITIES} facilities`,
        '21,000+ facilities  # canon:frozen: historical'),
      () => {
        const { ok, out } = check();
        expect(ok, `canon:frozen should exempt the line:\n${out}`).toBe(true);
      });
  });

  // ── server.mjs controls (★2026-07-30) — the file the guard newly covers ──
  // Six "12,650+" literals sat in tool DESCRIPTIONS while the initialize
  // instructions had been rebound to live canon; the guard now scans
  // server.mjs too. These controls prove all three edges of that coverage:
  // it catches a stale description quantity, it NEVER tracks the GEM
  // dataset's own "170+ countries" (a different dataset's coverage, not our
  // canon), and it never rewrites comment-line history.
  const SERVER = path.join(ROOT, 'server.mjs');
  function withServerMutation(mutate, fn) {
    const original = fs.readFileSync(SERVER, 'utf8');
    try {
      const next = mutate(original);
      expect(next, 'server.mjs mutation was a no-op — control proves nothing').not.toBe(original);
      fs.writeFileSync(SERVER, next);
      return fn();
    } finally {
      fs.writeFileSync(SERVER, original);
    }
  }

  it(`FAILS when a server.mjs tool description claims "12,650+ … facilities"`, () => {
    withServerMutation(
      (orig) => orig.replace(`${FACILITIES} global data center facilities`,
        '12,650+ global data center facilities'),
      () => {
        const { ok, out } = check();
        expect(ok, 'guard did NOT catch a stale facility count in server.mjs').toBe(false);
        expect(out).toMatch(/server\.mjs: .*stale facility count/);
      });
  });

  it("never flags GEM's own dataset coverage as a stale country count", () => {
    withServerMutation(
      (orig) => orig.replace('geolocated units across 170+ countries',
        'geolocated units across 190+ countries'),
      () => {
        // NB: the overall check MAY fail here — mutating a live description
        // legitimately trips the mcp-server.json description-drift guard
        // (the derived manifest no longer matches). The property under test
        // is narrower: the countries CANON rule must not claim the GEM
        // dataset's own coverage figure, which is not our quantity.
        const { out } = check();
        expect(out, "the GEM dataset's own coverage claim must never track our canon")
          .not.toMatch(/stale country count/);
      });
  });

  it('PASSES when a // comment line carries a retired figure (history stays true)', () => {
    withServerMutation(
      (orig) => orig.replace('// r-honest-figures (2026-07-30): every figure below binds',
        '// r-honest-figures (2026-07-30): once said 12,650+ facilities and 311 markets; every figure below binds'),
      () => {
        const { ok, out } = check();
        expect(ok, `comment lines must never be scanned as claims:\n${out}`).toBe(true);
      });
  });

  it('the tools: list matches the live catalog count', () => {
    const yaml = fs.readFileSync(YAML, 'utf8');
    const block = yaml.match(/^tools:\n((?:[ \t]*-[ \t]+\S+\n)+)/m);
    expect(block, 'smithery.yaml has no parseable tools: list').toBeTruthy();
    const listed = [...block[1].matchAll(/-[ \t]+(\S+)/g)].map((x) => x[1]);
    const count = Number(
      execFileSync('node', [SCRIPT, '--print-count'], { cwd: ROOT, encoding: 'utf8' }).trim());
    expect(count).toBeGreaterThan(20);
    expect(listed.length, 'smithery.yaml tools: list drifted from the live catalog').toBe(count);
  });
});
