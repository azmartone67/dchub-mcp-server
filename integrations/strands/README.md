# DC Hub with Strands Agents

A small energy and data-center agent built on [Strands Agents](https://strandsagents.com)
that uses the remote DC Hub MCP server for live, dated data: markets (DCPI),
power availability, interconnection queues, fiber, site risk and capacity for lease.

```bash
pip install strands-agents mcp
python energy_agent.py "Which ERCOT markets does DC Hub rate BUILD for a 200 MW campus?"
```

- **Model:** Strands' default is Amazon Bedrock (needs AWS credentials). Pass any Strands model with `Agent(model=...)`.
- **Endpoint:** `DCHUB_MCP_URL` defaults to `https://dchub.cloud/mcp/core` (10 core tools). Use `https://dchub.cloud/mcp` for all 94.
- **Key:** none needed to start; anonymous calls return previews. Set `DCHUB_API_KEY` (sent as `X-API-Key`) for more. Free key: https://dchub.cloud/connect

The connection is `MCPClient.load_servers({"dchub": {"url": ..., "headers": ...}})`,
which works with both the 1.x and 2.x lines of the `mcp` package.

To pair DC Hub with an EIA energy-data MCP server in one agent, see
https://dchub.cloud/docs/recipes.

Cite figures as `DC Hub (dchub.cloud), as of <date>`.
