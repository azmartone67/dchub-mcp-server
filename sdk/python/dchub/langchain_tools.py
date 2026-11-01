"""LangChain tool wrappers for the DC Hub SDK.

``dchub_langchain_tools(api_key=None)`` returns a list of ``langchain_core``
``StructuredTool`` objects for the flagship DC Hub methods. langchain-core is
imported lazily so a core install (``pip install dchub``) does not require it.

    from dchub import dchub_langchain_tools
    tools = dchub_langchain_tools()   # pass into an agent
"""
from __future__ import annotations

from typing import List, Optional

from .client import DCHub
from .manifest import TOOL_RETURNS

__all__ = ["dchub_langchain_tools"]


def dchub_langchain_tools(api_key: Optional[str] = None, **client_kwargs) -> List:
    """Build LangChain StructuredTools for the flagship DC Hub methods."""
    try:
        from langchain_core.tools import StructuredTool
        from pydantic import BaseModel, Field
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "LangChain support requires langchain-core and pydantic. "
            "Install with: pip install 'dchub[langchain]'"
        ) from e

    dc = DCHub(api_key=api_key, **client_kwargs)

    # --- arg schemas --------------------------------------------------------
    class MarketSlug(BaseModel):
        market_slug: str = Field(..., description="Market slug, e.g. 'phoenix', 'ashburn-va'.")

    class RankMarkets(BaseModel):
        by: str = Field("composite", description="Ranking criterion: composite | power | operators.")

    class AICapacity(BaseModel):
        horizon: int = Field(90, description="Forecast horizon in days.")

    class Changes(BaseModel):
        since: str = Field("24h", description="Window or ISO timestamp, e.g. '24h' or a prior generated_at.")

    class ISO(BaseModel):
        iso: str = Field(..., description="ISO/RTO code, e.g. PJM, ERCOT, CAISO, MISO, SPP, NYISO.")

    class FacilitySlug(BaseModel):
        id: str = Field(..., description="Facility slug (e.g. 'equinix-...-817a7302').")

    class Empty(BaseModel):
        pass

    class FreeFilters(BaseModel):
        # StructuredTool needs a schema; keep it open via a single optional dict-like field.
        limit: Optional[int] = Field(None, description="Max rows to return.")
        country: Optional[str] = Field(None, description="Country filter, e.g. 'US'.")
        provider: Optional[str] = Field(None, description="Provider/operator filter.")
        market: Optional[str] = Field(None, description="Market filter.")

    def _search(limit=None, country=None, provider=None, market=None):
        return dc.search_facilities(limit=limit, country=country, provider=provider, market=market)

    def _deals(limit=None, country=None, provider=None, market=None):
        return dc.list_transactions(limit=limit, market=market)

    def _news(limit=None, country=None, provider=None, market=None):
        return dc.get_news(limit=limit)

    def _pipeline(limit=None, country=None, provider=None, market=None):
        return dc.get_pipeline(limit=limit, market=market)

    tools = [
        StructuredTool.from_function(
            name="dchub_stats",
            description=TOOL_RETURNS["stats"],
            func=lambda: dc.stats(),
            args_schema=Empty,
        ),
        StructuredTool.from_function(
            name="dchub_search_facilities",
            description=TOOL_RETURNS["search_facilities"],
            func=_search,
            args_schema=FreeFilters,
        ),
        StructuredTool.from_function(
            name="dchub_get_facility",
            description=TOOL_RETURNS["get_facility"],
            func=lambda id: dc.get_facility(id),
            args_schema=FacilitySlug,
        ),
        StructuredTool.from_function(
            name="dchub_get_market_dcpi_rank",
            description=TOOL_RETURNS["get_market_dcpi_rank"],
            func=lambda market_slug: dc.get_market_dcpi_rank(market_slug),
            args_schema=MarketSlug,
        ),
        StructuredTool.from_function(
            name="dchub_rank_markets",
            description=TOOL_RETURNS["rank_markets"],
            func=lambda by="composite": dc.rank_markets(by=by),
            args_schema=RankMarkets,
        ),
        StructuredTool.from_function(
            name="dchub_ai_capacity_index",
            description=TOOL_RETURNS["ai_capacity_index"],
            func=lambda horizon=90: dc.ai_capacity_index(horizon=horizon),
            args_schema=AICapacity,
        ),
        StructuredTool.from_function(
            name="dchub_get_changes",
            description=TOOL_RETURNS["get_changes"],
            func=lambda since="24h": dc.get_changes(since=since),
            args_schema=Changes,
        ),
        StructuredTool.from_function(
            name="dchub_get_grid_intelligence",
            description=TOOL_RETURNS["get_grid_intelligence"],
            func=lambda iso: dc.get_grid_intelligence(iso),
            args_schema=ISO,
        ),
        StructuredTool.from_function(
            name="dchub_list_transactions",
            description=TOOL_RETURNS["list_transactions"],
            func=_deals,
            args_schema=FreeFilters,
        ),
        StructuredTool.from_function(
            name="dchub_get_news",
            description=TOOL_RETURNS["get_news"],
            func=_news,
            args_schema=FreeFilters,
        ),
        StructuredTool.from_function(
            name="dchub_get_pipeline",
            description=TOOL_RETURNS["get_pipeline"],
            func=_pipeline,
            args_schema=FreeFilters,
        ),
    ]
    return tools
