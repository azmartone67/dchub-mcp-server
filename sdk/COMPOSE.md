# Compose DC Hub into your MCP server

Add live, cited data center, power grid and capacity tools to your own MCP server in a
few lines. Each DC Hub tool keeps its own name and input schema, its description is
prefixed `From DC Hub (dchub.cloud):`, and its result passes through unchanged, so
`cite_as`, `as_of` and `human_url` reach your users intact.

## Node (`@modelcontextprotocol/sdk`)

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDCHubTools } from "dchub/compose";      // npm i dchub@^0.2.0

const server = new McpServer({ name: "acme-energy", version: "1.0.0" });
await registerDCHubTools(server, {
  via: "acme-energy",                 // your name in DC Hub's per-partner counts
  // tools: ["get_grid_data", "get_market_dcpi_rank"],   // default: 5 starter tools; "all" for every tool
  // apiKey: process.env.DCHUB_API_KEY,                  // partner key for production traffic
  // prefix: "dchub_",                                   // if a name would clash with yours
});
```

With zod 4 the input schemas keep their types and descriptions (`z.fromJSONSchema`);
with older zod they register as permissive objects and DC Hub validates server-side.
Another server framework: `dchubToolDefinitions(opts)` returns plain
`{ name, description, inputSchema, annotations, call(args) }` objects.

Try it: `node sdk/node/examples/compose-demo.mjs my-name` (from the repo root).

## Python

`pip install "dchub>=0.3.0"`

```python
from dchub.compose import dchub_tool_definitions

defs = dchub_tool_definitions(via="acme-energy")   # same options: tools=, api_key=
# register each {name, description, inputSchema} in your low-level
# mcp.server.lowlevel.Server list_tools handler, and route call_tool to defs[i]["call"](arguments)
```

## Starter tools

`execute_plan` (multi-part questions), `search_facilities`, `get_market_intel`,
`get_grid_data`, `source_capacity`. Full catalog: `tools/list` on https://dchub.cloud/mcp.

## Rules that come with the data

- `via`: lowercase letters, digits, `.`, `_` or `-`, 1-40 characters. It is sent as
  `X-DCHub-Via` and changes nothing in access or results.
- Keyless calls are previews and are counted per source IP, so relayed traffic shares
  your IP: evaluate keyless, then ask partnerships@dchub.cloud for a partner key.
- A partial result carries `human_url` / `human_message`: show them to your user; do not
  invent withheld numbers.
- Cite as `DC Hub (dchub.cloud), as of <date>`; each layer states its licence.

More: https://dchub.cloud/mcp/builders
