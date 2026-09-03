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
import datetime, json, os, re, urllib.request, urllib.parse, urllib.error

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
SMITHERY_SLUG = "azmartone67/dchub"
REPO_SLUG = "azmartone67/dchub-mcp-server"
LOBEHUB_SLUG = "azmartone67-dchub-mcp-server"

# ── CONNECTOR listings ────────────────────────────────────────────────────────
#
# ★2026-08-30. This module's header says Glama drift "is reported but NOT alerted
# (they re-crawl on their own cadence)". That is TRUE of the SERVER listing, which
# re-crawls the README — glama_page_tool_count() above depends on exactly that.
#
# It is FALSE of a CONNECTOR listing, and the difference cost us 22 days.
#
# A connector description is typed once into Glama's own database and is never
# re-read from this repo. Measured 2026-08-30, the live connector blurb still
# advertised "the DCGI Data Center Gas Index (per-state natural-gas suitability
# for siting)" as a CURRENT capability — a score withdrawn 2026-08-08 — alongside
# a facility count and a market count retired long before that.
#
# test/no-live-dcgi-claims.test.mjs exists to stop precisely that claim. It passes
# 12/12. It scans this REPOSITORY, and the claim does not live here, so no edit to
# it could ever have caught this. registry_stale_guard.py has the same blind spot
# and states the reason in its own docstring: "The public registries pull from the
# SOURCE files in this repo" — which the connector listings simply do not do.
#
# So: the one Glama surface that can never self-correct was the one surface not
# watched, under a policy written for the surface that does self-correct.
#
# SLUGS ARE NOT DISCOVERABLE. There is no connector-enumeration endpoint we know
# of, so each listing must be named here. An empty list is a hard failure rather
# than a quiet pass, and a slug that stops resolving is reported — a fence that
# cannot reach its subject must not look like a clean scan.
CONNECTOR_SLUGS = [
    # Confirmed 2026-08-31 from the address bar of each live listing. BOTH point
    # at the same server and the same 83 tools; only the stored blurb differs,
    # which is why both must be watched and why the difference is measurable:
    # the quantity-free one scores Server Coherence A, the quantity-dense one C.
    "cloud.dchub/mcp-server",                              # blurb corrected 2026-08-30
    "cloud.dchub/dc-hub-data-center-intelligence-mcp-server",
]

# Capabilities we have RETIRED. The rule matches test/no-live-dcgi-claims.test.mjs
# exactly — the word may appear, but never without "withdrawn" — so the same rule
# now covers the surface that test structurally cannot see.
# ★2026-08-31 — THE DCGI ENTRY IS GONE, AND ITS REMOVAL IS THE POINT.
#
# This fence shipped 2026-08-30 flagging any DCGI mention that did not also say
# "withdrawn". Measured 2026-08-31 06:57Z, `get_gas_index(state=TX)` returns
# ok:true with dcgi 81.9, gas_access 84.9, gas_cost 77.4, verdict
# GAS-ADVANTAGED. The DCGI composite was RESTORED 2026-08-30. So the rule
# inverted overnight: it would have flagged CORRECT copy as a regression and
# passed STALE "withdrawn" copy as clean — a fence enforcing a false claim,
# roughly eighteen hours after I wrote it warning about fences that cry wolf.
#
# The lesson is not "remove the entry". It is that a withdrawal is a DATED
# EVENT, not a permanent property, and anything keyed on one has to be re-read
# against the live tool rather than trusted. That is the same rule /bind states
# for quantities, applied to capabilities: the response is authoritative, the
# prose about it is not.
#
# WHAT IS STILL WITHDRAWN, verified the same way: `get_gas_economics(dallas)`
# returns the $/MMBtu layers and NO $/MWh field. The gas-to-grid levelized cost
# is genuinely still gone, so it takes the DCGI's place and the mechanism stays
# live. Its pattern is deliberately the PHRASE, not "$/MWh" — electricity
# prices are legitimately quoted in $/MWh all over these listings and matching
# the unit would fire on every one of them.
#
# NOT FENCED YET, on purpose: several surfaces now assert the INVERSE false
# claim — server.mjs, the methodology resource and at least two Glama listings
# still call the DCGI withdrawn. Catching that needs a stale-withdrawal rule
# and answers we do not have (were the two defective terms fixed, or was the
# score restored on different math; is 81.9 comparable to the pre-08-08 68.0).
# Deliberately left open rather than guessed at.
WITHDRAWN_CAPABILITIES = [
    ("gas-to-grid $/MWh",
     re.compile(r"gas[-\s]?to[-\s]?grid|levelized (?:gas )?cost", re.I),
     "2026-08-08"),
]


def scan_withdrawn(text):
    """Names of withdrawn capabilities advertised WITHOUT the withdrawal. Pure."""
    out = []
    for name, pat, date in WITHDRAWN_CAPABILITIES:
        for line in re.split(r"[\r\n]|(?<=[.;])\s+", text):
            if pat.search(line) and not re.search(r"withdraw", line, re.I):
                out.append((name, date, line.strip()[:120]))
                break
    return out


def connector_listing_text(slug):
    """The DESCRIPTION region of a connector page.

    Returns (text, None, False) on success, or (None, reason, transient) where
    `transient` separates THEIR outage from OUR blind spot — see
    connector_regressions() for why that distinction is load-bearing.

    The page, not an API path: /api/mcp/v1/servers/<slug> is documented and proven
    above, but no connector equivalent is, and a guard pointed at a guessed URL
    404s forever while reporting nothing. This URL is the one a human opens.

    ★SCOPED, and the first draft of this was not — which would have made it
    useless. The connector page renders the full tool catalog, and one of the
    tools is `get_gas_index`, whose DISPLAY NAME is literally "Gas Index (DCGI)".
    A whole-page scan therefore flags a withdrawn-capability claim on every run,
    forever, against a tool that legitimately still exists and returns the
    withdrawal when called. A fence that cries wolf every run is a fence someone
    switches off, which is how the other four in this codebase died.

    So the scan is bounded to the prose between "Server Details" and the tool
    catalogue. That is a textual assumption about someone else's page, and it can
    break — which is why a missing marker returns a REASON rather than empty
    text. Unknown must not look like clean; that distinction is the whole point
    of this module's no-hardcoded-fallback rule."""
    url = f"https://glama.ai/mcp/connectors/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            html = r.read().decode("utf-8", "ignore")
    except Exception as e:
        return None, f"unreachable ({type(e).__name__})", True
    start = html.find("Server Details")
    if start < 0:
        return None, "no 'Server Details' marker — page moved, renamed or redesigned", False
    end = -1
    for marker in ("Available Tools", "Tool Definition Quality", "Glama MCP Gateway"):
        i = html.find(marker, start)
        if i > 0:
            end = i if end < 0 else min(end, i)
    if end < 0:
        return None, "no tool-catalogue marker — cannot bound the description region", False
    return html[start:end], None, False


def connector_regressions():
    """(regressions, notes) across the connector listings.

    ★TWO FAILURE CLASSES, and collapsing them is a mistake this org has already
    paid for once. dchub-backend#3410 — "unit tests were asking glama.ai what it
    was serving, and main went red when the answer changed" — is the same shape:
    a check that treats a third party's availability as our defect.

      TRANSIENT (timeout, connection reset, 5xx): Glama is down or throttling.
        A NOTE, never a regression. Alerting on it trains everyone to ignore
        this fence, and an ignored fence is how the other four here died.

      STRUCTURAL (page reachable, expected markers absent): the page was
        redesigned and the scan is now blind. That IS ours, it does not
        self-heal, and it must alert — otherwise the fence silently degrades to
        a green check over an unread page, which is the exact defect it exists
        to catch.

    Empty slug list is structural too: a fence scanning nothing must never look
    like a fence finding nothing."""
    regressions, notes = [], []
    if not CONNECTOR_SLUGS:
        return ["CONNECTOR_SLUGS is empty — the connector fence is scanning nothing"], notes
    if not WITHDRAWN_CAPABILITIES:
        # Retiring the last entry (as the DCGI restore nearly did) would leave
        # scan_withdrawn() returning [] for every input — a capability fence
        # that has silently stopped checking capabilities. Structural, not a note.
        return ["WITHDRAWN_CAPABILITIES is empty — the capability fence checks nothing"], notes
    for slug in CONNECTOR_SLUGS:
        html, err, transient = connector_listing_text(slug)
        if err:
            msg = f"connector `{slug}` not scanned: {err}"
            (notes if transient else regressions).append(
                msg + ("  — Glama-side, retried next run" if transient
                       else "  — the fence is BLIND until this is fixed"))
            continue
        for name, date, line in scan_withdrawn(html):
            regressions.append(
                f"🚨 connector `{slug}` advertises {name} as a live capability "
                f"(withdrawn {date}) — a stored blurb never re-crawls, so this "
                f"does not self-heal: {line!r}")
    return regressions, notes


# ── RANKING MODEL — remeasured 2026-09-03. This REPLACES the 2026-07-12 Spearman
#    teardown that stood here ("score[text-relevance]≈0.61-0.88 and verified≈0.80-0.88
#    DRIVE rank; useCount≈0.53-0.66; createdAt≈0.00"). Those correlations were fitted to a
#    `score` column whose values ran 0.61-0.88. The live column now runs 0.014-0.065. That
#    is a DIFFERENT function, not a drifted one, so nothing derived from it survives —
#    including "a slip is a relevance loss to fix with description text", which is the
#    premise RECLAIM was built on and which is refuted below.
#
#    `score` is RECIPROCAL RANK FUSION over TWO retrieval lists, k=30:
#        score = Σ 1/(30 + rank_in_that_list)
#    Fitted over 240 (query, server, score) observations across 12 queries: k=30 explains
#    231/240 = 96.2%, a single unimodal peak (k=29 → 95.4%, k=31 → 92.5%, k=60 → 58.8%).
#    So a score decodes to one or two small integers: 2/31 = #1 in BOTH lists, 1/46 = #16
#    in ONE list and absent from the other. rrf_decode() below does that inversion, and it
#    is the whole diagnostic value — ">20" invites a copy edit, "absent from one list"
#    says copy cannot reach it.
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
#   utility added to RECLAIM 2026-09-01 — it was rank #1 on 2026-08-26 (measured, past
#     agent-utils at 10,009 uses) and is now >20 of 162. It was in NO list — not CORE, not
#     RECLAIM, not WATCH — so the fall from #1 to off-page was invisible to this monitor.
#     That half stands, and the tracking gap it opened is closed.
#
#   ★ 2026-09-03 — THE CAUSE RECORDED ABOVE ("presence, not popularity: the term had been
#     dropped from scripts/smithery_description.txt entirely") IS REFUTED. #301 restored
#     `utility` and `electricity` to the lead sentence, and the owner paste landed: the live
#     Smithery blurb is now BYTE-IDENTICAL to scripts/smithery_description.txt, with
#     electricity at char 48, utility at 65 and site selection at 786 — all inside the
#     1,000-char window the search API indexes. Two days later, measured live:
#         utility >100 of 162 · site selection >100 of 187 · electricity 14 of 117
#     Presence was restored and rank was not. Three independent measurements say text is
#     not the lever for these terms:
#       1. `colocation` ranks #1 with ZERO occurrences anywhere in the description.
#       2. EVERY top-6 winner on `utility` and `site selection` has zero occurrences of the
#          term in BOTH its displayName and its description — agent-utils (Developer
#          Utilities) wins "utility", netlify and recreation-gov win "site selection".
#       3. We do not appear in the fused top-100 for either term, so there is no per-list
#          rank to improve; on `electricity` we decode to (16,) — one list only, fused
#          1/46 = 0.0217 against a #5 competitor at 0.054.
#     These queries are won on EMBEDDING similarity to the query's dominant sense
#     ("utility" → developer utilities, "site" → websites). A description cannot argue with
#     that. Do not spend another owner paste on them.
#   2026-09-03: `utility` and `site selection` RECLAIM -> WATCH. RECLAIM's defining
#   promise is "structural gaps to reclaim with description TEXT" and its remedy string
#   tells the owner to paste. The measurement above shows text does not reach either term,
#   so leaving them in RECLAIM emits a remedy we have proven does not work — the expensive
#   kind of wrong, because the remedy costs a human paste every time it fires. WATCH is
#   the tier for "tracked, informational, not ours to fix with copy". `electricity` STAYS
#   in RECLAIM: it is the one of the three we still hold a decodable list position on.
RECLAIM = ["energy", "natural gas", "hyperscale", "PJM", "ERCOT", "CAISO", "MISO",
           "electricity"]
WATCH = ["grid", "infrastructure", "hyperscaler", "renewable energy", "transmission",
         "data center capacity", "grid capacity", "electricity grid",
         "ai infrastructure", "compute capacity", "power plant", "substation", "DCPI",
         "utility", "site selection"]

# Per-CORE-term relevance remedy surfaced on a slip. The ONLY Smithery lever that moves the
# top-level `score` is the UI-authored description (no CLI/registry write path reaches it —
# confirmed 2026-07-12), so every remedy leads with that owner action.
# Smithery's SEARCH api truncates `description` to exactly this many chars —
# measured 2026-09-01 across 50 servers off registry.smithery.ai: max length
# 1000, none over, five sitting exactly at it. The DETAIL endpoint returns the
# full text. Only what survives this cut can rank.
SMITHERY_SEARCH_CHARS = 1000

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


RRF_K = 30  # measured 2026-09-03 over 240 observations; see the ranking-model note above.


def rrf_decode(score, k=RRF_K, maxr=200, tol=1e-9):
    """Invert a Smithery `score` back into the per-list ranks that produced it.

    Smithery fuses TWO retrieval lists with reciprocal rank fusion,
    score = Σ 1/(k + rank). Returns the contributing ranks: a 1-tuple means we
    are in ONE list only, a 2-tuple means both. None means the score does not
    decode at this k — which is itself the finding, because it means the fusion
    changed underneath us and every tier decision in this file was made against
    a function that no longer exists (exactly how the 2026-07-12 model went
    stale without anything noticing).

    This is the difference between a rank and a diagnosis. ">20" invites a copy
    edit. "absent from one list entirely" says copy cannot reach it.
    """
    if not isinstance(score, (int, float)) or score <= 0:
        return None
    for r in range(1, maxr + 1):
        if abs(score - 1.0 / (k + r)) < tol:
            return (r,)
    for r1 in range(1, maxr + 1):
        rest = score - 1.0 / (k + r1)
        if rest <= 0:
            break
        for r2 in range(r1, maxr + 1):
            if abs(rest - 1.0 / (k + r2)) < tol:
                return (r1, r2)
    return None


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
    html, _err = _glama_server_html()   # one 2 MB fetch shared with the provenance check
    if html is None:
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


# ── BUILD PROVENANCE: the listing must be BUILT FROM THE CURRENT TIP OF MAIN ───
#
# ★2026-09-01. Measured, and still true as this shipped: the Glama SERVER listing
# renders `get_gas_index` as "★ WITHDRAWN 2026-08-08: this tool no longer returns
# a score" — a capability RESTORED on main 2026-08-30 and returning ok:true live.
# Seven tool descriptions were serving text main no longer declares.
#
# WHY EVERY EXISTING FENCE MISSED IT. This is NOT stale prose and NOT a stale
# cache. The text was genuine MCP introspection output — perfectly correct for
# the commit that was built. CONNECTOR_SLUGS above watches connector blurbs for
# stale PROSE, so no prose rule could fire on copy that was true when written.
# test/no-live-dcgi-claims.test.mjs and registry_stale_guard.py scan THIS
# REPOSITORY, and the defect was never in it. The unowned invariant was the one
# nothing asserted: THE PUBLISHED LISTING MUST BE BUILT FROM THE CURRENT TIP OF
# MAIN.
#
# THE MECHANISM IS FRESHNESS, NOT A VENDOR DEFECT. Glama's mirror syncs fine —
# measured 2026-09-01 it was AT origin/main while the listing was still stale.
#
# THERE ARE THREE CLOCKS, NOT TWO, and two drafts of this comment got the count
# wrong before the third stage was found by hand:
#
#     repo SYNC  →  container BUILD  →  RELEASE  →  published schema page
#
# Each is a separate trigger, and NONE of them fires the next one on its own.
#     2026-08-31 16:53Z  BUILD  ran `git checkout 2462f5de` (pre-fix)
#     2026-08-31 16:54Z  RELEASE cut from that build → this is what is published
#     2026-08-31 17:29Z  SYNC   advanced the mirror to 0792adc (post-fix)
#   ⇒ the build was run 36 minutes before the sync that carried the fix.
#     2026-09-01 14:42Z  BUILD  re-run, success, 22.2s, `git checkout e67cddd`
#                        (== origin/main), container tools/list introspects the
#                        RESTORED text correctly … and the listing did NOT change.
#                        That build page carries NO "Release Created" block.
#
# So a green build proves nothing TWICE OVER: it may re-run a frozen checkout
# (the 08-31 case), and even a build at the correct commit publishes nothing
# until a RELEASE is cut from it (the 09-01 case, which is the live state as
# this shipped). The failure this fence detects is therefore best described as
# A STALE PUBLISHED RELEASE, not "a stale build".
#
# The invariant this checks is the OUTPUT one, which is stage-agnostic on
# purpose — it stays true no matter which of the three clocks is behind:
#   what the listing SERVES == what origin/main DECLARES.
# The mirror-commit comparison is the one stage we can also read directly, so it
# is used to NARROW the remedy: mirror behind ⇒ sync; mirror current ⇒ the
# problem is downstream of the sync and the report must name BOTH remaining
# stages, because a rebuild is a no-op when the build is already current.
#
# ★WHY THIS ALERTS, against this module's own stated policy. The header says
# Glama drift "is reported but NOT alerted (they re-crawl on their own cadence)".
# That remains TRUE of the README re-crawl — glama_page_tool_count() depends on
# exactly that, and the mirror sync above is the same kind of self-correcting
# thing. It is FALSE of the BUILD. Nothing re-triggers a build when the mirror
# advances, so a build left behind main stays behind indefinitely: this one had
# already been stale for two days when it was found by hand. A condition that
# does not self-correct must page, or it is discovered the way this one was.
#
# ★"pinnedCommit": null DOES NOT MEAN "TRACK LATEST". Glama's saved Build Spec
# read `"pinnedCommit": null` while the generated Dockerfile still contained a
# literal `git checkout 2462f5de…`. Empty means "use whatever the mirror
# resolved at build time", not "follow the branch". And glama.json cannot express
# a ref pin either — its schema is `maintainers` only, required. So there is no
# in-repo lever for this: a green rebuild re-runs the frozen checkout and proves
# nothing about freshness. Only the OUTPUT can be trusted, which is what the
# behavioural proxy below reads.
#
# ★HEAD COMES FROM origin/main OVER THE NETWORK, NEVER A LOCAL CHECKOUT. A local
# tree is routinely dozens of commits behind — this exact mistake was made on
# 2026-08-31 from a tree 36 commits stale, which is how a fresh mirror first got
# misread as a frozen one.
GITHUB_API = "https://api.github.com/repos/" + REPO_SLUG
# Mirror sync lag we tolerate before calling it a stall. Measured 2026-09-01: the
# mirror sat 10 commits behind main after ~1 day, against a repo doing 35-80
# commits/week — so ~1 day of normal lag is ~7-11 commits and 40 is ~4 days. The
# mirror DOES self-correct, so this is deliberately generous: it exists to catch a
# mirror that has stopped, not one that is merely behind.
MIRROR_LAG_TOLERANCE = 40
# The tool whose repair is the worked example above. The check sweeps EVERY tool;
# this one is named only so the historical case stays legible in the report.
PROVENANCE_SENTINEL = "get_gas_index"
# ★PUBLISH LAG. The RELEASE stage is ASYNCHRONOUS AND AUTOMATIC — measured
# 2026-09-01, a release fired on its own and the schema page followed, tens of
# minutes after the 21:43Z build, with no human cutting anything. An earlier
# draft of this file said a release had to be cut by hand; that was wrong, and
# the remedy text below no longer says it. Inside that lag a correct, freshly
# deployed server is INDISTINGUISHABLE from a stale one: mirror at HEAD, served
# text still the previous release. Flagging it would page on every good deploy.
#
# ★WHAT THIS IS ANCHORED TO, AND WHY IT IS NEITHER THE BUILD TIME NOR HEAD. The
# natural anchor is the last build's timestamp, and it is NOT obtainable: the
# build page is admin-only and the JSON API is 401. Anchoring to our own
# first-observation would need state that survives runs, and state/ is gitignored
# with no cache step in registry-rank-monitor.yml — so a state-anchored window
# would reset every CI run and NEVER expire, silently disabling this fence.
#
# The first draft anchored to origin/main HEAD's commit date, and MEASUREMENT
# killed it. Over the last 30 days of origin/main: 198 commits, MEDIAN GAP 75
# MINUTES — below this window — and 103 of 197 gaps under 90 minutes. Commits
# arrive in bursts separated by long quiet stretches (longest 38.1h), so the
# reassuring 25% of-wall-clock figure is an average that hides the shape: DURING
# A BURST each push re-arms the window before the previous one expires, so it is
# effectively always open. Deploys happen during bursts. HEAD-anchoring was
# therefore open precisely when the defect is most likely to be introduced, and
# it got QUIETER THE MORE YOU PUSH.
#
# So the anchor is the MIRROR commit's date. The mirror advancing is the actual
# precondition for a rebuild — a push that has not synced cannot have been built,
# so it must not re-arm the window — and the mirror advances far less often than
# main does (measured: 10 commits / ~20h behind at one point on 2026-09-01).
#
# ★THE GUARANTEE IS ONE-SIDED, on purpose. A commit's date is a LOWER BOUND on
# when the mirror synced to it (sync >= commit), so age-since-commit >=
# age-since-sync. Therefore: age < grace PROVES we are still inside the publish
# window, and grace is sound. age >= grace does NOT prove we are outside it — the
# mirror may have just caught up to an older commit — so we may occasionally page
# during a legitimate publish. That asymmetry is deliberate: this fence exists
# because a stale listing went unnoticed for two days, so it fails toward paging
# and never toward silence. Start at 90 and tune; one clean measurement of the
# real build->release lag bounds it only loosely.
PUBLISH_GRACE_MINUTES = 90

_PAGE_CACHE = {}


def _glama_server_html():
    """The public server page (~2 MB), fetched at most once per run.

    Returns (html, err). Shared by glama_page_tool_count() and the provenance
    check so one fetch serves both."""
    if "html" not in _PAGE_CACHE:
        url = f"https://glama.ai/mcp/servers/{REPO_SLUG}"
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                _PAGE_CACHE["html"], _PAGE_CACHE["err"] = r.read().decode("utf-8", "ignore"), None
        except Exception as e:
            _PAGE_CACHE["html"], _PAGE_CACHE["err"] = None, f"unreachable ({type(e).__name__})"
    return _PAGE_CACHE["html"], _PAGE_CACHE["err"]


def _mirror_commit(html):
    """The commit Glama's repository mirror last resolved, or None.

    The page browses the mirrored tree at
    /mcp/servers/<slug>/tree/<40-hex-commit>/<path>, so the SHA is readable
    without an API key — which matters, because the JSON API at
    /api/mcp/v1/servers/<slug> now answers 401 and its data licence demands
    visible attribution. Pure: takes HTML, returns a SHA."""
    shas = set(re.findall(r"/mcp/servers/[^\"']*?/tree/([0-9a-f]{40})/", html or ""))
    return shas.pop() if len(shas) == 1 else None


def _rendered_descriptions(html):
    """{tool_name: description} as the LISTING renders them — i.e. the output of
    the last BUILD's MCP introspection. Pure.

    Bounded per tool the same way connector_listing_text() bounds its region, and
    for the same reason: a marker that moves must yield nothing rather than
    something wrong.

    ★READ THE TOOL REGIONS, NEVER THE PAGE'S OWN PROSE. The overview page mixes
    two feeds with different clocks: the surrounding prose and the "N MCP tools"
    badge are README-fed and go fresh at the repo SYNC (glama_page_tool_count()
    depends on that and is right to), while these per-tool blocks come from the
    published RELEASE and lag it. Measured 2026-09-01 on the same fetch: the
    prose already carried the current 20,100+ facility count while every tool
    block still served August's text. A check reading the prose would have gone
    green one full stage early — blind to exactly this failure.

    The tool blocks here are byte-identical to the ones on /schema (verified
    2026-09-01 on get_gas_index), and the overview page additionally carries the
    /tree/<sha>/ mirror links that /schema does not — which is why both signals
    are taken from this one page rather than splitting across two fetches."""
    out = {}
    for name in set(re.findall(r"tool=([a-z_][a-z0-9_]*)\"", html or "")):
        i = (html or "").find(f'tool={name}"')
        seg = html[i:i + 9000]
        j = seg.find('<div class="prose">')
        if j < 0:
            continue
        m = re.search(r"<p>([\s\S]*?)</p>", seg[j:])
        if m:
            out[name] = _norm_rendered(m.group(1))
    return out


def _norm_rendered(t):
    """Rendered HTML → comparable text. Tags out FIRST, then entities: the
    descriptions contain literal angle-bracket placeholders (`<ISO>`, `<slug>`,
    `<the user's question>`) which Glama's markdown renderer emits inconsistently
    — some survive as escaped text, some are eaten as bogus tags. Unescaping
    first would resurrect them into tags the stripper then removes, which is a
    difference in OUR normaliser masquerading as a difference in THEIR build.

    Markdown punctuation is deliberately NOT stripped here — _words() handles it
    for BOTH sides at once. Doing it on this side only is what an earlier draft
    did, and it silently merged `analyze_site` into `analyzesite` on the served
    side while the declared side kept the underscore: 80 of 83 tools "stale",
    every one of them a defect in the normaliser."""
    # Imported HERE and aliased on purpose: three functions in this module bind
    # `html` as a LOCAL (connector_listing_text, glama_page_tool_count,
    # _glama_server_html's caller), so a top-level `import html` is one careless
    # edit away from a local shadowing the module.
    import html as _html
    return re.sub(r"\s+", " ", _html.unescape(re.sub(r"<[^>]+>", "", t or ""))).strip()


def _words(t):
    """Comparable word set. Markdown punctuation (`` ` ``, *, _) becomes a
    SEPARATOR rather than being deleted, so `analyze_site` yields the same two
    words whether or not the renderer kept the underscore. Applied to BOTH sides
    by _undeclared_words(), which is the only thing that makes the comparison
    symmetric."""
    return set(re.findall(r"[a-z0-9]{3,}", re.sub(r"[`*_]", " ", (t or "").lower())))


def _undeclared_words(rendered, declared):
    """Words the LISTING serves that the SERVER does not declare. Pure.

    ★THE ASYMMETRY IS THE WHOLE DESIGN, and a symmetric diff does not work here.
    Measured across all 83 tools: rendering only ever REMOVES words (placeholders
    eaten as tags, markdown stripped), so a two-way diff false-positives on 6 of
    10 tools with nothing wrong. But rendering cannot INVENT a word — text the
    listing serves that the live server does not declare can only have come from
    a different, older commit. Comparing added-words-only takes the false
    positives to ZERO while leaving the real signal loud: 76/83 clean, and the 7
    flagged were exactly the 7 that go clean when compared against the commit the
    build actually used (2462f5de). That is not a tuned threshold — it is the one
    direction rendering cannot fake.

    Deliberately word-set, not string equality: the listing legitimately
    truncates and re-renders, and a fence that fires on formatting is a fence
    someone switches off."""
    return _words(rendered) - _words(declared)


def _gh_json(url):
    """Keyless GitHub API read → (data, reason, transient).

    No token, matching this module's no-secrets rule; that caps us at 60 req/h
    per IP, so a 403/429 is THEIR throttle and must be a note, never a
    regression — the same TRANSIENT/STRUCTURAL split connector_regressions()
    documents. A 404 is structural on either caller (see below) and alerts."""
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.load(r), None, False
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            return None, f"GitHub API throttled ({e.code}) — keyless limit is 60/h per IP", True
        if e.code == 404:
            # Structural on either caller: for commits/main the repo moved or was
            # renamed; for compare/… the mirror is on a commit GitHub cannot
            # resolve (force-push, GC'd, or a fork). Both are real and neither
            # self-heals, so this alerts rather than becoming a note.
            return None, f"GitHub API 404 for {url} — unknown repo or commit", False
        return None, f"GitHub API HTTP {e.code}", True
    except Exception as e:
        return None, f"GitHub API unreachable ({type(e).__name__})", True


def origin_main_head():
    """(sha, committed_iso, reason, transient) for origin/main's tip — read over
    the NETWORK.

    Never `git rev-parse`: see the ★HEAD note above. The whole check is a
    comparison against this value, so a local answer would silently compare the
    listing against whatever happened to be checked out.

    The commit DATE comes back too because it is the only publish-pipeline clock
    readable without an API key — see PUBLISH_GRACE_MINUTES."""
    d, err, transient = _gh_json(f"{GITHUB_API}/commits/main")
    if err:
        return None, None, err, transient
    sha = (d or {}).get("sha")
    when = (((d or {}).get("commit") or {}).get("committer") or {}).get("date")
    return (sha, when, None, False) if sha else (
        None, None, "no sha in GitHub commits/main response", False)


def _age_minutes(iso, now=None):
    """Minutes since an ISO-8601 instant, or None if unparseable. Pure.

    None (not 0) on bad input, and the caller must treat None as NO GRACE: an
    unreadable clock has to fail toward alerting, never toward silence."""
    if not iso:
        return None
    try:
        t = datetime.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except Exception:
        return None
    now = now or datetime.datetime.now(datetime.timezone.utc)
    # Clock skew can put a commit slightly in the future; clamp rather than
    # returning a negative age that would read as "very old".
    return max(0.0, (now - t).total_seconds() / 60.0)


def glama_build_provenance(live_tools):
    """(regressions, notes) — is the published listing built from current main?

    `live_tools` is the live tools/list array (see _live_tools()); passing it in
    keeps this to one MCP handshake per run.

    ★THE REFERENCE IS THE LIVE SERVER'S OWN tools/list, not a parse of
    server.mjs, and that choice is load-bearing. This module already states the
    principle — "the response is authoritative, the prose about it is not" — and
    the measurement backed it: statically reading the declarations out of
    server.mjs needs a JS-literal reader that handles concatenation chains, and
    the version that did not silently truncated `claim_free_key` at 371 of 4389
    chars and reported 119 phantom stale words. tools/list returns the resolved
    string as JSON with nothing to parse. The commit comparison below is the
    independent guard against the live server ITSELF being behind, so the two
    signals do not share a failure mode."""
    regressions, notes = [], []

    html, page_err = _glama_server_html()
    if page_err:
        # Glama down/throttled: theirs, retried next run. Never a regression —
        # dchub-backend#3410 is what treating their availability as our defect costs.
        return regressions, [f"Glama build-provenance not checked: {page_err} — Glama-side, retried next run"]

    head, head_when, head_err, head_transient = origin_main_head()
    if head_err:
        (notes if head_transient else regressions).append(
            f"build provenance not checked: {head_err}"
            + ("" if head_transient else "  — the fence is BLIND until this is fixed"))
        head = None

    # ── half 1: the mirror's synced commit vs origin/main HEAD ────────────────
    # mirror_fresh: True = the mirror carries current main, so anything stale in
    # the SERVED text can only have come from an older BUILD. None = unknown.
    mirror_fresh = None
    mirror = _mirror_commit(html)
    if not mirror:
        regressions.append("Glama page exposes no /tree/<sha>/ mirror commit — page redesigned; "
                           "the build-provenance fence is BLIND until this is fixed")
    elif head:
        if mirror == head:
            mirror_fresh = True
            notes.append(f"Glama mirror is AT origin/main ({head[:7]}).")
        else:
            cmp_, cmp_err, cmp_transient = _gh_json(f"{GITHUB_API}/compare/{mirror}...{head}")
            if cmp_err:
                (notes if cmp_transient else regressions).append(
                    f"mirror-vs-HEAD distance not measured: {cmp_err}")
            else:
                status, ahead = cmp_.get("status"), cmp_.get("ahead_by")
                mirror_fresh = False
                if status != "ahead":
                    # diverged/behind: the mirror is on a commit main cannot reach
                    # (force-push, rewritten history). It will not converge on its own.
                    regressions.append(
                        f"🚨 Glama mirror commit `{mirror[:7]}` is NOT an ancestor of origin/main "
                        f"`{head[:7]}` (compare status: {status}) — the listing is built from "
                        f"history main no longer contains")
                elif ahead is not None and ahead > MIRROR_LAG_TOLERANCE:
                    regressions.append(
                        f"🚨 Glama mirror commit `{mirror[:7]}` is {ahead} commits behind origin/main "
                        f"`{head[:7]}` (tolerance {MIRROR_LAG_TOLERANCE}) — the mirror has stopped syncing")
                else:
                    mirror_fresh = True
                    notes.append(f"Glama mirror at `{mirror[:7]}`, {ahead} commits behind origin/main "
                                 f"`{head[:7]}` — within normal crawl lag, self-corrects.")

    # ── half 2: behavioural proxy — what the listing SERVES vs what main DECLARES ──
    if not isinstance(live_tools, list) or not live_tools:
        notes.append("build provenance: live tools/list unavailable, so the served-vs-declared "
                     "comparison was skipped — the mirror-commit half above still applied.")
        return regressions, notes
    declared = {t.get("name"): t.get("description") or "" for t in live_tools if t.get("name")}
    served = _rendered_descriptions(html)
    if not served:
        regressions.append("Glama page rendered no tool descriptions — page redesigned; the "
                           "served-vs-declared half of the fence is BLIND until this is fixed")
        return regressions, notes
    stale = {}
    for name, text in served.items():
        if name not in declared:
            continue
        extra = _undeclared_words(text, declared[name])
        if extra:
            stale[name] = sorted(extra)
    if stale:
        worst = sorted(stale.items(), key=lambda kv: -len(kv[1]))
        head_line = (f"🚨 Glama listing serves {len(stale)} of {len(served)} tool descriptions that "
                     f"origin/main does NOT declare — the PUBLISHED RELEASE was built from an older "
                     f"commit. Nothing downstream re-runs itself, so this does NOT self-correct; see "
                     f"the staged remedy below (owner: glama.ai/mcp/servers/{REPO_SLUG}). Worst: "
                     + "; ".join(f"`{n}` (+{len(w)}: {', '.join(w[:5])})" for n, w in worst[:3]))
        found = [head_line]
        if PROVENANCE_SENTINEL in stale:
            found.append(
                f"🚨 including the sentinel `{PROVENANCE_SENTINEL}` — the listing advertises it with "
                f"wording main has replaced ({', '.join(stale[PROVENANCE_SENTINEL][:6])}). This is the "
                f"worked example in the comment above: a repaired capability still shown as broken.")
        if mirror_fresh:
            # Only meaningful when the mirror is CURRENT — if the mirror itself
            # were stalled, the staleness would be explained by the sync stage.
            found.append(
                "↳ the mirror is AT origin/main, so the SYNC stage is not the problem. Two stages remain "
                "and this check cannot see which one is behind: (A) the BUILD is older than the mirror "
                "→ Sync Server, then Deploy; or (B) the build is already at HEAD and its RELEASE has not "
                "landed yet. The release stage is AUTOMATIC and asynchronous — it fires on its own tens "
                "of minutes after a build — so (B) needs no human action and only becomes actionable "
                f"once it has been stale well past PUBLISH_GRACE_MINUTES ({PUBLISH_GRACE_MINUTES}m), at "
                "which point check the newest build for its 'Release Created' block. DO NOT simply "
                "rebuild: when the build is already current a rebuild is a NO-OP, and 'green build → "
                "nothing changed → the vendor must be broken' is the exact loop that cost two days here. "
                "Neither stage is fixable from this repo (glama.json has no ref-pin field, and "
                "`pinnedCommit: null` does not mean 'track latest').")
        # GRACE: inside the publish window this is what a good deploy looks like.
        # Anchored to the MIRROR commit (see PUBLISH_GRACE_MINUTES): when the
        # mirror is already AT head we reuse head's date rather than spending a
        # second API call on the same commit. An unreadable sha or date grants NO
        # grace — unknown must not buy silence.
        anchor = head_when if (mirror and head and mirror == head) else None
        if mirror and anchor is None:
            _d, _e, _t = _gh_json(f"{GITHUB_API}/commits/{mirror}")
            anchor = (((_d or {}).get("commit") or {}).get("committer") or {}).get("date")
        age = _age_minutes(anchor) if mirror else None
        if age is not None and age < PUBLISH_GRACE_MINUTES:
            notes.append(f"Glama publish in progress — the mirror commit `{mirror[:7]}` is {int(age)}m "
                         f"old (grace {PUBLISH_GRACE_MINUTES}m) and build→release trails a sync, so this "
                         f"is reported but NOT alerted; it pages once the window passes. "
                         + " ".join(found))
        else:
            regressions.extend(found)
    else:
        notes.append(f"Glama build provenance: all {len(served)} rendered tool descriptions match "
                     f"what the live server declares.")
    return regressions, notes


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


def _live_tools():
    """Initialize + tools/list against the LIVE MCP server → the tools ARRAY, or
    None on any error. Split out of live_tool_count() so the build-provenance
    check can read tool DESCRIPTIONS from the same single handshake."""
    return _live_tools_impl()


def live_tool_count():
    """Initialize + tools/list against the LIVE MCP server → the SOURCE OF TRUTH
    tool count. Returns None on any error (then we don't alert on it). This is the
    check that catches "the publish source (server.json) is behind reality" — the
    failure mode where server.json AND the official registry agree at a stale count
    so the parity check above sees them in sync and confirms stale-as-healthy."""
    t = _live_tools()
    return len(t) if isinstance(t, list) else None


def _live_tools_impl():
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
                        return tools
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


def _live_search_blurb():
    """The description Smithery's SEARCH index actually holds — already truncated
    by them, so no slicing here. Returns None if unreadable (never "")."""
    try:
        d = _get("https://registry.smithery.ai/servers?" + urllib.parse.urlencode(
            {"q": "data center", "pageSize": "50"}))
    except Exception:
        return None
    for s in (d.get("servers") or []):
        if "dchub" in (s.get("qualifiedName") or "").lower():
            return s.get("description") or ""
    return None


def smithery_visible_terms(core_ranks):
    """A ranked term the copy PAYS FOR but Smithery never indexes.

    ★This does NOT compare the two TEXTS, deliberately. They have never matched
    (2026-09-01: live 2,212 chars vs repo 2,383, measured BEFORE any paste), and
    repo-ahead-of-live is the NORMAL state between a merge and the owner's paste
    — the blurb is owner-authored in the UI and no repo path writes it. A
    text-equality fence would be red by design, and a fence that is red by
    design gets deleted rather than fixed. This compares TERM VISIBILITY, which
    is the property that decides rank.

    Severity follows the HARM, not the drift:
      slipped (rank > 1) AND absent from the live window -> REGRESSION. That is
        the 2026-09-01 fiber case exactly: rank #3 for 313 consecutive cycles
        (~20 days) while the word sat at char 1,932 of a file whose first 1,000
        are all the search API ever reads.
      absent but still #1 -> note. `datacenter`, `power grid`,
        `grid interconnection` and `renewables` are absent from the copy
        entirely and hold #1 off displayName, smithery.yaml keywords and tool
        names. Alerting on those would encode a requirement the evidence
        contradicts — the same scope line test/smithery-reclaim-terms.test.mjs
        draws.
    """
    regressions, notes = [], []
    blurb = _live_search_blurb()
    if blurb is None:
        notes.append("Smithery blurb UNREADABLE from here — term visibility was not "
                     "checked. This is an unknown, not a clean result.")
        return regressions, notes
    if len(blurb) > SMITHERY_SEARCH_CHARS:
        notes.append(f"Smithery now serves {len(blurb)} description chars, past the "
                     f"{SMITHERY_SEARCH_CHARS} this check assumes — the truncation moved; "
                     f"re-measure before trusting the visibility verdict below.")
    low = blurb.lower()
    try:
        repo = open("scripts/smithery_description.txt", encoding="utf-8").read().lower()
    except Exception:
        repo = ""

    slipped, holding = [], []
    for t in CORE:
        if t.lower() in low:
            continue
        pos = (core_ranks.get(t) or (None, None, None))[0]
        (slipped if (pos and pos > 1) else holding).append(
            f"{t} (#{pos})" if pos and pos > 1 else t)
    pending = [t for t in CORE + RECLAIM
               if t.lower() in repo and t.lower() not in low]

    if slipped:
        regressions.append(
            f"Smithery indexes a blurb that never says {', '.join(slipped)} — SLIPPED and "
            f"absent from the {SMITHERY_SEARCH_CHARS}-char window the search API reads. "
            f"Owner: smithery.ai/servers/{SMITHERY_SLUG} -> Edit, paste "
            f"scripts/smithery_description.txt (terms front-loaded), Save.")
    if pending:
        shown = ", ".join(pending[:6]) + ("..." if len(pending) > 6 else "")
        notes.append(f"repo->live paste PENDING: scripts/smithery_description.txt carries "
                     f"{len(pending)} monitored term(s) the live window does not ({shown}). "
                     f"The blurb is owner-pasted in the UI; no repo path writes it.")
    if holding:
        notes.append(f"absent from the live window but holding #1 — winning off displayName, "
                     f"keywords and tool names rather than the blurb: {', '.join(holding)}")
    return regressions, notes


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
    # ONE live handshake serves both the count gate and the build-provenance
    # comparison — _live_tools() returns the array, the count is derived from it.
    live_list = _live_tools()
    live_tools = len(live_list) if isinstance(live_list, list) else None
    off_ver, off_tools = official_registry()
    smi_name, smi_tools = smithery_record()
    gla_tools, gla_desc = glama_record()
    _conn_reg, _conn_notes = connector_regressions()
    reasons.extend(_conn_reg)
    for _n in _conn_notes:
        print(f"note: {_n}")
    # BUILD PROVENANCE — alerts, unlike the rest of the Glama drift above; the
    # long comment on glama_build_provenance() says why the exception is correct.
    _prov_reg, _prov_notes = glama_build_provenance(live_list)
    reasons.extend(_prov_reg)
    # TERM VISIBILITY on the surface that actually ranks. Alerts only where a
    # term is BOTH slipped and unindexed; see smithery_visible_terms().
    _vis_reg, _vis_notes = smithery_visible_terms(core)
    reasons.extend(_vis_reg)
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
    notes = list(_prov_notes) + list(_vis_notes)
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
        _dec = rrf_decode(sig.get("score"))
        if _dec is None:
            _lists = "**score does NOT decode at k=%d — the fusion may have changed; " \
                     "re-fit before trusting any tier decision in this file**" % RRF_K
        elif len(_dec) == 1:
            _lists = "one retrieval list only, at #%d (absent from the other)" % _dec[0]
        else:
            _lists = "both retrieval lists, at #%d and #%d" % _dec
        L.append(f"**Smithery signals:** {_vf} · useCount {sig.get('useCount', '?')} · "
                 f"score {sig.get('score', '?')} → {_lists}\n")
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


def _self_test():
    """Offline must-fail controls for the pure half. The network half reuses the
    page-fetch pattern already proven by glama_page_tool_count()."""
    cases = [
        # The DCGI is LIVE again (restored 2026-08-30, verified against
        # get_gas_index 2026-08-31). None of these may flag any more — the four
        # cases below are the ones this fence used to get wrong in the other
        # direction, kept as regression controls against re-adding the entry.
        ("the DCGI Data Center Gas Index (per-state natural-gas suitability)", False,
         "was the fence's original target; the DCGI is live, so this is now TRUE copy"),
        ("the DC Hub Gas Index (DCGI) was WITHDRAWN 2026-08-08", False,
         "stale, but NOT this fence's job — a stale-withdrawal rule is deliberately unbuilt"),
        ("DCPI market verdicts and live grid telemetry", False, "DCPI is not DCGI"),
        ("get_gas_index Gas Index (DCGI) Read-only Idempotent", False,
         "tool display name — no longer flags, so the description-region scoping "
         "is no longer load-bearing for THIS entry; it stays because the next "
         "entry will need it"),
        # The claim that IS still withdrawn.
        ("gas-to-grid levelized cost across CCGT heat rates", True,
         "the $/MWh withdrawal, still true 2026-08-31"),
        ("gas to grid $/MWh for this market", True, "spacing variant"),
        ("the gas-to-grid figure was WITHDRAWN 2026-08-08", False,
         "honest mention — allowed, an agent asking deserves the answer"),
        ("wholesale power at $42/MWh in ERCOT", False,
         "a legitimate electricity price — why the pattern matches the PHRASE, not the unit"),
    ]
    bad = 0
    for text, should_flag, why in cases:
        got = bool(scan_withdrawn(text))
        ok = got == should_flag
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  {'flag' if should_flag else 'pass'}  {why}")
    # ── BUILD-PROVENANCE controls ─────────────────────────────────────────────
    # The asymmetry in _undeclared_words() is the load-bearing claim, so the
    # first four cases are the rendering artifacts that a symmetric diff gets
    # WRONG: each one is a real transformation measured on the live Glama page
    # (6 of 10 tools tripped a two-way diff with nothing actually stale).
    print("\n  — build provenance —")
    words = [
        ("Prices in <ISO> right now? — live energy PRICING for the 7 US ISOs",
         "Prices in right now? — live energy PRICING for the 7 US ISOs", False,
         "renderer ATE the <ISO> placeholder as a bogus tag — removal only, must not flag"),
        ("Per-feed freshness for the ingest layer, one row per feed",
         "Per-feed freshness for the ingest", False,
         "listing TRUNCATED the description — removal only, must not flag"),
        ("set the `X-API-Key` header", "set the X-API-Key header", False,
         "markdown code ticks stripped by the renderer — must not flag"),
        ("identical text both sides", "identical text both sides", False, "exact match"),
        # The signal: text the listing serves that the server does not declare.
        ("DCGI — the per-state score. WITHDRAWN 2026-08-08, RESTORED 2026-08-30",
         "DCGI — the per-state score. WITHDRAWN 2026-08-08: this tool no longer "
         "returns a score, the backend names the defects", True,
         "the observed defect — a repaired capability still served as broken"),
        ("700+ subsea cables", "1,900+ subsea cables", True,
         "a single drifted quantity is still text main does not declare"),
    ]
    for declared_txt, served, should_flag, why in words:
        got = bool(_undeclared_words(served, declared_txt))
        ok = got == should_flag
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  {'flag' if should_flag else 'pass'}  {why}")

    # A fence that cannot reach its subject must return None (→ reported BLIND),
    # never a guess and never something that reads as clean.
    tree = '<a href="/mcp/servers/x/y/tree/' + "a" * 40 + '/docs">docs</a>'
    shas = [
        (tree, "a" * 40, "well-formed mirror tree link"),
        ('<a href="/mcp/servers/x/y">no tree links</a>', None,
         "page redesigned — must be None so the caller reports BLIND, not clean"),
        (tree + '<a href="/mcp/servers/x/y/tree/' + "b" * 40 + '/src">src</a>', None,
         "two different shas — ambiguous, so None rather than an arbitrary pick"),
    ]
    for html_in, want, why in shas:
        got = _mirror_commit(html_in)
        ok = got == want
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  sha   {why}")

    # The grace clock. An unreadable date must yield None so the caller grants NO
    # grace — a clock we cannot read must never buy silence.
    _T0 = datetime.datetime(2026, 9, 1, 12, 0, tzinfo=datetime.timezone.utc)
    for iso, want, why in [
        ("2026-09-01T11:00:00Z", 60.0, "a plain past instant, in minutes"),
        ("2026-09-01T11:00:00+00:00", 60.0, "offset form parses the same as Z"),
        (None, None, "no date → None → NO grace (unknown must not buy silence)"),
        ("not-a-date", None, "unparseable → None → NO grace, not 0"),
        ("2026-09-01T12:30:00Z", 0.0, "clock skew clamps to 0, never negative"),
    ]:
        got = _age_minutes(iso, now=_T0)
        ok = got == want
        bad += not ok
        print(f"  {'ok  ' if ok else 'FAIL'}  age   {why}")

    page = ('<a href="?tab=tools&amp;tool=get_gas_index">Inspect</a>'
            '<div class="prose"><p>Gas Index &amp; <code>dcgi</code> score</p></div>'
            '<a href="?tab=tools&amp;tool=orphan_tool">Inspect</a><div>no prose here</div>')
    got = _rendered_descriptions(page)
    for want_ok, why in [
        (got.get("get_gas_index") == "Gas Index & dcgi score",
         "entities decoded and <code> stripped after tags, not before"),
        ("orphan_tool" not in got,
         "a tool with no prose region is ABSENT, not empty-string (empty reads as clean)"),
    ]:
        bad += not want_ok
        print(f"  {'ok  ' if want_ok else 'FAIL'}  desc  {why}")

    if bad:
        print(f"\n\u2717 self-test: {bad} case(s) wrong")
        return 1
    print("\n\u2713 self-test: all cases correct")
    return 0


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    main(probe="--probe" in sys.argv)
