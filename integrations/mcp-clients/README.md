# DC Hub for MCP clients (Claude Desktop, Cursor, Cline, Continue, Windsurf, Zed)

DC Hub is a remote **Streamable-HTTP MCP server** at `https://dchub.cloud/mcp` — **38 tools, free tier.** Add it to any MCP client and the tools appear automatically.

## The config (works in most modern clients)
```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp"
    }
  }
}
```

## If your client only speaks stdio (older Claude Desktop, some setups)
Bridge the remote server with `mcp-remote`:
```json
{
  "mcpServers": {
    "dchub": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://dchub.cloud/mcp"]
    }
  }
}
```

## Paid tier (unlocks analyze_site, grid intelligence, interconnection queue, fiber, …)
Add your key as a header (claim one: `curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"my-client"}'`):
```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp",
      "headers": { "X-API-Key": "dch_live_YOURKEY" }
    }
  }
}
```

## Where the config file lives
| Client | File |
|---|---|
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) · `%APPDATA%\Claude\claude_desktop_config.json` (Win) |
| **Cursor** | Settings → MCP → Add, or `~/.cursor/mcp.json` |
| **Cline / Roo** | the extension's MCP settings (`cline_mcp_settings.json`) |
| **Continue** | `~/.continue/config.json` → `mcpServers` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **Zed** | `settings.json` → `context_servers` |

After saving, restart the client. You'll see `search_facilities`, `get_market_intel`, `get_grid_data`, `analyze_site`, and 34 more. Try: *"Use DC Hub to find data-center capacity in Northern Virginia."*
