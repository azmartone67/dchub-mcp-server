# Quick start by client

Endpoint for every client below: `https://dchub.cloud/mcp` (Streamable HTTP). The `?via=<client>` tag on the URLs below only records which install path was used; the server behaves the same without it. `DCHUB_API_KEY` is optional; previews work with no key.

Start with `execute_plan`: one question about grid power, electricity prices or interconnection queues returns one dated, cited answer.

| Client | One line |
|---|---|
| Claude Code | `claude mcp add dchub --transport http https://dchub.cloud/mcp` |
| Codex CLI | `codex mcp add dchub --url "https://dchub.cloud/mcp?via=codex"` |
| GitHub Copilot CLI | `copilot plugin marketplace add azmartone67/dchub-mcp-server && copilot plugin install dchub@dchub` (server + skills), or `copilot mcp add --transport http dchub "https://dchub.cloud/mcp?via=copilot-cli"` |
| Gemini CLI | `gemini extensions install https://github.com/azmartone67/dchub-mcp-server`, or `gemini mcp add -s user --transport http dchub "https://dchub.cloud/mcp?via=gemini-cli"` |
| opencode | `opencode mcp add dchub --url "https://dchub.cloud/mcp?via=opencode"` |
| VS Code | `code --add-mcp '{"name":"dchub","type":"http","url":"https://dchub.cloud/mcp?via=vscode"}'`, or `.vscode/mcp.json` (below) |
| Cursor | [Add DC Hub to Cursor](https://cursor.com/install-mcp?name=dchub&config=eyJ1cmwiOiJodHRwczovL2RjaHViLmNsb3VkL21jcD92aWE9Y3Vyc29yIn0%3D) |
| Windsurf / Devin Desktop | `mcp_config.json` (below) |
| Goose | `goose session --with-streamable-http-extension "https://dchub.cloud/mcp?via=goose"` |
| Kiro | [Add to Kiro](https://kiro.dev/launch/mcp/add?name=dchub&config=%7B%22url%22%3A%22https%3A%2F%2Fdchub.cloud%2Fmcp%3Fvia%3Dkiro%22%2C%22disabled%22%3Afalse%2C%22autoApprove%22%3A%5B%5D%7D) |
| LM Studio | [Add to LM Studio](https://lmstudio.ai/install-mcp?name=dchub&config=eyJ1cmwiOiJodHRwczovL2RjaHViLmNsb3VkL21jcD92aWE9bG1zdHVkaW8ifQ%3D%3D) |

Each client has its own config key for a remote URL. A wrong key still parses as JSON, but the client ignores it and never connects, so use the exact shape for your client:

VS Code, `.vscode/mcp.json`:

```json
{
  "servers": {
    "dchub": { "type": "http", "url": "https://dchub.cloud/mcp?via=vscode" }
  }
}
```

Windsurf / Devin Desktop, `mcp_config.json`:

```json
{
  "mcpServers": {
    "dchub": { "serverUrl": "https://dchub.cloud/mcp?via=windsurf" }
  }
}
```

GitHub Copilot CLI, `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "dchub": { "type": "http", "url": "https://dchub.cloud/mcp?via=copilot-cli", "tools": ["*"] }
  }
}
```

Codex CLI, `~/.codex/config.toml`:

```toml
[mcp_servers.dchub]
url = "https://dchub.cloud/mcp?via=codex"
```

Gemini CLI uses `httpUrl`, not `url`. Antigravity uses `serverUrl`. See [Install in the README](../README.md#install).

## A first question to try

```text
How soon can a 100 MW data center get grid power in ERCOT, and what are electricity prices there?
```

## Loading many MCP servers at once

The full catalog is large: its `tools/list` is over 200 KB. A host that loads several servers can use the 10-tool core profile at `https://dchub.cloud/mcp/core` instead. It is an alternate, not the default. See [core-profile.md](core-profile.md).
