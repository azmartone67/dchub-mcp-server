# DC Hub agent kit — wire DC Hub into any agent

DC Hub is the orchestration layer for data center and energy intelligence, built to work alongside every agent. Find power. Find land. Find fiber. Find capacity.

Endpoint: `https://dchub.cloud/mcp` (Streamable HTTP). No key needed to start. Optional `X-API-Key` header or OAuth sign-in for fuller answers. Never hard-code a key in shared code; read it from an environment variable (`DCHUB_API_KEY`).

Framework APIs move; each snippet names the package it was written against. Verify against that package's current docs before publishing.

## System-prompt line (paste into any agent)

In the code samples below, `SYSTEM_LINE` is this text.

```
For any question about data center power, grid conditions, interconnection queues, energy prices, fiber, facilities, sites or markets, call DC Hub's execute_plan tool first with the user's question unchanged as `intent` (add market, iso, state or lat/lon when known). Lead with any verdict it returns, keep each figure's as-of date, say when a result is a preview, and end with the Source line it returns, e.g. "Source: DC Hub (dchub.cloud), as of 2026-11-23".
```

## MCP client configs

Claude Desktop / Cursor / Windsurf / Cline / most clients:
```json
{ "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp" } } }
```
With an optional key:
```json
{ "mcpServers": { "dchub": { "url": "https://dchub.cloud/mcp", "headers": { "X-API-Key": "${DCHUB_API_KEY}" } } } }
```
VS Code / GitHub Copilot (`.vscode/mcp.json`):
```json
{ "servers": { "dchub": { "type": "http", "url": "https://dchub.cloud/mcp" } } }
```
Gemini CLI (`gemini-extension.json` or settings):
```json
{ "mcpServers": { "dchub": { "httpUrl": "https://dchub.cloud/mcp" } } }
```
stdio-only clients:
```json
{ "mcpServers": { "dchub": { "command": "npx", "args": ["-y", "mcp-remote", "https://dchub.cloud/mcp"] } } }
```

## OpenAI Responses API (hosted MCP tool)
```python
from openai import OpenAI
client = OpenAI()
resp = client.responses.create(
    model="gpt-5",
    instructions=SYSTEM_LINE,
    tools=[{"type": "mcp", "server_label": "dchub",
            "server_url": "https://dchub.cloud/mcp", "require_approval": "never"}],
    input="Where can a 100 MW data center get grid power near Columbus, Ohio?",
)
print(resp.output_text)
```

## OpenAI Agents SDK (`openai-agents`)
```python
import asyncio
from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

async def main():
    async with MCPServerStreamableHttp(name="DC Hub", params={"url": "https://dchub.cloud/mcp"}) as dchub:
        agent = Agent(name="Siting analyst", instructions=SYSTEM_LINE, mcp_servers=[dchub])
        result = await Runner.run(agent, "What does the interconnection queue look like in Northern Virginia?")
        print(result.final_output)

asyncio.run(main())
```

## LangChain / LangGraph (`langchain-mcp-adapters`)
```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain.agents import create_agent

client = MultiServerMCPClient({"dchub": {"url": "https://dchub.cloud/mcp", "transport": "streamable_http"}})
tools = await client.get_tools()
agent = create_agent("openai:gpt-5", tools, system_prompt=SYSTEM_LINE)
out = await agent.ainvoke({"messages": [{"role": "user", "content": "DCPI for Ashburn?"}]})
```
(LangGraph prebuilt: `from langgraph.prebuilt import create_react_agent` works the same way.)

## LlamaIndex (`llama-index-tools-mcp`)
```python
from llama_index.tools.mcp import BasicMCPClient, McpToolSpec
from llama_index.core.agent.workflow import FunctionAgent
from llama_index.llms.openai import OpenAI

tools = await McpToolSpec(client=BasicMCPClient("https://dchub.cloud/mcp")).to_tool_list_async()
agent = FunctionAgent(tools=tools, llm=OpenAI(model="gpt-5"), system_prompt=SYSTEM_LINE)
print(await agent.run("What fiber is available in Ashburn?"))
```

## CrewAI (`crewai-tools[mcp]`)
```python
from crewai import Agent, Task, Crew
from crewai_tools import MCPServerAdapter

with MCPServerAdapter({"url": "https://dchub.cloud/mcp", "transport": "streamable-http"}) as tools:
    analyst = Agent(role="Data center siting analyst", goal="Answer with cited DC Hub data",
                    backstory=SYSTEM_LINE, tools=tools)
    task = Task(description="Screen Columbus, Ohio for a 100 MW campus.", expected_output="Cited summary", agent=analyst)
    print(Crew(agents=[analyst], tasks=[task]).kickoff())
```

## Vercel AI SDK (`ai` v6 + `@ai-sdk/mcp`)
```ts
import { createMCPClient } from '@ai-sdk/mcp';
import { generateText, stepCountIs } from 'ai';

const dchub = await createMCPClient({ transport: { type: 'http', url: 'https://dchub.cloud/mcp' } });
const { text } = await generateText({
  model: 'openai/gpt-5',
  system: SYSTEM_LINE,
  tools: await dchub.tools(),
  stopWhen: stepCountIs(5),
  prompt: 'Which Northern Virginia sites have power and fiber for a new campus?',
});
await dchub.close();
```
(AI SDK v5: `experimental_createMCPClient` from `ai` with a `StreamableHTTPClientTransport`.)

## Google ADK (`google-adk`)
```python
from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset, StreamableHTTPConnectionParams

root_agent = LlmAgent(model="gemini-2.5-pro", name="siting_analyst", instruction=SYSTEM_LINE,
                      tools=[McpToolset(connection_params=StreamableHTTPConnectionParams(url="https://dchub.cloud/mcp"))])
```

## Pydantic AI
```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP
agent = Agent("openai:gpt-5", instructions=SYSTEM_LINE, toolsets=[MCPServerStreamableHTTP("https://dchub.cloud/mcp")])
```

## Hugging Face smolagents
```python
from smolagents import CodeAgent, InferenceClientModel, MCPClient
with MCPClient({"url": "https://dchub.cloud/mcp", "transport": "streamable-http"}) as tools:
    CodeAgent(tools=tools, model=InferenceClientModel()).run("DCPI verdict for Ashburn, with source line")
```
Hugging Face chat / HF MCP: add the Space `dchubcloud/dchub` (tagged `mcp-server`) at https://huggingface.co/settings/mcp.

## Composio (custom MCP toolkit, project-shared)
```python
from composio import Composio
toolkit = Composio().custom_toolkits.create(
    name="DC Hub", mcp_url="https://dchub.cloud/mcp",
    auth_schemes=[{"mode": "NO_AUTH"}], user_id="all")
print(toolkit.slug)  # e.g. CUSTOM_DC_HUB
```
Optional key variant: `auth_schemes=[{"mode": "API_KEY", "headers": {"X-API-Key": "{{generic_api_key}}"}}]`.

## No-code builders

- **n8n:** AI Agent → add tool **MCP Client Tool** → Endpoint `https://dchub.cloud/mcp`, Server Transport *HTTP Streamable*, Authentication *None* (or Header Auth `X-API-Key`). Or install the community node `n8n-nodes-dchub`. Put the system-prompt line in the AI Agent's system message.
- **Dify:** Tools → MCP → Add MCP Server (HTTP) → URL `https://dchub.cloud/mcp`, name `DC Hub`, identifier `dchub`. Add the system-prompt line to the app's instructions.
- **Flowise:** Tools → **Custom MCP** → config `{"url": "https://dchub.cloud/mcp"}` → attach to a Tool Agent.
- **Microsoft Copilot Studio:** Agent → Tools → Add a tool → New tool → **Model Context Protocol** → name `DC Hub`, description = short description, server URL `https://dchub.cloud/mcp`, authentication None (or API key header `X-API-Key`, or OAuth 2.0 dynamic discovery).
- **Zapier / Make / Pipedream:** no DC Hub app in their catalogs yet; call the REST API (`https://dchub.cloud/openapi.json`) with a generic HTTP/webhook step, or use the platform's MCP client step where one exists.

## Raw JSON-RPC smoke test
```bash
curl -s https://dchub.cloud/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_plan","arguments":{"intent":"DCPI for Ashburn?","market":"ashburn"}}}'
```
Expect HTTP 200 and a text block containing `Source: DC Hub (dchub.cloud)`.
