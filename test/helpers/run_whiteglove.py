#!/usr/bin/env python3
"""Run the white-glove step's REAL python (extracted from the workflow) against
scripted Smithery responses, and report what it did: exit code, reads, writes.

Same shape as run_copycheck.py, for the step that WRITES. The block lives in
YAML, so no source-reading test can execute it. This extracts it verbatim, stubs
the one thing it talks to (urllib.request.urlopen), and lets it run. If someone
rewrites the step, this runs the rewrite.

★2026-09-13 — WHY IT EXISTS. Run 34736406217 pre-read a CDN copy of our listing
that was hours old, PATCHed a description that already matched the store, then
"confirmed" the write against the same cached copy and failed the lane. The
`cached_edge` scenario serves exactly that: stale text on a plain URL, the
current text on any URL carrying a `_=` query string.

usage: run_whiteglove.py <scenario>
"""
import ast, io, json, os, re, sys, types, urllib.request

WF = ".github/workflows/smithery-freshness.yml"
WANT = open("scripts/smithery_description.txt", encoding="utf-8").read()
STALE_COPY = WANT[:-40]


def block():
    src = open(WF, encoding="utf-8").read()
    at = src.index("id: whiteglove")
    m = re.search(r"python3 - <<'PY_WG'\n(.*?)\n\s*PY_WG\n", src[at:], re.S)
    if not m:
        return None
    lines = m.group(1).split("\n")
    pad = min((len(l) - len(l.lstrip()) for l in lines if l.strip()), default=0)
    return "\n".join(l[pad:] if len(l) >= pad else l for l in lines)


def main():
    scenario = sys.argv[1]
    calls = {"reads": 0, "busted_reads": 0, "writes": 0}

    def fake_urlopen(req, timeout=None):
        url = getattr(req, "full_url", str(req))
        method = req.get_method() if hasattr(req, "get_method") else "GET"
        if method == "PATCH":
            calls["writes"] += 1
            return io.BytesIO(json.dumps({"success": True}).encode())
        calls["reads"] += 1
        busted = bool(re.search(r"[?&]_=", url))
        calls["busted_reads"] += int(busted)
        if scenario == "in_sync":
            desc = WANT
        elif scenario == "cached_edge":
            desc = WANT if busted else STALE_COPY
        else:
            raise SystemExit(f"run_whiteglove: unknown scenario {scenario!r}")
        return io.BytesIO(json.dumps({"description": desc}).encode())

    src = block()
    if src is None:
        print(json.dumps({"exit": 99, **calls, "out": "EXTRACT_FAILED"}))
        return

    urllib.request.urlopen = fake_urlopen
    # never actually sleep; the step's arithmetic still runs
    sys.modules["time"] = types.SimpleNamespace(sleep=lambda s: None, time=lambda: 0.0)
    os.environ.setdefault("SMITHERY_API_KEY", "stub")

    g = {"__name__": "__main__"}
    out = io.StringIO()
    real = sys.stdout
    sys.stdout = out
    try:
        exec(compile(ast.parse(src), "<whiteglove>", "exec"), g)
        code = 0
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    finally:
        sys.stdout = real
    print(json.dumps({"exit": code, **calls, "out": out.getvalue().strip()}))


main()
