#!/usr/bin/env python3
"""DC Hub — distribution radar (automates the adoption + discoverability lever).

The Optimization Engines name adoption (distinct agents/wk) + discoverability
(registries listed) as the distribution gaps, but their actuators are human/
admin-gated. This closes the loop on the part that CAN be automated safely:
every week it AUDITS the curated directory + 'best MCP' roundup targets — is
dchub.cloud actually listed/mentioned? — and emits a worklist (✅ listed vs 🔴
pitch/submit) with the ready-to-send draft for each gap.

★ DRAFT-ONLY + READ-ONLY. It NEVER auto-sends cold publisher outreach (that's
cold B2B outreach → spam/reputation risk → stays human, respecting the
propose-only safety line). It just keeps the worklist current + in your face
(GitHub issue) and CONFIRMS wins (a target flips ✅ once a pitch lands, so it
stops nagging). Drafts live in ~/Downloads/dchub-mcp-tier3/.

Run: python3 scripts/distribution_radar.py  (wired weekly via distribution-radar.yml)
"""
import os
import urllib.request

UA = "Mozilla/5.0 (compatible; DCHub-DistributionRadar/1.0; +https://dchub.cloud)"
FIND = ("dchub", "dc hub")  # presence signals (case-insensitive)

# Curated targets. directory = submittable; roundup = editorial (pitch the author).
TARGETS = [
    {"name": "mcp.directory",        "type": "directory", "url": "https://mcp.directory/best-mcp-servers",                    "action": "submit (suggest-a-server) + pitch #2"},
    {"name": "Cursor Directory",     "type": "directory", "url": "https://cursor.directory/mcp",                              "action": "cursor.directory submission (live=47 tools)"},
    {"name": "Cline marketplace",    "type": "directory", "url": "https://github.com/cline/mcp-marketplace/issues/1668",      "action": "bump issue #1668 → cline-1668-bump-comment.md"},
    {"name": "Continue.dev hub",     "type": "directory", "url": "https://hub.continue.dev",                                  "action": "publish a dchub mcpServers block"},
    {"name": "Developers Digest",    "type": "roundup",   "url": "https://www.developersdigest.tech/best/mcp-servers",        "action": "pitch #1 → roundup-pitches.md"},
    {"name": "K2view",               "type": "roundup",   "url": "https://www.k2view.com/blog/awesome-mcp-servers",           "action": "pitch #3"},
    {"name": "MCPBundles",           "type": "roundup",   "url": "https://www.mcpbundles.com/blog/best-mcp-servers",          "action": "pitch #4"},
    {"name": "PopularAITools",       "type": "roundup",   "url": "https://popularaitools.ai/blog/50-best-mcp-servers-2026",   "action": "pitch #5"},
    {"name": "SkillsLLM",            "type": "roundup",   "url": "https://skillsllm.com/blog/best-mcp-servers-2026",          "action": "pitch #6"},
    {"name": "UI Bakery",            "type": "roundup",   "url": "https://uibakery.io/blog/best-mcp-servers",                 "action": "pitch #7"},
    {"name": "ShareUHack",           "type": "roundup",   "url": "https://www.shareuhack.com/en/posts/best-mcp-servers-guide-2026", "action": "pitch #8"},
]


def audit(url):
    """True = dchub listed/mentioned, False = not found, None = unreachable (recheck)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode("utf-8", "ignore").lower()
        return any(s in body for s in FIND)
    except Exception:
        return None


def main():
    rows = [{**t, "listed": audit(t["url"])} for t in TARGETS]
    listed_n = sum(1 for r in rows if r["listed"] is True)
    gaps = [r for r in rows if r["listed"] is False]
    unknown = [r for r in rows if r["listed"] is None]

    L = ["## DC Hub — distribution radar\n",
         f"**Listed/mentioned: {listed_n}/{len(rows)}** · 🔴 gaps to work: {len(gaps)} · ⚪ unverifiable: {len(unknown)}\n",
         "| | Target | Type | Next action |", "|---|---|---|---|"]
    order = {True: 2, None: 1, False: 0}  # gaps first
    for r in sorted(rows, key=lambda x: (order[x["listed"]], x["type"], x["name"])):
        mark = {True: "✅", False: "🔴", None: "⚪"}[r["listed"]]
        act = "— listed" if r["listed"] is True else r["action"]
        L.append(f"| {mark} | [{r['name']}]({r['url']}) | {r['type']} | {act} |")
    L.append("\n**Drafts (copy-paste-send):** `~/Downloads/dchub-mcp-tier3/` → roundup-pitches.md · "
             "cline-1668-bump-comment.md · distribution-targets.md")
    L.append("Cold outreach is NOT auto-sent — work the 🔴 gaps, then watch adoption "
             "(`/api/v1/ai/reach` distinct_agents_7d) climb 16→50 and the Leadership discoverability score rise.")
    report = "\n".join(L)
    print(report)
    open("distribution_report.md", "w").write(report)

    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(report + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"gaps={len(gaps)}\nlisted={listed_n}\n")


if __name__ == "__main__":
    main()
