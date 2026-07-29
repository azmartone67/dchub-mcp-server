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

// Canon read FROM the script — never transcribed. If these stop resolving the
// test fails loudly rather than silently checking nothing.
const src = fs.readFileSync(SCRIPT, 'utf8');
const DEALS = src.match(/const DEALS_FLOOR\s*=\s*'([^']+)'/)?.[1];
const FACILITIES = src.match(/const FACILITIES_FLOOR\s*=\s*'([^']+)'/)?.[1];

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
