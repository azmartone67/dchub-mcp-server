"""DC Hub × LlamaIndex — drop-in tools.

A `FunctionTool` set wrapping DC Hub's live REST API so any LlamaIndex agent gets
ground-truth data-center, market & grid intelligence out of the box. Every tool
return carries a `citation` URL so the agent can attribute `dchub.cloud`.

    pip install -r requirements.txt
    # optional (free tier works without a key):
    #   export DCHUB_API_KEY=dch_live_...
    #   get one: curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"llamaindex"}'

Usage:
    from dchub_tools import DCHUB_TOOLS          # list[FunctionTool]
    FunctionAgent(tools=DCHUB_TOOLS, llm=llm)
"""
from __future__ import annotations

import os
import requests
from llama_index.core.tools import FunctionTool

API_BASE = os.environ.get("DCHUB_API_BASE", "https://api.dchub.cloud")
CITATION = "https://dchub.cloud"
_TIMEOUT = 25


def _get(path: str, params: dict | None = None) -> dict:
    headers = {}
    key = os.environ.get("DCHUB_API_KEY")
    if key:
        headers["X-API-Key"] = key
    r = requests.get(f"{API_BASE}{path}", params=params or {}, headers=headers,
                     timeout=_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    # Every response carries an attribution the agent can cite.
    data["citation"] = CITATION
    data["license"] = "CC-BY-4.0"
    return data


def get_market_intel(slug: str) -> dict:
    """Live data-center market intelligence for a market slug
    (lowercase-hyphenated, e.g. 'northern-virginia', 'dallas', 'phoenix'):
    facility count, total/avg power (MW), operator landscape, recent
    facilities, and a citation URL."""
    return _get(f"/api/v1/markets/{slug}")


def search_facilities(country: str = "US", state: str = "",
                            q: str = "", limit: int = 5) -> dict:
    """Search the global data-center facility map (corroborated count pending) by country (ISO code),
    state/region code, and/or free-text query. Returns rows with canonical slug,
    name, provider, location, and a citation URL."""
    params = {"country": country, "limit": limit}
    if state:
        params["state"] = state
    if q:
        params["q"] = q
    return _get("/api/v1/facilities", params)


def get_grid_intelligence(iso: str) -> dict:
    """Live grid intelligence for an ISO/grid operator ('ERCOT', 'PJM', 'CAISO',
    'MISO', 'SPP', 'NYISO'): recent demand (MW), generation/fuel mix, headroom,
    and a citation URL."""
    return _get(f"/api/v1/grid/intelligence/{iso}")


DCHUB_TOOLS = [
    FunctionTool.from_defaults(fn=get_market_intel, name="get_market_intel"),
    FunctionTool.from_defaults(fn=search_facilities, name="search_facilities"),
    FunctionTool.from_defaults(fn=get_grid_intelligence, name="get_grid_intelligence"),
]


if __name__ == "__main__":
    # Smoke test the tool layer (no LLM required).
    import json
    out = get_market_intel("northern-virginia")
    print("market:", json.dumps(out.get("stats", {}), indent=2), "→", out["citation"])
    fac = search_facilities(state="VA", limit=2)
    print("facilities:", [f["slug"] for f in fac.get("data", [])], "→", fac["citation"])
    grid = get_grid_intelligence("ERCOT")
    print("grid ERCOT demand pts:", len(grid.get("demand_24h", [])), "→", grid["citation"])
