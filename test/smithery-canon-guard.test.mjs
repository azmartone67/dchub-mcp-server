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

// Order-proof backstop for the isolation control above.
afterAll(() => {
  const changed = fingerprintDiff(TREE_BEFORE, fingerprintTree(REAL_ROOT));
  if (changed.length) {
    throw new Error(`the shared working tree was modified during this run: ${changed.join(', ')}`);
  }
});
