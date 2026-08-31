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
//
// ★2026-08-17 (r-sandbox): every mutation below used to happen IN THE SHARED
// WORKING TREE. It no longer does — see test/helpers/repo-sandbox.mjs for the
// full autopsy. Short version: vitest runs test FILES in parallel and several
// siblings readFileSync server.mjs at module load, so they could observe this
// file's transient "190+ countries" / "12,650+ … facilities" mutations and
// fail on drift nobody introduced. Measured on this repo at 3e73cd0: a sampler
// reading server.mjs alongside six canon-guard runs caught the stale claims in
// 307 of 8,233 samples, and caught the file at ZERO BYTES once (writeFileSync
// opens O_TRUNC then writes, and server.mjs is ~1 MB).
// The flake was the visible half. The invisible half is that a clobbered
// mutation or an early restore makes the must-fail controls below pass
// VACUOUSLY — a guard certifying canon it never actually broke. So the
// mutations now run against a private copy of the working tree, through a
// writer that REFUSES any path outside it. The refusal is the guarantee; the
// tree fingerprint at the bottom of this file is only a backstop, and a weak
// one (see the note on the isolation controls).
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoSandbox, fingerprintTree, fingerprintDiff } from './helpers/repo-sandbox.mjs';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Fingerprint the shared tree BEFORE anything runs, so the afterAll control
// below can prove nothing here touched it.
const TREE_BEFORE = fingerprintTree(REAL_ROOT);

// Every path this file reads or writes points INTO the sandbox. The sync
// script derives its ROOT from its own location and never reads process.cwd,
// so invoking the sandbox copy roots the whole check inside the sandbox.
const SANDBOX = createRepoSandbox(REAL_ROOT);
const ROOT = SANDBOX.root;
afterAll(() => SANDBOX.cleanup());

// The single write primitive every mutation below uses. It REFUSES any path
// outside the sandbox, which is what makes the isolation deterministic rather
// than merely observed: a mutate-and-restore aimed at the shared tree is
// invisible to an after-the-fact tree comparison (the restore heals it before
// anyone looks) but cannot get past this.
const sandboxWrite = SANDBOX.write;

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
    sandboxWrite(YAML, mutate(original));
    return fn();
  } finally {
    sandboxWrite(YAML, original);
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
    sandboxWrite(CANON_PATH, mutate(original));
    return fn();
  } finally {
    sandboxWrite(CANON_PATH, original);
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

  // ★★2026-08-31 — THE SENTINEL COLLIDED WITH REALITY AND THE TEST BLAMED THE
  // GUARD. This mutated canon to the hardcoded literal '19,900+', under the
  // comment "a value that appears nowhere in the repo". True the day it was
  // written. On 2026-08-31 the daily canon sync moved facilities to 19,900+ FOR
  // REAL and committed it [skip ci], so nothing ran this until the next PR:
  // the mutation became a no-op (smithery.yaml already carried 19,900+), the
  // guard correctly reported NO drift, and the test failed — asserting the
  // guard was broken at the exact moment it was working.
  //
  // A sentinel that is merely UNUSED TODAY is a time bomb on a value that
  // climbs past it. So it is now (a) an impossible magnitude rather than a
  // plausible next value, and (b) asserted absent before use, so a future
  // collision is a loud refusal naming the cause instead of a confusing red
  // against innocent code.
  const IMPOSSIBLE = '99,999,999+';

  it('the drift sentinel has not itself become a real canon value', () => {
    // The guard reads smithery.yaml and the snapshot; if the sentinel ever
    // appears in either, the mutation below is a no-op and every assertion
    // that follows is vacuous.
    for (const [label, file] of [['smithery.yaml', YAML], ['canon snapshot', CANON_PATH]]) {
      expect(fs.readFileSync(file, 'utf8'), `${label} already contains the drift sentinel `
        + `${IMPOSSIBLE} — pick a new one; the mutation test below cannot prove anything `
        + 'while the "wrong" value is also the right one').not.toContain(IMPOSSIBLE);
    }
  });

  it('tracks the snapshot rather than any number frozen in the script', () => {
    // Move canon to a value the surfaces cannot already carry. The guard must
    // now report the COMMITTED surfaces as drifted against it — proving the
    // quantities it enforces come from the snapshot, not from source.
    withCanonMutation((orig) => {
      const j = JSON.parse(orig);
      j.facilities = IMPOSSIBLE;
      return JSON.stringify(j, null, 2);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'guard ignored a moved canon — it is not snapshot-driven').toBe(false);
      expect(out).toContain(IMPOSSIBLE);
    });
    // And no source file was left carrying the throwaway value.
    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(script).not.toContain(IMPOSSIBLE);
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
      sandboxWrite(SERVER, next);
      return fn();
    } finally {
      sandboxWrite(SERVER, original);
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
      sandboxWrite(file, next);
      return fn();
    } finally {
      sandboxWrite(file, original);
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

  // ── isolation controls (★2026-08-17) ──
  // Isolation is enforced in three places, weakest last, because the first two
  // are the ones that hold:
  //   1. SANDBOX.write() REFUSES a path outside the sandbox — deterministic,
  //      at the write site. This is the real guarantee.
  //   2. the static scan below — no OTHER test file may write to disk at all.
  //   3. the tree fingerprint — an after-the-fact backstop.
  // (3) is listed last on purpose. It does catch a mutate-and-restore in THIS
  // file's own run window — verified 2026-08-17 by bypassing (1) with a raw
  // fs.writeFileSync at the real server.mjs, which it flagged, because it signs
  // mtime/ctime/inode and not just content. But it reports only after the
  // window has already been open, and it cannot see a SIBLING file's write at
  // all. Reading it as the guarantee would be exactly the vacuous-control
  // mistake this file exists to prevent.

  it('refuses to write outside the sandbox (the write-site guarantee)', () => {
    expect(ROOT, 'the sandbox must not be the repo itself').not.toBe(REAL_ROOT);
    expect(SANDBOX.inside(path.join(ROOT, 'server.mjs')), 'sandbox paths must be writable')
      .toBe(true);
    expect(() => sandboxWrite(path.join(REAL_ROOT, 'server.mjs'), 'x'))
      .toThrow(/refusing to write OUTSIDE the sandbox/);
    // …including the sandbox's own parent, and any path that merely shares a prefix.
    expect(() => sandboxWrite(`${ROOT}-sibling/server.mjs`, 'x'))
      .toThrow(/refusing to write OUTSIDE the sandbox/);
    expect(() => sandboxWrite(path.join(ROOT, '..', 'escape.txt'), 'x'))
      .toThrow(/refusing to write OUTSIDE the sandbox/);
  });

  it('left the shared working tree untouched', () => {
    const changed = fingerprintDiff(TREE_BEFORE, fingerprintTree(REAL_ROOT));
    expect(changed.join(', '),
      'a test wrote to the shared working tree — that is the race this file was ' +
      'isolated to close (mutate the sandbox copy, never the repo)').toBe('');
    // Non-vacuity: the fingerprint must actually be able to see the files the
    // controls above mutate, or "unchanged" means nothing.
    for (const rel of ['server.mjs', 'smithery.yaml', 'canonical/canon_phrases.json',
                       'REGISTRY-LISTINGS.md']) {
      expect(TREE_BEFORE.has(rel), `${rel} is not fingerprinted — this control is blind`).toBe(true);
    }
  });

  // Source-level companion, and the only one of the three that can see a
  // SIBLING test file: neither the write-site check nor the fingerprint can
  // reliably catch another worker's mutate-and-restore.
  it('no other test file writes to the shared working tree', () => {
    const TEST_DIR = path.join(REAL_ROOT, 'test');
    // Exactly ONE exemption: the sandbox helper, whose whole job is the temp
    // copy. This file is NOT exempt — it writes only through SANDBOX.write(),
    // so a raw fs write reintroduced here gets caught like anyone else's.
    const ALLOWED = new Set(['helpers/repo-sandbox.mjs']);
    const WRITES = /\bfs(?:p|\.promises)?\.(writeFileSync|writeFile|appendFileSync|appendFile|rmSync|rm|unlinkSync|unlink|renameSync|rename|copyFileSync|copyFile|cpSync|cp|truncateSync|truncate|createWriteStream)\s*\(/;

    const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory()
        ? walk(path.join(dir, e.name), `${prefix}${e.name}/`)
        : (e.name.endsWith('.mjs') ? [`${prefix}${e.name}`] : [])));
    const files = walk(TEST_DIR);

    // Non-vacuity: the pattern must fire on the file that legitimately writes.
    const helper = fs.readFileSync(path.join(TEST_DIR, 'helpers', 'repo-sandbox.mjs'), 'utf8');
    expect(WRITES.test(helper), 'the write-detector matches nothing — this control is vacuous')
      .toBe(true);

    const offenders = files.filter((rel) => !ALLOWED.has(rel)
      && WRITES.test(fs.readFileSync(path.join(TEST_DIR, rel), 'utf8')));
    expect(offenders.join(', '),
      'these test files mutate files on disk — vitest runs test FILES in parallel, so a ' +
      'sibling reading the same path can observe it mid-write (fs.writeFileSync truncates ' +
      'first). Use createRepoSandbox() from test/helpers/repo-sandbox.mjs instead.').toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ASSET-CLASS quantities (★2026-08-30)
//
// WHY THIS EXISTS: the four phrase quantities above healed from
// canon_phrases.json. The asset-class figures did not — server.mjs recorded
// them as "not yet in the phrases feed and remain hand-bound" — so they
// rotted for a month while every check stayed green. Measured against the
// LIVE gate on 2026-08-30, one session, one server, two answers:
//
//   initialize.instructions    330,000+ assets · 127k substations · 64k fiber
//   dchub://coverage resource  320,000+ assets · 126k substations · 55k fiber
//
// The coverage resource carried the CORRECT facilities and markets figures in
// the SAME paragraph, because those two heal and the asset ones did not.
// Fiber published 15% under the measured 64,836.
//
// Nothing could go red. instructions-compose.test.mjs asserts only that the
// KEY EXISTS in the facts object; end-of-burst-hook.test.mjs asserts against
// its own hardcoded '320,000+' fixture. Both are still green and both always
// would have been. So, as above, the MUST-FAIL controls are the point of this
// block — not the happy path.
//
// Canon is read from canonical/mcp_facts.json and never transcribed here, for
// the same reason the block above reads canon_phrases.json: a number frozen in
// a test can only ever certify a stale number in the source.
const FACTS_PATH = path.join(ROOT, 'canonical', 'mcp_facts.json');
const SERVER = path.join(ROOT, 'server.mjs');
const FACTS = (() => {
  try { return JSON.parse(fs.readFileSync(FACTS_PATH, 'utf8')); }
  catch { return null; }
})();
const isAssetPhrase = (v) => typeof v === 'string' && /^\d{1,3}(?:,\d{3})*k?\+?$/.test(v);
const FIBER = (FACTS && isAssetPhrase(FACTS.numbers?.fiber_routes)) ? FACTS.numbers.fiber_routes : null;
const ASSETS_TOTAL = (FACTS && isAssetPhrase(FACTS.numbers?.infrastructure_assets_total))
  ? FACTS.numbers.infrastructure_assets_total : null;

/** Temporarily replace canonical/mcp_facts.json, run fn, always restore. */
function withFactsMutation(mutate, fn) {
  const original = fs.readFileSync(FACTS_PATH, 'utf8');
  try {
    sandboxWrite(FACTS_PATH, mutate(original));
    return fn();
  } finally {
    sandboxWrite(FACTS_PATH, original);
  }
}

/** Temporarily replace server.mjs, run fn, always restore. */
function withServerMutation(mutate, fn) {
  const original = fs.readFileSync(SERVER, 'utf8');
  try {
    sandboxWrite(SERVER, mutate(original));
    return fn();
  } finally {
    sandboxWrite(SERVER, original);
  }
}

describe('server.mjs asset-class quantity guard', () => {
  it('resolves the asset floors from the facts snapshot (not from this test)', () => {
    expect(FIBER, `numbers.fiber_routes missing/malformed in ${FACTS_PATH} — this guard is blind`)
      .toBeTruthy();
    expect(ASSETS_TOTAL, `numbers.infrastructure_assets_total missing/malformed — this guard is blind`)
      .toBeTruthy();
  });

  // ── the must-fail control ──
  // Reintroduce the EXACT defect measured on 2026-08-30: the coverage resource
  // republishing a fiber figure the instructions blob had already moved past.
  it('FAILS when a published asset literal drifts from the facts snapshot', () => {
    const stale = FIBER === '55k' ? '51k' : '55k';   // never collide with canon
    withServerMutation((orig) => {
      const from = `${FIBER} fiber routes`;
      expect(orig.includes(from), `fixture anchor "${from}" not found in server.mjs`).toBe(true);
      return orig.replace(from, `${stale} fiber routes`);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'a stale published fiber-route count did NOT fail the guard').toBe(false);
      expect(out).toMatch(/stale fiber-route count/);
    });
  });

  // ── the fail-closed controls ──
  // Same contract the canon snapshot has: an unusable source is a hard stop,
  // never a silent skip. The pre-existing facts check read this same file as
  // `try { … } catch { /* not generated yet */ }` — fail-OPEN — so a missing
  // file disabled it silently. These prove the asset heal does not inherit that.
  it('REFUSES to run when the facts snapshot is unreadable (no frozen fallback)', () => {
    withFactsMutation(() => '{ not json', () => {
      const { ok, out } = check();
      expect(ok, 'guard ran anyway — it must not heal from a hardcoded fallback').toBe(false);
      expect(out).toMatch(/FATAL \(facts\)/);
    });
  });

  it('REFUSES to run when an asset quantity is not a floor phrase', () => {
    withFactsMutation((orig) => {
      const j = JSON.parse(orig);
      j.numbers.fiber_routes = null;   // the unknown-as-success direction
      return JSON.stringify(j, null, 2);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'guard accepted a malformed asset quantity').toBe(false);
      expect(out).toMatch(/not a floor phrase/);
    });
  });

  // The dangerous direction, and the one the compose path already refuses:
  // past _FACTS_MAX_AGE_DAYS, _composeInstructions stops publishing figures
  // entirely. Healing PERMANENT literals from a snapshot that stale would bake
  // in exactly the numbers the live blob has decided it will not serve.
  it('REFUSES to heal from a snapshot older than the compose freshness gate', () => {
    withFactsMutation((orig) => {
      const j = JSON.parse(orig);
      j.generated_at = new Date(Date.now() - 365 * 86400e3).toISOString();
      return JSON.stringify(j, null, 2);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'guard healed published copy from a year-old snapshot').toBe(false);
      expect(out).toMatch(/facts snapshot is \d+d old/);
    });
  });

  it('tracks the snapshot rather than any number frozen in the script', () => {
    // Move the asset total to a value that appears nowhere in the repo. The
    // COMMITTED surfaces must now read as drifted against it — proving the
    // figure enforced comes from the snapshot, not from source.
    withFactsMutation((orig) => {
      const j = JSON.parse(orig);
      j.numbers.infrastructure_assets_total = '911,000+';
      return JSON.stringify(j, null, 2);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'the committed surfaces did not drift against a moved canon').toBe(false);
      expect(out).toMatch(/stale mapped-asset total \(canonical 911,000\+\)/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// server.mjs publish-version guard  (★2026-08-30)
//
// THE DEFECT, measured on origin/main:
//
//   package.json 2.12.1 · server.json 2.12.1 · mcp-server.json 2.12.1 ·
//   smithery.yaml 2.12.1 · server.mjs 2.12.0
//
// #262 bumped the canonical version to trigger a registry republish. The three
// DERIVED manifest surfaces followed; server.mjs did not, so the live gateway
// kept introducing itself as 2.12.0 for four days — the one surface of the five
// a connecting agent actually reads.
//
// #267 fixed the half that let it MERGE: the guard that caught this lived in
// regression.test.mjs, named in test.yml's continue-on-error step, so it went
// red while `smoke` reported SUCCESS. It now lives in
// test/version-consistency.test.mjs on the hard gate, and that file is where
// the five-surface agreement rule belongs.
//
// These controls guard the other half, which #267 left open: nothing HEALS
// server.mjs. `node scripts/sync-tools-manifest.mjs` printed "✓ all manifest +
// facts surfaces consistent" on the drifted tree, because the version loop
// carried package.json / smithery.yaml / mcp-server.json and stopped there.
// Detection alone leaves every future operator bump a hand-edit that fails the
// build until someone notices; the heal makes `--fix` (and the daily job that
// runs it) carry the gateway like every other derived surface.
//
// Extended here rather than in a new file for the reason test.yml states in its
// own comment block: it names test files EXPLICITLY, `npm test` is invoked by no
// workflow, and a new file no line names is dead on arrival, silently green.
// ─────────────────────────────────────────────────────────────────────────────
const SERVER_JSON = path.join(ROOT, 'server.json');

// Canon read FROM server.json — the operator-owned canonical version — never
// transcribed into this file. A version literal frozen in a test certifies the
// test, not the repo.
const CANON_VERSION = (() => {
  try {
    const v = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf8')).version;
    return /^\d+\.\d+\.\d+$/.test(v) ? v : null;
  } catch { return null; }
})();

/** Temporarily replace server.json, run fn, always restore. */
function withServerJsonMutation(mutate, fn) {
  const original = fs.readFileSync(SERVER_JSON, 'utf8');
  try {
    sandboxWrite(SERVER_JSON, mutate(original));
    return fn();
  } finally {
    sandboxWrite(SERVER_JSON, original);
  }
}

/** Run the sync script in --fix mode. Returns {ok, out}. */
function fix() {
  try {
    return { ok: true, out: execFileSync('node', [SCRIPT, '--fix'], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const SERVER_VERSION_RX = /const SERVER_VERSION = \{ version: '(\d+\.\d+\.\d+)' \}\.version/;

describe('server.mjs publish-version guard', () => {
  it('resolves the canonical version from server.json (not from this test)', () => {
    expect(CANON_VERSION, `server.json .version missing/malformed in ${SERVER_JSON} — this guard is blind`)
      .toBeTruthy();
  });

  it('the committed tree agrees: the gateway reports the canonical version', () => {
    const m = SERVER_VERSION_RX.exec(fs.readFileSync(SERVER, 'utf8'));
    expect(m, 'SERVER_VERSION declaration not found in server.mjs').toBeTruthy();
    expect(m[1], 'the live gateway version drifted from server.json').toBe(CANON_VERSION);
  });

  // ── the must-fail control ──
  // Reintroduce the EXACT defect: the gateway republishing a version the
  // manifest surfaces have already moved past.
  it('FAILS when the gateway version drifts from the canonical version', () => {
    const [maj, min, pat] = CANON_VERSION.split('.').map(Number);
    const stale = `${maj}.${min}.${pat === 0 ? 1 : pat - 1}`;   // never collide with canon
    expect(stale).not.toBe(CANON_VERSION);
    withServerMutation((orig) => {
      const from = `const SERVER_VERSION = { version: '${CANON_VERSION}' }.version`;
      expect(orig.split(from).length - 1, `fixture anchor must appear exactly once: "${from}"`).toBe(1);
      return orig.replace(from, `const SERVER_VERSION = { version: '${stale}' }.version`);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'a stale gateway version did NOT fail the guard').toBe(false);
      expect(out).toMatch(new RegExp(`server\\.mjs SERVER_VERSION ${stale.replace(/\./g, '\\.')} != ${CANON_VERSION.replace(/\./g, '\\.')}`));
    });
  });

  // ── the vacuity control: unknown-as-SUCCESS, the dangerous direction ──
  // The heal is a regex over source. A regex whose anchor has moved matches
  // nothing and heals nothing, and the naive spelling of this check reports
  // that as a clean tree — the same silent-green shape the whole script exists
  // to kill, applied to the one surface agents actually read. Removing the
  // anchor must be a HARD failure, never an unobserved pass.
  it('FAILS when the SERVER_VERSION anchor is gone (matching nothing is not a pass)', () => {
    withServerMutation((orig) => {
      const from = `const SERVER_VERSION = { version: '${CANON_VERSION}' }.version`;
      expect(orig.includes(from), `fixture anchor "${from}" not found in server.mjs`).toBe(true);
      // A plausible refactor, not vandalism: same value, shape the anchor misses.
      return orig.replace(from, `const SERVER_VERSION = String('${CANON_VERSION}')`);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'the version heal matched nothing and reported the tree CLEAN').toBe(false);
      expect(out).toMatch(/SERVER_VERSION literal NOT FOUND/);
    });
  });

  it('tracks server.json rather than any version frozen in the script', () => {
    // Move the canonical version to a value that appears nowhere in the repo.
    // Every DERIVED surface must now read as drifted against it — server.mjs
    // among them, which is the whole point of this block.
    withServerJsonMutation((orig) => {
      const j = JSON.parse(orig);
      j.version = '9.87.65';
      return JSON.stringify(j, null, 2) + '\n';
    }, () => {
      const { ok, out } = check();
      expect(ok, 'the committed surfaces did not drift against a moved canonical version').toBe(false);
      expect(out).toMatch(/server\.mjs SERVER_VERSION \d+\.\d+\.\d+ != 9\.87\.65/);
      // The pre-existing three must still be named too — this block extends the
      // loop, it does not replace it.
      expect(out).toMatch(/package\.json version \d+\.\d+\.\d+ != 9\.87\.65/);
      expect(out).toMatch(/mcp-server\.json version \d+\.\d+\.\d+ != 9\.87\.65/);
      expect(out).toMatch(/smithery\.yaml version \d+\.\d+\.\d+ != 9\.87\.65/);
    });
  });

  // Behavioural, not just declarative: --fix must actually WRITE the healed
  // literal. daily-manifest-sync.yml already stages server.mjs in $OWNED (the
  // prose-quantity heal writes it), so a heal that computes but never writes
  // would be discarded with a green log — the failure mode that workflow's own
  // UNOWNED-HEAL GATE was added to stop.
  it('--fix heals the gateway version back to canon (and touches nothing else)', () => {
    const [maj, min, pat] = CANON_VERSION.split('.').map(Number);
    const stale = `${maj}.${min}.${pat === 0 ? 1 : pat - 1}`;
    withServerMutation((orig) => orig.replace(
      `const SERVER_VERSION = { version: '${CANON_VERSION}' }.version`,
      `const SERVER_VERSION = { version: '${stale}' }.version`,
    ), () => {
      const before = fs.readFileSync(SERVER, 'utf8');
      expect(SERVER_VERSION_RX.exec(before)[1], 'mutation did not land').toBe(stale);
      const { ok } = fix();
      expect(ok, '--fix exited non-zero on a drift it is supposed to heal').toBe(true);
      const after = fs.readFileSync(SERVER, 'utf8');
      expect(SERVER_VERSION_RX.exec(after)[1], '--fix did not write the healed version').toBe(CANON_VERSION);
      // The heal is surgical: restoring the one literal makes the file byte-identical.
      expect(after.replace(SERVER_VERSION_RX, `const SERVER_VERSION = { version: '${stale}' }.version`))
        .toBe(before);
    });
  });

  // The heal is anchored on SERVER_VERSION alone — deliberately, so it can never
  // rewrite the dated changelog beside it. That leaves one gap the anchored heal
  // cannot see, and it is covered elsewhere rather than here: a SECOND semver
  // literal in server.mjs disagreeing with the first. Measured 2026-08-30 —
  // injecting `{ version: '1.0.0' }` leaves this check at exit 0 while
  // test/version-consistency.test.mjs reports "2.12.1,1.0.0". That file is on
  // the hard gate since #267, so the broader rule blocks; duplicating it here
  // would be a second copy to rot. Stated so the boundary is deliberate, not
  // assumed.

  // The dated changelog shares the SERVER_VERSION line. It is history, and a
  // heal that rewrote it would make this file's own record of what shipped
  // false — the same rule the asset-class heal honours for //-comment lines.
  it('leaves the dated changelog on that line untouched', () => {
    const line = fs.readFileSync(SERVER, 'utf8')
      .split('\n').find((l) => SERVER_VERSION_RX.test(l));
    expect(line, 'SERVER_VERSION line not found').toBeTruthy();
    const history = line.slice(line.indexOf('//'));
    expect(history, 'the trailing changelog lost its dated entries').toMatch(/\/\/ \d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\):/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// integrations/copilot/dchub-mcp.yaml publish-version guard  (★2026-08-30)
//
// THE DEFECT, measured on origin/main at 8c38fe8:
//
//   server.json 2.12.1 (canon) · integrations/copilot/dchub-mcp.yaml 2.1.13
//
// Eleven minor versions stale — and, unlike the server.mjs gap #268 closed, this
// file was NEVER outside the script's reach. It is in sync-tools-manifest.mjs's
// COVERAGE list AND in daily-manifest-sync.yml's $OWNED, so the daily job healed
// its facility / market / deal / country phrases every single day and pushed the
// result. COVERAGE heals phrase QUANTITIES only. Nothing owned `version:`.
//
// That is the shape worth a control: a PARTIALLY healed surface reads MORE
// current than an untouched one. Every number beside the version was correct and
// freshly written, which is precisely why eleven versions of rot drew no
// attention. "This file is covered" was true and still insufficient.
//
// It is a server DESCRIPTOR in the smithery.yaml family (name / display_name /
// description / version / server.transport / base_url -> https://dchub.cloud/mcp),
// and integrations/copilot/README.md tells a human to "Paste the YAML manifest
// from dchub-mcp.yaml" — the paste-ready manual-repair path this script's own
// 2026-07-28 note widened REGISTRY-LISTINGS.md to cover.
//
// Extended here rather than in a new file for the reason test.yml states in its
// own comment block: it names test files EXPLICITLY, `npm test` is invoked by no
// workflow, and a new file no line names is dead on arrival, silently green.
// ─────────────────────────────────────────────────────────────────────────────
const COPILOT = path.join(ROOT, 'integrations', 'copilot', 'dchub-mcp.yaml');

// The same anchor the heal uses: column-0, double-quoted, top-level `version:`.
const COPILOT_VERSION_RX = /^version:[ \t]*"([^"\n]*)"[ \t]*$/m;

/** Temporarily replace the Copilot descriptor, run fn, always restore. */
function withCopilotMutation(mutate, fn) {
  const original = fs.readFileSync(COPILOT, 'utf8');
  try {
    const next = mutate(original);
    expect(next, 'copilot yaml mutation was a no-op — control proves nothing').not.toBe(original);
    sandboxWrite(COPILOT, next);
    return fn();
  } finally {
    sandboxWrite(COPILOT, original);
  }
}

describe('copilot descriptor publish-version guard', () => {
  it('the committed tree agrees: the Copilot descriptor declares the canonical version', () => {
    const m = COPILOT_VERSION_RX.exec(fs.readFileSync(COPILOT, 'utf8'));
    expect(m, 'top-level `version: "x.y.z"` not found in integrations/copilot/dchub-mcp.yaml').toBeTruthy();
    expect(m[1], 'the Copilot descriptor version drifted from server.json').toBe(CANON_VERSION);
  });

  // ── the must-fail control ──
  // Reintroduce the EXACT value found on main: 2.1.13 against a canon of 2.12.1.
  // Note the shape — 2.1.13 is not merely old, it sorts as a DIFFERENT minor
  // line entirely, which is how it survived eyeballing next to 2.12.1.
  it('FAILS when the Copilot descriptor version drifts from canon', () => {
    withCopilotMutation((orig) => {
      const from = `version: "${CANON_VERSION}"`;
      expect(orig.split(from).length - 1, `fixture anchor must appear exactly once: "${from}"`).toBe(1);
      return orig.replace(from, 'version: "2.1.13"');
    }, () => {
      const { ok, out } = check();
      expect(ok, 'a stale Copilot descriptor version did NOT fail the guard').toBe(false);
      expect(out).toMatch(new RegExp(
        `integrations/copilot/dchub-mcp\\.yaml version 2\\.1\\.13 != ${CANON_VERSION.replace(/\./g, '\\.')}`));
    });
  });

  // ── the vacuity control: unknown-as-SUCCESS, the dangerous direction ──
  // The heal is a regex over YAML source. An anchor that has moved matches
  // nothing, heals nothing, and the naive spelling reports that as a clean tree.
  // This file is the copy a human PASTES into the listing, so a silent no-op
  // here republishes whatever rot is already there.
  it('FAILS when the version anchor is gone (matching nothing is not a pass)', () => {
    withCopilotMutation((orig) => {
      const from = `version: "${CANON_VERSION}"`;
      expect(orig.includes(from), `fixture anchor "${from}" not found`).toBe(true);
      // A plausible YAML edit, not vandalism: same key, same value, no quotes.
      return orig.replace(from, `version: ${CANON_VERSION}`);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'the version heal matched nothing and reported the tree CLEAN').toBe(false);
      expect(out).toMatch(/dchub-mcp\.yaml: top-level `version: "x\.y\.z"` key NOT FOUND/);
    });
  });

  // ── the precision control ──
  // The heal must anchor at COLUMN 0. tools[] below is a list of indented
  // key/value blocks; if a future entry gains a `version:` field, a bare
  // /^version:/m-with-\s* heal could rewrite IT and leave the real one stale —
  // silently, since the descriptor would still "contain" the canonical version.
  // Drift the top-level version SO A HEAL ACTUALLY FIRES, then confirm the write
  // lands on the column-0 key and nowhere else. Asserting "the nested key
  // survived" on a tree where no heal runs proves nothing — the earlier spelling
  // of this control passed with the heal block deleted entirely.
  it('heals only the top-level version:, never an indented one under tools[]', () => {
    withCopilotMutation(
      (orig) => orig
        .replace('  - name: search_facilities',
          '  - name: search_facilities\n    version: "0.0.1"')
        .replace(`version: "${CANON_VERSION}"`, 'version: "2.1.13"'),
      () => {
        const before = fs.readFileSync(COPILOT, 'utf8');
        expect(before, 'nested-key fixture did not land').toContain('    version: "0.0.1"');
        expect(COPILOT_VERSION_RX.exec(before)[1], 'drift fixture did not land').toBe('2.1.13');
        const { ok } = check();
        expect(ok, 'the drifted top-level version was not caught').toBe(false);
        const { ok: fixOk } = fix();
        expect(fixOk, '--fix exited non-zero on a drift it is supposed to heal').toBe(true);
        const after = fs.readFileSync(COPILOT, 'utf8');
        expect(COPILOT_VERSION_RX.exec(after)[1], 'the top-level version was not healed').toBe(CANON_VERSION);
        expect(after, 'the heal ALSO rewrote a nested version: key — the anchor is not column-0')
          .toContain('    version: "0.0.1"');
      });
  });

  it('tracks server.json rather than any version frozen in the script', () => {
    withServerJsonMutation((orig) => {
      const j = JSON.parse(orig);
      j.version = '9.87.65';
      return JSON.stringify(j, null, 2) + '\n';
    }, () => {
      const { ok, out } = check();
      expect(ok, 'the descriptor did not drift against a moved canonical version').toBe(false);
      expect(out).toMatch(/integrations\/copilot\/dchub-mcp\.yaml version \d+\.\d+\.\d+ != 9\.87\.65/);
      // The pre-existing four must still be named — this extends the loop, it
      // does not replace it.
      expect(out).toMatch(/package\.json version \d+\.\d+\.\d+ != 9\.87\.65/);
      expect(out).toMatch(/mcp-server\.json version \d+\.\d+\.\d+ != 9\.87\.65/);
      expect(out).toMatch(/smithery\.yaml version \d+\.\d+\.\d+ != 9\.87\.65/);
      expect(out).toMatch(/server\.mjs SERVER_VERSION \d+\.\d+\.\d+ != 9\.87\.65/);
    });
  });

  // Behavioural, not just declarative: --fix must actually WRITE the healed
  // version. daily-manifest-sync.yml already stages this path in $OWNED, so a
  // heal that computes but never writes would be discarded with a green log.
  it('--fix heals the descriptor version back to canon (and touches nothing else)', () => {
    withCopilotMutation(
      (orig) => orig.replace(`version: "${CANON_VERSION}"`, 'version: "2.1.13"'),
      () => {
        const before = fs.readFileSync(COPILOT, 'utf8');
        expect(COPILOT_VERSION_RX.exec(before)[1], 'mutation did not land').toBe('2.1.13');
        const { ok } = fix();
        expect(ok, '--fix exited non-zero on a drift it is supposed to heal').toBe(true);
        const after = fs.readFileSync(COPILOT, 'utf8');
        expect(COPILOT_VERSION_RX.exec(after)[1], '--fix did not write the healed version').toBe(CANON_VERSION);
        // Surgical: restoring the one value makes the file byte-identical.
        expect(after.replace(`version: "${CANON_VERSION}"`, 'version: "2.1.13"')).toBe(before);
      });
  });

  // ── the chain control, specific to this file ──
  // This is the ONLY surface in the version loop that is ALSO in COVERAGE, so it
  // is the only one where two heals write the same file in one run. They must
  // CHAIN through pend()/readCur(), not clobber: the version block runs first and
  // pends, then COVERAGE reads the PENDING content. If either dropped the
  // other's write, the daily job would ship a file healed on one axis and
  // reverted on the other — and converge only one run later, if at all.
  it('heals version AND phrase quantities in the SAME --fix run (the two heals chain)', () => {
    expect(FACILITIES, 'canon facilities phrase unresolved — this control would be vacuous').toBeTruthy();
    withCopilotMutation((orig) => {
      const staleQty = orig.replace(`${FACILITIES} facilities`, '12,650+ facilities');
      expect(staleQty, 'quantity mutation did not land — canon phrase not present as written')
        .not.toBe(orig);
      return staleQty.replace(`version: "${CANON_VERSION}"`, 'version: "2.1.13"');
    }, () => {
      const { ok } = fix();
      expect(ok, '--fix exited non-zero').toBe(true);
      const after = fs.readFileSync(COPILOT, 'utf8');
      expect(COPILOT_VERSION_RX.exec(after)[1], 'the COVERAGE heal clobbered the version heal')
        .toBe(CANON_VERSION);
      expect(after, 'the version heal clobbered the COVERAGE quantity heal')
        .toContain(`${FACILITIES} facilities`);
      expect(after, 'the stale quantity survived').not.toContain('12,650+ facilities');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// smithery.yaml publish-version guard  (★2026-08-30)
//
// THE DEFECT. #268 (server.mjs) and #269 (the Copilot descriptor) each added a
// surface to the version loop. This one was ALREADY in the loop and still could
// not catch the drift, because the check asked the wrong question:
//
//   if (!sy.includes(VERSION))   // "does 2.12.1 appear ANYWHERE in the file?"
//
// which is not "does this descriptor DECLARE 2.12.1". Measured on 676255f:
//
//   line 5   # Last refreshed 2026-07-10 (83-tool / v2.12.1 canonical sync)…
//   line 16  version: "9.9.9"
//   $ node scripts/sync-tools-manifest.mjs   -> exit 0
//   ✓ all manifest + facts surfaces consistent
//
// The trigger is HOUSEKEEPING, not vandalism. Line 5 of the committed file reads
// "(71-tool / v2.4.4 canonical sync)" — refreshing that comment to the current
// version is a normal, well-intentioned edit, and it silently disarms the guard
// on the key one line below. This is the listing the file is named for.
//
// The controls below are the regression test for that exact shape: the canonical
// string PRESENT in the file, the declared version WRONG.
// ─────────────────────────────────────────────────────────────────────────────
const SMITHERY_VERSION_RX = /^version:[ \t]*"([^"\n]*)"[ \t]*$/m;

describe('smithery.yaml publish-version guard', () => {
  it('the committed tree agrees: smithery.yaml declares the canonical version', () => {
    const m = SMITHERY_VERSION_RX.exec(fs.readFileSync(YAML, 'utf8'));
    expect(m, 'top-level `version: "x.y.z"` not found in smithery.yaml').toBeTruthy();
    expect(m[1], 'the Smithery descriptor version drifted from server.json').toBe(CANON_VERSION);
  });

  // ── the must-fail control: the .includes() hole itself ──
  // Drift the DECLARED version while leaving the canonical string in the file,
  // in the file's own comment format. `includes()` reported this tree clean.
  it('FAILS when the declared version drifts but a comment still carries canon', () => {
    withMutation((orig) => {
      const decl = `version: "${CANON_VERSION}"`;
      expect(orig.split(decl).length - 1, `fixture anchor must appear exactly once: "${decl}"`).toBe(1);
      const next = orig
        .replace(decl, 'version: "9.9.9"')
        .replace('# Last refreshed', `# Last refreshed — canonical sync v${CANON_VERSION} —`);
      // The whole point: canon is STILL present in the file, just not declared.
      expect(next.includes(CANON_VERSION),
        'fixture must leave the canonical string in the file — otherwise it does not '
        + 'reproduce the includes() hole').toBe(true);
      expect(SMITHERY_VERSION_RX.exec(next)[1], 'drift fixture did not land').toBe('9.9.9');
      return next;
    }, () => {
      const { ok, out } = check();
      expect(ok, 'a drifted smithery.yaml version passed because canon appeared elsewhere in the file')
        .toBe(false);
      expect(out).toMatch(new RegExp(
        `smithery\\.yaml version 9\\.9\\.9 != ${CANON_VERSION.replace(/\./g, '\\.')}`));
    });
  });

  // ── the vacuity control: unknown-as-SUCCESS ──
  it('FAILS when the version anchor is gone (matching nothing is not a pass)', () => {
    withMutation((orig) => {
      const decl = `version: "${CANON_VERSION}"`;
      expect(orig.includes(decl), `fixture anchor "${decl}" not found`).toBe(true);
      // A plausible YAML edit, not vandalism: same key, same value, no quotes.
      return orig.replace(decl, `version: ${CANON_VERSION}`);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'the version heal matched nothing and reported the tree CLEAN').toBe(false);
      expect(out).toMatch(/smithery\.yaml: top-level `version: "x\.y\.z"` key NOT FOUND/);
    });
  });

  it('--fix heals the declared version back to canon (and touches nothing else)', () => {
    withMutation(
      (orig) => orig.replace(`version: "${CANON_VERSION}"`, 'version: "9.9.9"'),
      () => {
        const before = fs.readFileSync(YAML, 'utf8');
        expect(SMITHERY_VERSION_RX.exec(before)[1], 'mutation did not land').toBe('9.9.9');
        const { ok } = fix();
        expect(ok, '--fix exited non-zero on a drift it is supposed to heal').toBe(true);
        const after = fs.readFileSync(YAML, 'utf8');
        expect(SMITHERY_VERSION_RX.exec(after)[1], '--fix did not write the healed version')
          .toBe(CANON_VERSION);
        // Surgical: restoring the one value makes the file byte-identical. This also
        // pins the dropped `\s*` — a rewrite that ran past the end of the version
        // line would change bytes the heal has no business touching.
        expect(after.replace(`version: "${CANON_VERSION}"`, 'version: "9.9.9"')).toBe(before);
      });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dxt/manifest.json publish-version guard  (★2026-08-30, operator-directed)
//
// Not a found defect — a decision. The Claude Desktop extension manifest carried
// "version": "1.0.0", set at creation (a88e500) and never bumped, while the
// extension it packages followed the server through 12 minor releases. Claude
// Desktop shows that number and uses it to decide whether an installed extension
// is stale, so a frozen 1.0.0 means a day-one installer is never told anything
// changed. The operator's call is that it joins the DERIVED set.
//
// TWO THINGS THIS FILE MUST NOT LOSE, and both have a control below:
//
//   1. "dxt_version": "0.1" on line 2 — the DXT SPEC version. Not ours to move.
//      A bare /"version":/ heal is one careless character away from it.
//   2. The — escapes. This heal is TEXT-anchored precisely because
//      JSON.parse -> JSON.stringify is not byte-identical here: it emits a literal
//      em-dash and reformats 19 bytes of lines the heal has no business touching,
//      while the COVERAGE loop heals this same file as raw text. Two writers, two
//      formats, one file.
// ─────────────────────────────────────────────────────────────────────────────
const DXT = path.join(ROOT, 'dxt', 'manifest.json');
const DXT_VERSION_RX = /^  "version": "([^"\n]*)"(?:,)?$/m;

/** Temporarily replace the DXT manifest, run fn, always restore. */
function withDxtMutation(mutate, fn) {
  const original = fs.readFileSync(DXT, 'utf8');
  try {
    const next = mutate(original);
    expect(next, 'dxt manifest mutation was a no-op — control proves nothing').not.toBe(original);
    sandboxWrite(DXT, next);
    return fn();
  } finally {
    sandboxWrite(DXT, original);
  }
}

describe('dxt/manifest.json publish-version guard', () => {
  it('the committed tree agrees: the extension declares the canonical version', () => {
    const m = DXT_VERSION_RX.exec(fs.readFileSync(DXT, 'utf8'));
    expect(m, 'top-level `"version": "x.y.z"` not found in dxt/manifest.json').toBeTruthy();
    expect(m[1], 'the extension version drifted from server.json').toBe(CANON_VERSION);
  });

  // ── the must-fail control ── reintroduce the frozen-at-creation value.
  it('FAILS when the extension version drifts from canon', () => {
    withDxtMutation((orig) => {
      const from = `  "version": "${CANON_VERSION}",`;
      expect(orig.split(from).length - 1, `fixture anchor must appear exactly once: "${from}"`).toBe(1);
      return orig.replace(from, '  "version": "1.0.0",');
    }, () => {
      const { ok, out } = check();
      expect(ok, 'a stale extension version did NOT fail the guard').toBe(false);
      expect(out).toMatch(new RegExp(
        `dxt/manifest\\.json version 1\\.0\\.0 != ${CANON_VERSION.replace(/\./g, '\\.')}`));
    });
  });

  // ── the vacuity control: unknown-as-SUCCESS ──
  it('FAILS when the version anchor is gone (matching nothing is not a pass)', () => {
    withDxtMutation((orig) => {
      const from = `  "version": "${CANON_VERSION}",`;
      expect(orig.includes(from), `fixture anchor "${from}" not found`).toBe(true);
      // A plausible reformat, not vandalism: same key, same value, 4-space indent.
      return orig.replace(from, `    "version": "${CANON_VERSION}",`);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'the version heal matched nothing and reported the tree CLEAN').toBe(false);
      expect(out).toMatch(/dxt\/manifest\.json: top-level `"version": "x\.y\.z"` key NOT FOUND/);
    });
  });

  // ── the precision control: dxt_version is NOT ours ──
  // Drift the top-level version SO A HEAL ACTUALLY FIRES, then prove the write
  // landed on our key and left the DXT spec version alone. "dxt_version" contains
  // the substring `version"`, so this is one careless anchor away from breaking
  // every install by claiming DXT spec 2.12.1.
  it('never rewrites "dxt_version" — the DXT spec version is not ours to move', () => {
    withDxtMutation(
      (orig) => orig.replace(`  "version": "${CANON_VERSION}",`, '  "version": "1.0.0",'),
      () => {
        const before = fs.readFileSync(DXT, 'utf8');
        expect(DXT_VERSION_RX.exec(before)[1], 'drift fixture did not land').toBe('1.0.0');
        const spec = /"dxt_version": "([^"]*)"/.exec(before)[1];
        const { ok } = fix();
        expect(ok, '--fix exited non-zero on a drift it is supposed to heal').toBe(true);
        const after = fs.readFileSync(DXT, 'utf8');
        expect(DXT_VERSION_RX.exec(after)[1], 'the extension version was not healed').toBe(CANON_VERSION);
        expect(/"dxt_version": "([^"]*)"/.exec(after)[1],
          'the heal rewrote "dxt_version" — the anchor is matching the DXT SPEC version')
          .toBe(spec);
      });
  });

  // ── the format control ──
  // The reason this heal is text-anchored rather than a JSON round-trip. If someone
  // "simplifies" it to JSON.parse/stringify, the — escapes become literal
  // em-dashes and the file reformats around a one-value change.
  it('--fix heals surgically, preserving \\u2014 escapes and every other byte', () => {
    withDxtMutation(
      (orig) => orig.replace(`  "version": "${CANON_VERSION}",`, '  "version": "1.0.0",'),
      () => {
        const before = fs.readFileSync(DXT, 'utf8');
        const escapesBefore = (before.match(/\\u2014/g) || []).length;
        expect(escapesBefore, 'fixture should carry \\u2014 escapes — otherwise this control is vacuous')
          .toBeGreaterThan(0);
        const { ok } = fix();
        expect(ok, '--fix exited non-zero').toBe(true);
        const after = fs.readFileSync(DXT, 'utf8');
        expect((after.match(/\\u2014/g) || []).length,
          'the heal unescaped \\u2014 — this is the JSON round-trip reformat the text anchor avoids')
          .toBe(escapesBefore);
        // Restoring the one value makes the file byte-identical.
        expect(after.replace(`  "version": "${CANON_VERSION}",`, '  "version": "1.0.0",')).toBe(before);
      });
  });

  it('tracks server.json rather than any version frozen in the script', () => {
    withServerJsonMutation((orig) => {
      const j = JSON.parse(orig);
      j.version = '9.87.65';
      return JSON.stringify(j, null, 2) + '\n';
    }, () => {
      const { ok, out } = check();
      expect(ok, 'the extension did not drift against a moved canonical version').toBe(false);
      expect(out).toMatch(/dxt\/manifest\.json version \d+\.\d+\.\d+ != 9\.87\.65/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// dchub.dxt — the SHIPPED bundle  (★2026-08-30)
//
// Every guard above holds a SOURCE file to canon. dchub.dxt is a committed BINARY
// at the repo root carrying a COPY of dxt/manifest.json, and nothing built it — it
// was hand-zipped in a88e500 and last repacked by hand on 2026-07-30 (#107).
// Measured on 887c250, the shipped manifest read
//
//   version 1.0.0 · 81 tools · 15,300+ facilities
//
// against a canon of 2.12.1 / 83 / 19,500+, while the daily job healed
// dxt/manifest.json beside it every single day. `grep -c dchub.dxt` was 0 in both
// sync-tools-manifest.mjs and daily-manifest-sync.yml's $OWNED: no guard was
// wrong, none existed, and the artifact a user installs was the stale one.
//
// The bridge CODE inside was current — server/index.js was byte-identical to
// source. Only the metadata rotted, which is what made it invisible: the thing
// worked, it just lied about what it was.
// ─────────────────────────────────────────────────────────────────────────────
const BUNDLE = path.join(ROOT, 'dchub.dxt');
const DXT_SRC = path.join(ROOT, 'dxt', 'manifest.json');

/** Temporarily replace the committed bundle, run fn, always restore. */
function withBundleMutation(mutate, fn) {
  const original = fs.readFileSync(BUNDLE);
  try {
    const next = mutate(original);
    expect(next.equals(original), 'bundle mutation was a no-op — control proves nothing').toBe(false);
    sandboxWrite(BUNDLE, next);
    return fn();
  } finally {
    sandboxWrite(BUNDLE, original);
  }
}

describe('dchub.dxt shipped-bundle guard', () => {
  it('the committed bundle is a readable zip with the expected layout', async () => {
    const { readZipEntries } = await import(path.join(ROOT, 'scripts', 'dxt-bundle.mjs'));
    const e = readZipEntries(fs.readFileSync(BUNDLE));
    expect([...e.keys()].sort()).toEqual(['manifest.json', 'server/', 'server/index.js']);
  });

  it('the committed bundle carries the CURRENT source, not a stale copy', () => {
    const { ok, out } = check();
    expect(ok, `the shipped bundle drifted from source: ${out}`).toBe(true);
  });

  // ── the must-fail control ──
  // Reintroduce the exact defect: a bundle whose embedded manifest is stale while
  // the source beside it is correct. This is the shape that sat in the repo for a
  // month, and the shape no guard could see.
  it('FAILS when the bundle embeds a manifest that disagrees with dxt/manifest.json', async () => {
    const { readZipEntries, buildZip } = await import(path.join(ROOT, 'scripts', 'dxt-bundle.mjs'));
    await withBundleMutation((orig) => {
      const e = readZipEntries(orig);
      const m = JSON.parse(e.get('manifest.json'));
      m.version = '1.0.0';                       // the frozen-at-creation value
      m.description = (m.description || '').replace(/\d+ tools/, '81 tools');
      return buildZip([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8') },
        { name: 'server/' },
        { name: 'server/index.js', data: e.get('server/index.js') },
      ]);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'a stale shipped bundle did NOT fail the guard').toBe(false);
      expect(out).toMatch(/dchub\.dxt entry "manifest\.json" does not match dxt\/manifest\.json/);
    });
  });

  // ── the code-drift control ──
  // The metadata is what rotted last time, but the bridge is the part that RUNS.
  // A bundle shipping stale server/index.js is the worse failure and must also fail.
  it('FAILS when the bundle ships a stale server/index.js', async () => {
    const { readZipEntries, buildZip } = await import(path.join(ROOT, 'scripts', 'dxt-bundle.mjs'));
    await withBundleMutation((orig) => {
      const e = readZipEntries(orig);
      return buildZip([
        { name: 'manifest.json', data: e.get('manifest.json') },
        { name: 'server/' },
        { name: 'server/index.js',
          data: Buffer.concat([e.get('server/index.js'), Buffer.from('\n// stale\n', 'utf8')]) },
      ]);
    }, () => {
      const { ok, out } = check();
      expect(ok, 'a bundle with stale bridge code did NOT fail the guard').toBe(false);
      expect(out).toMatch(/dchub\.dxt entry "server\/index\.js" does not match dxt\/server\/index\.js/);
    });
  });

  // ── the vacuity control: unknown-as-SUCCESS ──
  // A corrupt or non-zip bundle must be a HARD failure. The tempting spelling —
  // try/catch and carry on — reports "nothing to compare" as agreement, which is
  // the silent-green shape this whole file exists to kill.
  it('FAILS when the bundle is not a readable zip (unreadable is not agreement)', () => {
    withBundleMutation(() => Buffer.from('not a zip at all', 'utf8'), () => {
      const { ok, out } = check();
      expect(ok, 'an unreadable bundle reported the tree CLEAN').toBe(false);
      expect(out).toMatch(/dchub\.dxt unreadable as a zip/);
    });
  });

  // ── the behavioural control ──
  // --fix must REPACK. daily-manifest-sync.yml stages dchub.dxt in $OWNED, so a
  // repack that computes but never writes would be discarded with a green log.
  it('--fix repacks the bundle so it carries source again', async () => {
    const { readZipEntries, buildZip } = await import(path.join(ROOT, 'scripts', 'dxt-bundle.mjs'));
    await withBundleMutation((orig) => {
      const e = readZipEntries(orig);
      const m = JSON.parse(e.get('manifest.json'));
      m.version = '1.0.0';
      return buildZip([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8') },
        { name: 'server/' },
        { name: 'server/index.js', data: e.get('server/index.js') },
      ]);
    }, () => {
      expect(JSON.parse(readZipEntries(fs.readFileSync(BUNDLE)).get('manifest.json')).version,
        'mutation did not land').toBe('1.0.0');
      const { ok } = fix();
      expect(ok, '--fix exited non-zero on a drift it is supposed to heal').toBe(true);
      const after = readZipEntries(fs.readFileSync(BUNDLE));
      expect(after.get('manifest.json').equals(fs.readFileSync(DXT_SRC)),
        '--fix did not repack the bundle from source').toBe(true);
      expect(after.get('server/index.js')
        .equals(fs.readFileSync(path.join(ROOT, 'dxt', 'server', 'index.js'))),
        '--fix repacked stale bridge code').toBe(true);
    });
  });

  // ── the no-churn control ──
  // A zip embeds a per-entry mtime. If the packer stamped wall-clock time or the
  // source files' mtimes, the daily job would commit a fresh binary every run
  // forever — drift noise indistinguishable from a real repack.
  //
  // Byte-equality ALONE is too weak to state that: two packs inside one process
  // share whatever the packer read once, so an mtime-stamping packer passes it.
  // So pin the property directly — every entry must carry the ZIP epoch
  // (1980-01-01 00:00), which no clock and no file can produce by accident.
  it('stamps every entry with the ZIP epoch, so an unchanged tree never churns', async () => {
    const { packBundle } = await import(path.join(ROOT, 'scripts', 'dxt-bundle.mjs'));
    const rs = (f) => fs.readFileSync(path.join(ROOT, f));
    const buf = packBundle(rs);

    // DOS date 1980-01-01 = (0 << 9) | (1 << 5) | 1 = 0x0021; time 00:00:00 = 0.
    const stamps = [];
    for (let i = 0; i + 4 <= buf.length; i++) {
      if (buf.readUInt32LE(i) === 0x04034b50) {
        stamps.push({ time: buf.readUInt16LE(i + 10), date: buf.readUInt16LE(i + 12) });
      }
    }
    expect(stamps.length, 'no local file headers found — this control is vacuous').toBe(3);
    for (const s of stamps) {
      expect(s.date, 'an entry is stamped with a real date — the packer read a clock or an mtime, '
        + 'so the daily job would commit a new binary every run').toBe(0x0021);
      expect(s.time, 'an entry carries a non-zero time stamp').toBe(0);
    }

    // And, given epoch stamping, identical inputs must give identical bytes.
    expect(packBundle(rs).equals(buf), 'two packs of the same tree differ').toBe(true);
  });

  // ── the staging control ──
  // A heal the workflow does not stage is discarded with a green log. That failure
  // mode is why daily-manifest-sync.yml grew its UNOWNED-HEAL GATE; this asserts
  // the new binary is actually covered rather than trusting the gate to catch it.
  it('daily-manifest-sync.yml stages dchub.dxt in $OWNED', () => {
    const wf = fs.readFileSync(
      path.join(ROOT, '.github', 'workflows', 'daily-manifest-sync.yml'), 'utf8');
    const m = wf.match(/OWNED="([\s\S]*?)"/);
    expect(m, '$OWNED assignment not found in daily-manifest-sync.yml').toBeTruthy();
    const owned = new Set(m[1].split(/\s+/).filter((x) => x && x !== '\\'));
    expect(owned.has('dchub.dxt'),
      'dchub.dxt is repacked by --fix but not staged — the daily job would discard it').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// release asset guard — scripts/verify-release-bundle.mjs  (★2026-08-30)
//
// #270 made the committed bundle self-healing against CANON. That says nothing
// about the TAG it gets published under, and a release asset is the one place the
// two can disagree silently: a v2.12.0 release carrying a 2.12.1 bundle downloads
// fine, installs fine, and misreports itself for as long as anyone fetches it.
//
// This was a live fork, not a hypothesis. When the guard was written the latest
// release was v2.12.0 while canon and the bundle were both 2.12.1, and no release
// carried any asset at all — so "just attach it to the existing release" was the
// fast option, and it would have shipped exactly that lie.
// ─────────────────────────────────────────────────────────────────────────────
const RELEASE_GUARD = path.join(ROOT, 'scripts', 'verify-release-bundle.mjs');

// Synchronous handle on the sandbox's bundle module, so the controls below can
// build fixtures without every one of them being async.
let _bundleMod = null;
function bundleModSync() {
  if (!_bundleMod) throw new Error('bundle module not loaded — see the beforeAll below');
  return _bundleMod;
}
beforeAll(async () => { _bundleMod = await import(path.join(ROOT, 'scripts', 'dxt-bundle.mjs')); });

/** Run the release guard for a tag. Returns {code, out}. */
function verifyRelease(tag) {
  try {
    const out = execFileSync('node', [RELEASE_GUARD, tag], { cwd: ROOT, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

describe('release asset guard', () => {
  it('accepts the committed bundle under the tag it actually declares', () => {
    const { code, out } = verifyRelease(`v${CANON_VERSION}`);
    expect(code, `the guard refused an honest pairing: ${out}`).toBe(0);
    expect(out).toMatch(/safe to publish/);
  });

  // ── the must-fail control ──
  // The exact pairing that was available and declined.
  it('REFUSES a tag that disagrees with the bundle version', () => {
    const [maj, min, pat] = CANON_VERSION.split('.').map(Number);
    const other = `v${maj}.${min}.${pat === 0 ? 1 : pat - 1}`;
    expect(other).not.toBe(`v${CANON_VERSION}`);
    const { code, out } = verifyRelease(other);
    expect(code, 'a version-mismatched asset would have been published').toBe(1);
    expect(out).toMatch(/declares version .* but would be published under tag/);
  });

  // A tag that MATCHES a stale bundle is the subtler miss: the pairing is
  // self-consistent and still ships a binary that is not the source.
  it('REFUSES a stale bundle even when the tag matches what it declares', () => {
    withBundleMutation((orig) => {
      const { readZipEntries, buildZip } = bundleModSync();
      const e = readZipEntries(orig);
      const m = JSON.parse(e.get('manifest.json'));
      m.version = '1.0.0';
      return buildZip([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8') },
        { name: 'server/' },
        { name: 'server/index.js', data: e.get('server/index.js') },
      ]);
    }, () => {
      const { code, out } = verifyRelease('v1.0.0');
      expect(code, 'a self-consistent but STALE bundle would have been published').toBe(1);
      expect(out).toMatch(/does not match dxt\/manifest\.json/);
    });
  });

  it('REFUSES an unreadable bundle rather than publishing it unverified', () => {
    withBundleMutation(() => Buffer.from('not a zip at all', 'utf8'), () => {
      const { code, out } = verifyRelease(`v${CANON_VERSION}`);
      expect(code, 'an unreadable bundle would have been published').toBe(1);
      expect(out).toMatch(/unreadable as a zip/);
    });
  });

  // A tag the guard cannot parse must be a hard stop, not a skipped comparison —
  // the unknown-as-SUCCESS direction, applied to the release path.
  it('REFUSES a non-semver tag instead of silently skipping the comparison', () => {
    const { code, out } = verifyRelease('v1.0.0; rm -rf /');
    expect(code, 'an unparseable tag was treated as verifiable').toBe(2);
    expect(out).toMatch(/refusing to verify against a non-semver tag/);
  });

  // ── the injection control ──
  // GitHub substitutes ${{ }} as raw TEXT before bash parses the line, so a ref
  // interpolated straight into `run:` is executed rather than compared. Every
  // value this workflow puts on a command line must arrive through env:.
  it('the workflow passes the tag through env, never ${{ }} inside run:', () => {
    const wf = fs.readFileSync(
      path.join(ROOT, '.github', 'workflows', 'release-assets.yml'), 'utf8');
    expect(wf, 'workflow does not trigger on a published release').toMatch(/release:\s*\n\s*types:\s*\[published\]/);
    const runs = [...wf.matchAll(/^\s*run:\s*(\|?)([\s\S]*?)(?=\n\s{6}[-\w]|\n\S|$)/gm)];
    expect(runs.length, 'no run: blocks found — this control is vacuous').toBeGreaterThan(0);
    for (const r of runs) {
      expect(r[2].includes('${{'),
        `a run: block interpolates \${{ }} directly — GitHub substitutes it as TEXT before bash `
        + `parses, so a crafted ref would execute: ${r[2].trim().slice(0, 60)}`).toBe(false);
    }
  });
});

// Order-proof backstop for the isolation control above.
afterAll(() => {
  const changed = fingerprintDiff(TREE_BEFORE, fingerprintTree(REAL_ROOT));
  if (changed.length) {
    throw new Error(`the shared working tree was modified during this run: ${changed.join(', ')}`);
  }
});
