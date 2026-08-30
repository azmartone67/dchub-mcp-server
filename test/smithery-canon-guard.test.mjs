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
import { describe, it, expect, afterAll } from 'vitest';
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
      expect(out).toMatch(/smithery\.yaml does not contain canonical version 9\.87\.65/);
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
      expect(out).toMatch(/smithery\.yaml does not contain canonical version 9\.87\.65/);
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

// Order-proof backstop for the isolation control above.
afterAll(() => {
  const changed = fingerprintDiff(TREE_BEFORE, fingerprintTree(REAL_ROOT));
  if (changed.length) {
    throw new Error(`the shared working tree was modified during this run: ${changed.join(', ')}`);
  }
});
