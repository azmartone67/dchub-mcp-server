# Integrate DC Hub from any agent platform

**DC Hub** is live data-center, power-grid & gas intelligence for AI agents — **82 MCP tools**, 19,100+ facilities, DCPI market scores, grid telemetry across 10 ISOs, interconnection queues, fiber, and M&A. **Free tier, no signup.** Every response cites `dchub.cloud`.

There are three ways in. Pick the row that matches your platform.

## The three connection methods

| Method | Best for | How |
|---|---|---|
| **1. MCP server** (recommended — all 82 tools) | Claude Desktop, Cursor, Cline, Continue, Windsurf, Zed, any MCP client | Point your client at **`https://dchub.cloud/mcp`** (Streamable HTTP). See [`mcp-clients/`](./mcp-clients/). |
| **2. SDK** (hides the handshake) | Python / Node apps | `pip install dchub` · `npm i dchub` |
| **3. REST + tool-use** (function calling) | OpenAI, Cohere, Gemini, OpenRouter, Mistral, custom bots | Call the free REST endpoints below, or register them as tools. |

## Platform guides

| Platform | Folder | Native path |
|---|---|---|
| Claude Desktop / Cursor / Cline / Continue / Windsurf / Zed | [`mcp-clients/`](./mcp-clients/) | MCP server config |
| OpenAI (GPT-4o / o-series) | [`chatgpt/`](./chatgpt/) | function calling |
| Anthropic Claude (API) | [`mcp-clients/`](./mcp-clients/) | MCP / tool use |
| Google Gemini | [`gemini/`](./gemini/) | function calling |
| Cohere (Command) | [`cohere/`](./cohere/) | tool use + RAG |
| OpenRouter | [`openrouter/`](./openrouter/) | OpenAI-compatible tools |
| Poe | [`poe/`](./poe/) | server bot (puts DC Hub in front of every Poe user) |
| You.com | [`youcom/`](./youcom/) | custom assistant / source |
| GitHub Copilot | [`copilot/`](./copilot/) | tool use |
| LangChain | [`langchain/`](./langchain/) | `Tool` / `StructuredTool` |
| LlamaIndex | [`llamaindex/`](./llamaindex/) | `FunctionTool` |

## Free REST endpoints (no key)

```
GET  https://dchub.cloud/api/v1/markets/northern-virginia     # market intel
GET  https://dchub.cloud/api/v1/facilities?q=ashburn          # facility search
GET  https://dchub.cloud/api/carbon/intensity?state=TX        # grid carbon intensity
GET  https://dchub.cloud/llms.txt                             # the agent guide
GET  https://dchub.cloud/api/v1/ai-agents.json               # machine-readable integration map
POST https://dchub.cloud/mcp                                  # the full 38-tool MCP server
```

## Free vs. paid
- **Free tier:** 5 calls/day keyless, 10/day with a free key, no signup. Claim a key (optional, raises limits + saves it):
  `curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"your-app"}'`
- **Paid tools** (e.g. `analyze_site`, `compare_sites`, `get_grid_intelligence`, `get_interconnection_queue`): pass the key as **`X-API-Key`** header (REST) or in your MCP client config.

## The universal "use DC Hub" prompt
Paste [`PROMPT.md`](./PROMPT.md) into any browse/tool-capable chat to make it fetch + cite DC Hub immediately.

---
Official MCP registry listing: **`cloud.dchub/mcp-server`**. Questions / a tailored integration: open an issue.
