# LobeHub MCP Discovery submission

**Target:** https://lobehub.com/discover/mcp

**Type:** GitHub-PR submission. LobeHub's MCP catalog is open-source — submissions
go to `lobehub/lobe-chat-plugins` (or the dedicated MCP repo). Format is a JSON
manifest entry the maintainer adds via PR.

| Field | Value |
|-------|-------|
| Identifier | dchub |
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

**Short description (≤300 chars):**
> Live data-center & energy intelligence MCP: 21k+ facilities, 232 markets, 10
> ISO grids, the DCPI power index, the DCGI gas index, interconnection queues,
> M&A, fiber, water & tax. 38 tools an agent can query and cite (CC-BY-4.0).
> Free tier, no signup.

**Manifest entry (JSON, paste-ready for the LobeHub PR):**
```json
{
  "identifier": "dchub",
  "name": "DC Hub — Data Center & Energy Intelligence",
  "description": "Live data-center & energy intelligence MCP: 21k+ facilities, 232 markets, 10 ISO grids, DCPI power index, DCGI gas index, interconnection queues, M&A, fiber, water & tax. 38 tools, query and cite (CC-BY-4.0). Free tier, no signup.",
  "homepage": "https://dchub.cloud",
  "repository": "https://github.com/azmartone67/dchub-mcp-server",
  "type": "streamable-http",
  "url": "https://dchub.cloud/mcp",
  "tags": ["data-center", "energy", "natural-gas", "electricity-grid", "infrastructure", "market-intelligence"],
  "categories": ["data-analytics", "infrastructure"],
  "license": "CC-BY-4.0",
  "author": "azmartone67",
  "tools": 38
}
```

**Config snippet (for LobeHub users to install in LobeChat):**
```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp"
    }
  }
}
```

## Maintainer checklist
- [ ] Open https://github.com/lobehub/lobe-chat-plugins (or the MCP-specific
      sibling repo) and check the contribution guide for the current submission
      path.
- [ ] Fork → add the JSON entry above to the manifest → open a PR titled
      "feat: add DC Hub MCP server (data-center & energy intelligence)".
- [ ] If the LobeHub catalog has a web-form alternative at
      https://lobehub.com/discover/mcp, use that instead — same field values.
- [ ] After listing, confirm tool count shows **38** and the endpoint is correct.
