#!/usr/bin/env python3
"""DC Hub MCP — registry rank + drift monitor.

Checks, on a schedule (registry-rank-monitor.yml) or locally:
  1. Smithery SEARCH RANK for the key terms (the thing that actually decayed).
  2. Cross-registry parity: canonical (repo server.json) vs the OFFICIAL MCP
     registry, Smithery, and Glama — version + tool count.

Flags a REGRESSION when a CORE term falls out of #1, or when the OFFICIAL
registry record drifts from the repo's canonical version/tool-count. Smithery /
Glama index lag is reported but NOT alerted (they re-crawl on their own cadence).

Read-only. No secrets. Smithery's API 403s the default urllib UA, so a browser
UA is set on every request.
"""
import json, os, re, urllib.request, urllib.parse

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
SMITHERY_SLUG = "azmartone67/dchub"
REPO_SLUG = "azmartone67/dchub-mcp-server"

# CORE = must stay #1 (the defensible cluster). WATCH = track, don't alert.
CORE = ["data center", "data centers", "power grid", "fiber", "interconnection", "capacity"]
WATCH = ["grid", "power", "infrastructure", "renewables", "energy", "hyperscale"]


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def smithery_rank(term):
    try:
        d = _get("https://registry.smithery.ai/servers?" + urllib.parse.urlencode({"q": term, "pageSize": "50"}))
    except Exception:
        return None, None
    servers = d.get("servers") or []
    total = (d.get("pagination") or {}).get("totalCount")
    for i, s in enumerate(servers, 1):
        if "dchub" in (s.get("qualifiedName") or "").lower():
            return i, total
    return None, total


def canonical():
    try:
        d = json.load(open("server.json"))
        meta = d.get("_meta", {}).get("io.modelcontextprotocol.registry/publisher-provided", {})
        return d.get("version"), meta.get("toolCount")
    except Exception:
        return None, None


def official_registry():
    try:
        d = _get("https://registry.modelcontextprotocol.io/v0/servers?search=cloud.dchub&version=latest")
        s = (d.get("servers") or [{}])[0]
        srv = s.get("server", s)
        meta = (s.get("_meta", {}) or {}).get("io.modelcontextprotocol.registry/publisher-provided", {}) or {}
        return srv.get("version"), meta.get("toolCount")
    except Exception:
        return None, None


def smithery_record():
    try:
        d = _get(f"https://registry.smithery.ai/servers/{SMITHERY_SLUG}")
        t = d.get("tools")
        return d.get("displayName"), (len(t) if isinstance(t, list) else t)
    except Exception:
        return None, None


def glama_record():
    try:
        d = _get(f"https://glama.ai/api/mcp/v1/servers/{REPO_SLUG}")
        desc = d.get("description") or ""
        m = re.search(r"(\d+)\s*tools", desc)
        return (int(m.group(1)) if m else None), desc[:60]
    except Exception:
        return None, None


def live_tool_count():
    """Initialize + tools/list against the LIVE MCP server → the SOURCE OF TRUTH
    tool count. Returns None on any error (then we don't alert on it). This is the
    check that catches "the publish source (server.json) is behind reality" — the
    failure mode where server.json AND the official registry agree at a stale count
    so the parity check above sees them in sync and confirms stale-as-healthy."""
    base = "https://dchub.cloud/mcp"
    hdr = {"User-Agent": UA, "Content-Type": "application/json",
           "Accept": "application/json, text/event-stream"}
    try:
        init = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                           "clientInfo": {"name": "drift-monitor", "version": "1"}}}
        req = urllib.request.Request(base, data=json.dumps(init).encode(), headers=hdr)
        with urllib.request.urlopen(req, timeout=25) as r:
            sid = r.headers.get("Mcp-Session-Id") or r.headers.get("mcp-session-id")
            r.read()
        if not sid:
            return None
        lst = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
        req2 = urllib.request.Request(base, data=json.dumps(lst).encode(),
                                      headers={**hdr, "Mcp-Session-Id": sid})
        with urllib.request.urlopen(req2, timeout=25) as r2:
            body = r2.read().decode("utf-8", "ignore")
        for line in body.split("\n"):
            line = line.strip()
            if line.startswith("data:"):
                line = line[5:].strip()
            if line.startswith("{"):
                try:
                    d = json.loads(line)
                    tools = (d.get("result") or {}).get("tools")
                    if isinstance(tools, list):
                        return len(tools)
                except Exception:
                    pass
        return None
    except Exception:
        return None


def main():
    can_ver, can_tools = canonical()
    live_tools = live_tool_count()
    off_ver, off_tools = official_registry()
    smi_name, smi_tools = smithery_record()
    gla_tools, gla_desc = glama_record()

    core = {t: smithery_rank(t) for t in CORE}
    watch = {t: smithery_rank(t) for t in WATCH}

    # --- regressions (the only things that page) ---
    reasons = []
    core_one = 0
    for t, (pos, _tot) in core.items():
        if pos == 1:
            core_one += 1
        else:
            reasons.append(f"CORE term **{t}** fell to {('#'+str(pos)) if pos else '>50'} (expected #1)")
    if off_ver and can_ver and off_ver != can_ver:
        reasons.append(f"Official registry version **{off_ver}** ≠ repo canonical **{can_ver}**")
    if off_tools and can_tools and off_tools != can_tools:
        reasons.append(f"Official registry toolCount **{off_tools}** ≠ repo canonical **{can_tools}**")
    # SOURCE-OF-TRUTH gate (2026-06-20): catch the publish source falling behind
    # the live server — the failure that let 46-vs-42 persist (server.json + the
    # official registry both stale at 42, so the parity check above saw "in sync").
    if live_tools and can_tools and live_tools != can_tools:
        reasons.append(f"LIVE tools/list **{live_tools}** ≠ repo canonical server.json **{can_tools}** "
                       f"— publish source is BEHIND the live server; bump server.json toolCount + republish")
    regression = bool(reasons)

    # --- report ---
    L = []
    L.append("## DC Hub — registry rank + drift monitor\n")
    L.append(f"**Canonical (repo):** v{can_ver} · {can_tools} tools · **LIVE tools/list: {live_tools}**\n")
    L.append("### Cross-registry parity")
    L.append("| Registry | Version | Tools | Note |")
    L.append("|---|---|---|---|")
    L.append(f"| Official MCP registry | {off_ver} | {off_tools} | cascade source |")
    L.append(f"| Smithery | — | {smi_tools} | name: {smi_name} |")
    L.append(f"| Glama | — | {gla_tools} | {gla_desc} |")
    L.append("")
    L.append(f"### Smithery search ranks — CORE ({core_one}/{len(CORE)} at #1)")
    L.append("| Term | Rank | of N |")
    L.append("|---|---|---|")
    for t, (pos, tot) in core.items():
        L.append(f"| {t} | {('#'+str(pos)) if pos else '>50'} | {tot} |")
    L.append("")
    L.append("### Watch terms")
    L.append("| Term | Rank | of N |")
    L.append("|---|---|---|")
    for t, (pos, tot) in watch.items():
        L.append(f"| {t} | {('#'+str(pos)) if pos else '>50'} | {tot} |")
    L.append("")
    if regression:
        L.append("### 🔻 Regression detected")
        for r in reasons:
            L.append(f"- {r}")
    else:
        L.append(f"### ✅ No regression — CORE cluster holding #1 ({core_one}/{len(CORE)}), registry record in sync.")
    report = "\n".join(L)

    print(report)
    open("monitor_report.md", "w").write(report)

    # GitHub Actions wiring (no-ops locally)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(report + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"regression={'true' if regression else 'false'}\n")
            f.write(f"core_one={core_one}\n")


if __name__ == "__main__":
    main()
