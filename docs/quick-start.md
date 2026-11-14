# Quick start by client

Endpoint for every client below: `https://dchub.cloud/mcp` (Streamable HTTP). `DCHUB_API_KEY` is optional; previews work with no key.

Start with `execute_plan`: one question about grid power, electricity prices or interconnection queues returns one dated, cited answer.

| Client | One line |
|---|---|
| Claude Code | `claude mcp add dchub --transport http https://dchub.cloud/mcp` |
| Codex CLI | `codex mcp add dchub --url https://dchub.cloud/mcp` |
| GitHub Copilot CLI | `copilot mcp add --transport http dchub https://dchub.cloud/mcp` |
| Gemini CLI | `gemini mcp add -s user --transport http dchub https://dchub.cloud/mcp` |
| opencode | `opencode mcp add dchub --url https://dchub.cloud/mcp` |
| VS Code | `.vscode/mcp.json` (below) |
| Cursor | [Add DC Hub to Cursor](https://cursor.com/install-mcp?name=dchub&config=eyJ1cmwiOiAiaHR0cHM6Ly9kY2h1Yi5jbG91ZC9tY3AifQ%3D%3D) |
| Windsurf / Devin Desktop | `mcp_config.json` (below) |

Each client has its own config key for a remote URL. A wrong key still parses as JSON, but the client ignores it and never connects, so use the exact shape for your client:

VS Code, `.vscode/mcp.json`:

```json
{
  "servers": {
    "dchub": { "type": "http", "url": "https://dchub.cloud/mcp" }
  }
}
```

Windsurf / Devin Desktop, `mcp_config.json`:

```json
{
  "mcpServers": {
    "dchub": { "serverUrl": "https://dchub.cloud/mcp" }
  }
}
```

GitHub Copilot CLI, `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "dchub": { "type": "http", "url": "https://dchub.cloud/mcp", "tools": ["*"] }
  }
}
```

Codex CLI, `~/.codex/config.toml`:

```toml
[mcp_servers.dchub]
url = "https://dchub.cloud/mcp"
```

Gemini CLI uses `httpUrl`, not `url`. Antigravity uses `serverUrl`. See [Install in the README](../README.md#install).

## A first question to try

```text
How soon can a 100 MW data center get grid power in ERCOT, and what are electricity prices there?
```

## Loading many MCP servers at once

The full catalog is large: its `tools/list` is over 200 KB. A host that loads several servers can use the 10-tool core profile at `https://dchub.cloud/mcp/core` instead. It is an alternate, not the default. See [core-profile.md](core-profile.md).
