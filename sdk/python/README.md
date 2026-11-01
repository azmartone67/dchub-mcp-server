# dchub — Python SDK for DC Hub

[![PyPI](https://img.shields.io/pypi/v/dchub.svg)](https://pypi.org/project/dchub/) [![Python](https://img.shields.io/pypi/pyversions/dchub.svg)](https://pypi.org/project/dchub/) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/azmartone67/dchub-mcp-server/blob/main/LICENSE)

Live data-center and energy intelligence for AI agents. Query [DC Hub](https://dchub.cloud)
instead of guessing from stale training data: facilities, markets (Data Center Power Index / DCPI),
real-time ISO grid telemetry, interconnection queues, fiber, gas, site risk and tracked deals.

Four ways in, one package:

| You want | Use |
|---|---|
| Plain Python calls over the REST API | `dchub.DCHub` |
| Any MCP tool from Python | `dchub.DCHubMCP` (module `dchub.mcp`) |
| DC Hub tools inside **your own** MCP server | `dchub.compose.dchub_tool_definitions` |
| LangChain or smolagents tools | `dchub_langchain_tools()`, `dchub_smolagents_tools()` |

Anonymous use returns previews and needs no key. A free key raises limits and unlocks full
answers: claim one at <https://dchub.cloud/signup> or with the MCP `claim_free_key` tool.

## Install

```bash
pip install dchub                 # core (requests only)
pip install "dchub[langchain]"    # + LangChain StructuredTools
pip install "dchub[agents]"       # + smolagents Tools
```

## REST client

```python
from dchub import DCHub

dc = DCHub()                              # no key
# dc = DCHub(api_key="dch_live_...")      # higher limits / key-gated endpoints

rank = dc.get_market_dcpi_rank("phoenix")
print(rank["composite_score"], rank["verdict"])

dc.search_facilities(country="US", limit=5)       # GET /api/v1/facilities
dc.stats()                                        # facility counts + sources
dc.ai_capacity_index(horizon=90)                  # AI Capacity Index markets
dc.get_grid_intelligence("PJM")                   # real-time ISO grid intel
dc.get_changes(since="24h")                       # incremental diffs
```

Every method returns parsed JSON (a `dict`). Non-2xx responses raise `DCHubError`,
which carries `.status_code` and the API's self-correcting `.detail` (for example,
how to claim a free key).

Any REST-backed tool in `dchub.TOOL_MANIFEST` can be called by name; path placeholders
are filled from kwargs and the rest become the query string:

```python
dc.call("get_market_dcpi_rank", slug="phoenix")
dc.call("search_facilities", provider="Equinix", limit=3)
```

| Method | REST endpoint |
| --- | --- |
| `stats()` | `/api/v1/stats` |
| `search_facilities(**filters)` | `/api/v1/facilities` |
| `get_facility(slug)` | `/api/v1/facilities/<slug>` |
| `fetch_facility(id)` | `/api/v1/facility/<id>` (numeric id) |
| `get_market_dcpi_rank(market_slug)` | `/api/v1/dcpi/scores/<slug>` |
| `rank_markets(by=...)` | `/api/v1/mcp/tools/rank_markets` |
| `ai_capacity_index(horizon=90)` | `/api/v1/ai-capacity-index` |
| `get_changes(since="24h")` | `/api/v1/changes/since` |
| `get_grid_intelligence(iso)` | `/api/v1/grid/intelligence/<iso>` |
| `list_transactions(**f)` | `/api/v1/deals` |
| `get_news(**f)` | `/api/news` |
| `get_pipeline(**f)` | `/api/v1/pipeline` (needs a free key) |

## MCP client (new in 0.3.0)

Every tool on the DC Hub MCP server, with the MCP handshake and SSE parsing handled
(stdlib only, no extra dependencies):

```python
from dchub import DCHubMCP

dc = DCHubMCP()                            # reads DCHUB_API_KEY from env if set
dc.market("northern-virginia")             # get_market_intel
dc.search(state="VA")                      # search_facilities
dc.grid(iso="ERCOT")                       # get_grid_data
dc.call("get_power_availability_timeline", state="TX")   # any tool
dc.tools()                                 # tool names
```

## Compose DC Hub into your own MCP server (new in 0.3.0)

```python
from dchub.compose import dchub_tool_definitions

defs = dchub_tool_definitions(via="acme-energy")   # 5 starter tools; tools="all" for every tool
# register each {name, description, inputSchema} in your low-level
# mcp.server.lowlevel.Server list_tools handler, and route call_tool to defs[i]["call"](arguments)
```

Descriptions are prefixed "From DC Hub (dchub.cloud):" and results pass through unchanged
(`cite_as`, `as_of`, `human_url` intact). `via` names your server in DC Hub's per-partner
counts: <https://dchub.cloud/mcp/builders>. Node version and the rules that come with the
data: [sdk/COMPOSE.md](https://github.com/azmartone67/dchub-mcp-server/blob/main/sdk/COMPOSE.md).

## LangChain

```python
from dchub import dchub_langchain_tools

tools = dchub_langchain_tools()          # list[StructuredTool]
```

## smolagents

```python
from dchub import dchub_smolagents_tools
from smolagents import CodeAgent, InferenceClientModel

agent = CodeAgent(tools=dchub_smolagents_tools(), model=InferenceClientModel())
agent.run("What's the DCPI verdict for Phoenix and which US market ranks #1?")
```

## Citation

Cite data from this SDK as **DC Hub (dchub.cloud), as of <date>**.

## Tests and release

```bash
pip install -e ".[test]" && pytest tests/test_compose.py tests/test_published_api.py   # offline
pytest tests/test_client.py tests/test_rest_smoke.py                                   # live
python -m build && twine upload dist/*
```

## License

MIT.
