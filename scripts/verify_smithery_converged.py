#!/usr/bin/env python3
"""Did the Smithery LISTING actually change, or was the release merely ACCEPTED?

WHY THIS FILE EXISTS AS A FILE (2026-09-05)
───────────────────────────────────────────
`smithery mcp publish` exits 0 on `{"status":"PENDING"}`. PENDING is the release
being ACCEPTED, not the listing being UPDATED. Measured on the owner's Mac:

    637 of 637 releases in ~/Library/Logs/dchub-smithery-freshness.log
    report PENDING. No terminal status has EVER been observed.

.github/workflows/smithery-freshness.yml learned that on 2026-07-28 and verifies
the OUTCOME. The LOCAL LaunchAgent (scripts/smithery-freshness-heartbeat.sh)
never did — it beat the dead-man ledger `success` off the CLI's exit code, so
the lane could not fail. Two lanes publishing the same listing, one of them
unable to report a bad publish, is one lane too many and one check too few.

So the check lives here, in ONE file both lanes run. A check that exists twice
drifts; this one is imported by the workflow and by the local agent.

WHAT IT COMPARES
────────────────
`tools/list` off our live MCP endpoint against the `tools` array the Smithery
registry serves — NAMES *and* the first 80 chars of each description. Membership
alone is not enough: the 2026-07-28 stale listing had the right COUNT for days
while `plan_query` still read "START HERE" after the live catalogue had moved on.

NOT /api/v1/mcp/tools.json — its `summary` is a separately curated field that
legitimately differs from the MCP `description` on 46 of 81 tools, so comparing
those two would fail every day while saying nothing about listing freshness.

EXIT CODES — three outcomes, not two
────────────────────────────────────
  0  CONVERGED   — the listing serves what we serve.
  1  DIVERGED    — publish accepted, listing did not catch up in the budget.
                   This is the failure that used to report green.
  2  INCONCLUSIVE — we could not read our OWN tools/list, so there was nothing
                   to compare against. "Could not run" is not "ran and passed",
                   and it is not "ran and failed" either; callers decide.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

REGISTRY = "https://registry.smithery.ai/servers/azmartone67/dchub"
MCP = "https://dchub.cloud/mcp"
UA = {"User-Agent": "dchub-smithery-freshness-verify/1.0"}

_GH = bool(os.environ.get("GITHUB_ACTIONS"))


def _say(level, msg):
    """GitHub annotation in CI, plain prefixed line anywhere else.

    The local agent's log is read by a human sitting at this Mac; `::error::`
    there is noise that means nothing. The TEXT is identical either way so the
    two lanes can be grepped together.
    """
    if _GH:
        print(f"::{level}::{msg}")
    else:
        print(f"[{level}] {msg}")


def _get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def _rpc(url, body, sid=None):
    """Streamable-HTTP MCP call. Responses may arrive as SSE frames."""
    h = dict(UA, **{"Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream"})
    if sid:
        h["Mcp-Session-Id"] = sid
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=h)
    with urllib.request.urlopen(req, timeout=45) as r:
        raw, hdr = r.read().decode(), r.headers.get("Mcp-Session-Id")
    if "data:" in raw[:200]:
        raw = next(l[5:].strip() for l in raw.splitlines() if l.startswith("data:"))
    return json.loads(raw), hdr


def live_tools(mcp_url):
    """{name: description[:80]} off our own server, or None if unreadable."""
    try:
        _, sid = _rpc(mcp_url, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                "params": {"protocolVersion": "2024-11-05",
                                           "capabilities": {},
                                           "clientInfo": {"name": "dchub-freshness-verify",
                                                          "version": "1.0"}}})
        tl, _ = _rpc(mcp_url, {"jsonrpc": "2.0", "id": 2,
                               "method": "tools/list", "params": {}}, sid)
        return {t["name"]: (t.get("description") or "")[:80]
                for t in tl["result"]["tools"]}
    except Exception as e:
        _say("warning", f"cannot read our own tools/list ({e}) — nothing to compare against")
        return None


def diff_once(live, registry_url):
    """(converged, summary). `converged` is None when the registry was unreadable."""
    try:
        reg = _get(registry_url)
        reg_tools = {t["name"]: (t.get("description") or "")[:80]
                     for t in (reg.get("tools") or [])}
    except Exception as e:
        return None, f"registry unreadable: {e}"
    if not reg_tools:
        return None, "registry served no tools array"
    missing = sorted(set(live) - set(reg_tools))
    extra = sorted(set(reg_tools) - set(live))
    changed = sorted(n for n in set(live) & set(reg_tools) if live[n] != reg_tools[n])
    if not (missing or extra or changed):
        return True, f"{len(reg_tools)} tools, descriptions match live"
    return False, (f"{len(reg_tools)} listed vs {len(live)} live; "
                   f"missing={missing[:5]} extra={extra[:5]} stale_desc={changed[:5]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checks", type=int, default=20, help="how many times to look (default 20)")
    ap.add_argument("--interval", type=int, default=30, help="seconds between looks (default 30)")
    ap.add_argument("--registry", default=REGISTRY)
    ap.add_argument("--mcp", default=MCP)
    a = ap.parse_args()

    live = live_tools(a.mcp)
    if live is None:
        return 2
    if not live:
        _say("warning", "live tools/list parsed empty — nothing to compare against")
        return 2
    print(f"live tools/list: {len(live)} tools")

    last = ""
    for attempt in range(1, a.checks + 1):
        ok, summary = diff_once(live, a.registry)
        if ok:
            _say("notice", f"listing converged after {attempt} check(s): {summary}")
            return 0
        last = summary
        print(f"  attempt {attempt}/{a.checks}: {last}")
        if attempt < a.checks:
            time.sleep(a.interval)

    # The loop does NOT sleep after the last look, so the elapsed wait is
    # (checks - 1) intervals. Reporting checks*interval would overstate how long
    # we actually gave the re-crawl — a number a reader would use to decide
    # whether the budget is too tight.
    budget = max(0, a.checks - 1) * a.interval
    _say("error",
         f"Smithery published but the listing did NOT converge within "
         f"{budget // 60}m{budget % 60:02d}s. {last}. The publish was ACCEPTED and "
         f"the re-crawl did not land — this is exactly the failure that used to "
         f"report green. Check https://smithery.ai/servers/azmartone67/dchub/releases "
         f"for the release status, and correct the listing by hand if the "
         f"deployment is stuck.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
