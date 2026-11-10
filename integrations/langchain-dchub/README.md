# langchain-dchub

[![PyPI](https://img.shields.io/pypi/v/langchain-dchub.svg)](https://pypi.org/project/langchain-dchub/) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/azmartone67/dchub-mcp-server/blob/main/LICENSE)

LangChain tools for [DC Hub](https://dchub.cloud): data-center, power-grid and energy data for agents.
Facilities and operators, market intelligence, live grid demand and fuel mix, interconnection queues,
fiber, site risk, and data-center capacity listed for sale or lease. Every result carries DC Hub's
citation and `as_of` dates, passed through to your agent unchanged.

The tools call the DC Hub MCP server (`https://dchub.cloud/mcp`) through the
[`dchub`](https://pypi.org/project/dchub/) Python SDK.

## Installation

```bash
pip install -U langchain-dchub
```

## Credentials

A key is optional.

Anonymous: previews, no key needed. Free key: previews plus 2 full answers per tool per day. Add an email: 50 calls/day (up to 10 full answers per tool per day). Paid plans: dchub.cloud/pricing. Grid/queue/market-intel tools: previews on free; an email adds 10 full answers/day each.

Get a free key at <https://dchub.cloud/signup>, then:

```bash
export DCHUB_API_KEY="dch_live_..."
```

A preview result says which fields were withheld (a `_withheld` suffix) and ends with a
`human_url` link where a person can unlock the full answer. Show that line to your user; do not
invent the withheld numbers.

## Tools

```python
from langchain_dchub import DCHubGridData

tool = DCHubGridData()
print(tool.invoke({"iso": "ERCOT"}))
```

| Class | Tool name | What it answers |
|---|---|---|
| `DCHubExecutePlan` | `dchub_execute_plan` | A multi-part question (markets, power, queues, fiber, incentives, risk) planned and answered in one call |
| `DCHubSearchFacilities` | `dchub_search_facilities` | Which data centers exist, and who operates them, by country, state, city, operator, MW or free text |
| `DCHubMarketIntel` | `dchub_get_market_intel` | One market: facility count, tracked MW, status mix, top providers, lease pricing and its basis |
| `DCHubGridData` | `dchub_get_grid_data` | Live grid demand, 24-hour curve and fuel mix for US ISOs, utility BAs and many non-US grids |
| `DCHubSourceCapacity` | `dchub_source_capacity` | Capacity to buy or lease (powered land, powered shell, turnkey, colocation) by size and location |

Each tool returns the server's text to the model and keeps the raw MCP result as the
`ToolMessage.artifact` (`response_format="content_and_artifact"`).

## Toolkit

```python
from langchain_dchub import DCHubToolkit

tools = DCHubToolkit().get_tools()  # the five tools above, no network call
```

Every read-only tool on the server, built from its live `tools/list`:

```python
tools = DCHubToolkit(load_from_server=True).get_tools()
```

The smaller core server (`/mcp/core`):

```python
tools = DCHubToolkit(endpoint="https://dchub.cloud/mcp/core", load_from_server=True).get_tools()
```

Options: `tool_names=["get_grid_data", ...]` keeps only those tools (MCP names);
`include_write_tools=True` also returns tools that are not read-only (alerts, saved sites,
key and email binding); `name_prefix=""` drops the `dchub_` prefix. Payment parameters
(`mpp_pay`, `mpp_credential`) are removed from every schema, so a model cannot start a payment.

## Use in an agent

```python
from langchain.agents import create_agent
from langchain_dchub import DCHubToolkit

agent = create_agent(
    model="claude-sonnet-4-6",  # pip install "langchain[anthropic]"
    tools=DCHubToolkit().get_tools(),
    system_prompt="Answer with DC Hub data. Cite DC Hub (dchub.cloud) and the as_of date.",
)
result = agent.invoke(
    {"messages": [{"role": "user", "content": "How much grid headroom does ERCOT have right now?"}]}
)
print(result["messages"][-1].content)
```

Any chat model with tool calling works; swap the `model` string for your provider.

## Configuration

| Argument | Environment variable | Default |
|---|---|---|
| `api_key` | `DCHUB_API_KEY` | none (anonymous previews) |
| `endpoint` | `DCHUB_ENDPOINT` | `https://dchub.cloud/mcp` |
| `headers` | | `{}` (extra HTTP headers) |
| `timeout` | | `60` seconds |

## Citing

Attribute figures to DC Hub (dchub.cloud) with the `as_of` date the result carries.

## Development

```bash
cd integrations/langchain-dchub
python -m venv .venv && . .venv/bin/activate
pip install -e . --group test        # pip >= 25.1 reads [dependency-groups]
pytest --disable-socket --allow-unix-socket tests/unit_tests   # no network
pytest tests/integration_tests                                 # live, anonymous
python -m build && twine check dist/*
```

The integration tests call the live API anonymously with DC Hub's QA User-Agent
(`dchub-qa-readonly`), so they are left out of DC Hub's usage counts.

## Links

- DC Hub: <https://dchub.cloud>
- MCP server: <https://dchub.cloud/mcp>
- Agent guide: <https://dchub.cloud/llms.txt>
- Source: <https://github.com/azmartone67/dchub-mcp-server/tree/main/integrations/langchain-dchub>

MIT licensed.
