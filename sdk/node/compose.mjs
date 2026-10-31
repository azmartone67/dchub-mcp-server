/**
 * Compose DC Hub into your own MCP server.
 *
 *   import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 *   import { registerDCHubTools } from "dchub/compose";
 *
 *   const server = new McpServer({ name: "acme-energy", version: "1.0.0" });
 *   await registerDCHubTools(server, { via: "acme-energy" });   // 5 starter tools
 *
 * Each DC Hub tool is registered under its own name with DC Hub's own input schema,
 * its description prefixed "From DC Hub (dchub.cloud):", and its result passed
 * through unchanged (cite_as, as_of and human_url stay intact, so your users can
 * cite the figure and open the full answer). `via` names your server in DC Hub's
 * per-partner counts (https://dchub.cloud/mcp/builders).
 *
 * Not on @modelcontextprotocol/sdk? dchubToolDefinitions() returns plain
 * {name, description, inputSchema, call} objects to wire into any server.
 */
import { DCHub, checkVia } from "./index.mjs";

export const STARTER_TOOLS = Object.freeze([
  "execute_plan", "search_facilities", "get_market_intel", "get_grid_data", "source_capacity",
]);
export const DESCRIPTION_PREFIX = "From DC Hub (dchub.cloud): ";

/** Plain tool definitions: [{name, description, inputSchema, annotations, call(args)}]. */
export async function dchubToolDefinitions({ via, apiKey, endpoint, tools = STARTER_TOOLS, client } = {}) {
  const dc = client || new DCHub({ apiKey, endpoint, via: checkVia(via) });
  const wanted = tools === "all" ? null : new Set(tools);
  const listed = await dc.listTools();
  const byName = new Map(listed.map((t) => [t.name, t]));
  if (wanted) {
    const missing = [...wanted].filter((n) => !byName.has(n));
    if (missing.length) throw new Error(`DC Hub does not serve: ${missing.join(", ")}`);
  }
  return listed
    .filter((t) => !wanted || wanted.has(t.name))
    .map((t) => ({
      name: t.name,
      description: DESCRIPTION_PREFIX + (t.description || ""),
      inputSchema: t.inputSchema || { type: "object", properties: {} },
      annotations: t.annotations,
      call: (args) => dc.callRaw(t.name, args || {}),
    }));
}

/** Convert a JSON Schema to a zod schema the MCP SDK accepts. zod >= 4 keeps the types
 * and descriptions (z.fromJSONSchema); older zod falls back to a permissive object
 * and DC Hub validates the arguments server-side. */
function toZod(z, json) {
  if (typeof z.fromJSONSchema === "function") {
    try { return z.fromJSONSchema(json); } catch { /* fall through */ }
  }
  return z.object({}).passthrough();
}

/** Register DC Hub tools on an @modelcontextprotocol/sdk McpServer. Returns the names. */
export async function registerDCHubTools(server, { via, apiKey, endpoint, tools = STARTER_TOOLS, z, prefix = "", client } = {}) {
  if (!server || typeof server.registerTool !== "function") {
    throw new TypeError("registerDCHubTools needs an McpServer (server.registerTool); use dchubToolDefinitions() for other servers");
  }
  const zod = z || (await import("zod"));
  const defs = await dchubToolDefinitions({ via, apiKey, endpoint, tools, client });
  for (const d of defs) {
    server.registerTool(prefix + d.name, {
      description: d.description,
      inputSchema: toZod(zod, d.inputSchema),
      annotations: d.annotations,
    }, async (args) => d.call(args));
  }
  return defs.map((d) => prefix + d.name);
}

export default registerDCHubTools;
