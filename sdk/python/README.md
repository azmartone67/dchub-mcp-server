# dchub — Python SDK

Live data-center, power & gas intelligence for AI agents. Hides the MCP JSON-RPC
handshake (`initialize` → `notifications/initialized` → `tools/call`, SSE
parsing) behind a thin client. **Zero runtime dependencies** (stdlib only).

## Install
```bash
pip install dchub          # from this repo: pip install ./sdk/python
```

## Quickstart (5 lines)
```python
from dchub import DCHub
dc = DCHub()                       # reads DCHUB_API_KEY from env if set
print(dc.market("northern-virginia"))   # market intel
print(dc.search(state="VA"))            # facility search (canonical slugs)
print(dc.grid(iso="ERCOT"))             # live grid intel
```

## API
| Method | Tool | Returns |
|--------|------|---------|
| `dc.market(slug)` | `get_market_intel` | by-status counts, operators, recent facilities |
| `dc.search(q, state, country, limit)` | `search_facilities` | rows w/ canonical slug, provider, location |
| `dc.grid(iso)` | `get_grid_data` | live demand / mix / headroom |
| `dc.call(tool, **args)` | *any of 38* | cleaned data payload |
| `dc.tools()` | `tools/list` | list of 38 tool names |

## Auth & tiers
Set `DCHUB_API_KEY` (sent as `X-API-Key`) for full data:
```bash
curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"python-sdk"}'
export DCHUB_API_KEY=dch_live_...
```
On the **free tier** some fields are masked and `grid` returns a gated preview;
the SDK strips the upsell wrapper and returns the real embedded payload either
way. Source/citation: https://dchub.cloud (CC-BY-4.0).

## Tests
```bash
pip install -e ".[test]" && pytest        # 5 live, gate-graceful tests
```

> Packaging is configured but **not published** — the maintainer runs
> `python -m build && twine upload` to ship to PyPI.
