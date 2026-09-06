# DC Hub MCP — Registry Listing Copy (ready to paste)

Source of truth: `https://dchub.cloud/.well-known/mcp-server.json` · Endpoint: `https://dchub.cloud/mcp` (Streamable HTTP)
Live server **83 tools** · official registry listing `cloud.dchub/datacenter-power-grid-fiber` **v2.3.3** · CC-BY-4.0 data · free tier (no key) + `X-API-Key` for full data.

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

## ★ PER-REGISTRY ENDPOINT URLs — source attribution (2026-09-04)

`dchub-mcp-server` #331 shipped **arrival attribution by path**. Each registry has
its own live endpoint, identical to `/mcp` in every respect (same 83 tools, same
auth, same free tier) — the ONLY difference is that the server records which one
was called, so we can finally answer "did this listing ever send anyone".

| Registry | Endpoint to list | Switchable from this repo? |
|---|---|---|
| **Smithery** | `https://dchub.cloud/mcp/smithery` | ✅ CLI publish — see below |
| **Glama** | `https://dchub.cloud/mcp/glama` | ❌ dashboard only (cascade-fed) |
| **PulseMCP** | `https://dchub.cloud/mcp/pulsemcp` | ❌ web form / dashboard |
| **mcp.so** ⚠️ we are NOT listed — see note below | `https://dchub.cloud/mcp/mcpso` | ❌ paid submission ($39) + sign-in |
| **LobeHub** | `https://dchub.cloud/mcp/lobehub` | ❌ dashboard |
| **ToolPlex** ⚠️ destination UNLOCATED — see note below | `https://dchub.cloud/mcp/toolplex` | ⚠️ unverified |
| **MCPMarketHub** | `https://dchub.cloud/mcp/mcpmarket` | ❌ dashboard |
| **Docker MCP Catalog** — ships in Docker Desktop's MCP Toolkit (one-click install into Claude Desktop / Cursor / VS Code). ⚠️ we are NOT listed — measured 404 on `servers/dchub/server.yaml` | `https://dchub.cloud/mcp/docker` | ✅ PR to `docker/mcp-registry` (remote-server entry: server.yaml + tools.json + readme.md) |
| **Anthropic Connectors Directory** — in-app, submitted from claude.ai org settings. ⚠️ needs a **Team/Enterprise org** + Owner role; ends in 7 policy acknowledgments the owner must make. | `https://dchub.cloud/mcp/anthropic` | ⚠️ portal only — not submittable from this repo |
| **cursor.directory** (community; cursor.com has no public MCP directory) | `https://dchub.cloud/mcp/cursordirectory` | ❌ owner-typed listing |
| **Official MCP registry** — live listing `cloud.dchub/datacenter-power-grid-fiber` (cascade → PulseMCP + Glama (verified) — see REGISTRY-LISTINGS.md) | `https://dchub.cloud/mcp/officialregistry` | ✅ `server.json` — CURRENT |
| ~~Official MCP registry~~ — retired listing `cloud.dchub/mcp-server` | `https://dchub.cloud/mcp/registry` | ⏳ still served; awaiting `deprecated` |

> **Why the official registry has TWO rows.** The listing was renamed on
> 2026-09-04 (registry search matches the server NAME only — descriptions are
> not indexed, so `cloud.dchub/mcp-server` was findable by nothing except the
> literal string "dchub"). The registry REFUSES a remote URL already used by
> another server:
>
> ```
> 400 remote URL https://dchub.cloud/mcp/registry is already used by
>     server cloud.dchub/mcp-server
> ```
>
> So the new name cannot reuse `/mcp/registry` while the old entry holds it.
> `server.json` now points at `/mcp/officialregistry` and the new listing is
> the live one. `/mcp/registry` stays SERVED — existing installs from the old
> listing still arrive on it — until `cloud.dchub/mcp-server` is deprecated.
> Only then is that URL free, and only then does this table collapse to one row.

### ⚠️ `server.json` carries the SHARED cascade tag — never a per-registry one

The official registry is the cascade source for **PulseMCP / mcp.so / Glama /
ToolPlex** (see the `SERVER_VERSION` note in `server.mjs`). One URL feeds all
four, so pointing it at any *single* registry path would credit every mirrored
arrival to that one registry — worse than no attribution, because it would look
precise.

It therefore carries `/mcp/registry`, a shared tag meaning **"arrived from a
registry listing"** and nothing more. As of v2.12.5 this is already set.

★ Read it for what it is. `mcp-registry` CANNOT tell Glama from PulseMCP, and
that precision is not available at any effort — Glama exposes no maintainer
field for the endpoint (its `glama.json` schema's only property is
`maintainers`, and the listing carries no edit affordance). What it does buy is
the distinction that was actually blocking a decision: all four registries
report zero today, and nothing separated *zero* from *unmeasured*.

★ `_meta.canonicalRemote` stays `https://dchub.cloud/mcp`, and `/mcp` keeps
serving every existing install unchanged. Only the URL new listings hand out is
tagged. The README and install snippets stay on `/mcp` — a human copying from
GitHub is not a registry arrival.

### How to switch each one

- **Smithery** — republish against the source path:
  ```bash
  smithery mcp publish "https://dchub.cloud/mcp/smithery" -n azmartone67/dchub
  ```
- **Everything else** — edit the endpoint/URL field in that registry's own
  dashboard or resubmit its form with the URL from the table. `smithery.yaml` and
  `glama.json` do **not** declare an endpoint, so neither switch can be made by
  committing to this repo.

### Verifying a switch worked

The path is live the moment it is listed — no deploy needed. Confirm the endpoint
answers, then watch for the arrival:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://dchub.cloud/mcp/glama \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
# 200 = listed URL is serving
```

Arrivals log as `[source] registry=glama path=/mcp/glama tool=… sid=…`. Until
dchub-backend#3778 adds the `source` column, that log line is the only read —
`/api/v1/reach` will NOT show it.

★ `source` is caller-assertable, not proof: the path is public once listed, so
anyone who finds it can credit that registry with their traffic. Fine for a growth
read, not for a payout or a public claim.

---

## One-liner (≤ 100 chars)
The data-center, power & energy intelligence layer for AI agents — query AND cite, live.

## Short description (≤ 300 chars)
DC Hub is the live data-center, power & energy intelligence MCP: 20,700+ facilities, 300+ markets, 7 US ISOs + 43 utility BAs + 31 intl grid regions, live interconnection-queue depth, the tracked construction pipeline, the DCPI power index, renewables, fiber, hyperscaler deals & M&A. 83 tools an agent can query and cite (CC-BY-4.0). Free tier.

## Long description
DC Hub is the neutral, real-time data layer for data-center infrastructure — built so AI agents can both **query** it (MCP + REST) and **cite** it (every full-data response carries `Source: DC Hub, CC-BY-4.0`).

Coverage:
- **Facilities** — 20,700+ data centers worldwide: search, profiles, scoring, alternatives
- **Markets** — 300+ markets with the **DCPI** (Data Center Power Index): BUILD/CAUTION/AVOID
- **Gas** — per-state pipeline + operator presence with live Henry Hub via `get_gas_intelligence` (the DCGI composite was withdrawn 2026-08-08 and restored 2026-08-30 once all three defective terms were repaired — not comparable to pre-08-08 figures; the gas-fired $/MWh stays withdrawn)
- **Grid / ISO** — live fuel mix, carbon intensity, demand, prices & interconnection-queue depth across 7 US ISOs + 43 US utility BAs + 31 international grid regions; one-call all-ISO scoreboard
- **Capital** — 2,100+ tracked M&A deals + hyperscaler capex tracker + AI Compute Capacity Index
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
- `search_facilities` — search the 20,700+ facility universe
- `get_market_dcpi_rank` — a market's DCPI power score + BUILD/CAUTION/AVOID verdict
- `get_gas_intelligence` — per-state gas brief: pipeline + operator presence, live Henry Hub (the DCGI score was restored 2026-08-30 and is not comparable to pre-2026-08-08 figures)
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

### Config snippet — DEFAULT SHAPE, and the five clients that reject it
```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp"
    }
  }
}
```
Correct as-is for Cursor, Continue and most registry forms. Claude Desktop wants
`"transport": "http"` alongside `url`, and Claude Code is a CLI one-liner
(`claude mcp add dchub --transport http <url>`), not this shape at all.

★ It is NOT universal, and every exception fails SILENTLY — the block stays
valid JSON and simply registers nothing, so a directory that pastes this into
the wrong client shows DC Hub as installed and broken. Hand these clients their
own shape instead:

| Client | Field / root | The wrong one does |
|---|---|---|
| **Gemini CLI** | `httpUrl` | `url` is the SSE form — wrong transport, never connects |
| **Antigravity** | `serverUrl` | `url` and `httpUrl` both rejected |
| **Windsurf** | `serverUrl` | same as Antigravity |
| **VS Code** (Copilot agent) | root key `servers`, `"type": "http"` | `mcpServers` parses and registers nothing |
| **Cline** | `"type": "streamableHttp"` | without it, treated as stdio |

These are the same shapes the server hands agents in `persist_config.clients`
(see `_persistConfig` in server.mjs) — that is the canonical source, so copy
from it rather than from memory when a new client is added here.
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
As an `mcpServers` entry (Cursor / Cline / Windsurf / Claude Desktop / Gemini CLI):
> Only for clients or scanners that need a runnable process. **Gemini CLI and
> Antigravity both speak remote Streamable HTTP natively** — give them the
> `httpUrl` / `serverUrl` shapes above instead; the shim is a downgrade for them.
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
> Built for agents answering power, siting and capacity questions: pull live **interconnection-queue** depth, wait times and per-ISO BUILD/CAUTION/AVOID verdicts across 7 US ISOs + 43 US utility BAs + 31 international grid regions; track the **construction capacity pipeline** plus the AI Compute Capacity Index; rank 300+ markets by the DCPI power index; search 20,700+ data centers across 170+ countries; score any lat/lon for buildability; compare US + European + GB + Taiwan + Japan + Korea + Brazil grids live (fuel mix, renewables, carbon, demand); and reach hyperscaler $1B+ deals, 2,100+ tracked M&A, gas-vs-grid economics, fiber routes, water-stress & tax incentives.
>
> Free tier works with no key (10 calls/day). Add `X-API-Key` for full rows. Every full-data response carries `Source: DC Hub (CC-BY-4.0)` so your agent attributes cleanly. The MCP-native alternative to static PDF research — live JSON, no NDAs.
**Try it:** `get_interconnection_queue iso=PJM` · `get_power_pipeline` (construction pipeline) · `get_grid_scoreboard` · `get_market_dcpi_rank market=northern-virginia`

### Glama — audience: quality-graded directory (rich copy lifts the grade)
**Description:**
> DC Hub is the neutral, real-time data layer for data-center infrastructure, exposed as a Model Context Protocol server so any AI agent can both **query** it and **cite** it.
>
> **Coverage:** 20,700+ facilities (search, profile, score, alternatives); 300+ markets scored by the DCPI Data Center Power Index; per-state gas pipeline/operator presence with live Henry Hub (the DCGI composite, restored 2026-08-30, not comparable to pre-08-08 figures); live grid telemetry across 7 US ISOs (fuel mix, carbon intensity, demand, prices) plus a one-call all-ISO scoreboard; interconnection-queue depth; 2,100+ tracked M&A deals and a hyperscaler-capex tracker; and site factors — fiber routes, water-stress, tax incentives, nearby substations & transmission.
>
> **Why agents choose it:** it's the only data-center-intelligence source an LLM can query live *and* cite — every full-data response includes a `Source: DC Hub, CC-BY-4.0` attribution line. It's the MCP-native alternative to quarterly PDF research: live JSON, no contracts, no NDAs.
>
> **Access:** Streamable HTTP at `https://dchub.cloud/mcp`. Free tier with no signup; free email-verified dev key for higher limits; paid tiers for full data volume.
**Categories:** data-center, energy, natural-gas, electricity-grid, infrastructure, sustainability, market-intelligence, real-estate, M&A

### PulseMCP — audience: broad MCP discovery directory
**Name:** DC Hub — Data Center Intelligence
**Description:**
> Real-time data-center, power & gas intelligence for AI agents. 83 MCP tools over Streamable HTTP: search 20,700+ facilities, score sites, rank 300+ markets (DCPI power index), pull the per-state gas brief (pipelines, operators, live Henry Hub), compare US ISO grids live, and pull interconnection queues, M&A, fiber, water & tax data. Free tier, no signup. Responses are citation-ready (CC-BY-4.0). The live alternative to static data-center research reports.
**Use cases:** "Where should I build a data center?" · "Which US grid is greenest right now?" · "Which states are gas-advantaged for DC power?" · "What's Northern Virginia's DCPI verdict?"

### Cursor Directory — audience: IDE developers
**Description:**
> Give your agent live data-center, grid & gas intelligence. 83 MCP tools: facility search (20,700+), site scoring, DCPI market ranks, the per-state gas brief (the DCGI score, restored 2026-08-30, is not comparable to pre-08-08 figures), a live all-ISO grid scoreboard, interconnection queues, M&A, fiber, water & tax. Free tier needs no key; add `X-API-Key` for full data. Citation-ready (CC-BY-4.0).
**Config:**
> ```json
> { "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp" } } }
> ```

---

## (a) Manifest status — FIXED in-repo (2026-05-31)

Investigated + corrected. The canonical Flask manifest `_canonical_mcp_manifest()` (main.py, served at `/.well-known/mcp.json` + `/mcp/manifest` + `/api/v1/mcp/manifest`) listed 29 tools but was MISSING `get_gas_index` + `get_grid_scoreboard`. Added both + bumped version 2.1.13 → 2.1.20 (commit 4e49e651, additive 3-line change). After the backend redeploys, the canonical manifest lists these incl. the gas index + grid scoreboard. (Headline "38 tools" = live `/mcp` tools/list; the canonical manifest's hand-curated list differs slightly in membership — use 38 for listings.) <!-- canon:frozen: historical investigation log, not a claim about the current surface -->

Remaining caveat (out-of-repo, your call): the public **`dchub.cloud/.well-known/mcp.json` edge** is served/cached by the `dchubapiproxy` Cloudflare worker and showed an OLDER copy (v2.1.11) than even Railway-direct. After the backend deploy, if the edge still lags, it needs a CF cache purge or worker refresh (the worker is not in this repo). `/api/v1/admin/drift-check` surfaces the gap. `api.dchub.cloud/.well-known/mcp.json` always reflects the fresh canonical source if you need a clean URL to hand a registry now.


### ⚠️ The four-way cascade claim is 2 of 4 — measured 2026-09-05

This file and several code comments asserted that the official registry
"cascades to PulseMCP / mcp.so / Glama / ToolPlex". Checked each in a REAL
BROWSER, because all of them answer automated UAs with 403/429 — curl proves
nothing about any of them, in either direction:

| | result | evidence |
|---|---|---|
| **PulseMCP** | ✅ listed | classification "Official", #11,607 of ~21,970 (#8,547 this week), 624 est. visitors (24 this week) |
| **Glama** | ✅ listed | already covered by `scripts/registry_monitor.py` |
| **mcp.so** | ❌ **ABSENT** | control-verified: `data center` (55KB) and `datacenter` (75KB) return results that do NOT include us; `dchub` / `dc hub` → "No servers match" |
| **ToolPlex** | ⚠️ **destination unlocated** | `toolplex.ai` is a forecasting/inventory SaaS; `/mcp` `/servers` `/directory` `/registry` `/tools` all 404. This repo named ToolPlex 11× but the ONLY url it ever recorded is our own `/mcp/toolplex` — it never said where ToolPlex is |

★ Both source paths are KEPT. They cost nothing, they already serve
(`POST /mcp/mcpso` and `/mcp/pulsemcp` both return 200), and a tag that exists
before a listing does is exactly what makes the listing attributable from its
first day. What is removed is the CLAIM that all four mirror us.

★ TIMING CAVEAT. The official listing was renamed and the old entry deprecated
on 2026-09-04. Anything that genuinely does cascade may re-sync over the
following days, so re-measure mcp.so before concluding the cascade never
reached it.

★ To submit to mcp.so: it is a PAID listing — $39 one-time, behind a sign-in,
and the only automated control is "Pay and submit automatically". Submit the
TAGGED url `https://dchub.cloud/mcp/mcpso`, never the bare `/mcp`, or the
listing's arrivals are unattributable for its whole life. PulseMCP currently
has submissions AND listing changes PAUSED, so its bare url cannot be corrected
right now.
