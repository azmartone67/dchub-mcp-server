# dxt.so submission

**Target:** https://dxt.so (Desktop Extensions / DXT — Anthropic's distribution
format for MCP servers).

**Type:** dxt.so primarily distributes **local** desktop extensions packaged as
`.dxt` bundles, but it also lists **remote** MCP servers. Submission is a web
form on dxt.so (or a PR to the upstream dxt repo if listed there).

**Note:** DC Hub is a remote/hosted Streamable HTTP server (not a local
process), so it lists under the "Remote Servers" or "Hosted" section.

| Field | Value |
|-------|-------|
| Name | DC Hub — Data Center & Energy Intelligence |
| Repo URL | https://github.com/azmartone67/dchub-mcp-server |
| Server type | Remote (Streamable HTTP) |
| Endpoint URL | https://dchub.cloud/mcp |
| Homepage | https://dchub.cloud |
| Auth | None for free tier; `X-API-Key` header for full data |
| Tool count | 38 |
| Tags | data-center, energy, natural-gas, electricity-grid, infrastructure, market-intelligence |
| License | CC-BY-4.0 (data); MIT (code) |

**Short description (≤300 chars):**
> DC Hub is the live data-center & energy intelligence MCP: 21k+ facilities,
> 232 markets, 10 ISO grids, the DCPI power index, the DCGI gas index,
> interconnection queues, M&A, fiber, water & tax. 38 tools an agent can query
> and cite (CC-BY-4.0). Free tier, no signup.

**Manifest URL (if asked):** `https://dchub.cloud/.well-known/mcp-server.json`

**Config snippet (for Claude Desktop / dxt-installed clients):**
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
- [ ] Visit https://dxt.so and find the submission form (likely "Submit" in
      the nav or a "Remote Servers" listing form).
- [ ] If dxt.so is purely local-`.dxt`-only and rejects remote servers, this
      branch can be closed with "registry scope mismatch — DC Hub is
      remote-only, dxt.so is local-extension-only."
- [ ] Otherwise paste the values above; provide the manifest URL.
- [ ] After listing, confirm tool count shows **38**.

> If dxt.so requires a local `.dxt` bundle, the maintainer can optionally
> create a thin local proxy `.dxt` that just calls the remote endpoint — but
> this is **not required** for the listing per current dxt.so behavior (remote
> MCP servers are accepted).
