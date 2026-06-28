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
import json, os, re, urllib.request, urllib.parse, urllib.error

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
SMITHERY_SLUG = "azmartone67/dchub"
REPO_SLUG = "azmartone67/dchub-mcp-server"
LOBEHUB_SLUG = "azmartone67-dchub-mcp-server"

# CORE = must stay #1 (the defensible cluster). WATCH = track, don't alert.
CORE = ["data center", "data centers", "power grid", "fiber", "interconnection", "capacity"]
WATCH = ["grid", "power", "infrastructure", "renewables", "energy", "hyperscale"]


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def smithery_rank(term):
    """(our_position, total, leader_qualifiedName) for a search term. `leader` is the
    #1 result — it powers the COMPETITIVE RADAR / proactive early-warning: we want to
    SEE a rival leading (or newly closing on) a term we own BEFORE we lose #1, and to
    name who to beat — not just learn after the fact that a number changed."""
    try:
        d = _get("https://registry.smithery.ai/servers?" + urllib.parse.urlencode({"q": term, "pageSize": "50"}))
    except Exception:
        return None, None, None
    servers = d.get("servers") or []
    total = (d.get("pagination") or {}).get("totalCount")
    leader = servers[0].get("qualifiedName") if servers else None
    for i, s in enumerate(servers, 1):
        if "dchub" in (s.get("qualifiedName") or "").lower():
            return i, total, leader
    return None, total, leader


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


def readme_tool_count():
    """The tool count STATED in README.md. LobeHub and the awesome-list scrapers
    (punkpeye, appcypher, …) render the README, not the live server — so when the
    README drifts from live, every README-syncing surface shows a stale count
    (this is exactly why LobeHub displays 30/42 while live is 46). CI-reliable:
    reads a local file, no network. Prefers an explicit 'N MCP tools' phrase, then
    the shields.io tools badge."""
    try:
        txt = open("README.md", encoding="utf-8").read()
    except Exception:
        return None
    m = re.search(r"(\d+)\s*(?:MCP\s*)?tools\b", txt, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"tools-(\d+)-", txt)  # [![Tools](…/badge/tools-42-blue)]
    return int(m.group(1)) if m else None


def lobehub_presence(slug=LOBEHUB_SLUG):
    """Best-effort verification that the LobeHub listing still EXISTS + its displayed
    tool count. lobehub.com 429s automated UAs (including from GitHub Actions), so
    this is deliberately FAIL-SAFE and returns one of:
        ("present", tool_count|None) | ("absent", None) | ("unverifiable", None)
    Only ("absent", …) is alert-worthy. A 429 / timeout / connection error is
    ("unverifiable", …) — it must NOT page (the listing is almost certainly fine;
    CI just can't reach it). Verify 'unverifiable' in a real browser session."""
    url = f"https://lobehub.com/mcp/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return ("absent", None) if e.code == 404 else ("unverifiable", None)
    except Exception:
        return ("unverifiable", None)
    low = html.lower()
    if "dc hub mcp server" not in low and "dchub" not in low:
        return "absent", None  # reachable, but our listing is no longer on the page
    m = re.search(r"(\d+)\s*tools", low) or re.search(r"server features[^0-9]{0,24}(\d+)", low)
    return "present", (int(m.group(1)) if m else None)


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
    readme_tools = readme_tool_count()
    lobe_status, lobe_tools = lobehub_presence()

    core = {t: smithery_rank(t) for t in CORE}
    watch = {t: smithery_rank(t) for t in WATCH}

    # --- regressions (the only things that page) ---
    reasons = []
    core_one = 0
    for t, (pos, _tot, leader) in core.items():
        if pos == 1:
            core_one += 1
        else:
            who = f" — **{leader}** leads (beat them on relevance/freshness)" \
                  if leader and "dchub" not in (leader or "").lower() else ""
            reasons.append(f"CORE term **{t}** at {('#'+str(pos)) if pos else '>50'} (expected #1){who}")
    # PROACTIVE escalation: one rival leading 2+ CORE terms = a coordinated threat
    # contesting our cluster, not a one-off slip → call it out by name, loudly.
    core_set = set(CORE)
    rivals = {}
    for t in CORE:
        _pos, _t, leader = core[t]
        if leader and "dchub" not in (leader or "").lower():
            rivals.setdefault(leader, []).append(t)
    for rival, terms in sorted(rivals.items(), key=lambda kv: -len(kv[1])):
        if len(terms) >= 2:
            reasons.append(f"⚠️ THREAT: **{rival}** now leads {len(terms)} CORE terms "
                           f"({', '.join(terms)}) — a single rival is contesting the core cluster")
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
    # README-SYNC gate (2026-06-20): LobeHub + the awesome-list scrapers render the
    # README, not the live server. A stale README count makes ALL of them show stale
    # (LobeHub displayed 30/42 vs live 46). This is in-repo controllable → it ALERTS.
    if live_tools and readme_tools and live_tools != readme_tools:
        reasons.append(f"README states **{readme_tools} tools** but LIVE is **{live_tools}** — every "
                       f"README-syncing surface (LobeHub, punkpeye/appcypher awesome-lists) renders the "
                       f"stale count; update README.md (badge + prose) then re-trigger their crawls")
    # PRESENCE gate: the listing graded A/PREMIUM disappearing is alert-worthy.
    # 429/unverifiable is NOT (CI can't reach lobehub.com) — handled as a note below.
    if lobe_status == "absent":
        reasons.append(f"LobeHub listing **not found** at lobehub.com/mcp/{LOBEHUB_SLUG} "
                       f"(was Grade A/PREMIUM) — investigate de-listing")
    regression = bool(reasons)

    # Non-paging notes: owner-gated or environmental items we report but don't alert on.
    notes = []
    if lobe_status == "present" and lobe_tools and live_tools and lobe_tools != live_tools:
        notes.append(f"LobeHub shows **{lobe_tools} tools** vs live **{live_tools}** — owner: open the "
                     f"listing and click **Refresh Metadata** (re-crawls the README) once README is current.")
    if lobe_status == "unverifiable":
        notes.append("LobeHub presence **unverifiable from here** (lobehub.com rate-limits automated "
                     "requests) — confirm in a logged-in browser; not treated as a regression.")

    # --- report ---
    L = []
    L.append("## DC Hub — registry rank + drift monitor\n")
    L.append(f"**Canonical (repo):** v{can_ver} · {can_tools} tools · **LIVE tools/list: {live_tools}** · "
             f"README states: {readme_tools} tools\n")
    L.append("### Cross-registry parity")
    L.append("| Registry | Version | Tools | Note |")
    L.append("|---|---|---|---|")
    L.append(f"| Official MCP registry | {off_ver} | {off_tools} | cascade source |")
    L.append(f"| Smithery | — | {smi_tools} | name: {smi_name} |")
    L.append(f"| Glama | — | {gla_tools} | {gla_desc} |")
    L.append(f"| LobeHub | — | {lobe_tools if lobe_tools is not None else '—'} | "
             f"{lobe_status} · README-synced, 429s CI |")
    L.append("")
    L.append(f"### 🛡 Smithery competitive radar — CORE ({core_one}/{len(CORE)} held at #1)")
    L.append("| | Term | Our rank | Leader (← who to beat) | of N |")
    L.append("|---|---|---|---|---|")
    for t, (pos, tot, leader) in core.items():
        held = "✅" if pos == 1 else "🔻"
        lead = leader or "—"
        if pos == 1:
            lead = "**(us)**"
        L.append(f"| {held} | {t} | {('#'+str(pos)) if pos else '>50'} | {lead} | {tot} |")
    L.append("")
    L.append("### Watch terms (relevance opportunities — track, don't page)")
    L.append("| Term | Our rank | Leader | of N |")
    L.append("|---|---|---|---|")
    for t, (pos, tot, leader) in watch.items():
        lead = "**(us)**" if pos == 1 else (leader or "—")
        L.append(f"| {t} | {('#'+str(pos)) if pos else '>50'} | {lead} | {tot} |")
    L.append("")
    if regression:
        L.append("### 🔻 Regression detected")
        for r in reasons:
            L.append(f"- {r}")
    else:
        L.append(f"### ✅ No regression — CORE cluster holding #1 ({core_one}/{len(CORE)}), registry record in sync.")
    if notes:
        L.append("")
        L.append("### ℹ️ Notes (owner-gated / environmental — no alert)")
        for n in notes:
            L.append(f"- {n}")
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
