# Cursor.directory submission (re-submit for the 38-tool update)

**Target:** https://cursor.directory/mcp

**Status:** Already listed at `cursor.directory/plugins/mcp-dchub` (per task #59
re-submit). This artifact is the **38-tool update re-submission** — bumps the
tool count and adds the new tools (`get_gas_index`, `get_grid_scoreboard`,
plus the rest of the recent additions to reach 38).

**Type:** Open-source repo (`pontusab/cursor.directory`) — submission is a PR
adding/updating a JSON entry in their MCP plugins directory.

| Field | Value |
|-------|-------|
| Slug | mcp-dchub |
| Name | DC Hub — Data Center & Energy Intelligence |
| Repo URL | https://github.com/azmartone67/dchub-mcp-server |
| Server type | Remote (Streamable HTTP) |
| Endpoint URL | https://dchub.cloud/mcp |
| Homepage | https://dchub.cloud |
| Auth | None for free tier; `X-API-Key` header for full data |
| Tool count | 38 (was 33) |
| Tags | data-center, energy, natural-gas, electricity-grid, infrastructure, market-intelligence |

**Description (paste-ready):**
> Give your agent live data-center, grid & gas intelligence. 38 MCP tools:
> facility search (21k+), site scoring, DCPI market ranks, the DCGI gas index,
> a live all-ISO grid scoreboard, interconnection queues, M&A, fiber, water &
> tax. Free tier needs no key; add `X-API-Key` for full data. Citation-ready
> (CC-BY-4.0).

**New tools to highlight in the update PR:**
- `get_gas_index` — DCGI per-state natural-gas suitability index
- `get_grid_scoreboard` — all 10 ISOs ranked live by carbon / renewables /
  fuel mix
- Plus 3 more recent additions (see `../mcp-server.json` for the full 38).

**Config snippet (the Cursor MCP config for users):**
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

## Maintainer checklist
- [ ] Open https://github.com/pontusab/cursor.directory and find the existing
      `mcp-dchub` JSON entry (likely under `apps/web/src/data/mcp/` or
      similar).
- [ ] Update the tool count (33 → 38) + description + the new-tool highlights.
- [ ] Open a PR titled "feat: update dchub MCP entry (38 tools + DCGI + grid scoreboard)".
- [ ] After merge, confirm the listing at https://cursor.directory/mcp/dchub
      shows **38 tools** and the new description.
