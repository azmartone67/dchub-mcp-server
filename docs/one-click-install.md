# One-click install — DC Hub MCP

DC Hub is a **remote, hosted HTTP MCP server** — nothing to clone, build, or
npm-install. Connect with the URL `https://dchub.cloud/mcp` (85 tools, free
anonymous tier, no signup). Below are one-click deep links + copy-paste configs
for the major agent clients.

> Acceptance test for any client: after connecting, ask **"list the dchub tools"** —
> you should see **85 tools** including `get_composite_site_score`,
> `get_disaster_risk`, `get_climate_intel`, `rank_markets`, `get_grid_scoreboard`.

## Deep links (one click)

**Cursor** — add DC Hub in one click:
```
cursor://anysphere.cursor-deeplink/mcp/install?name=dchub&config=eyJ1cmwiOiJodHRwczovL2RjaHViLmNsb3VkL21jcCJ9
```
Embeddable button (for docs/site):
```html
<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=dchub&config=eyJ1cmwiOiJodHRwczovL2RjaHViLmNsb3VkL21jcCJ9">Add DC Hub to Cursor</a>
```

**VS Code** (MCP):
```
vscode:mcp/install?%7B%22name%22%3A%20%22dchub%22%2C%20%22url%22%3A%20%22https%3A//dchub.cloud/mcp%22%7D
```

**Claude Code (CLI)** — one command:
```bash
claude mcp add dchub --transport http https://dchub.cloud/mcp
```

## Copy-paste configs

**Claude Desktop** — `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):
```json
{ "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp", "transport": "http" } } }
```

**Cline / Roo** — `cline_mcp_settings.json` → `mcpServers`:
```json
{ "mcpServers": { "dchub": { "type": "streamableHttp", "url": "https://dchub.cloud/mcp" } } }
```

**Cursor** (manual) — `~/.cursor/mcp.json`:
```json
{ "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp" } } }
```

**Continue.dev** — `config.json` → `experimental.modelContextProtocolServers`:
```json
{ "transport": { "type": "streamable-http", "url": "https://dchub.cloud/mcp" } }
```

## Paid tiers — connect at your full plan
A bare `/mcp` URL connects at the free tier. To use a plan you paid for:
- **Claude.ai web** (no header field): put the key in the URL —
  `https://dchub.cloud/mcp?api_key=YOUR_KEY`
- **Claude Desktop / Cursor / Cline**: send a header — `X-API-Key: YOUR_KEY`

Your key is the `dch_live_…` from your welcome email or dashboard.

## Machine-readable discovery (for platforms & registries)
- MCP manifest: `https://dchub.cloud/.well-known/mcp.json` (85 tools)
- Server card: `https://dchub.cloud/.well-known/mcp/server-card.json`
- Alt manifest: `https://dchub.cloud/mcp/manifest`
- OpenAPI (REST mirror): `https://dchub.cloud/openapi.json`
- Full tool schemas: `POST https://dchub.cloud/mcp {"jsonrpc":"2.0","id":1,"method":"tools/list"}`

Every response carries provenance (`source`, `retrieved_at`) and returns
`unavailable` — never a fabricated number — when a factor's data isn't sourced.
