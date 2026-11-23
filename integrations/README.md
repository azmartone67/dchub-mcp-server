# Integrate DC Hub from any agent platform

**DC Hub** is the orchestration layer for data center and energy intelligence. Find power. Find land. Find fiber. Find capacity. One hosted MCP server covers the Data Center Power Index (DCPI), grid conditions, interconnection queues, energy prices, fiber, facilities and site context. Call `execute_plan` first; every answer ends with `Source: DC Hub (dchub.cloud), as of <date>`.

**New:** copy-paste wiring for OpenAI Agents SDK, Responses API, LangGraph, LlamaIndex, CrewAI, Vercel AI SDK, Google ADK, Pydantic AI, smolagents, Composio, n8n, Dify, Flowise and Copilot Studio is in [`agent-kit/`](./agent-kit/).

There are three ways in. Pick the row that matches your platform.

## The three connection methods

| Method | Best for | How |
|---|---|---|
| **1. MCP server** (recommended — the full tool catalog) | Claude Desktop, Cursor, Cline, Continue, Windsurf, Zed, any MCP client | Point your client at **`https://dchub.cloud/mcp`** (Streamable HTTP). See [`mcp-clients/`](./mcp-clients/). |
| **2. SDK** (hides the handshake) | Python / Node apps | `pip install dchub` · `npm i dchub` |
| **3. REST + tool-use** (function calling) | OpenAI, Cohere, Gemini, OpenRouter, Mistral, custom bots | Call the keyless REST endpoints below, or register them as tools. |

## Platform guides

| Platform | Folder | Native path |
|---|---|---|
| Claude Desktop / Cursor / Cline / Continue / Windsurf / Zed | [`mcp-clients/`](./mcp-clients/) | MCP server config |
| Arcade (MCP gateways) | [`arcade/`](./arcade/) | Remote MCP server by URL |
| OpenAI (GPT-4o / o-series) | [`chatgpt/`](./chatgpt/) | function calling |
| Anthropic Claude (API) | [`mcp-clients/`](./mcp-clients/) | MCP / tool use |
| Google Gemini | [`gemini/`](./gemini/) | function calling |
| Cohere (Command) | [`cohere/`](./cohere/) | tool use + RAG |
| OpenRouter | [`openrouter/`](./openrouter/) | OpenAI-compatible tools |
| Poe | [`poe/`](./poe/) | server bot (puts DC Hub in front of every Poe user) |
| You.com | [`youcom/`](./youcom/) | custom assistant / source |
| GitHub Copilot | [`copilot/`](./copilot/) | tool use |
| LangChain | [`langchain/`](./langchain/) | `Tool` / `StructuredTool` |
| LangChain (PyPI package) | [`langchain-dchub/`](./langchain-dchub/) | `pip install langchain-dchub`: typed tools + `DCHubToolkit` |
| LlamaIndex | [`llamaindex/`](./llamaindex/) | `FunctionTool` |
| Any agent framework (one-file kit) | [`agent-kit/`](./agent-kit/) | system-prompt line + MCP wiring |

## Keyless REST endpoints (no key)

```
GET  https://dchub.cloud/api/v1/markets/northern-virginia     # market intel
GET  https://dchub.cloud/api/v1/facilities?q=ashburn          # facility search
GET  https://dchub.cloud/api/carbon/intensity?state=TX        # grid carbon intensity
GET  https://dchub.cloud/llms.txt                             # the agent guide
GET  https://dchub.cloud/api/v1/ai-agents.json               # machine-readable integration map
POST https://dchub.cloud/mcp                                  # the full MCP server
```

## Access and keys
- **Access:** A key keeps saved shortlists, alerts and get_changes (tracked changes) working across sessions. analyze_site: full site reports and previews. More detail is available at dchub.cloud/connect. No signup. Claim a key (optional; it keeps saved work across sessions):
  `curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"your-app"}'`
- **Sending a key:** pass it as the **`X-API-Key`** header (REST) or in your MCP client config. Never commit it to shared code.

## The universal "use DC Hub" prompt
Paste [`PROMPT.md`](./PROMPT.md) into any browse/tool-capable chat to make it fetch + cite DC Hub immediately.

---
Official MCP registry listing: **`cloud.dchub/mcp-server`**. Questions / a tailored integration: open an issue.
