# DC Hub × LlamaIndex

Drop-in LlamaIndex tools for live data-center, market & grid intelligence. A
`FunctionTool` set over DC Hub's REST API — every response carries a `citation`
URL so your agent attributes `dchub.cloud` (CC-BY-4.0).

## Install
```bash
pip install -r requirements.txt          # llama-index-core, requests
# optional, for the agent example: pip install llama-index-llms-openai
```

## Get a key (optional — free tier works without one)
```bash
curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"llamaindex"}'
export DCHUB_API_KEY=dch_live_...
```

## Tools
| Tool | What it returns |
|------|-----------------|
| `dchub_market_intel(slug)` | facility count, total/avg MW, operators, recent facilities |
| `dchub_search_facilities(country, state, q, limit)` | facility rows w/ canonical slug, provider, location |
| `dchub_grid(iso)` | live demand (MW), generation/fuel mix, headroom for an ISO |

## 10-line agent example
```python
import asyncio
from llama_index.llms.openai import OpenAI
from llama_index.core.agent.workflow import FunctionAgent
from dchub_tools import DCHUB_TOOLS

agent = FunctionAgent(tools=DCHUB_TOOLS, llm=OpenAI(model="gpt-4o-mini"))
print(asyncio.run(agent.run(
    "What is the data-center capacity in Northern Virginia? Cite your source.")))
# → "Northern Virginia has 739 data-center facilities totaling ~13,442 MW.
#    Source: https://dchub.cloud"
```

`python example_agent.py` runs the above; with no `OPENAI_API_KEY` it falls back
to a direct tool call so it's still runnable.

## Tests
```bash
pip install pytest && pytest test_dchub_tools.py   # 5 live, gate-graceful tests
```
Includes an `iso`-bites regression test (PJM ≠ ERCOT) so the grid tool can't
silently ignore its param.

## Upstream
A prepared (un-submitted) `llama-hub` / LlamaIndex tool-spec contribution lives
in [`../UPSTREAM.md`](../UPSTREAM.md) — the maintainer files the upstream PR.
