# mcp.so submission

**Type:** web form (no repo file). Go to https://mcp.so → "Submit".
mcp.so indexes from the GitHub repo + the official registry, so most fields
auto-populate; paste the values below where prompted.

| Field | Value |
|-------|-------|
| Name | DC Hub — Data Center & Energy Intelligence |
| Repo URL | https://github.com/azmartone67/dchub-mcp-server |
| Server type | Remote (Streamable HTTP) |
| Endpoint URL | https://dchub.cloud/mcp |
| Homepage | https://dchub.cloud |
| Auth | None for free tier; `X-API-Key` header for full data |
| Tool count | 38 |
| Tags | data-center, energy, natural-gas, electricity-grid, infrastructure, market-intelligence, M&A |

**Short description (≤300 chars):**
> DC Hub is the live data-center & energy intelligence MCP: 21k+ facilities, 300+ markets, 10 ISO grids, the DCPI power index, the DCGI gas index, interconnection queues, M&A, fiber, water & tax. 38 tools an agent can query and cite (CC-BY-4.0). Free tier, no signup.

**Config snippet (for the "usage" field):**
```json
{ "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp" } } }
```

## Maintainer checklist
- [ ] Submit the form at https://mcp.so with the values above.
- [ ] If asked for a manifest URL: `https://dchub.cloud/.well-known/mcp-server.json`.
- [ ] After listing, confirm the tool count shows **38** (not a stale number).
