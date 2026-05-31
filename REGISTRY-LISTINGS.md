# DC Hub MCP — Registry Listing Copy (ready to paste)

Source of truth: `https://dchub.cloud/.well-known/mcp.json` · Endpoint: `https://dchub.cloud/mcp` (Streamable HTTP)
Live server **v2.1.19 · 30 tools** (verified via tools/list 2026-05-31) · CC-BY-4.0 data · free tier (no key) + `X-API-Key` for full data.

> ⚠️ KNOWN ISSUE (fix before/with submitting): the public manifest `/.well-known/mcp.json` is STALE — it reports v2.1.11 / 29 tools and is missing `get_gas_index` + `get_grid_scoreboard`. It's served out-of-repo by the `dchubapiproxy` Cloudflare worker (not this repo's `mcp-server.json`, which is also stale at v2.1.13/28). Registries scrape this manifest, so refresh the worker's manifest to v2.1.19/30 tools first, or some registries will show outdated info. Submitting still works (the live `/mcp` tools/list is correct), but the listing card may lag until the manifest is refreshed.

---

## One-liner (≤ 100 chars)
The data-center, energy & gas intelligence layer for AI agents — query AND cite, live.

## Short description (≤ 300 chars)
DC Hub is the live data-center & energy intelligence MCP: 21k+ facilities, 232 markets, 10 ISO grids, the DCPI power index, the DCGI gas index, interconnection queues, M&A, fiber, water & tax. 30 tools an agent can query and cite (CC-BY-4.0). Free tier, no signup.

## Long description
DC Hub is the neutral, real-time data layer for data-center infrastructure — built so AI agents can both **query** it (MCP + REST) and **cite** it (every full-data response carries `Source: DC Hub, CC-BY-4.0`).

Coverage:
- **Facilities** — 21,000+ data centers worldwide: search, profiles, scoring, alternatives
- **Markets** — 232 markets with the **DCPI** (Data Center Power Index): BUILD/CAUTION/AVOID
- **Gas** — the **DCGI** (Data Center Gas Index): per-state natural-gas suitability for siting
- **Grid / ISO** — live fuel mix, carbon intensity, demand, prices & interconnection-queue depth across 10 North-American grid operators; one-call all-ISO scoreboard
- **Capital** — $324B+ M&A history + hyperscaler capex tracker + AI Compute Capacity Index
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
- `search_facilities` — search the 21k+ facility universe
- `get_market_dcpi_rank` — a market's DCPI power score + BUILD/CAUTION/AVOID verdict
- `get_gas_index` — DCGI per-state natural-gas suitability (gas analog to DCPI)
- `get_grid_scoreboard` — all 10 ISOs ranked live by carbon / renewables / fuel mix
- `get_interconnection_queue` — interconnection-queue depth + wait by ISO
- `score_facility` / `analyze_site` — score a lat/lon for data-center suitability
- `hyperscaler_deals` — AI/hyperscaler capex + M&A tracker

---

## Per-registry submission notes

### Smithery (smithery.ai/servers/azmartone67/dchub)
- Type: Remote (Streamable HTTP). Base URL `https://dchub.cloud/mcp`. No auth required to list/try (free tier).
- Use the short description + categories above. Confirm the tool list auto-populates from the manifest (30 tools).

### Glama (glama.ai/mcp/connectors/cloud.dchub/...)
- Already indexed as a connector. Refresh so it picks up v2.1.16 / 30 tools (now incl. `get_gas_index`, `get_grid_scoreboard`).
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

> Submissions are yours to send (they require your registry accounts). This file is the copy to paste.
