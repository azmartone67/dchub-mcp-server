#!/usr/bin/env python3
"""May the white-glove step overwrite the live Smithery description?

WHY THIS FILE EXISTS (2026-09-24)
─────────────────────────────────
The white-glove step in .github/workflows/smithery-freshness.yml PATCHes
scripts/smithery_description.txt onto api.smithery.ai whenever the live text
differs. It could not tell WHY it differed. On 2026-09-24 a new description was
pasted live on Smithery by hand, with no repo change; the next run would have
overwritten it with the stale repo file, silently. PR #537 mirrored it by hand.
This guard closes that failure class: the writer only overwrites text it wrote.

THE RECORD
──────────
After a CONFIRMED write (and whenever live == repo) the workflow stores the
sha256 of the NORMALISED text in `--record` and carries it to the next run as a
workflow artifact. Normalised = the same normalisation the white-glove `clean()`
comparison uses (whitespace collapsed, `\\&` -> `&`), so a harmless whitespace
difference in how the API echoes the text cannot read as a foreign edit.

THE DECISION (pure: see decide())
────────────────────────────────
  live == repo                          -> in_sync       no write
  live == last written (repo moved on)  -> write         the writer owns live
  live != repo and != last written      -> foreign_edit  NO write; human decides
  no record yet, live != repo           -> foreign_edit  fail safe: never
                                                         overwrite what we cannot
                                                         prove we wrote
  live unreadable                       -> unreadable    NO write (same reason)
  --force and live != repo              -> write         deliberate revert

A foreign edit is a HUMAN-DECISION state, not a broken lane: this script exits 0
for every verdict and hands the verdict to the workflow through GITHUB_OUTPUT.
A non-zero exit means the guard itself could not run (e.g. the repo file is
missing), and the white-glove step then refuses to write.

The live read is api.smithery.ai (authoritative), never registry.smithery.ai
(an eventually-consistent projection), with a unique query string per read
(the CDN in front of both keeps the plain URL for hours: s-maxage=14400). A
foreign verdict must hold across --confirm-reads reads: api.smithery.ai itself
was measured flapping between edges 268 ms apart (2026-09-05), and one stale
read must not open an issue.
"""
import argparse
import difflib
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

API = "https://api.smithery.ai/servers/azmartone67/dchub"
ISSUE_TITLE = "Smithery listing edited outside the repo"
INSTRUCTION = ("mirror the live text into scripts/smithery_description.txt (PR) "
               "or re-run with force to revert it")

_GH = bool(os.environ.get("GITHUB_ACTIONS"))


def say(level, msg):
    print(f"::{level}::{msg}" if _GH else f"[{level}] {msg}", flush=True)


def norm(text):
    return re.sub(r"\s+", " ", (text or "").replace("\\&", "&")).strip()


def digest(text):
    return hashlib.sha256(norm(text).encode("utf-8")).hexdigest()


def decide(repo, live, record, force=False):
    """Return (verdict, reason). `live` None = unreadable; `record` None = no record."""
    if live is None:
        if force:
            return "write", "forced: live description unreadable, overwriting on request"
        return "unreadable", "could not read the live description — cannot prove we wrote it, so no write"
    if norm(live) == norm(repo):
        return "in_sync", "live description already matches the repo file"
    if force:
        return "write", "forced: overwriting the live description with the repo file"
    if record is None:
        return "foreign_edit", ("no last-written record yet and live differs from the repo file — "
                                "failing safe toward NOT overwriting")
    if digest(live) == record:
        return "write", "live is the text this writer last wrote; only the repo changed"
    return "foreign_edit", "live differs from both the repo file and the text this writer last wrote"


def read_record(path):
    try:
        with open(path, encoding="utf-8") as fh:
            m = re.search(r"\b[0-9a-f]{64}\b", fh.read())
    except OSError:
        return None
    return m.group(0) if m else None


def write_record(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(digest(text) + "\n")


def read_live(api, key, timeout=30):
    """The live description, or None when it cannot be read (never '' for an error)."""
    h = {"User-Agent": "dchub-white-glove-guard/1.0"}
    if key:
        h["Authorization"] = f"Bearer {key}"
    url = f"{api}{'&' if '?' in api else '?'}_={int(time.time() * 1000)}"
    try:
        body = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout))
    except Exception as e:  # noqa: BLE001 — every read failure is "unreadable", by design
        say("warning", f"could not read {api} ({e})")
        return None
    desc = body.get("description") if isinstance(body, dict) else None
    # An empty description is UNMEASURED, not a foreign edit (same rule as copycheck).
    return desc if isinstance(desc, str) and desc.strip() else None


def sentences(text):
    """One line per sentence, so a unified diff of a one-paragraph blurb is readable."""
    return [s + "\n" for s in re.split(r"(?<=[.!?])\s+", norm(text)) if s]


def issue_body(repo, live, record, run_url):
    diff = "".join(difflib.unified_diff(
        sentences(repo), sentences(live),
        fromfile="scripts/smithery_description.txt (repo)",
        tofile="api.smithery.ai description (live)", n=1))
    fence = "~~~~"
    return "\n".join([
        f"The Smithery description for `azmartone67/dchub` was edited outside the repo. "
        f"The white-glove auto-writer in `.github/workflows/smithery-freshness.yml` did **not** overwrite it.",
        "",
        f"**Action:** {INSTRUCTION}.",
        "",
        "- Mirror: paste the live text below into `scripts/smithery_description.txt` and open a PR. "
        "The next run sees live == repo, records it, and closes this issue.",
        "- Revert: Actions -> smithery freshness heartbeat -> Run workflow with `force_overwrite` = true.",
        "",
        f"repo sha256 (normalised): `{digest(repo)}`  ",
        f"live sha256 (normalised): `{digest(live)}`  ",
        f"last written by the auto-writer: `{record or 'no record yet'}`  ",
        f"run: {run_url or 'local'}",
        "",
        "### Diff (repo -> live, one sentence per line)",
        "",
        f"{fence}diff",
        diff.rstrip("\n") or "(differs only in stale markers or normalisation)",
        fence,
        "",
        f"### Live text ({len(live)} chars)",
        "",
        fence,
        live,
        fence,
        "",
    ])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo-file", default="scripts/smithery_description.txt")
    ap.add_argument("--record", required=True, help="file holding the last-written sha256")
    ap.add_argument("--api", default=API)
    ap.add_argument("--issue-body-out", help="write the foreign-edit issue body here")
    ap.add_argument("--force", default="false", help="'true' bypasses the guard")
    ap.add_argument("--confirm-reads", type=int, default=3)
    ap.add_argument("--interval", type=float, default=10.0)
    ap.add_argument("--mark-written", action="store_true",
                    help="record the repo file as the text this writer last wrote, then exit "
                         "(the workflow calls this only after a CONFIRMED write or a matching read)")
    a = ap.parse_args(argv)

    if a.mark_written:
        with open(a.repo_file, encoding="utf-8") as fh:
            repo = fh.read()
        write_record(a.record, repo)
        say("notice", f"drift guard: recorded last-written sha256 {digest(repo)}")
        return 0

    force = str(a.force).strip().lower() in ("1", "true", "yes")
    with open(a.repo_file, encoding="utf-8") as fh:  # missing file = guard cannot run = exit 1
        repo = fh.read()
    record = read_record(a.record)
    key = os.environ.get("SMITHERY_API_KEY", "")

    live = read_live(a.api, key)
    verdict, reason = decide(repo, live, record, force)
    # A foreign verdict must survive re-reads: one stale edge must not open an issue.
    reads = 1
    while verdict == "foreign_edit" and reads < max(1, a.confirm_reads):
        time.sleep(a.interval)
        again = read_live(a.api, key)
        reads += 1
        if again is None:
            continue
        live = again
        verdict, reason = decide(repo, live, record, force)

    if verdict == "in_sync":
        write_record(a.record, repo)  # refresh: live == repo is text we are content to own
        say("notice", f"drift guard: in_sync — {reason}; no write")
    elif verdict == "write":
        say("notice", f"drift guard: write — {reason}")
    elif verdict == "unreadable":
        say("warning", f"drift guard: unreadable — {reason}. Not failing the lane.")
    else:
        say("warning", f"drift guard: foreign_edit after {reads} read(s) — {reason}. "
                       f"NOT overwriting. {INSTRUCTION}. (issue: '{ISSUE_TITLE}')")
        if a.issue_body_out:
            run_url = None
            if os.environ.get("GITHUB_RUN_ID"):
                run_url = (f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/"
                           f"{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/{os.environ['GITHUB_RUN_ID']}")
            with open(a.issue_body_out, "w", encoding="utf-8") as fh:
                fh.write(issue_body(repo, live, record, run_url))

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"verdict={verdict}\n")
            fh.write(f"repo_sha={digest(repo)}\n")
            fh.write(f"live_sha={digest(live) if live is not None else ''}\n")
            fh.write(f"record_sha={record or ''}\n")
    print(f"verdict={verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
