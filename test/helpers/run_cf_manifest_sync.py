#!/usr/bin/env python3
"""Run the REAL scripts/sync_cf_worker_manifest.py main() over a worker read from
stdin, and report what it wrote and what it said.

The ONE thing stubbed is the network boundary — `_fetch_live_tools`, whose whole
body is a urllib POST to the live MCP. Everything the test is about (argument
parsing, the comment-aware scan, the scoped count rewrite, the version handling,
the summary line) is the shipped code running for real. Stubbing the fetch is
what makes the guard deterministic; stubbing anything below it would make the
guard green on a mock instead of on the script.

usage:  echo "<worker source>" | run_cf_manifest_sync.py <n_tools> [script args...]
prints: {"exit": int, "out": "<patched worker>", "err": "<stderr>"} on stdout

Two optional env vars, both defaulting to the behaviour above:

  SYNC_TOOLS_JSON   path to a JSON array of {name, description, inputSchema} to
                    serve instead of the synthetic tool_000… list (n_tools is
                    then ignored). A test about what happens to DESCRIPTIONS
                    needs real ones; "synthetic tool 3" carries nothing to test.
  SYNC_SCRIPT       path to the script to load instead of the committed one, so
                    a must-fail control can run a deliberately broken COPY and
                    prove the harness is able to report a red at all.
"""
import contextlib
import importlib.util
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.environ.get("SYNC_SCRIPT") or os.path.normpath(
    os.path.join(HERE, "..", "..", "scripts", "sync_cf_worker_manifest.py"))

spec = importlib.util.spec_from_file_location("sync_cf_worker_manifest", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

n = int(sys.argv[1])
argv = ["-"] + sys.argv[2:]
src = sys.stdin.read()

# Named tool_000… so a test can prove the array it reads really came from THIS
# list, and not from whatever the fixture already contained.
tools = [
    {"name": "tool_%03d" % i,
     "description": "synthetic tool %d" % i,
     "inputSchema": {"type": "object", "properties": {}}}
    for i in range(n)
]
if os.environ.get("SYNC_TOOLS_JSON"):
    with open(os.environ["SYNC_TOOLS_JSON"], encoding="utf-8") as fh:
        tools = [{"name": t["name"],
                  "description": t.get("description") or "",
                  "inputSchema": t.get("inputSchema") or {"type": "object", "properties": {}}}
                 for t in json.load(fh)]

mod._fetch_live_tools = lambda: tools

out, err, code = io.StringIO(), io.StringIO(), 0
stdin = sys.stdin
sys.stdin = io.StringIO(src)
try:
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        mod.main(argv)
except SystemExit as e:
    if isinstance(e.code, int):
        code = e.code
    else:
        code = 1
        err.write("%s\n" % e.code)
except Exception as e:  # noqa: BLE001 — the test wants the message, not a traceback
    code = 2
    err.write("%s: %s\n" % (type(e).__name__, e))
finally:
    sys.stdin = stdin

json.dump({"exit": code, "out": out.getvalue(), "err": err.getvalue()}, sys.stdout)
