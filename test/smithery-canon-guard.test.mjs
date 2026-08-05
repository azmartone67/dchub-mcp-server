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

// Canon read FROM the snapshot — never transcribed. Resolution mirrors the
// script exactly (★2026-08-05): canonical/canon_phrases.json is the ONLY
// source. It used to fall back to the script's X_FLOOR constants, but those
// were deleted — a frozen fallback fails OPEN, and FACILITIES_FLOOR had itself
// drifted to '15,300+' against a live canon of 16,500+. A test that can fall
// back to a stale constant is a test that can certify stale canon.
const CANON_PATH = path.join(ROOT, 'canonical', 'canon_phrases.json');
const SNAP = (() => {
  try { return JSON.parse(fs.readFileSync(CANON_PATH, 'utf8')); }
  catch { return null; }
})();
const isPhrase = (v) => typeof v === 'string' && /^\d[\d,]*\+$/.test(v);
const DEALS = (SNAP && isPhrase(SNAP.deals)) ? SNAP.deals : null;
const FACILITIES = (SNAP && isPhrase(SNAP.facilities)) ? SNAP.facilities : null;

/** Temporarily replace the canon snapshot, run fn, always restore. */
function withCanonMutation(mutate, fn) {
  const original = fs.readFileSync(CANON_PATH, 'utf8');
  try {
    fs.writeFileSync(CANON_PATH, mutate(original));
    return fn();
  } finally {
    fs.writeFileSync(CANON_PATH, original);
  }
}

describe('smithery.yaml canonical-quantity guard', () => {
  it('resolves the canonical floors from the snapshot (not from this test)', () => {
    expect(DEALS, `deals missing/malformed in ${CANON_PATH} — the guard test is blind`).toBeTruthy();
    expect(FACILITIES, `facilities missing/malformed in ${CANON_PATH} — the guard test is blind`).toBeTruthy();
  });

  // ── the fail-closed controls (★2026-08-05) ──
  // The guard must refuse to run on an unusable snapshot rather than heal every
  // registry surface to a number frozen in source. These prove it: without them
  // a future "just add a sensible default" would sail through review.
  it('REFUSES to run when the canon snapshot is unreadable (no frozen fallback)', () => {
    withCanonMutation(() => '{ not json', () => {
      const { ok, out } = check();
      expect(ok, 'guard ran anyway — it must not heal from a hardcoded fallback').toBe(false);
      expect(out).toMatch(/FATAL \(canon\)/);
    });
  });

  it('REFUSES to run when a canon quantity is not a floor phrase', () => {
    withCanonMutation((orig) => {
      const j = JSON.parse(orig);
      j.facilities = 16500; // a number, not the "16,500+" floor form
      return JSON.stringify(j, null, 2);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'guard accepted a malformed canon quantity').toBe(false);
      expect(out).toMatch(/not a floor phrase/);
    });
  });

  it('tracks the snapshot rather than any number frozen in the script', () => {
    // Move canon to a value that appears nowhere in the repo. The guard must
    // now report the COMMITTED surfaces as drifted against it — proving the
    // quantities it enforces come from the snapshot, not from source.
    withCanonMutation((orig) => {
      const j = JSON.parse(orig);
      j.facilities = '19,900+';
      return JSON.stringify(j, null, 2);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'guard ignored a moved canon — it is not snapshot-driven').toBe(false);
      expect(out).toMatch(/19,900\+/);
    });
    // And no source file was left carrying the throwaway value.
    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(script).not.toMatch(/19,900\+/);
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

  // ── noun-coverage controls (★2026-08-05) ──
  // The facilities rule knew exactly one word for the thing it counts. So
  // REGISTRY-LISTINGS.md — the file a human pastes from to correct a listing —
  // advertised "15,300+ data centers worldwide", "search 15,300+ data centers
  // across 170+ countries" and "facility search (15,300+)" against a canon of
  // 16,500+, and `node scripts/sync-tools-manifest.mjs` called the tree clean
  // while this very suite passed. A guard blind to the commonest phrasing of
  // its own subject is not a guard, so each blind spot gets a control that
  // fails without the fix.
  const LISTINGS = path.join(ROOT, 'REGISTRY-LISTINGS.md');
  function withFileMutation(file, mutate, fn) {
    const original = fs.readFileSync(file, 'utf8');
    try {
      const next = mutate(original);
      expect(next, `mutation of ${path.basename(file)} was a no-op — control proves nothing`)
        .not.toBe(original);
      fs.writeFileSync(file, next);
      return fn();
    } finally {
      fs.writeFileSync(file, original);
    }
  }

  // (a) the "data center(s)" noun — number FIRST
  it('FAILS when a listing claims a stale "N data centers" (the noun the rule lacked)', () => {
    withFileMutation(LISTINGS,
      (orig) => orig.replace(`${FACILITIES} data centers`, '15,300+ data centers'),
      () => {
        const { ok, out } = check();
        expect(ok, 'guard did NOT catch a stale "data centers" count — the noun gap is back').toBe(false);
        expect(out).toMatch(/REGISTRY-LISTINGS\.md: .*stale facility count/);
      });
  });

  // (b) number AFTER the noun — "facility search (15,300+)"
  it('FAILS when the quantity trails the noun — "facility search (15,300+)"', () => {
    withFileMutation(LISTINGS,
      (orig) => orig.replace(`facility search (${FACILITIES})`, 'facility search (15,300+)'),
      () => {
        const { ok, out } = check();
        expect(ok, 'guard did NOT catch a trailing parenthesised quantity').toBe(false);
        expect(out).toMatch(/facility search \(15,300\+\)/);
      });
  });

  // (c) the head noun ELIDED — "1,600+ tracked M&A," with no "deals" after it
  it('FAILS when a deal count elides its head noun ("N tracked M&A,")', () => {
    withFileMutation(LISTINGS,
      (orig) => orig.replace(`${DEALS} tracked M&A,`, '1,600+ tracked M&A,'),
      () => {
        const { ok, out } = check();
        expect(ok, 'guard did NOT catch "N tracked M&A" with the head noun elided').toBe(false);
        expect(out).toMatch(/stale deal count/);
      });
  });

  // (d) the hazard the widened noun introduces: "a 100 MW data center" is a
  // CAPACITY claim, not a fleet count. It sits in server.mjs sample intents —
  // a file this guard HEALS — and 100 clears the >=50 floor, so without the
  // capacity-unit skip `--fix` would write "16,500+ MW data center" into the
  // live gateway. Verified 2026-08-05: removing the skip makes the guard report
  // exactly that, twice. Asserted against the committed tree, with a
  // non-vacuity check that the hazard phrase is really in the scanned file.
  it('never heals "N MW data center" — a capacity claim is not a fleet count', () => {
    const server = fs.readFileSync(SERVER, 'utf8');
    expect(server, 'no "N MW data center" left in server.mjs — this control is vacuous')
      .toMatch(/\d{2,4} MW data cent/);
    const { ok, out } = check();
    expect(ok, `a capacity claim must not read as a stale count:\n${out}`).toBe(true);
  });

  // (e) the raw-discovery-pile phrase must stay exempt under the WIDER noun —
  // "~4,900 of 21,900+ tracked facilities" is the verified-of-tracked basis, a
  // different quantity from the deduped fleet. Healing it to the fleet figure
  // would erase the distinction.
  it('still exempts the raw-pile "N tracked facilities" provenance phrase', () => {
    withFileMutation(LISTINGS,
      (orig) => orig.replace('## Categories / tags',
        '~4,900 analyst-verified of 21,900+ tracked facilities.\n\n## Categories / tags'),
      () => {
        const { ok, out } = check();
        expect(ok, `the raw-pile phrase must never track the fleet canon:\n${out}`).toBe(true);
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
