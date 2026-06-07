# Continue.dev Hub submission

**Target:** https://hub.continue.dev

**Type:** Continue's Hub (the public marketplace for Continue agent blocks)
accepts MCP server submissions either via the hub.continue.dev web form or as
a PR to the `continuedev/continue` repo (depending on current submission
flow). Continue is an open-source AI code-assistant for IDEs (VS Code, JetBrains).

| Field | Value |
|-------|-------|
| Slug | dchub |
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

**Continue config (`config.yaml`) — paste-ready snippet for end-user docs:**
```yaml
mcpServers:
  - name: dchub
    url: https://dchub.cloud/mcp
    type: streamable-http
```

With a key:
```yaml
mcpServers:
  - name: dchub
    url: https://dchub.cloud/mcp
    type: streamable-http
    headers:
      X-API-Key: dch_live_...
```

**Continue Hub block JSON entry (paste-ready):**
```json
{
  "slug": "dchub",
  "name": "DC Hub — Data Center & Energy Intelligence",
  "description": "Live data-center & energy intelligence MCP: 21k+ facilities, 232 markets, 10 ISO grids, DCPI power index, DCGI gas index, interconnection queues, M&A, fiber, water & tax. 38 tools, query and cite (CC-BY-4.0). Free tier, no signup.",
  "homepage": "https://dchub.cloud",
  "repository": "https://github.com/azmartone67/dchub-mcp-server",
  "type": "streamable-http",
  "url": "https://dchub.cloud/mcp",
  "tags": ["data-center", "energy", "natural-gas", "infrastructure", "market-intelligence"],
  "categories": ["data-analytics", "infrastructure"],
  "license": "CC-BY-4.0",
  "author": "azmartone67",
  "tools": 38
}
```

## Maintainer checklist
- [ ] Visit https://hub.continue.dev and look for the "Submit" or "Create Block"
      flow for MCP servers.
- [ ] If the form is available, paste the values above.
- [ ] If submission is via GitHub PR, fork
      https://github.com/continuedev/continue and add the JSON entry to their
      MCP marketplace manifest (path varies — check contribution guide).
- [ ] After listing, confirm the listing appears at
      `https://hub.continue.dev/explore` with **38 tools** and the endpoint is
      correct.

> Continue's tool surface area is a strong fit for DC Hub (developers asking
> infra/energy questions during code review on real estate, power, or grid
> systems). The Continue Hub also funnels into JetBrains + VS Code MCP-enabled
> users.
