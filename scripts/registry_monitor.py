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

# ── Term tiers (recalibrated 2026-07-12 from a Spearman teardown of registry.smithery.ai
#    ordering: score[text-relevance]≈0.61-0.88 and verified≈0.80-0.88 DRIVE rank; useCount
#    ≈0.53-0.66; createdAt[recency]≈0.00 == UNUSED. So a slip is a RELEVANCE loss to fix
#    with description/keyword text, NOT a freshness problem — republishing barely moves rank.)
#
# CORE  = terms we VERIFIABLY hold #1 on and that are ours to defend → a slip PAGES.
# RECLAIM = terms we do NOT hold #1 on for a STRUCTURAL reason (an off-topic server wins the
#           bare token on exact-name/usage, or the token is simply absent from our surfaces).
#           These must NOT page (they'd fire a permanent false regression); we TRACK them and,
#           when one slips/stays lost, emit the specific relevance remedy — never a freshness kick.
# WATCH = popularity/brand-capped opportunities (cloudflare/vercel/gce out-USE us). Informational.
#
# Recalibrated 2026-08-01 from a 35-term scan (we now hold #1 on 33/35). Moves:
#   energy CORE→RECLAIM — 101 consecutive checks at #2 behind sawftware-apps/commodities-sh
#     (useCount 60 vs our 3031, and "energy" is ALREADY prominent in our description) ⇒ a
#     semantic-relevance loss we cannot fix with text = a permanent false page.
#   interconnection / interconnection queue RECLAIM→CORE, datacenter WATCH→CORE — all held
#     #1, all named in the canonical description, all dead-center our product.
#   electricity + site selection WATCH→RECLAIM — both stuck at #9 behind an exact-name
#     (zemloai/elecz) and an on-topic land server (erik-7clt/local-intel): structural gaps
#     to reclaim with description text, not popularity caps.
#   MISO added to RECLAIM (>50: bare token is noise — zoho_books leads it).
CORE = ["data center", "data centers", "datacenter", "power grid", "fiber", "capacity",
        "grid interconnection", "interconnection", "interconnection queue",
        "renewables", "power"]
RECLAIM = ["energy", "natural gas", "hyperscale", "PJM", "ERCOT", "CAISO", "MISO",
           "electricity", "site selection"]
WATCH = ["grid", "infrastructure", "hyperscaler", "renewable energy", "transmission",
         "data center capacity", "grid capacity", "electricity grid",
         "ai infrastructure", "compute capacity", "power plant", "substation", "DCPI"]

# Per-CORE-term relevance remedy surfaced on a slip. The ONLY Smithery lever that moves the
# top-level `score` is the UI-authored description (no CLI/registry write path reaches it —
# confirmed 2026-07-12), so every remedy leads with that owner action.
STATE_FILE = "state/rank_streak.json"


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


def self_signals(term="data center"):
    """Our OWN Smithery signals from the search index (the search entries carry
    `verified`, `useCount`, `score`; the detail endpoint does not). `verified` is a
    large fixed rank boost (0.80-0.88 corr) that ONLY the owner can restore — so a
    drop to False is CORE-level alert-worthy. One cheap query on a term we hold #1 on."""
    try:
        d = _get("https://registry.smithery.ai/servers?" + urllib.parse.urlencode({"q": term, "pageSize": "50"}))
    except Exception:
        return None
    for s in (d.get("servers") or []):
        if "dchub" in (s.get("qualifiedName") or "").lower():
            return {"verified": s.get("verified"), "useCount": s.get("useCount"), "score": s.get("score")}
    return None


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


def glama_page_tool_count():
    """Tool count RENDERED on the public Glama page. Glama serves TWO counts that
    drift independently: the human/browser-facing page re-crawls the README (fast),
    while the API `description` blurb is a separately-cached auto-summary that lags
    for weeks. Agents discover DC Hub via the rendered page + live badge, not the
    blurb — so the page is the count that matters. FAIL-SAFE: any error → None so we
    fall back to the API blurb rather than false-alerting."""
    url = f"https://glama.ai/mcp/servers/{REPO_SLUG}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            html = r.read().decode("utf-8", "ignore")
    except Exception:
        return None
    m = re.search(r"(\d+)\s*MCP\s*tools", html, re.I)
    return int(m.group(1)) if m else None


def glama_record():
    """Prefer the page-rendered count (README re-crawl); the API `description` blurb
    is a lagging cache and is reported only as a fallback / for context."""
    page = glama_page_tool_count()
    try:
        d = _get(f"https://glama.ai/api/mcp/v1/servers/{REPO_SLUG}")
        desc = d.get("description") or ""
        m = re.search(r"(\d+)\s*tools", desc)
        blurb = int(m.group(1)) if m else None
    except Exception:
        blurb = None
        desc = ""
    if page is not None:
        note = f"page {page} tools"
        if blurb is not None and blurb != page:
            note += f" (API blurb lags: {blurb})"
        return page, note
    return blurb, (desc[:60] or "unreachable")


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


def _load_streak():
    try:
        return json.load(open(STATE_FILE))
    except Exception:
        return {}


def _save_streak(state):
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        json.dump(state, open(STATE_FILE, "w"), indent=1, sort_keys=True)
    except Exception:
        pass  # state is best-effort; never let it break the monitor


def _update_streaks(core_ranks):
    """Advance a per-CORE-term consecutive-slip counter so 'still slipped after N cycles'
    is evaluable (the monitor was stateless before — it overwrote monitor_report.md each run).
    Returns (state, list_of_terms_with_streak>=2)."""
    state = _load_streak()
    escalated = []
    for term, (pos, _tot, leader) in core_ranks.items():
        rec = state.get(term, {"streak": 0})
        if pos == 1:
            rec = {"streak": 0, "last_rank": 1, "leader": None}
        else:
            rec = {"streak": rec.get("streak", 0) + 1,
                   "last_rank": pos, "leader": leader}
            if rec["streak"] >= 2:
                escalated.append(term)
        state[term] = rec
    _save_streak(state)
    return state, escalated


def _write_status(core_one, remediate, escalated, regression):
    """Machine-readable status the Rank Defense Master Shell consumes to decide
    escalation/auto-PR without re-parsing stdout. Best-effort; never fatal."""
    try:
        os.makedirs("state", exist_ok=True)
        json.dump({"core_one": core_one, "core_total": len(CORE),
                   "remediate": remediate, "escalated": escalated,
                   "regression": bool(regression)},
                  open("state/rank_status.json", "w"), indent=1, sort_keys=True)
    except Exception:
        pass


def _reflex_kick():
    """INSURANCE ONLY. Recency has ~0 rank weight (createdAt is frozen at first-publish),
    so this republish does NOT recover rank — it only keeps `verified`/deployment/tool-catalog
    fresh so nothing structural rots while the real (relevance) remedy is applied. Local best-
    effort; gated by RANK_AUTOHEAL_DISABLE.

    ★★ IN CI, NOTHING FIRES — and this used to say it did. The workflow step that
    dispatched a freshness run was REMOVED on 2026-07-13 (see the removal note in
    .github/workflows/registry-rank-monitor.yml: a Smithery relevance slip is not
    fixed by a republish, which is correct). This function was not updated, so
    every CI-generated alert kept printing

        auto-heal reflex: ci (workflow fires gh workflow run smithery-freshness.yml)

    naming a step that no longer existed. That is the worst possible line to be
    wrong: it tells the reader the system is handling it, so the owner-gated
    remedy — the only thing that actually moves Smithery's score — never gets
    done. CORE term `energy` sat at #2/#3 for days under that reassurance.

    The CI branch now reports what is true and points at the real remedy, which
    the ESCALATE line below already spells out. Guarded by
    test/registry-reflex-honesty.test.mjs, which fails if this string ever again
    claims a workflow fires without that workflow actually being dispatched.
    """
    if os.environ.get("RANK_AUTOHEAL_DISABLE"):
        return "disabled (RANK_AUTOHEAL_DISABLE set)"
    if os.environ.get("GITHUB_OUTPUT"):
        return ("none in CI — no automated reflex exists for a relevance slip. "
                "Recency has ~0 rank weight, so the freshness dispatch was "
                "removed 2026-07-13 as ineffective. The remedy is OWNER-GATED: "
                "paste scripts/smithery_description.txt into the Smithery owner "
                "UI (see the ESCALATE line for the exact URL)")
    try:
        import subprocess
        uid = os.getuid()
        subprocess.run(["launchctl", "kickstart", "-k",
                        f"gui/{uid}/cloud.dchub.smithery-freshness"],
                       check=False, capture_output=True, timeout=20)
        return "kicked cloud.dchub.smithery-freshness (insurance; recency≈0 rank weight)"
    except Exception as e:
        return f"kick failed ({e})"


def main(probe=False):
    core = {t: smithery_rank(t) for t in CORE}
    # --- CORE regression + streak + reflex (both modes) ---
    reasons = []
    core_one = 0
    for t, (pos, _tot, leader) in core.items():
        if pos == 1:
            core_one += 1
        else:
            who = f" — **{leader}** leads" if leader and "dchub" not in (leader or "").lower() else ""
            reasons.append(f"CORE term **{t}** at {('#'+str(pos)) if pos else '>50'} (expected #1){who}")
    remediate = [t for t, (pos, _t, _l) in core.items() if pos != 1]
    _state, escalated = _update_streaks(core)
    reflex = None
    if remediate:
        reflex = _reflex_kick()
        for t in escalated:
            reasons.append(f"🚨 ESCALATE: CORE term **{t}** slipped ≥2 checks — a RELEVANCE loss. FIX: paste the "
                           f"canonical listing (source of truth scripts/smithery_description.txt; the local loop "
                           f"also stages it to ~/Downloads/smithery-description-CURRENT.txt) into "
                           f"smithery.ai/servers/{SMITHERY_SLUG} → Edit — the ONLY path to Smithery's `score`. "
                           f"If '{t}' is missing from that file, add it there first (it's the source of truth).")

    # VERIFIED tripwire (both modes): the `verified` badge is a large fixed rank
    # boost that ONLY the owner can restore — a drop pages loudly, but is NOT a
    # `remediate` item (no automation can fix it, so it must not trigger the auto-PR).
    sig = self_signals()
    if sig and sig.get("verified") is False:
        reasons.append(f"🚨 VERIFIED badge LOST on Smithery — a large fixed rank boost only the OWNER can "
                       f"restore; re-verify at smithery.ai/servers/{SMITHERY_SLUG} → Settings.")

    # RECLAIM tracking (never pages) — measure progress toward claiming these.
    reclaim = {t: smithery_rank(t) for t in RECLAIM}

    if probe:
        return _emit_probe(core, core_one, reclaim, reasons, remediate, reflex, escalated, sig)

    can_ver, can_tools = canonical()
    live_tools = live_tool_count()
    off_ver, off_tools = official_registry()
    smi_name, smi_tools = smithery_record()
    gla_tools, gla_desc = glama_record()
    readme_tools = readme_tool_count()
    lobe_status, lobe_tools = lobehub_presence()

    watch = {t: smithery_rank(t) for t in WATCH}

    # CORE regression, streak, remediate + reflex are computed at the top of main()
    # (shared with --probe mode); here we only ADD the cross-registry parity gates.
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
    if sig is not None:
        _vf = "✅ verified" if sig.get("verified") else "🚨 VERIFIED LOST"
        L.append(f"**Smithery signals:** {_vf} · useCount {sig.get('useCount', '?')} · "
                 f"score {sig.get('score', '?')}\n")
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
    # RECLAIM: terms not held for a structural reason — track progress, never page.
    reclaim_one = sum(1 for (pos, _t, _l) in reclaim.values() if pos == 1)
    L.append(f"### 🎯 Reclaim tier (relevance/keyword gaps — track, don't page) — {reclaim_one}/{len(RECLAIM)} at #1")
    L.append("| Term | Our rank | Leader | of N |")
    L.append("|---|---|---|---|")
    for t, (pos, tot, leader) in reclaim.items():
        lead = "**(us)**" if pos == 1 else (leader or "—")
        L.append(f"| {t} | {('#'+str(pos)) if pos else '>50'} | {lead} | {tot} |")
    L.append("")
    if regression:
        L.append("### 🔻 Regression detected")
        for r in reasons:
            L.append(f"- {r}")
        if reflex:
            L.append(f"- _auto-heal reflex: {reflex}_")
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
    _write_status(core_one, remediate, escalated, regression)

    # GitHub Actions wiring (no-ops locally). `remediate` drives the workflow's
    # detect→republish→verify step; it is the machine-readable list of CORE slips.
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(report + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"regression={'true' if regression else 'false'}\n")
            f.write(f"core_one={core_one}\n")
            f.write(f"remediate={'true' if remediate else 'false'}\n")
            f.write(f"remediate_terms={','.join(remediate)}\n")
    return regression


def _emit_probe(core, core_one, reclaim, reasons, remediate, reflex, escalated, sig=None):
    """Light mode (`--probe`): CORE + RECLAIM ranks only, no cross-registry/live/lobehub
    calls. Fires every ~90 min via the Rank Defense Master Shell between the 6h CI cron,
    so a slip is caught (and the insurance reflex + escalation fire) within the hour."""
    _vf = "?" if not sig else ("✅" if sig.get("verified") else "🚨 LOST")
    _uc = (sig or {}).get("useCount", "?")
    L = [f"## rank probe — CORE {core_one}/{len(CORE)} at #1 · verified {_vf} · useCount {_uc}"]
    for t, (pos, _tot, leader) in core.items():
        held = "✅" if pos == 1 else "🔻"
        L.append(f"{held} {t}: {('#'+str(pos)) if pos else '>50'}"
                 + ("" if pos == 1 else f"  (leader: {leader})"))
    reclaim_one = sum(1 for (pos, _t, _l) in reclaim.values() if pos == 1)
    L.append(f"— reclaim {reclaim_one}/{len(RECLAIM)} at #1")
    if reasons:
        L.append("REGRESSION:")
        L.extend(f"  - {r}" for r in reasons)
    if reflex:
        L.append(f"reflex: {reflex}")
    report = "\n".join(L)
    print(report)
    _write_status(core_one, remediate, escalated, bool(reasons))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"regression={'true' if reasons else 'false'}\n")
            f.write(f"remediate={'true' if remediate else 'false'}\n")
            f.write(f"remediate_terms={','.join(remediate)}\n")
    return bool(reasons)


if __name__ == "__main__":
    import sys
    main(probe="--probe" in sys.argv)
