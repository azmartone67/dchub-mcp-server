#!/usr/bin/env python3
"""registry_version_bump_guard.py — fail when server.json changed but its
version did not, so the official-registry publish stops silently no-opping.

WHY THIS EXISTS
───────────────
registry-refresh.yml publishes server.json to registry.modelcontextprotocol.io,
which is the CASCADE SOURCE: a new version re-syncs PulseMCP / mcp.so / Glama /
ToolPlex. The registry rejects a duplicate version, and the workflow treated
that rejection as a graceful no-op — it printed a ::notice:: and exited 0.

That is correct when nothing changed. It is a silent data-staleness bug the
moment server.json's CONTENT changes without a version bump: the publish is
rejected, the job goes green, and the registry keeps serving the old manifest
with nobody told. The workflow's own comment already stated the rule ("bump
server.json's version when you modify things → everything refreshes") — it just
had nothing enforcing it.

MEASURED 2026-08-31, which is why this is not hypothetical. Version 2.12.1 was
set in 941b8d5 (2026-08-29 16:16). Two later commits changed server.json and
left the version alone:
    9bd1a7d  feat(identity): say when a call came through a gateway
    6123f8d  feat(cite): summarize_for_citation
Between the bump and HEAD the manifest gained `deploymentType`,
`canonicalRemote` and `gatewayNote`, and `toolCount` moved 82 → 83. Every push
since re-attempted the publish, took the duplicate-version 400, and reported
success. The registry — and therefore every aggregator mirroring it — had been
advertising 82 tools and no gateway metadata for two days.

WHAT IT CHECKS
──────────────
Walks the commits that touched server.json, newest first, to find the one that
introduced HEAD's version. If server.json differs between that commit and HEAD,
the current version has already been published with different content, so the
next publish will be rejected and the registry will stay stale → FAIL, naming
the bump as the fix.

★ IT FAILS OPEN, ALWAYS. A guard that cannot see enough history must not
invent a verdict: no git, no repo, a single commit, or a shallow clone whose
history ends before the version change all return PASS with an explicit notice
saying the check did not run. A false red here would block every push in the
repo, which is a worse failure than the one being guarded.

Usage:
    python3 scripts/registry_version_bump_guard.py            # guard (exit 1 on drift)
    python3 scripts/registry_version_bump_guard.py --self-test  # must-fail controls
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

MANIFEST = "server.json"


def _git(*args: str, cwd: str | None = None) -> tuple[int, str]:
    p = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout.strip()


def _version_at(rev: str, cwd: str | None = None) -> str | None:
    """server.json's `version` at a revision, or None if absent/unparseable."""
    code, out = _git("show", f"{rev}:{MANIFEST}", cwd=cwd)
    if code != 0:
        return None
    try:
        return json.loads(out).get("version")
    except Exception:
        return None


def check(cwd: str | None = None) -> tuple[bool, str]:
    """(ok, message). ok=False ONLY for proven drift; every unknown is ok=True."""
    code, _ = _git("rev-parse", "--git-dir", cwd=cwd)
    if code != 0:
        return True, "not a git repo — version-bump guard did not run"

    root = Path(cwd or ".") / MANIFEST
    if not root.exists():
        return True, f"no {MANIFEST} — nothing to guard"

    head_ver = _version_at("HEAD", cwd=cwd)
    if head_ver is None:
        return True, f"{MANIFEST} unreadable at HEAD — guard did not run"

    code, out = _git("log", "--format=%H", "--", MANIFEST, cwd=cwd)
    commits = [c for c in out.splitlines() if c]
    if code != 0 or len(commits) < 2:
        return True, f"fewer than two commits touch {MANIFEST} — nothing to compare"

    # Newest-first, find the last commit still carrying HEAD's version. The one
    # after it (older) has a different version, so this one introduced it.
    bump = None
    for c in commits:
        if _version_at(c, cwd=cwd) == head_ver:
            bump = c
        else:
            break
    else:
        # Never saw a different version — history is shallow or the manifest has
        # only ever had this one. Cannot prove drift; do not invent it.
        return True, (f"every commit in available history carries version {head_ver} "
                      f"— history too shallow to judge, guard did not run")

    if bump is None:
        return True, "could not locate the commit that set the current version — guard did not run"

    code, _ = _git("diff", "--quiet", bump, "HEAD", "--", MANIFEST, cwd=cwd)
    if code == 0:
        return True, f"{MANIFEST} unchanged since version {head_ver} was set — publish is a correct no-op"

    _, changed = _git("diff", "--numstat", bump, "HEAD", "--", MANIFEST, cwd=cwd)
    return False, (
        f"{MANIFEST} CHANGED since version {head_ver} was set in {bump[:7]}, but the version "
        f"was not bumped ({changed or 'content differs'}).\n"
        f"The official registry already holds {head_ver}, so the next publish is rejected as a "
        f"duplicate and the registry keeps serving the OLD manifest — silently, with a green check.\n"
        f"Fix: bump \"version\" in {MANIFEST}. That publishes and cascades to PulseMCP / mcp.so / "
        f"Glama / ToolPlex.\n"
        f"See: git diff {bump[:7]} HEAD -- {MANIFEST}"
    )


# ── must-fail controls ──────────────────────────────────────────────────────
# A guard that has never been shown to go RED is not evidence. Each control
# builds a throwaway repo, applies one mutation, and asserts the verdict.
def _self_test() -> int:
    import tempfile

    ran = failed = 0

    def repo(tmp: str) -> None:
        for a in (["init", "-q", "-b", "main"], ["config", "user.email", "g@example.com"],
                  ["config", "user.name", "guard"]):
            _git(*a, cwd=tmp)

    def write(tmp: str, ver: str, extra: str = "") -> None:
        obj = {"name": "cloud.dchub/mcp-server", "version": ver}
        if extra:
            obj["note"] = extra
        Path(tmp, MANIFEST).write_text(json.dumps(obj, indent=2), encoding="utf-8")

    def commit(tmp: str, msg: str) -> None:
        _git("add", MANIFEST, cwd=tmp)
        _git("commit", "-q", "-m", msg, cwd=tmp)

    def case(name: str, build, want_ok: bool) -> None:
        nonlocal ran, failed
        ran += 1
        with tempfile.TemporaryDirectory() as tmp:
            repo(tmp)
            build(tmp)
            ok, msg = check(cwd=tmp)
            if ok == want_ok:
                print(f"  ok   {name}")
            else:
                failed += 1
                print(f"  FAIL {name} — wanted ok={want_ok}, got ok={ok}: {msg}")

    # A: THE BUG. Content moved after the bump, version stood still.
    def a(tmp):
        write(tmp, "1.0.0"); commit(tmp, "v1")
        write(tmp, "1.1.0"); commit(tmp, "bump to 1.1.0")
        write(tmp, "1.1.0", "toolCount moved 82 -> 83"); commit(tmp, "content, no bump")
    case("A: content changed after the bump, version did not -> RED", a, want_ok=False)

    # B: the discipline the workflow documents — change and bump together.
    def b(tmp):
        write(tmp, "1.0.0"); commit(tmp, "v1")
        write(tmp, "1.1.0", "new field"); commit(tmp, "content + bump together")
    case("B: content changed WITH a bump -> green", b, want_ok=True)

    # C: the benign no-op this guard must not break — most pushes.
    def c(tmp):
        write(tmp, "1.0.0"); commit(tmp, "v1")
        write(tmp, "1.1.0"); commit(tmp, "bump")
        Path(tmp, "other.txt").write_text("x", encoding="utf-8")
        _git("add", "other.txt", cwd=tmp); _git("commit", "-q", "-m", "unrelated", cwd=tmp)
    case("C: server.json untouched since the bump -> green", c, want_ok=True)

    # D: accumulation — several content-only commits after one bump.
    def d(tmp):
        write(tmp, "2.0.0"); commit(tmp, "v2")
        write(tmp, "2.1.0"); commit(tmp, "bump")
        write(tmp, "2.1.0", "one"); commit(tmp, "drift 1")
        write(tmp, "2.1.0", "two"); commit(tmp, "drift 2")
    case("D: drift accumulated over several commits -> RED", d, want_ok=False)

    # E: fail-open — a single commit cannot prove anything.
    def e(tmp):
        write(tmp, "1.0.0"); commit(tmp, "only commit")
    case("E: one commit only -> green (fails open, no invented verdict)", e, want_ok=True)

    # F: fail-open — every commit carries one version (shallow-clone shape).
    def f(tmp):
        write(tmp, "3.0.0"); commit(tmp, "a")
        write(tmp, "3.0.0", "x"); commit(tmp, "b")
    case("F: no version change anywhere in history -> green (fails open)", f, want_ok=True)

    print(f"\nself-test: {ran} control(s), {failed} failed")
    return 1 if failed else 0


def main() -> int:
    if "--self-test" in sys.argv:
        return _self_test()
    ok, msg = check()
    if ok:
        print(f"[registry-version-guard] {msg}")
        return 0
    print(f"::error::{msg}", file=sys.stderr)
    print(f"[registry-version-guard] DRIFT\n{msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
