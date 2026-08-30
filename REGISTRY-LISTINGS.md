# DC Hub MCP — Registry Listing Copy (ready to paste)

Source of truth: `https://dchub.cloud/.well-known/mcp-server.json` · Endpoint: `https://dchub.cloud/mcp` (Streamable HTTP)
Live server **83 tools** · official registry listing `cloud.dchub/mcp-server` **v2.3.3** · CC-BY-4.0 data · free tier (no key) + `X-API-Key` for full data.

## ⚡ STATUS + WHAT'S LEFT (2026-06-02)
- ✅ **Official MCP Registry** (`registry.modelcontextprotocol.io`) — **DONE, v2.3.3 live.** Auto-republishes on every `server.json` version bump (GitHub Action `registry-refresh.yml`, DNS-auth). **Most directories mirror this**, so you're already broadly listed.
- ✅ **Glama** — auto-listed from this repo's `glama.json`; just hit **Refresh** on your Glama page if it looks stale.
- ⏳ **3 quick web forms left** (~5 min each — there's NO "upload a document" field; paste the values below):
  1. **PulseMCP** → https://www.pulsemcp.com → "Submit" in the top nav.
  2. **mcp.so** → https://mcp.so → "Submit".
  3. **Smithery** → CLI, no form: `smithery mcp publish "https://dchub.cloud/mcp" -n azmartone67/dchub` (or "Add Server" on smithery.ai).
- For ALL of them, paste from the **One-liner / Short description / Connection** blocks below. Manifest the form may ask for: `https://dchub.cloud/.well-known/mcp-server.json` (now v2.3.3 / 83 tools at origin; CF edge refreshes within ~10 min).

> Note: a registry that verifies by fetching the manifest reads the dchub.cloud edge copy (CF, ~10-min cache). If it shows stale data, wait 10 min or give it the Railway-direct origin URL.

## ★ HIGHEST-LEVERAGE, NOT YET DONE (2026-06-22) — reach is the binding constraint
- 🔲 **Anthropic Connectors Directory** — APPLY (it's an application/review, not an API). This is the **single highest-traffic placement**: ~100% of current external reach already comes from Claude, so a verified directory listing puts DC Hub in front of exactly the users who convert. Apply at the Anthropic "Submit a connector" flow; use the One-liner + Long description + Connection (`https://dchub.cloud/mcp`) below.
- 🔲 **Scan-based directories that need a *runnable* command** (Smithery/Cursor/Cline/Glama verify by introspecting a process, not a bare remote URL) — give them the **stdio bridge command** (verified working 2026-06-22): `npx mcp-remote https://dchub.cloud/mcp`. This is the structural fix for "listed but unverified / Claude-only reach": a remote-only server can't be scanned, but the `mcp-remote` shim exposes it as a runnable stdio server every directory can introspect. See the **Stdio install** block under Connection.

---

## One-liner (≤ 100 chars)
The data-center, power & energy intelligence layer for AI agents — query AND cite, live.

## Short description (≤ 300 chars)
DC Hub is the live data-center, power & energy intelligence MCP: 19,500+ facilities, 300+ markets, 7 US ISOs + 43 utility BAs + 31 intl grid regions, live interconnection-queue depth, the tracked construction pipeline, the DCPI power index, renewables, fiber, hyperscaler deals & M&A. 83 tools an agent can query and cite (CC-BY-4.0). Free tier.

## Long description
DC Hub is the neutral, real-time data layer for data-center infrastructure — built so AI agents can both **query** it (MCP + REST) and **cite** it (every full-data response carries `Source: DC Hub, CC-BY-4.0`).

Coverage:
- **Facilities** — 19,500+ data centers worldwide: search, profiles, scoring, alternatives
- **Markets** — 300+ markets with the **DCPI** (Data Center Power Index): BUILD/CAUTION/AVOID
- **Gas** — per-state pipeline + operator presence with live Henry Hub via `get_gas_intelligence` (the DCGI composite was withdrawn 2026-08-08 — inputs, not a score)
- **Grid / ISO** — live fuel mix, carbon intensity, demand, prices & interconnection-queue depth across 7 US ISOs + 43 US utility BAs + 31 international grid regions; one-call all-ISO scoreboard
- **Capital** — 2,000+ tracked M&A deals + hyperscaler capex tracker + AI Compute Capacity Index
- **Site factors** — fiber routes, water-stress, tax incentives, nearby substations/transmission

Why agents pick it: the only DC-intelligence source an LLM can query live AND cite — the MCP-native alternative to static PDF research. No NDAs, no quarterly reports, just live JSON.

## Categories / tags
`data-center` · `energy` · `natural-gas` · `electricity-grid` · `ISO` · `infrastructure` · `real-estate` · `sustainability` · `market-intelligence` · `M&A`

## Connection
- Transport: **Streamable HTTP**
- URL: `https://dchub.cloud/mcp`
- Auth: none for the free tier; `X-API-Key: dch_live_…` for full data (free dev key, email only, at https://dchub.cloud/signup)
- Manifest: `https://dchub.cloud/.well-known/mcp.json`
- Discovery: `https://dchub.cloud/llms.txt` · `https://dchub.cloud/AGENTS.md`

## Headline tools (highlight these)
- `search_facilities` — search the 19,500+ facility universe
- `get_market_dcpi_rank` — a market's DCPI power score + BUILD/CAUTION/AVOID verdict
- `get_gas_intelligence` — per-state gas brief: pipeline + operator presence, live Henry Hub (the DCGI score was withdrawn 2026-08-08)
- `get_grid_scoreboard` — all 7 US ISOs + 31 intl grid regions ranked live by carbon / renewables / fuel mix
- `get_interconnection_queue` — interconnection-queue depth + wait by ISO
- `score_facility` / `analyze_site` — score a lat/lon for data-center suitability
- `hyperscaler_deals` — AI/hyperscaler capex + M&A tracker

---

## Per-registry submission notes

### Smithery (smithery.ai/servers/azmartone67/dchub)
- Type: Remote (Streamable HTTP). Base URL `https://dchub.cloud/mcp`. No auth required to list/try (free tier).
- Use the short description + categories above. Confirm the tool list auto-populates from the manifest (83 tools).

### Glama (glama.ai/mcp/connectors/cloud.dchub/...)
- Already indexed as a connector. Refresh so it picks up the current 83 tools (now incl. `get_grid_scoreboard`, `get_fiber_readiness`, `claim_free_key`).
- Long description + tags above lift the Glama quality score (target A).

### PulseMCP (pulsemcp.com/submit)
- Remote server. Name: "DC Hub — Data Center Intelligence". URL `https://dchub.cloud/mcp`. Use long description + headline tools.

### Cursor Directory (cursor.directory/plugins/mcp-dchub)
- Already present. Update the description to mention the gas index + grid scoreboard; config snippet:
  ```json
  { "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp" } } }
  ```

### Generic config snippet (for any client/registry)
```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp"
    }
  }
}
```
With a key:
```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp",
      "headers": { "X-API-Key": "dch_live_…" }
    }
  }
}
```

### Stdio install — for clients/directories that need a runnable command (verified 2026-06-22)
Some clients and scan-based directories want a stdio *command*, not a remote URL. The standard `mcp-remote` bridge proxies stdio ↔ the remote server — no custom package to publish, nothing to install:
```bash
npx mcp-remote https://dchub.cloud/mcp
```
As an `mcpServers` entry (Cursor / Cline / Windsurf / Claude Desktop):
```json
{
  "mcpServers": {
    "dchub": {
      "command": "npx",
      "args": ["mcp-remote", "https://dchub.cloud/mcp"]
    }
  }
}
```
This is the fix for "listed but unverified / Claude-only reach": Smithery/Cursor/Cline/Glama verify by introspecting a running process, which a bare remote URL can't provide but this shim can. Connects on the free tier (no key); for full data add `X-API-Key` as a header in the client.

> Submissions are yours to send (they require your registry accounts). This file is the copy to paste.

---

## (b) Tuned long descriptions — per registry (paste-ready)

### Smithery — audience: agent builders / developers
**Title:** DC Hub — Data Center, Interconnection & Capacity Intelligence
> _(Title tweak 2026-07-12: added "Interconnection & Capacity" — these are the two search terms we lost #1 on; the displayName is the highest-weighted rank field on Smithery.)_
**Description:**
> Live **interconnection-queue**, grid-**capacity** & data-center power intelligence for AI agents — query it and cite it. One Streamable-HTTP MCP server, 83 tools, no signup to start.
>
> Built for agents answering power, siting and capacity questions: pull live **interconnection-queue** depth, wait times and per-ISO BUILD/CAUTION/AVOID verdicts across 7 US ISOs + 43 US utility BAs + 31 international grid regions; track the **construction capacity pipeline** plus the AI Compute Capacity Index; rank 300+ markets by the DCPI power index; search 19,500+ data centers across 170+ countries; score any lat/lon for buildability; compare US + European + GB + Taiwan + Japan + Korea + Brazil grids live (fuel mix, renewables, carbon, demand); and reach hyperscaler $1B+ deals, 2,000+ tracked M&A, gas-vs-grid economics, fiber routes, water-stress & tax incentives.
>
> Free tier works with no key (10 calls/day). Add `X-API-Key` for full rows. Every full-data response carries `Source: DC Hub (CC-BY-4.0)` so your agent attributes cleanly. The MCP-native alternative to static PDF research — live JSON, no NDAs.
**Try it:** `get_interconnection_queue iso=PJM` · `get_power_pipeline` (construction pipeline) · `get_grid_scoreboard` · `get_market_dcpi_rank market=northern-virginia`

### Glama — audience: quality-graded directory (rich copy lifts the grade)
**Description:**
> DC Hub is the neutral, real-time data layer for data-center infrastructure, exposed as a Model Context Protocol server so any AI agent can both **query** it and **cite** it.
>
> **Coverage:** 19,500+ facilities (search, profile, score, alternatives); 300+ markets scored by the DCPI Data Center Power Index; per-state gas pipeline/operator presence with live Henry Hub (the DCGI composite was withdrawn 2026-08-08); live grid telemetry across 7 US ISOs (fuel mix, carbon intensity, demand, prices) plus a one-call all-ISO scoreboard; interconnection-queue depth; 2,000+ tracked M&A deals and a hyperscaler-capex tracker; and site factors — fiber routes, water-stress, tax incentives, nearby substations & transmission.
>
> **Why agents choose it:** it's the only data-center-intelligence source an LLM can query live *and* cite — every full-data response includes a `Source: DC Hub, CC-BY-4.0` attribution line. It's the MCP-native alternative to quarterly PDF research: live JSON, no contracts, no NDAs.
>
> **Access:** Streamable HTTP at `https://dchub.cloud/mcp`. Free tier with no signup; free email-verified dev key for higher limits; paid tiers for full data volume.
**Categories:** data-center, energy, natural-gas, electricity-grid, infrastructure, sustainability, market-intelligence, real-estate, M&A

### PulseMCP — audience: broad MCP discovery directory
**Name:** DC Hub — Data Center Intelligence
**Description:**
> Real-time data-center, power & gas intelligence for AI agents. 83 MCP tools over Streamable HTTP: search 19,500+ facilities, score sites, rank 300+ markets (DCPI power index), pull the per-state gas brief (pipelines, operators, live Henry Hub), compare US ISO grids live, and pull interconnection queues, M&A, fiber, water & tax data. Free tier, no signup. Responses are citation-ready (CC-BY-4.0). The live alternative to static data-center research reports.
**Use cases:** "Where should I build a data center?" · "Which US grid is greenest right now?" · "Which states are gas-advantaged for DC power?" · "What's Northern Virginia's DCPI verdict?"

### Cursor Directory — audience: IDE developers
**Description:**
> Give your agent live data-center, grid & gas intelligence. 83 MCP tools: facility search (19,500+), site scoring, DCPI market ranks, the per-state gas brief (the DCGI score is withdrawn), a live all-ISO grid scoreboard, interconnection queues, M&A, fiber, water & tax. Free tier needs no key; add `X-API-Key` for full data. Citation-ready (CC-BY-4.0).
**Config:**
> ```json
> { "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp" } } }
> ```

---

## (a) Manifest status — FIXED in-repo (2026-05-31)

Investigated + corrected. The canonical Flask manifest `_canonical_mcp_manifest()` (main.py, served at `/.well-known/mcp.json` + `/mcp/manifest` + `/api/v1/mcp/manifest`) listed 29 tools but was MISSING `get_gas_index` + `get_grid_scoreboard`. Added both + bumped version 2.1.13 → 2.1.20 (commit 4e49e651, additive 3-line change). After the backend redeploys, the canonical manifest lists these incl. the gas index + grid scoreboard. (Headline "38 tools" = live `/mcp` tools/list; the canonical manifest's hand-curated list differs slightly in membership — use 38 for listings.) <!-- canon:frozen: historical investigation log, not a claim about the current surface -->

Remaining caveat (out-of-repo, your call): the public **`dchub.cloud/.well-known/mcp.json` edge** is served/cached by the `dchubapiproxy` Cloudflare worker and showed an OLDER copy (v2.1.11) than even Railway-direct. After the backend deploy, if the edge still lags, it needs a CF cache purge or worker refresh (the worker is not in this repo). `/api/v1/admin/drift-check` surfaces the gap. `api.dchub.cloud/.well-known/mcp.json` always reflects the fresh canonical source if you need a clean URL to hand a registry now.
