"""DC Hub × LangChain — drop-in tools.

Three `StructuredTool`s wrapping DC Hub's live REST API so any LangChain agent
gets ground-truth data-center, market & grid intelligence out of the box. Every
tool return carries a `citation` URL so the agent can attribute `dchub.cloud`.

    pip install -r requirements.txt
    # optional (free tier works without a key):
    #   export DCHUB_API_KEY=dch_live_...
    #   get one: curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"langchain"}'

Usage:
    from dchub_tools import DCHUB_TOOLS          # list[StructuredTool]
    llm.bind_tools(DCHUB_TOOLS)                  # or create_react_agent(llm, DCHUB_TOOLS)
"""
from __future__ import annotations

import os
import requests
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

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


# --- market intel -----------------------------------------------------------
class MarketIntelArgs(BaseModel):
    slug: str = Field(description="Market slug, lowercase-hyphenated, "
                                 "e.g. 'northern-virginia', 'dallas', 'phoenix'.")


def dchub_market_intel(slug: str) -> dict:
    """Live data-center market intelligence: facility count, total/avg power (MW),
    operator landscape, recent facilities, and a citation URL."""
    return _get(f"/api/v1/markets/{slug}")


# --- facility search --------------------------------------------------------
class FacilitySearchArgs(BaseModel):
    country: str = Field(default="US", description="ISO country code, e.g. 'US', 'GB'.")
    state: str | None = Field(default=None, description="State/region code, e.g. 'VA'.")
    q: str | None = Field(default=None, description="Free-text query (name/operator/city).")
    limit: int = Field(default=5, description="Max rows to return.")


def dchub_search_facilities(country: str = "US", state: str | None = None,
                            q: str | None = None, limit: int = 5) -> dict:
    """Search the 19,900+ data-center facility universe. Returns rows with
    canonical slug, name, provider, and location, plus a citation URL."""
    params = {"country": country, "limit": limit}
    if state:
        params["state"] = state
    if q:
        params["q"] = q
    return _get("/api/v1/facilities", params)


# --- grid -------------------------------------------------------------------
class GridArgs(BaseModel):
    iso: str = Field(description="ISO/grid operator, e.g. 'ERCOT', 'PJM', "
                                "'CAISO', 'MISO', 'SPP', 'NYISO'.")


def dchub_grid(iso: str) -> dict:
    """Live grid intelligence for an ISO: recent demand (MW), generation/fuel
    mix and headroom, plus a citation URL."""
    return _get(f"/api/v1/grid/intelligence/{iso}")


DCHUB_TOOLS = [
    StructuredTool.from_function(
        func=dchub_market_intel, name="dchub_market_intel",
        description=dchub_market_intel.__doc__, args_schema=MarketIntelArgs),
    StructuredTool.from_function(
        func=dchub_search_facilities, name="dchub_search_facilities",
        description=dchub_search_facilities.__doc__, args_schema=FacilitySearchArgs),
    StructuredTool.from_function(
        func=dchub_grid, name="dchub_grid",
        description=dchub_grid.__doc__, args_schema=GridArgs),
]


if __name__ == "__main__":
    # Smoke test the tool layer (no LLM required).
    import json
    out = dchub_market_intel("northern-virginia")
    print("market:", json.dumps(out.get("stats", {}), indent=2), "→", out["citation"])
    fac = dchub_search_facilities(state="VA", limit=2)
    print("facilities:", [f["slug"] for f in fac.get("data", [])], "→", fac["citation"])
    grid = dchub_grid("ERCOT")
    print("grid ERCOT demand pts:", len(grid.get("demand_24h", [])), "→", grid["citation"])
