/**
 * DC Hub tools for the Vercel AI SDK (`ai` >= 5).
 *
 *   import { generateText, stepCountIs } from "ai";
 *   import { dchubTools } from "dchub/ai-sdk";
 *
 *   const { text } = await generateText({
 *     model,                                  // any AI SDK model
 *     tools: await dchubTools(),              // 5 starter tools, no key needed
 *     stopWhen: stepCountIs(5),
 *     prompt: "Rank US markets for a 200 MW AI campus and cite the as-of date.",
 *   });
 *
 * Each tool wraps the remote DC Hub MCP server (https://dchub.cloud/mcp) under its
 * own name, with DC Hub's own JSON input schema and description. Without a key,
 * calls return free-tier previews; set DCHUB_API_KEY (or pass apiKey) and it is
 * sent as X-API-Key. The tool result is the text DC Hub returns, unchanged, so
 * cite_as, as_of and human_url reach the model and your user.
 *
 * `via` names your app in DC Hub's per-partner counts
 * (https://dchub.cloud/mcp/builders). It defaults to "ai-sdk".
 */
import { dchubToolDefinitions, STARTER_TOOLS } from "./compose.mjs";

export { STARTER_TOOLS };
export const DEFAULT_VIA = "ai-sdk";

/** Join the text parts of an MCP tool result; other parts are returned as JSON. */
export function resultText(result) {
  const content = (result && result.content) || [];
  return content
    .map((c) => (c && c.type === "text" ? c.text : JSON.stringify(c)))
    .join("\n");
}

/**
 * Build an AI SDK ToolSet: { [name]: tool({ description, inputSchema, execute }) }.
 * Options: apiKey, endpoint, via, tools (array of names, or "all"), prefix,
 * client (a DCHub instance), ai (the `ai` module, if you import it yourself).
 */
export async function dchubTools({
  apiKey, endpoint, via, tools = STARTER_TOOLS, prefix = "", client, ai,
} = {}) {
  const sdk = ai || (await import("ai"));
  if (typeof sdk.tool !== "function" || typeof sdk.jsonSchema !== "function") {
    throw new TypeError("dchubTools needs the Vercel AI SDK (`npm i ai`, version 5 or later)");
  }
  const defs = await dchubToolDefinitions({
    apiKey, endpoint, tools, client,
    via: via !== undefined ? via : (process.env.DCHUB_VIA || DEFAULT_VIA),
  });
  const set = {};
  for (const d of defs) {
    set[prefix + d.name] = sdk.tool({
      description: d.description,
      inputSchema: sdk.jsonSchema(d.inputSchema),
      execute: async (args) => {
        const result = await d.call(args);
        const text = resultText(result);
        if (result && result.isError) throw new Error(text || `DC Hub tool ${d.name} failed`);
        return text;
      },
    });
  }
  return set;
}

export default dchubTools;
