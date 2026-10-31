// Compose DC Hub into a tiny MCP server and call one tool through it, in-process.
// Run from the repo root (uses the root node_modules for the MCP SDK and zod):
//   node sdk/node/examples/compose-demo.mjs [via-name]
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerDCHubTools } from "../compose.mjs";

const via = process.argv[2] || "compose-demo";
const server = new McpServer({ name: "acme-energy", version: "1.0.0" });
const names = await registerDCHubTools(server, { via });
console.log("registered:", names.join(", "));

const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: "demo-client", version: "1" });
await client.connect(ct);

const { tools } = await client.listTools();
console.log("listed by the composed server:", tools.length, "tools; get_grid_data requires",
  JSON.stringify(tools.find((t) => t.name === "get_grid_data")?.inputSchema?.required));
const r = await client.callTool({ name: "get_grid_data", arguments: { iso: "PJM" } });
console.log("get_grid_data(PJM) via the composed server:\n" + (r.content?.[0]?.text || "").slice(0, 600));
await client.close();
