# dchub-mcp-server

Live data-center and energy intelligence for AI agents, from [DC Hub](https://dchub.cloud): facility coverage in 170+ countries and 92 MCP tools covering power grids, interconnection queues, fiber, gas, site selection, markets and M&A.

DC Hub is a **hosted** MCP server at `https://dchub.cloud/mcp` (Streamable HTTP). If your client supports remote MCP servers, point it at that URL directly. This package is a small launcher for clients that only run local (stdio) servers: it connects them to the hosted server.

## Use

```bash
npx -y dchub-mcp-server
```

Claude Desktop, Cursor, Windsurf, Cline and other JSON-config clients:

```json
{
  "mcpServers": {
    "dchub": {
      "command": "npx",
      "args": ["-y", "dchub-mcp-server"],
      "env": { "DCHUB_API_KEY": "" }
    }
  }
}
```

## Keys and plans

- **Anonymous:** previews, no API key needed. Leave `DCHUB_API_KEY` empty.
- **Free key (one `claim_free_key` call, no email):** previews plus 2 full answers per tool per day, every tool callable, most as previews. Ask your agent to call `claim_free_key`, or get one at https://dchub.cloud/connect, then set `DCHUB_API_KEY`.
- **Add an email (`bind_email`):** 50 calls/day (up to 10 full answers per tool per day).
- **Paid plans and credit packs:** see https://dchub.cloud/pricing.

Environment variables:

| Variable | Purpose |
| --- | --- |
| `DCHUB_API_KEY` (or `X_API_KEY`) | Optional API key, sent as the `X-API-Key` header |
| `DCHUB_MCP_URL` | Override the endpoint (default `https://dchub.cloud/mcp`) |

## Links

- Connect guide for every client: https://dchub.cloud/connect
- Tool catalog: https://dchub.cloud/llms.txt
- Official MCP Registry: `cloud.dchub/mcp-server`
- Source: https://github.com/azmartone67/dchub-mcp-server
- Node SDK: [`dchub`](https://www.npmjs.com/package/dchub)

MIT licensed. The hosted data service is operated by DC Hub.
