/**
 * test/glama-build-provenance.test.mjs — the published listing must be BUILT
 * FROM THE CURRENT TIP OF MAIN, and the fence that says so must keep alerting.
 *
 * WHAT THIS PINS
 * ──────────────
 * Measured 2026-09-01: glama.ai/mcp/servers/azmartone67/dchub-mcp-server served
 * `get_gas_index` as "★ WITHDRAWN 2026-08-08: this tool no longer returns a
 * score" — a capability RESTORED on main 2026-08-30 and answering ok:true live.
 * Seven of 83 tool descriptions were text main no longer declares.
 *
 * Every existing fence was structurally blind to it, and that is the point:
 *   - CONNECTOR_SLUGS in registry_monitor.py watches connector blurbs for stale
 *     PROSE. This text was genuine MCP introspection output, correct for the
 *     commit that was built, so no prose rule could fire on it.
 *   - test/no-live-dcgi-claims.test.mjs and scripts/registry_stale_guard.py scan
 *     THIS REPOSITORY. The defect was never in it.
 * The unowned invariant was the one nothing asserted: what is PUBLISHED must be
 * built from what is on MAIN.
 *
 * THE MECHANISM IS FRESHNESS, NOT A VENDOR DEFECT — and there are THREE clocks,
 * not two. Glama's mirror syncs fine; it was AT origin/main while the listing
 * was still stale.
 *
 *     repo SYNC  →  container BUILD  →  RELEASE  →  published schema page
 *
 * None of these fires the next. The 2026-08-31 build ran `git checkout 2462f5de`
 * 36 minutes BEFORE the sync that carried the fix, and the release cut from it is
 * what is published. A second build on 2026-09-01 ran at the correct commit
 * (e67cddd), introspected the RESTORED text correctly in-container — and changed
 * nothing, because NO RELEASE was cut from it.
 *
 * So this fence does not detect "a stale build". It detects A STALE PUBLISHED
 * RELEASE, and the 7 tools it flags are clean against 2462f5de precisely because
 * 2462f5de is the commit the currently PUBLISHED RELEASE was built from — now two
 * stages behind main rather than one.
 *
 * THE CONTRACT
 * ────────────
 *   C1. The check must ALERT — its regressions must reach main()'s `reasons`.
 *       The module's header policy ("Glama index lag is reported but NOT
 *       alerted") is correct for the README re-crawl and for the mirror sync,
 *       which self-correct. A stale BUILD does not: nothing re-triggers a build
 *       when the mirror advances. Demoting this to a note re-opens the hole.
 *   C2. origin/main HEAD must be read over the NETWORK, never from a local
 *       checkout — a local tree is routinely dozens of commits behind, and that
 *       exact mistake (a tree 36 commits stale, 2026-08-31) is what first made a
 *       healthy mirror look frozen.
 *   C3. A fence that cannot reach its subject must never read as clean:
 *       page-reachable-but-unparseable is STRUCTURAL (alerts), Glama being down
 *       is TRANSIENT (a note) — the same split connector_regressions() documents.
 *   C4. The comparison must stay SYMMETRIC. Normalising one side only is not
 *       hypothetical: an earlier draft stripped `_` from the served side alone,
 *       merged `analyze_site` into `analyzesite`, and reported 80 of 83 tools
 *       stale — every one a defect in the normaliser.
 *   C5. The pre-existing connector-blurb fences must not be weakened to make
 *       room for this one.
 *   C9. A publish in progress must NOT page. The release stage is automatic and
 *       asynchronous (measured 2026-09-01: one fired with no human, tens of
 *       minutes after the build), so inside that lag a correct fresh deploy is
 *       indistinguishable from a stale one. The window is anchored to
 *       origin/main's commit date because the build timestamp is admin-only and
 *       a state-anchored window would never expire in CI — state/ is gitignored
 *       and registry-rank-monitor.yml caches nothing.
 *   C8. When the mirror is CURRENT the remedy must name BOTH remaining stages and
 *       must warn that a rebuild is a no-op. An earlier draft of this fence said
 *       "rebuilding is sufficient"; the 2026-09-01 rebuild proved that false. A
 *       detector that fires and says only "rebuild" walks the operator into the
 *       loop that cost two days here: green build → nothing changes → conclude
 *       the vendor is broken.
 *
 * EXPECTED PASS/FAIL — MEASURED, not predicted.
 * ─────────────────────────────────────────────
 * UNPATCHED (origin/main @ e67cddd): 9 failed, 1 passed. The module has no
 *   glama_build_provenance/origin_main_head/_undeclared_words at all, so C0-C4
 *   and C6-C9 all fail. The ONE pass is C5 — the pre-existing connector-blurb
 *   fences, which this change deliberately leaves alone.
 * PATCHED (this branch):             0 failed, 10 passed.
 *
 * FIRED ON A REAL DEFECT, not only on synthetic mutations — worth recording
 * because it is the one thing a mutation test cannot establish. Against the live
 * listing on 2026-09-01 the check reported 7 of 83 tool descriptions serving text
 * origin/main does not declare, held that finding across hours while the stale
 * release stood, and dropped to 0 of 83 ("all 83 rendered tool descriptions match
 * what the live server declares") within minutes of the release publishing. It
 * detects a real, self-clearing condition — it is not stuck on.
 *
 * WHY C5 PASSES UNPATCHED, so nobody reads it as a surviving mutant. The
 * unpatched column is this file run against origin/main's registry_monitor.py —
 * the ABSENCE of the change, not a mutant of it. C5 asserts the PRE-EXISTING
 * connector-blurb fences still stand, and they exist on origin/main already, so
 * C5 passing there is the point of C5: it is the "do not weaken what is already
 * here" guard, and it would be the broken one if it ever failed unpatched.
 *
 * MUTATION-VERIFIED, not asserted. Thirteen mutations toward the PERMISSIVE
 * failure (make the guard ALLOW what it should refuse) were applied one at a
 * time to scripts/registry_monitor.py, each confirmed to have landed, each run
 * against this file, each restored after. All thirteen are now killed:
 *   _undeclared_words returns set()            -> C4, C6
 *   _mirror_commit guesses on ambiguity        -> C3, C6
 *   unreadable clock yields age 0.0            -> C6
 *   grace branch lets a None age buy silence   -> C9
 *   grace anchor reverts to HEAD's date        -> C9
 *   provenance demoted out of `reasons`        -> C1
 *   _norm_rendered strips markdown one-sided   -> C4
 *   remedy drops "AUTOMATIC"                   -> C8
 *   remedy reinstates "rebuilding is enough"   -> C8
 *   remedy orders a human to cut the release   -> C8
 *   GitHub read gains an auth header           -> C7
 *   no-descriptions BLIND -> notes.append      -> C3
 *   no-mirror-sha BLIND   -> notes.append      -> C3
 *
 * ★THE LAST TWO SURVIVED THE FIRST ROUND, and that is the reason C3 looks the
 * way it does. C3 originally asserted only that the BLIND *strings* appeared in
 * the function. Flipping `regressions.append` to `notes.append` kept both
 * strings and passed — turning "this fence is blind" into a non-paging note,
 * which is the exact unknown-reads-as-clean failure the whole module exists to
 * prevent, sitting inside the guard against it.
 *
 * ★PRESENCE != ROUTING, and this is the THIRD instance of one family, not a
 * one-off. Recorded in dchub-backend's notes, both 2026-08-30: a test asserted a
 * helper returned the right set while nothing checked that the surface CALLED
 * it; and a regex matching `except Exception.*?return None` stayed green when a
 * `return []` was inserted above it, leaving the matched return dead. Those two
 * are "presence != BEHAVIOUR" — the text was correct but unreachable. This one
 * adds an axis: the text is reachable and correct, and the defect is WHICH SINK
 * it is appended to. Same needle, different list, opposite severity. So the
 * sharper rule, and the one to apply next time: a guard that greps for
 * correct-looking text proves neither that the text runs NOR where its result
 * goes.
 *
 * ★ONE CAUSE BEHIND TWO TRAPS IN THIS WORK, worth naming once: multi-line
 * CONCATENATED literals defeat single-line matching. It truncated `claim_free_key`
 * at 371 of 4,389 chars when the declared descriptions were first read out of
 * server.mjs with a reader that stopped at the first closing quote (which is why
 * the reference is now the live tools/list, not a parse). And it made the
 * "rebuilding is sufficient" mutation report ANCHOR x0 — the target string spans
 * a line break inside a concatenated literal — which would have been logged as a
 * survival had the anchor count not been checked first. Whenever matching a
 * string in this module, in test or in mutation: check the match count, and
 * assume any long message is split across source lines.
 *
 * C0 is the must-fail control (vitest has no xfail): it asserts the harness can
 * actually read the module and locate the function, so a rename fails loudly
 * instead of passing vacuously. Its unpatched failure is the control working —
 * it is the check that stops C1-C7 from passing over a module they cannot read.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MON = path.join(REPO, 'scripts', 'registry_monitor.py');
const src = fs.readFileSync(MON, 'utf8');

/** Body of a top-level def, comments and docstring stripped — a claim in prose
 *  must never satisfy a check about what the code does. */
function body(name) {
  const at = src.indexOf(`def ${name}(`);
  if (at === -1) return null;
  const rest = src.slice(at + 1);
  const end = rest.search(/\ndef [A-Za-z_]/);
  return (end === -1 ? rest : rest.slice(0, end))
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/^\s*#[^\n]*$/gm, ' ');
}

describe('glama build provenance — the listing must be built from current main', () => {
  // ── C0: must-fail control ────────────────────────────────────────────────
  it('C0 the harness can read the module and locate the check', () => {
    expect(src.length).toBeGreaterThan(5000);
    const b = body('glama_build_provenance');
    expect(b, 'glama_build_provenance() not found — every check below is vacuous').toBeTruthy();
    expect(b.length).toBeGreaterThan(200);
    expect(body('origin_main_head'), 'origin_main_head() not found').toBeTruthy();
    expect(body('_undeclared_words'), '_undeclared_words() not found').toBeTruthy();
  });

  // ── C1: it must ALERT, not merely note ───────────────────────────────────
  it('C1 provenance regressions reach main() reasons (it pages, not notes)', () => {
    const main = body('main');
    expect(main).toMatch(/glama_build_provenance\s*\(/);
    // the regressions half must be extended into `reasons`, the paging channel
    expect(main, 'provenance findings must land in reasons[], not only notes[]')
      .toMatch(/reasons\.extend\(\s*_prov_reg\s*\)/);
  });

  // ── C2: HEAD over the network, never a local checkout ────────────────────
  it('C2 origin/main HEAD is read from the network, not a local git tree', () => {
    const b = body('origin_main_head');
    expect(b).toMatch(/GITHUB_API|api\.github\.com/);
    expect(b).not.toMatch(/rev-parse|rev_parse/);
    // nowhere in the module may HEAD come from a local checkout
    expect(src.replace(/"""[\s\S]*?"""/g, ' ').replace(/^\s*#[^\n]*$/gm, ' '))
      .not.toMatch(/rev-parse/);
  });

  // ── C3: unknown must never look like clean ───────────────────────────────
  it('C3 a fence that cannot reach its subject reports, and splits transient from structural', () => {
    const b = body('glama_build_provenance');
    // structural blindness alerts …
    expect(b).toMatch(/BLIND/);
    // … while Glama being unreachable is a note, never a regression
    expect(b).toMatch(/Glama-side, retried next run/);
    // ★Both blind branches must exist AND must be routed to `regressions`, not
    // `notes`. Asserting only that the STRING is present is vacuous: mutation
    // M10 flipped `regressions.append` to `notes.append` for the
    // no-descriptions branch — turning "the fence is blind" into a non-paging
    // note, the exact unknown-reads-as-clean failure this module exists to
    // prevent — and the string-only assertion passed it. Pin the CHANNEL.
    expect(b, 'no mirror sha must ALERT, not note')
      .toMatch(/regressions\.append\(\s*"Glama page exposes no \/tree/);
    expect(b, 'no rendered descriptions must ALERT, not note')
      .toMatch(/regressions\.append\(\s*"Glama page rendered no tool descriptions/);
    // ★IF THIS EVER FAILS AFTER A REFACTOR, DO NOT LOOSEN IT. Hoisting the text
    // into a variable — `msg = "Glama page rendered…"; regressions.append(msg)`
    // — breaks these regexes, which is the SAFE direction. The hazard is the
    // repair: relaxing them back to string-presence silently reopens the hole
    // that mutations M10/M11 walked through. The correct fix is to keep
    // asserting the SINK — match `regressions.append(<whatever>)` inside the
    // branch, or parse the call and check the append target is `regressions` —
    // never to go back to matching the message text alone.
    // an unparseable subject must yield None, so the caller can report BLIND
    expect(body('_mirror_commit')).toMatch(/len\(shas\)\s*==\s*1/);
  });

  // ── C4: the comparison must stay symmetric ───────────────────────────────
  it('C4 both sides go through the same word normaliser', () => {
    const b = body('_undeclared_words');
    // (?<![A-Za-z]) so the def line's own `_undeclared_words(` is not counted
    const calls = [...b.matchAll(/(?<![A-Za-z])_words\(/g)];
    expect(calls.length, 'both operands must be normalised by _words()').toBe(2);
    expect(b).toMatch(/_words\(\s*rendered\s*\)\s*-\s*_words\(\s*declared\s*\)/);
    // _norm_rendered must NOT strip markdown punctuation on its own — that is
    // the one-sided normalisation that reported 80 of 83 tools stale.
    expect(body('_norm_rendered'), '_norm_rendered must not strip `*_ on one side')
      .not.toMatch(/\[`\*_\]/);
  });

  // ── C5: the existing connector fences are not weakened ───────────────────
  it('C5 the pre-existing connector-blurb fences still stand', () => {
    expect(src).toMatch(/CONNECTOR_SLUGS\s*=\s*\[/);
    expect(src).toMatch(/def scan_withdrawn\(/);
    expect(src).toMatch(/def connector_regressions\(/);
    // both empty-list hard failures must survive
    expect(src).toMatch(/CONNECTOR_SLUGS is empty/);
    expect(src).toMatch(/WITHDRAWN_CAPABILITIES is empty/);
    expect(body('main')).toMatch(/reasons\.extend\(\s*_conn_reg\s*\)/);
  });

  // ── C6: the offline controls actually pass ───────────────────────────────
  it('C6 the module self-test passes (offline must-fail controls)', () => {
    const r = spawnSync('python3', [MON, '--self-test'], { cwd: REPO, encoding: 'utf8' });
    // A guard that cannot run must fail loudly, not skip: a skipped control is
    // indistinguishable from a control that does not exist.
    expect(r.error, `could not run python3: ${r.error?.message}`).toBeFalsy();
    expect(r.stdout).toMatch(/build provenance/);
    expect(r.status, `self-test failed:\n${r.stdout}\n${r.stderr}`).toBe(0);
  });

  // ── C8: the remedy must not collapse back to "just rebuild" ──────────────
  it('C8 a current mirror yields a staged remedy, not a bare "rebuild"', () => {
    const b = body('glama_build_provenance');
    // the branch that fires when the mirror is already at HEAD
    expect(b).toMatch(/mirror_fresh/);
    // it must name the release stage, not only the build stage
    expect(b, 'the remedy must name the RELEASE stage').toMatch(/RELEASE|Release Created/);
    // and it must say, in as many words, that rebuilding alone can do nothing
    expect(b, 'the remedy must warn that a rebuild can be a no-op').toMatch(/NO-OP|no-op/);
    // the falsified claim must not come back
    expect(b, '"rebuilding is sufficient" was disproved on 2026-09-01')
      .not.toMatch(/rebuilding is sufficient/);
    // …and it must not swing to the OPPOSITE error. The release stage is
    // automatic and asynchronous (measured 2026-09-01: it fired with no human).
    // Telling an operator to go cut one sends them hunting for a control that
    // does not exist — the mirror image of the "just rebuild" loop.
    expect(b, 'the remedy must say the release stage is automatic')
      .toMatch(/AUTOMATIC|automatic/);
    expect(b, 'must not order a human to cut the release')
      .not.toMatch(/cut the release/);
  });

  // ── C9: a publish in progress must not page ──────────────────────────────
  it('C9 the grace window is anchored to the MIRROR commit, not to HEAD', () => {
    expect(src).toMatch(/PUBLISH_GRACE_MINUTES\s*=\s*\d+/);
    const b = body('glama_build_provenance');
    // inside the window the finding is reported as a note, not a regression
    expect(b).toMatch(/PUBLISH_GRACE_MINUTES/);
    expect(b).toMatch(/notes\.append\(f?"Glama publish in progress/);
    // an unreadable clock must grant NO grace — unknown may not buy silence
    expect(b, 'None age must not fall into the grace branch')
      .toMatch(/age is not None and age < PUBLISH_GRACE_MINUTES/);
    // the anchor is the MIRROR commit's date: the mirror advancing is the
    // precondition for a rebuild, so a push that has not synced must not re-arm.
    expect(b, 'the grace anchor must be the mirror commit')
      .toMatch(/commits\/\{mirror\}/);
    // ★the falsified anchor must not come back. HEAD-anchoring was measured
    // open ~always during a burst (median gap 75 min < the 90 min window), i.e.
    // quieter the more you push — exactly backwards, since deploys ride bursts.
    expect(b, 'HEAD-anchoring was disproved by the 30-day cadence measurement')
      .not.toMatch(/_age_minutes\(head_when\)/);
    expect(body('origin_main_head')).toMatch(/committer/);
  });

  // ── C7: no secrets introduced ────────────────────────────────────────────
  it('C7 the check stays keyless (the module is read-only, no secrets)', () => {
    const b = body('glama_build_provenance') + body('_gh_json') + body('origin_main_head');
    expect(b).not.toMatch(/API_KEY|api_key|Authorization|Bearer|GLAMA_TOKEN/);
  });
});
