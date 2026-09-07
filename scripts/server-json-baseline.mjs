// ============================================================================
// "Has server.json's CONTENT moved since the version it still declares was
// published?" — the one predicate behind the registry-publish stall.
//
// WHY THIS EXISTS (★2026-09-07)
// ─────────────────────────────
// registry.modelcontextprotocol.io REJECTS a duplicate version. That rejection
// is a correct no-op when nothing changed, and a silent staleness bug the
// moment the manifest's content changes without a bump: the publish is
// refused, the workflow reports success, and the registry — the CASCADE SOURCE
// for PulseMCP / mcp.so / Glama / ToolPlex — keeps serving the OLD manifest.
//
// It has now stalled the publish TWICE, both times found only after the fact:
//   2026-08-31  toolCount 82 -> 83 with no bump (scripts/registry_version_bump_guard.py
//               was written that day, as the after-the-fact backstop).
//   2026-09-07  c5b45b5 "get_subsea_cables + get_peering_intel … 86 -> 88" left
//               version at 2.12.8; registry-refresh failed on all three runs
//               that day (09:02 / 13:47 / 20:48 UTC) and was repaired by hand
//               in #376. Between those, a1df751 (#370) is the same shape again.
//
// The backstop works — it is the only reason either occurrence was noticed —
// but it can only go RED after the commit exists. Nothing asked the question at
// WRITE time, and `sync-tools-manifest.mjs --fix` (the single entry point that
// regenerates toolCount) cheerfully rewrote the content and left `version`
// alone. This module is that missing question, factored out so the write-time
// consumer and the CI backstop cannot answer it differently.
//
// ★ IT FAILS OPEN, ALWAYS — the same rule as the Python backstop, for the same
// reason: a check that cannot see enough history must not invent a verdict. No
// git, no repo, one commit, a shallow clone, or a version that is not in the
// visible history all return {ok:false, reason} and force NO bump. A false
// positive here would auto-bump (or red) on a tree it never understood, which
// is worse than the bug being guarded.
//
// ★ EQUIVALENCE WITH THE BACKSTOP is pinned by a test, not by this comment:
// test/registry-version-bump-write-time.test.mjs runs THIS module and
// scripts/registry_version_bump_guard.py over the same synthetic repos and
// asserts they agree on every one. Two spellings of one predicate drift the
// moment nothing compares them.
// ============================================================================
import { execFileSync } from 'node:child_process';

export const MANIFEST = 'server.json';

function git(args, cwd) {
  try {
    return { ok: true, out: execFileSync('git', args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
    }) };
  } catch {
    return { ok: false, out: '' };
  }
}

function versionAt(rev, cwd) {
  const r = git(['show', `${rev}:${MANIFEST}`], cwd);
  if (!r.ok) return null;
  try { return JSON.parse(r.out).version ?? null; } catch { return null; }
}

/**
 * The manifest MINUS `version`, in a form two files can be compared by.
 *
 * ★ Key order is normalised recursively. A re-indent or a reordered key is not
 * a content change worth burning a version on — the registry stores the parsed
 * document, not our bytes — and treating it as one would auto-bump on every
 * cosmetic edit. Returns null for anything that will not parse, which every
 * caller must treat as "cannot judge" rather than "changed".
 */
export function contentKey(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const canon = (v) => (
    Array.isArray(v) ? v.map(canon)
      : (v && typeof v === 'object')
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v
  );
  const { version: _drop, ...rest } = obj;
  return JSON.stringify(canon(rest));
}

/** '2.12.9' -> '2.12.10'. null for anything that is not a bare x.y.z. */
export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? ''));
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : null;
}

/**
 * server.json as it stood at the commit that INTRODUCED `version` — i.e. the
 * content the registry is already serving under that number.
 *
 * Walks the commits touching server.json newest-first and keeps the OLDEST run
 * of commits still carrying `version`; the first commit with a different
 * version ends the run. Identical to registry_version_bump_guard.check().
 *
 * @returns {{ok: true, text: string, commit: string} | {ok: false, reason: string}}
 */
export function publishedBaseline(cwd, version) {
  if (!version) return { ok: false, reason: `${MANIFEST} declares no version — cannot judge` };
  if (!git(['rev-parse', '--git-dir'], cwd).ok) {
    return { ok: false, reason: 'not a git repo — version fence did not run' };
  }
  const log = git(['log', '--format=%H', '--', MANIFEST], cwd);
  const commits = log.ok ? log.out.split('\n').filter(Boolean) : [];
  if (commits.length < 2) {
    return { ok: false, reason: `fewer than two commits touch ${MANIFEST} — nothing to compare` };
  }

  let bump = null;
  let sawDifferent = false;
  for (const c of commits) {
    if (versionAt(c, cwd) === version) { bump = c; } else { sawDifferent = true; break; }
  }
  if (!sawDifferent) {
    return { ok: false, reason: `every commit in available history carries version ${version} — history too shallow to judge` };
  }
  if (bump === null) {
    // The newest commit touching server.json already carries a DIFFERENT
    // version, so the working tree's version is not one this history published
    // — most often because the bump is sitting uncommitted right now, which is
    // precisely the state --fix leaves behind. Nothing to enforce.
    return { ok: false, reason: `version ${version} is not the one HEAD's newest ${MANIFEST} commit carries — nothing published under it yet` };
  }
  const show = git(['show', `${bump}:${MANIFEST}`], cwd);
  if (!show.ok) return { ok: false, reason: `could not read ${MANIFEST} at ${bump.slice(0, 7)} — fence did not run` };
  return { ok: true, text: show.out, commit: bump };
}

/**
 * The whole question in one call.
 *
 * @param {string} cwd            repo root
 * @param {string} version        the version the candidate text declares
 * @param {string} candidateText  server.json as it WILL be on disk after this run
 * @returns {{drifted: boolean, reason: string, commit?: string}}
 *   drifted:true ONLY when the baseline was readable, parsed, and differs.
 */
export function versionFence(cwd, version, candidateText) {
  const base = publishedBaseline(cwd, version);
  if (!base.ok) return { drifted: false, reason: base.reason };
  const want = contentKey(base.text);
  const have = contentKey(candidateText);
  if (want === null || have === null) {
    return { drifted: false, reason: `${MANIFEST} did not parse on one side — fence did not run` };
  }
  if (want === have) {
    return { drifted: false, reason: `${MANIFEST} unchanged since version ${version} was set in ${base.commit.slice(0, 7)}`, commit: base.commit };
  }
  return {
    drifted: true,
    commit: base.commit,
    reason: `${MANIFEST} CONTENT changed since version ${version} was set in ${base.commit.slice(0, 7)}`,
  };
}
