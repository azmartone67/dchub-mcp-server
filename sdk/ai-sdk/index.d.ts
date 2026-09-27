import type { ToolSet } from 'ai';

export declare const DCHUB_MCP_URL: 'https://dchub.cloud/mcp';

export interface DCHubToolsOptions {
  /** Sent as X-API-Key. Defaults to process.env.DCHUB_API_KEY; omit both to run keyless. */
  apiKey?: string;
  /** MCP endpoint. Defaults to https://dchub.cloud/mcp. */
  url?: string;
  /** Keep only these tool names. Throws if one is not served. */
  only?: string[];
}

export declare function createDCHubTools(
  options?: DCHubToolsOptions,
): Promise<{ tools: ToolSet; close: () => Promise<void> }>;

export declare function withDCHubTools<T>(
  options: DCHubToolsOptions,
  fn: (ctx: { tools: ToolSet }) => Promise<T>,
): Promise<T>;
