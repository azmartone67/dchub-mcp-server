"""smolagents tool wrappers for the DC Hub SDK.

``dchub_smolagents_tools(api_key=None)`` returns a list of ``smolagents.Tool``
objects for the flagship DC Hub methods. smolagents is imported lazily so a core
install does not require it.

    from dchub import dchub_smolagents_tools
    tools = dchub_smolagents_tools()
"""
from __future__ import annotations

from typing import List, Optional

from .client import DCHub
from .manifest import TOOL_RETURNS

__all__ = ["dchub_smolagents_tools"]


def dchub_smolagents_tools(api_key: Optional[str] = None, **client_kwargs) -> List:
    """Build smolagents Tools for the flagship DC Hub methods."""
    try:
        from smolagents import Tool
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "smolagents support requires smolagents. "
            "Install with: pip install 'dchub[agents]'"
        ) from e

    dc = DCHub(api_key=api_key, **client_kwargs)

    class StatsTool(Tool):
        name = "dchub_stats"
        description = TOOL_RETURNS["stats"]
        inputs = {}
        output_type = "object"

        def forward(self):
            return dc.stats()

    class SearchFacilitiesTool(Tool):
        name = "dchub_search_facilities"
        description = TOOL_RETURNS["search_facilities"]
        inputs = {
            "country": {"type": "string", "description": "Country filter e.g. 'US'.", "nullable": True},
            "provider": {"type": "string", "description": "Provider/operator filter.", "nullable": True},
            "market": {"type": "string", "description": "Market filter.", "nullable": True},
            "limit": {"type": "integer", "description": "Max rows.", "nullable": True},
        }
        output_type = "object"

        def forward(self, country=None, provider=None, market=None, limit=None):
            return dc.search_facilities(country=country, provider=provider, market=market, limit=limit)

    class GetFacilityTool(Tool):
        name = "dchub_get_facility"
        description = TOOL_RETURNS["get_facility"]
        inputs = {"id": {"type": "string", "description": "Facility slug."}}
        output_type = "object"

        def forward(self, id):
            return dc.get_facility(id)

    class MarketDCPITool(Tool):
        name = "dchub_get_market_dcpi_rank"
        description = TOOL_RETURNS["get_market_dcpi_rank"]
        inputs = {"market_slug": {"type": "string", "description": "Market slug e.g. 'phoenix'."}}
        output_type = "object"

        def forward(self, market_slug):
            return dc.get_market_dcpi_rank(market_slug)

    class RankMarketsTool(Tool):
        name = "dchub_rank_markets"
        description = TOOL_RETURNS["rank_markets"]
        inputs = {
            "by": {"type": "string", "description": "composite | power | operators.", "nullable": True}
        }
        output_type = "object"

        def forward(self, by="composite"):
            return dc.rank_markets(by=by)

    class AICapacityTool(Tool):
        name = "dchub_ai_capacity_index"
        description = TOOL_RETURNS["ai_capacity_index"]
        inputs = {
            "horizon": {"type": "integer", "description": "Horizon in days.", "nullable": True}
        }
        output_type = "object"

        def forward(self, horizon=90):
            return dc.ai_capacity_index(horizon=horizon)

    class ChangesTool(Tool):
        name = "dchub_get_changes"
        description = TOOL_RETURNS["get_changes"]
        inputs = {
            "since": {"type": "string", "description": "Window/timestamp e.g. '24h'.", "nullable": True}
        }
        output_type = "object"

        def forward(self, since="24h"):
            return dc.get_changes(since=since)

    class GridIntelTool(Tool):
        name = "dchub_get_grid_intelligence"
        description = TOOL_RETURNS["get_grid_intelligence"]
        inputs = {"iso": {"type": "string", "description": "ISO code e.g. PJM, ERCOT, CAISO."}}
        output_type = "object"

        def forward(self, iso):
            return dc.get_grid_intelligence(iso)

    class TransactionsTool(Tool):
        name = "dchub_list_transactions"
        description = TOOL_RETURNS["list_transactions"]
        inputs = {
            "market": {"type": "string", "description": "Market filter.", "nullable": True},
            "limit": {"type": "integer", "description": "Max rows.", "nullable": True},
        }
        output_type = "object"

        def forward(self, market=None, limit=None):
            return dc.list_transactions(market=market, limit=limit)

    class NewsTool(Tool):
        name = "dchub_get_news"
        description = TOOL_RETURNS["get_news"]
        inputs = {"limit": {"type": "integer", "description": "Max rows.", "nullable": True}}
        output_type = "object"

        def forward(self, limit=None):
            return dc.get_news(limit=limit)

    class PipelineTool(Tool):
        name = "dchub_get_pipeline"
        description = TOOL_RETURNS["get_pipeline"]
        inputs = {
            "market": {"type": "string", "description": "Market filter.", "nullable": True},
            "limit": {"type": "integer", "description": "Max rows.", "nullable": True},
        }
        output_type = "object"

        def forward(self, market=None, limit=None):
            return dc.get_pipeline(market=market, limit=limit)

    return [
        StatsTool(),
        SearchFacilitiesTool(),
        GetFacilityTool(),
        MarketDCPITool(),
        RankMarketsTool(),
        AICapacityTool(),
        ChangesTool(),
        GridIntelTool(),
        TransactionsTool(),
        NewsTool(),
        PipelineTool(),
    ]
