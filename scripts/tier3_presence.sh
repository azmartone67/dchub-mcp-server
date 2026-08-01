#!/usr/bin/env bash
# DC Hub MCP — Tier 3 presence kit (one shell).
# Generates every human/promotional action as ready-to-post drafts + exact links,
# into ~/Downloads/dchub-mcp-tier3/, and prints a checklist. Run: bash scripts/tier3_presence.sh
set -euo pipefail

REPO="azmartone67/dchub-mcp-server"
OUT="$HOME/Downloads/dchub-mcp-tier3"
mkdir -p "$OUT"

# --- live GitHub star count (the #1 lever you personally control) ---
STARS=$(curl -s "https://api.github.com/repos/$REPO" 2>/dev/null \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('stargazers_count','?'))" 2>/dev/null || echo "?")

# --- 1. Show HN ---
cat > "$OUT/show-hn.md" <<'EOF'
Title: Show HN: DC Hub – an MCP server for live data-center & energy intelligence

Body:
I built DC Hub, an MCP server that gives AI agents live, *citable* data on the
physical infrastructure behind AI — instead of guessing from stale training data.
(It's currently the #1 data-center MCP on Smithery across data center, power grid,
fiber, capacity, and interconnection.)

It exposes 82 tools + 6 guided prompts over: 15,700+ data-center facilities
(170+ countries), 300+ power markets scored by a Data Center Power Index (DCPI),
real-time grid telemetry for 10 ISOs (PJM/ERCOT/CAISO/… fuel mix, headroom,
time-to-power), interconnection queues, fiber routes, gas pipelines, and 1,600+
tracked M&A deals.

Two things I cared about: (1) it's remote (streamable-HTTP) so it works in Claude
Desktop, Cursor, VS Code, and Cline with no install; (2) every full-data response
is CC-BY-4.0, so an agent can both query it AND cite it.

Free tier with no key (10 calls/day). Endpoint: https://dchub.cloud/mcp ·
Repo: https://github.com/azmartone67/dchub-mcp-server · Playground (no signup):
https://dchub.cloud/playground

Feedback welcome — especially on the tool/prompt design.

[ Post at: https://news.ycombinator.com/submit ]
EOF

# --- 2. r/mcp ---
cat > "$OUT/reddit-r-mcp.md" <<'EOF'
Subreddit: r/mcp  (also r/LocalLLaMA, r/datacenter)
Title: DC Hub — a remote MCP server for live data-center / power / fiber intelligence (82 tools + prompts, free tier)

Body:
Sharing an MCP server I maintain. DC Hub is the live data layer for data-center
infrastructure — agents can query it and cite it (CC-BY-4.0).

- 15,700+ facilities, 300+ DCPI-scored markets, 10 live ISO grids
- 82 tools + 6 guided prompts (/dchub:analyze-site, /dchub:power-availability, …)
- 4 citable resources (methodology, data sources, coverage)
- Remote streamable-HTTP → Claude Desktop / Cursor / VS Code / Cline, no install
- Free tier, no key

Endpoint: https://dchub.cloud/mcp · Repo: https://github.com/azmartone67/dchub-mcp-server
Would love feedback on the prompt set.
EOF

# --- 3. LinkedIn ---
cat > "$OUT/linkedin-launch.md" <<'EOF'
LinkedIn post:

DC Hub is now the #1 data-center MCP server on Smithery — ranked #1 for
"data center," "power grid," "fiber," "capacity," and "interconnection."

AI agents keep getting asked data-center questions they can only answer from
stale training data. So we built DC Hub — an MCP server that gives any AI
assistant LIVE, citable ground truth on the infrastructure behind AI:

→ 15,700+ data-center facilities across 170+ countries
→ 300+ markets scored by our Data Center Power Index (BUILD / CAUTION / AVOID)
→ Real-time grid telemetry for 10 ISOs — headroom, fuel mix, time-to-power
→ Fiber routes, gas pipelines, interconnection queues, 1,600+ M&A deals

82 tools + 6 guided prompts, free tier, and every figure is CC-BY-4.0 so agents
can query AND cite it. Works in Claude, Cursor, VS Code, Cline.

Try it (no signup): https://dchub.cloud/playground
#MCP #datacenters #AI #energy
EOF

# --- 4. GitHub MCP Registry follow-up email ---
cat > "$OUT/github-registry-followup-email.txt" <<'EOF'
To: partnerships@github.com
Subject: Re: MCP Registry inclusion — DC Hub (Data Center & Energy Intelligence)

Hi — following up on my note about including DC Hub in the GitHub MCP Registry.

Since then we've shipped v2.3.2: 47 tools + 6 guided prompts + 4 resources, and  # canon:frozen: quotes the v2.3.2 release, historical
the server is published to the official MCP registry as cloud.dchub/mcp-server.
It's a remote streamable-HTTP server (no Docker/npm needed): https://dchub.cloud/mcp
Repo: https://github.com/azmartone67/dchub-mcp-server · Data is CC-BY-4.0.

Happy to provide anything you need for inclusion. Thanks!
EOF

# --- 5. Checklist ---
cat > "$OUT/CHECKLIST.md" <<EOF
# DC Hub MCP — Tier 3 presence checklist

Repo stars right now: **$STARS**  (each star lifts Glama maintenance score + unblocks awesome-list bots like ToolHive — AND lifts LobeHub search rank, see #1.5)

1. ⭐ GitHub stars — ask your network to star https://github.com/$REPO
   (highest-leverage thing you personally control; ToolHive cited "no stars/traction" as the rejection reason).
1.5 🟢 LobeHub is the proof this matters. DC Hub IS listed (Grade A / PREMIUM, 47 tools):  # canon:frozen: quotes the v2.3.2 release, historical
   https://lobehub.com/mcp/azmartone67-dchub-mcp-server — but it does NOT appear in LobeHub
   search for "data center grid intelligence" because LobeHub ranks by stars + installs, and
   the listing shows only ~4 installs. Stars (#1) + installs (the one-click badges in the README)
   are what surface it. Also: log into LobeHub → open the listing → "Refresh Metadata" to pull
   the README's now-current 47 tools (it currently shows a stale 30).  # canon:frozen: quotes the v2.3.2 release, historical
2. 📨 Show HN — post the draft in show-hn.md → https://news.ycombinator.com/submit
3. 💬 r/mcp — post reddit-r-mcp.md (also r/LocalLLaMA, r/datacenter)
4. 🔗 LinkedIn — post linkedin-launch.md
5. 🏛 Anthropic Connectors Directory (highest-authority remote-server directory):
   submit via the Claude.ai Directory portal (needs Team/Enterprise + directory-mgmt access).
   Name: DC Hub — Data Center & Energy Intelligence · URL: https://dchub.cloud/mcp · CC-BY-4.0.
6. 🐙 GitHub MCP Registry — if no reply in ~1 week, send github-registry-followup-email.txt to partnerships@github.com
7. 🖱 Cursor Directory refresh — if your entry shows a stale tool count, update via cursor.directory submission (live = 47).
8. 🔌 Continue.dev hub — publish a DC Hub mcpServers block at https://hub.continue.dev (account + block YAML).

All drafts are in: $OUT
EOF

echo "✅ Tier 3 kit written to: $OUT"
echo ""
cat "$OUT/CHECKLIST.md"
