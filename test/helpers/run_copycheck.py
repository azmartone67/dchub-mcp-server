#!/usr/bin/env python3
"""Run the copycheck step's REAL python (extracted from the workflow) against a
scripted sequence of registry reads, and report the exit code it chose.

The block is embedded in YAML, so a source-reading test cannot exercise it and a
comment cannot fail. This extracts it verbatim, stubs the ONE thing it talks to
(urllib.request.urlopen) and lets it run. If someone rewrites the step, this runs
the rewrite.

usage: run_copycheck.py <scenario>
"""
import ast, io, json, re, sys, types, urllib.request

WF = ".github/workflows/smithery-freshness.yml"
WANT = open("scripts/smithery_description.txt", encoding="utf-8").read()

# ★2026-09-06 — DERIVED, not pinned. This read `WANT.replace("83 live MCP tools",
#   ...)`. str.replace on a string that is not present is a silent no-op, so when
#   the catalog moved 83 -> 85 the fixture injected NO stale marker, the checker
#   correctly found none, and the test failed with "expected +0 to be 1" — a
#   green-looking fixture that had quietly stopped constructing its own scenario.
#   The count moves every time a tool is added; the PHRASE does not.
#   Raising on a miss matters as much as the regex: a fixture that cannot build
#   its scenario must fail loudly, not assert against nothing.
_m = re.search(r"\b\d+ live MCP tools\b", WANT)
if not _m:
    raise SystemExit(
        "run_copycheck fixture: no '<N> live MCP tools' phrase in "
        "scripts/smithery_description.txt — the stale scenario cannot be built, "
        "and injecting nothing would make the test assert against an empty case.")
_TOOLS_PHRASE = _m.group(0)

def block():
    src = open(WF, encoding="utf-8").read()
    at = src.index("id: copycheck")
    m = re.search(r"python3 - <<'PY'\n(.*?)\n\s*PY\n", src[at:], re.S)
    if not m:
        print("EXTRACT_FAILED"); sys.exit(99)
    lines = m.group(1).split("\n")
    pad = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
    return "\n".join(l[pad:] if len(l) >= pad else l for l in lines)

SCENARIOS = {
    # the flap that caused the false red: stale read first, correct read next
    "flap":        [WANT[:-40], WANT],
    "match":       [WANT],
    "drift":       ["a completely different description. It has sentences. Two of them."] * 12,
    "stale":       [WANT.replace(_TOOLS_PHRASE, "the DCGI is live now. 65 tracked feeds")],
    "unreadable":  [None] * 12,
    "empty":       [""] * 12,
}

def main():
    seq = list(SCENARIOS[sys.argv[1]])
    reads = {"n": 0}

    def fake_urlopen(req, timeout=None):
        i = min(reads["n"], len(seq) - 1)
        reads["n"] += 1
        v = seq[i]
        if v is None:
            raise OSError("stubbed network failure")
        return io.BytesIO(json.dumps({"description": v}).encode())

    urllib.request.urlopen = fake_urlopen
    # never actually sleep; the budget arithmetic still runs
    sys.modules["time"] = types.SimpleNamespace(sleep=lambda s: None, time=lambda: 0.0)

    g = {"__name__": "__main__"}
    out = io.StringIO()
    real = sys.stdout
    sys.stdout = out
    try:
        exec(compile(ast.parse(block()), "<copycheck>", "exec"), g)
        code = 0
    except SystemExit as e:
        code = e.code or 0
    finally:
        sys.stdout = real
    print(json.dumps({"exit": code, "reads": reads["n"], "out": out.getvalue().strip()}))

main()
