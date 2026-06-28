# Cline Marketplace submission

**Target:** https://github.com/cline/mcp-marketplace

**Type:** Open-source GitHub repo — submission is a PR adding a JSON entry to
their marketplace manifest. Cline (the VS Code MCP agent) reads this for the
in-IDE marketplace.

| Field | Value |
|-------|-------|
| ID | dchub |
| Name | DC Hub — Data Center & Energy Intelligence |
| Repo URL | https://github.com/azmartone67/dchub-mcp-server |
| Server type | Remote (Streamable HTTP) |
| Endpoint URL | https://dchub.cloud/mcp |
| Homepage | https://dchub.cloud |
| Auth | None for free tier; `X-API-Key` header for full data |
| Tool count | 38 |
| Tags | data-center, energy, natural-gas, electricity-grid, infrastructure, market-intelligence |
| License | CC-BY-4.0 (data); MIT (code) |
| Author | azmartone67 |

**Manifest entry (JSON, paste-ready for the Cline marketplace PR):**
```json
{
  "id": "dchub",
  "name": "DC Hub — Data Center & Energy Intelligence",
  "description": "Live data-center & energy intelligence MCP: 21k+ facilities, 300+ markets, 10 ISO grids, DCPI power index, DCGI gas index, interconnection queues, M&A, fiber, water & tax. 38 tools, query and cite (CC-BY-4.0). Free tier, no signup.",
  "homepage": "https://dchub.cloud",
  "repository": "https://github.com/azmartone67/dchub-mcp-server",
  "type": "streamable-http",
  "url": "https://dchub.cloud/mcp",
  "tags": ["data-center", "energy", "natural-gas", "electricity-grid", "infrastructure", "market-intelligence"],
  "categories": ["data-analytics", "infrastructure"],
  "license": "CC-BY-4.0",
  "author": "azmartone67",
  "tools": 38,
  "icon": "https://dchub.cloud/logo-400.png"
}
```

**Cline `cline_mcp_settings.json` config (for end-user docs):**
```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp",
      "transportType": "streamableHttp"
    }
  }
}
```

## Maintainer checklist
- [ ] Fork https://github.com/cline/mcp-marketplace.
- [ ] Locate the marketplace manifest (likely `README.md` or
      `marketplace.json` — check the contribution guide).
- [ ] Add the JSON entry above to the manifest.
- [ ] Open a PR titled "feat: add DC Hub MCP server (data-center & energy intelligence, 38 tools)".
- [ ] After merge, confirm the listing appears in the Cline VS Code extension's
      MCP marketplace and tool count shows **38**.
- [ ] Bonus: open a follow-up cosmetic PR to add the dchub badge to the README
      grid (if their marketplace uses one).
