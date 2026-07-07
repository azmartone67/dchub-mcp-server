# DC Hub MCP Server — Install Guide (for AI agents)

This file tells an AI assistant (Cline, Claude, Cursor, Continue, etc.) exactly how to
connect to the **DC Hub MCP server**. DC Hub is a **remote, hosted HTTP MCP server** —
there is **nothing to clone, build, or npm-install**. You connect to a URL.

- **Server URL:** `https://dchub.cloud/mcp`
- **Transport:** Streamable HTTP (MCP `2025-06-18`)
- **Auth:** none required for the free anonymous tier (10 calls/day). For higher limits,
  pass an API key via the `X-API-Key` header (see "Optional: API key" below).
- **Tools exposed:** 33 (facility search, market intelligence, grid + interconnection,
  site analysis, M&A deals, infrastructure).

## What it does

DC Hub gives an agent real-time, structured answers about data-center and power-market
infrastructure: 21,000+ data-center facilities across 170+ countries, 300+ markets
scored by the DC Hub Power Index (DCPI), 3,000+ tracked M&A deals, live ISO grid telemetry
(PJM, ERCOT, CAISO, MISO, SPP, NYISO + more), interconnection-queue snapshots, fiber routes,
gas pipelines, NEPA filings, and energy pricing.

## Install steps

### Cline / Roo (VS Code)

Open the MCP settings file (`cline_mcp_settings.json`) and add this entry under
`mcpServers`. No command, no args — it is a remote URL server:

```json
{
  "mcpServers": {
    "dchub": {
      "type": "streamableHttp",
      "url": "https://dchub.cloud/mcp"
    }
  }
}
```

Then reload the MCP servers. Verify by asking: **"List the dchub tools"** — you should see
61 tools including `search_facilities`, `rank_markets`, `get_grid_scoreboard`, and
`get_interconnection_queue`.

### Claude Desktop / Claude Code

Add to `claude_desktop_config.json` (Claude Desktop) — on macOS at
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp",
      "transport": "http"
    }
  }
}
```

Or, from the Claude Code CLI (one command):

```bash
claude mcp add dchub --transport http https://dchub.cloud/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp"
    }
  }
}
```

### Continue.dev

In `config.json` under `experimental.modelContextProtocolServers`:

```json
{
  "transport": {
    "type": "streamable-http",
    "url": "https://dchub.cloud/mcp"
  }
}
```

## Optional: API key (higher limits)

The anonymous tier allows **10 calls/day**. To raise limits, get a free key
(email signup, ~60 seconds) at https://dchub.cloud/signup, then add an
`X-API-Key` header. Example for Cline:

```json
{
  "mcpServers": {
    "dchub": {
      "type": "streamableHttp",
      "url": "https://dchub.cloud/mcp",
      "headers": { "X-API-Key": "YOUR_KEY_HERE" }
    }
  }
}
```

Claude Code CLI with a key:

```bash
claude mcp add dchub --transport http --header "X-API-Key: YOUR_KEY_HERE" https://dchub.cloud/mcp
```

### Limits by tier

| Tier | Price | Calls/day |
|------|-------|-----------|
| Anonymous | free | 10 |
| Free key (email) | free | 50 |
| Starter | $9/mo | 200 |
| Developer | $49/mo | 500 |
| Pro | $199/mo | 2,000 |
| Enterprise | custom | 100,000 |

A $10 one-time credit pack (1,000 API calls, no subscription) is available at https://buy.stripe.com/9B69AU08y2FfbSR55UaZi0i.

## Verify the connection

After adding the config, confirm the server is reachable and reports its tools:

```bash
# 1) initialize → returns an Mcp-Session-Id response header
curl -s -D - -X POST https://dchub.cloud/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}'

# 2) using the Mcp-Session-Id from step 1, list tools (expect 33)
curl -s -X POST https://dchub.cloud/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Mcp-Session-Id: <SESSION_ID_FROM_STEP_1>' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
```

A healthy server card is also published at
`https://dchub.cloud/.well-known/mcp/server-card.json`.

## Troubleshooting

- **No tools appear:** make sure the entry uses a `url` (remote), not a `command`. DC Hub
  is not an npm/stdio server — there is no local process to spawn.
- **429 / rate-limited:** you have hit the anonymous 10/day cap. Add an `X-API-Key` header
  (free at https://dchub.cloud/signup) for 50/day, or a paid tier for more.
- **Transport type:** if your client supports it, prefer `streamableHttp` /
  `streamable-http`. Older clients can use plain `http`.

## Support

Issues: https://github.com/azmartone67/dchub-mcp-server/issues ·
Contact: azmartone@gmail.com (Jonathan Martone, Martone Advisors LLC)
