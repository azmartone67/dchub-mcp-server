#!/usr/bin/env python3
"""Update auto-merge PRs that are ready but BEHIND main (strict mode, 2026-10-10).

Branch protection on main requires branches to be up to date (`strict: true`).
GitHub auto-merge never updates a branch, and main gets ~77 commits a day
against 10-34 min of CI, so without this a green auto-merge PR sits BEHIND
until a person clicks "Update branch" (measured before 2026-09-21, when strict
was last on: 5 of 18 open PRs stuck BEHIND).

This updates a PR only when it is READY: auto-merge armed, same-repo head, an
allowlisted author, not a draft, no conflicts, every required check finished
and green on its current head, and main has commits the head lacks. A PR whose
checks are still running is left alone, so a busy main does not restart its CI
on every push; it is picked up when they finish (the cron below, or the next
push to main). A required context missing from a head whose other checks are
all finished means that head's CI will never produce it (a renamed job, a
workflow added after the push), and updating starts it.

★2026-10-11 — ONE AT A TIME. Updating every ready PR at once made them race:
main moved every ~15-17 min overnight, a PR's CI takes 12-21 min, and each
merge left the others BEHIND again (#6774 was updated 6 times and #6777 5
times in 2 h without merging). So this keeps at most one PR IN FLIGHT: an
eligible PR already up to date with main and not failing a required check.
While one is in flight nothing else is updated; when none is, only the oldest
ready PR is. A merge queue does this properly but needs an org-owned repo.
An in-flight PR whose head is older than STALE_IN_FLIGHT_MIN stops holding the
queue (stuck checks must not stop every other PR), with a warning.

★2026-11-04 — RED BUT STALE. A required check that failed because main was
broken stays red after main is fixed: GitHub re-runs nothing, and decide()
never updates a failing PR. On 11-04 fe#2166/2167 sat red on a preflight
assertion fe#2169 had already fixed on main, and be#8304 on a registry test,
until a person clicked "Update branch". So an armed PR whose required checks
have all finished, with at least one failed, and that is behind main is
updated too (decide_red / plan_red): at most RED_PER_RUN a run, outside the
one-in-flight queue (that queue orders PRs that would merge; these cannot
until they re-run). A PR whose head is a merge from main younger than
RED_RETRY_MIN is left alone, so a PR whose own change is the failure gets one
fresh run per window, not one per push to main.

The same file runs in dchub-frontend, whose required checks come from a
ruleset that branches/main does not report; _required() reads both.

The update is made with a PAT (PR_SUBMIT_TOKEN, else GH_PAT), never
GITHUB_TOKEN: GitHub starts no workflow runs for a push made with GITHUB_TOKEN,
so the updated PR would never get the checks it needs (auto-enable-automerge.yml
has the measurement). `expected_head_sha` makes GitHub refuse the update if the
PR moved since we read it.

Usage: GH_TOKEN=<pat> REPO=owner/name python3 scripts/update_behind_prs.py [--dry-run]
Exit 0 when every candidate was handled (updated or skipped with a reason),
1 when the token is missing or an update failed. A PR whose update-branch
hits a merge conflict is warned about and skipped, and the next ready PR is
updated in the same run (exit 0 if that one succeeds).
"""
from __future__ import annotations

import datetime
import json
import os
import subprocess
import sys
import time

# The authors auto-enable-automerge.yml arms auto-merge for (SEC-5). A PR from
# anyone else is never armed, so never updated here either.
ALLOWED_AUTHORS = frozenset({"azmartone67", "dependabot[bot]", "app/dependabot"})

_FAILED = frozenset({"FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED",
                     "STARTUP_FAILURE", "ERROR"})
_PENDING_STATES = frozenset({"PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS",
                             "WAITING", "REQUESTED"})


_RANK = {"ok": 0, "pending": 1, "failed": 2}

#: Minutes after which an up-to-date PR that has not merged stops holding the
#: queue. CI takes 12-21 min; 60 leaves room for a slow runner queue.
STALE_IN_FLIGHT_MIN = 60

#: Red-but-stale lane (★2026-11-04): minutes before a failing PR that was just
#: updated from main is updated again, and how many failing PRs one run updates.
#: Backend CI is 12-21 min; 240 caps a genuinely broken PR at ~6 extra runs a day.
RED_RETRY_MIN = 240
RED_PER_RUN = 2
#: First lines of a commit that merged main into a PR branch: update-branch
#: (GitHub's API and button) and a local `git merge origin/main`.
_MAIN_MERGE_PREFIXES = ("Merge branch 'main' into ",
                        "Merge remote-tracking branch 'origin/main' into ")


def _check_state(item: dict) -> tuple[str, str]:
    """(name, "pending" | "failed" | "ok") for one statusCheckRollup entry,
    which is a CheckRun (name/status/conclusion) or a StatusContext
    (context/state)."""
    name = item.get("name") or item.get("context") or ""
    if "state" in item and "status" not in item:          # StatusContext
        st = (item.get("state") or "").upper()
        if st in _PENDING_STATES:
            return name, "pending"
        return name, "failed" if st in _FAILED else "ok"
    if (item.get("status") or "").upper() != "COMPLETED":  # CheckRun
        return name, "pending"
    return name, "failed" if (item.get("conclusion") or "").upper() in _FAILED else "ok"


def _ineligible(pr: dict) -> str | None:
    """Why this PR is never ours to update, or None when it is eligible."""
    n = pr.get("number")
    if pr.get("isDraft"):
        return f"#{n} draft"
    if pr.get("isCrossRepository"):
        return f"#{n} from a fork"
    author = (pr.get("author") or {}).get("login") or ""
    if author not in ALLOWED_AUTHORS:
        return f"#{n} author {author!r} not allowlisted"
    if not pr.get("autoMergeRequest"):
        return f"#{n} auto-merge not armed"
    if pr.get("baseRefName") != "main":
        return f"#{n} base is {pr.get('baseRefName')!r}"
    if pr.get("mergeable") == "CONFLICTING":
        return f"#{n} has conflicts (a person resolves those)"
    return None


def _states(pr: dict) -> dict[str, str]:
    """{check name: ok | pending | failed}; one name can report more than once
    (eight workflows have a job named `check`), and the worst state wins."""
    states: dict[str, str] = {}
    for item in pr.get("statusCheckRollup") or []:
        name, st = _check_state(item)
        prev = states.get(name)
        if prev is None or _RANK[st] > _RANK[prev]:
            states[name] = st
    return states


def decide(pr: dict, behind_by: int, required: set[str]) -> tuple[bool, str]:
    """(ready to update?, reason) for one PR. Pure: no network."""
    n = pr.get("number")
    why_not = _ineligible(pr)
    if why_not:
        return False, why_not
    states = _states(pr)
    failed = sorted(c for c in required if states.get(c) == "failed")
    if failed:
        return False, f"#{n} required check(s) failing: {', '.join(failed)}"
    if any(st == "pending" for st in states.values()):
        return False, f"#{n} checks still running"
    if behind_by <= 0:
        return False, f"#{n} up to date with main"
    missing = sorted(required - set(states))
    why = (f"missing required context(s) {', '.join(missing)} on a finished head"
           if missing else "ready and green")
    return True, f"#{n} {behind_by} commit(s) behind main, {why}"


def in_flight(pr: dict, behind_by: int, required: set[str],
              head_age_min: float | None) -> bool:
    """True when this PR is the one heading for main: eligible, up to date
    with main, no failing required check, and its head is not stale."""
    if _ineligible(pr) or behind_by > 0:
        return False
    states = _states(pr)
    if any(states.get(c) == "failed" for c in required):
        return False
    return head_age_min is not None and head_age_min < STALE_IN_FLIGHT_MIN


def plan(entries: list[dict], required: set[str],
         skip: frozenset[int] | set[int] = frozenset()) -> tuple[int | None, list[str]]:
    """(the one PR number to update or None, one log line per PR). Pure.

    Each entry is {"pr": <gh pr list dict>, "behind": int, "head_age_min":
    float | None}. At most one PR is updated, and none while another is in
    flight; among ready PRs the oldest (createdAt, then number) goes first.
    `skip` holds PR numbers update-branch already refused with a merge conflict
    in this run (GitHub reports `mergeable` lazily, so they looked ready); they
    are dropped so the next ready PR gets the slot."""
    lines: list[str] = []
    entries = [e for e in entries if e["pr"].get("number") not in skip]
    flying = [e for e in entries
              if in_flight(e["pr"], e["behind"], required, e.get("head_age_min"))]
    for e in entries:
        pr = e["pr"]
        if (not _ineligible(pr) and e["behind"] <= 0 and e.get("head_age_min") is not None
                and e["head_age_min"] >= STALE_IN_FLIGHT_MIN
                and not any(_states(pr).get(c) == "failed" for c in required)):
            lines.append(f"::warning::#{pr.get('number')} is up to date but has not merged "
                         f"for {int(e['head_age_min'])} min; it no longer holds the queue")
    ready = []
    for e in entries:
        ok, why = decide(e["pr"], e["behind"], required)
        if ok:
            ready.append((e, why))
        else:
            lines.append(f"skip   {why}")
    if flying:
        held = ", ".join(f"#{e['pr'].get('number')}" for e in flying)
        lines += [f"queued {why} (waiting for in-flight {held} to merge)"
                  for _, why in ready]
        return None, lines
    ready.sort(key=lambda r: (r[0]["pr"].get("createdAt") or "", r[0]["pr"].get("number") or 0))
    if not ready:
        return None, lines
    (first, why), rest = ready[0], ready[1:]
    lines.append(f"update {why}")
    lines += [f"queued {w} (behind #{first['pr'].get('number')} in the queue)" for _, w in rest]
    return first["pr"].get("number"), lines


def decide_red(pr: dict, behind_by: int, required: set[str],
               head: dict | None) -> tuple[bool, str]:
    """(update this failing PR so its checks run on main's tip?, reason). Pure.

    `head` is {"merges_main": bool, "age_min": float} for the PR's head commit,
    or None when it could not be read (then the PR is left alone)."""
    n = pr.get("number")
    why_not = _ineligible(pr)
    if why_not:
        return False, why_not
    states = _states(pr)
    failed = sorted(c for c in required if states.get(c) == "failed")
    if not failed:
        return False, f"#{n} no required check failing"
    if any(st == "pending" for st in states.values()):
        return False, f"#{n} checks still running"
    if behind_by <= 0:
        return False, f"#{n} failing on a head that already has main: {', '.join(failed)}"
    if head is None:
        return False, f"#{n} head commit unread"
    if head.get("merges_main") and head.get("age_min", 0) < RED_RETRY_MIN:
        return False, (f"#{n} failing ({', '.join(failed)}) {int(head['age_min'])} min "
                       f"after its last update from main; next try after {RED_RETRY_MIN} min")
    return True, (f"#{n} {behind_by} commit(s) behind main, failing {', '.join(failed)}: "
                  f"re-run on main's tip")


def plan_red(entries: list[dict], required: set[str]) -> tuple[list[int], list[str]]:
    """(failing PR numbers to update, one log line per candidate). Pure.

    Entries are plan()'s plus "head" (see decide_red). Only PRs failing a
    required check are logged here; plan() already logged the rest. The oldest
    RED_PER_RUN go first; the others wait for the next run."""
    lines: list[str] = []
    ready = []
    for e in entries:
        pr = e["pr"]
        if _ineligible(pr) or not any(_states(pr).get(c) == "failed" for c in required):
            continue
        ok, why = decide_red(pr, e["behind"], required, e.get("head"))
        if ok:
            ready.append((e, why))
        else:
            lines.append(f"red    {why}")
    ready.sort(key=lambda r: (r[0]["pr"].get("createdAt") or "", r[0]["pr"].get("number") or 0))
    go, rest = ready[:RED_PER_RUN], ready[RED_PER_RUN:]
    lines += [f"update {why}" for _, why in go]
    lines += [f"queued {why} (next run; {RED_PER_RUN} per run)" for _, why in rest]
    return [e["pr"].get("number") for e, _ in go], lines


def _head_info(repo: str, sha: str, now: datetime.datetime) -> dict | None:
    """{"merges_main", "age_min"} for a PR's head commit, or None if unreadable."""
    out = _gh("api", f"repos/{repo}/commits/{sha}", "--jq",
              '[(.parents|length), .commit.committer.date, '
              '(.commit.message|split("\\n")[0])]|@tsv').strip()
    parts = out.split("\t", 2)
    if len(parts) != 3:
        return None
    parents, when, subject = parts
    try:
        age = (now - datetime.datetime.fromisoformat(
            when.replace("Z", "+00:00"))).total_seconds() / 60
    except ValueError:
        return None
    return {"merges_main": parents == "2" and subject.startswith(_MAIN_MERGE_PREFIXES),
            "age_min": age}


def _required(repo: str, branch: dict) -> set[str]:
    """main's required check names: branch protection (dchub-backend), else the
    branch rulesets (dchub-frontend, where branches/main reports none)."""
    required = set(((branch.get("protection") or {}).get("required_status_checks")
                    or {}).get("contexts") or [])
    if required:
        return required
    try:
        rules = json.loads(_gh_read("api", f"repos/{repo}/rules/branches/main") or "[]")
    except (subprocess.CalledProcessError, ValueError):
        return set()
    if not isinstance(rules, list):
        return set()
    return {c.get("context") for r in rules if r.get("type") == "required_status_checks"
            for c in (r.get("parameters") or {}).get("required_status_checks") or []
            if c.get("context")}


def _gh_read(*args: str) -> str:
    """A read that the PAT may not be allowed to make (statusCheckRollup): use the
    run's GITHUB_TOKEN (GH_READ_TOKEN) when the workflow provides one. Reads start no
    workflow runs, so the PAT-only rule for update-branch writes does not apply."""
    tok = os.environ.get("GH_READ_TOKEN")
    if not tok:
        return _gh(*args)
    saved = os.environ.get("GH_TOKEN")
    os.environ["GH_TOKEN"] = tok
    try:
        return _gh(*args)
    finally:
        if saved is None:
            os.environ.pop("GH_TOKEN", None)
        else:
            os.environ["GH_TOKEN"] = saved


def _gh(*args: str, attempts: int = 3) -> str:
    """gh, retried: GitHub's GraphQL intermittently fails heavy reads. The last
    failure's stderr is printed before it is raised; capture_output used to
    swallow it, so a red run said only 'returned non-zero exit status 1'."""
    for i in range(attempts):
        try:
            return subprocess.run(["gh", *args], check=True, capture_output=True,
                                  text=True).stdout
        except subprocess.CalledProcessError as e:
            err = (e.stderr or "").strip()
            # a 422 from update-branch is a verdict, not a flake: the caller judges it
            if i == attempts - 1 or "422" in err:
                print(f"::warning::gh {' '.join(args[:3])} failed: {err[:500]}")
                raise
            time.sleep(5 * (i + 1))
    raise AssertionError("unreachable")


def is_merge_conflict(stderr: str) -> bool:
    """True for update-branch's 422 "merge conflict between base and head"."""
    low = stderr.lower()
    return "merge conflict" in low and "422" in low


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    repo = os.environ.get("REPO") or os.environ.get("GITHUB_REPOSITORY") or ""
    if not os.environ.get("GH_TOKEN") and not dry:
        print("::error::no PAT (PR_SUBMIT_TOKEN / GH_PAT). Refusing GITHUB_TOKEN: "
              "its pushes start no workflow runs, so an updated PR would never "
              "get its required checks. BEHIND PRs now need a manual update.")
        return 1
    if not repo:
        print("::error::REPO / GITHUB_REPOSITORY not set")
        return 1
    branch = json.loads(_gh("api", f"repos/{repo}/branches/main"))
    main_sha = branch["commit"]["sha"]
    required = _required(repo, branch)
    if not required:
        print("::error::could not read main's required checks from "
              f"repos/{repo}/branches/main; refusing to judge readiness without them")
        return 1
    # statusCheckRollup is NOT listed for all open PRs at once: across ~100 PRs that
    # GraphQL read failed on most runs from 10-23 (the job was red ~40 runs in a row).
    # It is read per PR below, only for the few that are eligible.
    prs = json.loads(_gh("pr", "list", "--repo", repo, "--state", "open",
                         "--limit", "100", "--json",
                         "number,isDraft,isCrossRepository,author,autoMergeRequest,"
                         "baseRefName,mergeable,headRefOid,createdAt"))
    for pr in prs:
        if "statusCheckRollup" not in pr and not _ineligible(pr):
            pr["statusCheckRollup"] = json.loads(_gh_read(
                "pr", "view", str(pr["number"]), "--repo", repo,
                "--json", "statusCheckRollup") or "{}").get("statusCheckRollup") or []
    now = datetime.datetime.now(datetime.timezone.utc)
    entries = []
    for pr in prs:
        behind, age = 0, None
        if not _ineligible(pr):
            behind = int(_gh("api", f"repos/{repo}/compare/{pr['headRefOid']}...{main_sha}",
                             "--jq", ".ahead_by").strip() or 0)
            if behind == 0:
                when = _gh("api", f"repos/{repo}/commits/{pr['headRefOid']}",
                           "--jq", ".commit.committer.date").strip()
                age = (now - datetime.datetime.fromisoformat(
                    when.replace("Z", "+00:00"))).total_seconds() / 60
        entries.append({"pr": pr, "behind": behind, "head_age_min": age})
    rc = 0
    skipped: set[int] = set()
    updated = False
    while True:
        number, lines = plan(entries, required, skipped)
        for line in lines:
            print(line)
        if number is None:
            break
        pr = next(e["pr"] for e in entries if e["pr"].get("number") == number)
        if dry:
            print(f"WOULD  update #{number} (dry run)")
            break
        try:
            _gh("api", f"repos/{repo}/pulls/{number}/update-branch",
                "--method", "PUT", "-f", f"expected_head_sha={pr['headRefOid']}")
            updated = True
            break
        except subprocess.CalledProcessError as e:
            err = (e.stderr or "").strip()
            if is_merge_conflict(err):
                # mergeable was UNKNOWN when listed. A person must resolve it;
                # until its head changes every run lands here again, but the
                # slot goes to the next ready PR in the same run.
                print(f"::warning::#{number} conflicts with main; skipped, "
                      f"a person must resolve it")
                skipped.add(number)
                continue
            # Any other failure (422 when the head moved under us: the next run
            # sees the new head).
            print(f"::warning::update of #{number} failed: {err[:300]}")
            rc = 1
            break
    if skipped and not updated and not dry:
        rc = 1   # nothing moved: a conflicting PR is blocking and needs a person
    for e in entries:
        pr = e["pr"]
        if (e["behind"] > 0 and not _ineligible(pr)
                and any(_states(pr).get(c) == "failed" for c in required)):
            e["head"] = _head_info(repo, pr["headRefOid"], now)
    numbers, lines = plan_red(entries, required)
    for line in lines:
        print(line)
    for number in numbers:
        pr = next(e["pr"] for e in entries if e["pr"].get("number") == number)
        if dry:
            print(f"WOULD  update failing #{number} (dry run)")
            continue
        try:
            _gh("api", f"repos/{repo}/pulls/{number}/update-branch",
                "--method", "PUT", "-f", f"expected_head_sha={pr['headRefOid']}")
        except subprocess.CalledProcessError as e:
            err = (e.stderr or "").strip()
            if is_merge_conflict(err):
                print(f"::warning::failing #{number} conflicts with main; a person must resolve it")
                continue
            print(f"::warning::update of failing #{number} failed: {err[:300]}")
            rc = 1
    print(f"{len(prs)} open PR(s) read; main at {main_sha[:9]}; "
          f"{len(required)} required context(s)")
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
