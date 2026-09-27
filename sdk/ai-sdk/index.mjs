// dchub-ai-sdk — DC Hub tools for the Vercel AI SDK.
//
// A thin wrapper over @ai-sdk/mcp: it opens an MCP client on the DC Hub remote
// server and hands back the server's tools in AI SDK shape. There is no copy of
// the tool list in this package, so it never drifts from what the server serves.
import { createMCPClient } from '@ai-sdk/mcp';

export const DCHUB_MCP_URL = 'https://dchub.cloud/mcp';

/**
 * Open a DC Hub MCP client and return its tools.
 * The caller owns the client: call `close()` when done (or use withDCHubTools).
 *
 * @param {object} [options]
 * @param {string} [options.apiKey]  Sent as X-API-Key. Defaults to process.env.DCHUB_API_KEY.
 *                                   Omit both to run keyless on the free tier.
 * @param {string} [options.url]     MCP endpoint. Defaults to https://dchub.cloud/mcp.
 * @param {string[]} [options.only]  Keep only these tool names.
 */
export async function createDCHubTools(options = {}, _createClient = createMCPClient) {
  const apiKey = options.apiKey ?? globalThis.process?.env?.DCHUB_API_KEY;
  const transport = { type: 'http', url: options.url ?? DCHUB_MCP_URL };
  if (apiKey) transport.headers = { 'X-API-Key': apiKey };

  const client = await _createClient({ transport });
  let tools;
  try {
    tools = await client.tools();
  } catch (err) {
    await client.close();
    throw err;
  }
  if (options.only) {
    const missing = options.only.filter((name) => !(name in tools));
    if (missing.length) {
      await client.close();
      throw new Error(`dchub-ai-sdk: unknown tool(s): ${missing.join(', ')}`);
    }
    tools = Object.fromEntries(options.only.map((name) => [name, tools[name]]));
  }
  return { tools, close: () => client.close() };
}

/**
 * Run `fn` with DC Hub tools and always close the client afterwards.
 *
 * @template T
 * @param {Parameters<typeof createDCHubTools>[0]} options
 * @param {(ctx: { tools: Record<string, any> }) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withDCHubTools(options, fn, _createClient = createMCPClient) {
  const { tools, close } = await createDCHubTools(options, _createClient);
  try {
    return await fn({ tools });
  } finally {
    await close();
  }
}
