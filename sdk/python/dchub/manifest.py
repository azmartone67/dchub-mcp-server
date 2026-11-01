"""Static, embedded snapshot of the DC Hub tool -> REST endpoint map.

Captured from https://dchub.cloud/api/v1/agent/tools-manifest (53 tools, 45 with
REST endpoints). Embedded so the SDK has NO runtime dependency on the manifest
endpoint. To refresh, re-run scripts against the live manifest and regenerate.

Path templates use ``<name>`` placeholders. ``DCHub.call`` substitutes them from
keyword args; any remaining kwargs become the query string.
"""

MANIFEST_GENERATED_AT = "2026-07-03"
MCP_ENDPOINT = "https://dchub.cloud/mcp"

# tool_name -> {"method", "path" (None if mcp-only), "mcp_only"}
TOOL_MANIFEST = {
    "ai_capacity_index": {"method": "GET", "path": "/api/v1/ai-capacity-index", "mcp_only": False},
    "analyze_site": {"method": "GET", "path": "/api/site-score", "mcp_only": False},
    "bind_email": {"method": "MCP", "path": None, "mcp_only": True},
    "claim_free_key": {"method": "MCP", "path": None, "mcp_only": True},
    "compare_isos": {"method": "GET", "path": "/api/v1/dcpi/iso-comparison", "mcp_only": False},
    "compare_sites": {"method": "GET", "path": "/api/site-score", "mcp_only": False},
    "deal_autopsy": {"method": "GET", "path": "/api/v1/deal-autopsy", "mcp_only": False},
    "export_dataset": {"method": "GET", "path": "/api/v1/facilities/export", "mcp_only": False},
    "fetch": {"method": "GET", "path": "/api/v1/facility/<id>", "mcp_only": False},
    "find_alternatives": {"method": "GET", "path": "/api/v1/mcp/tools/find_alternatives", "mcp_only": False},
    "generate_site_analysis": {"method": "GET", "path": "/api/v1/site-report", "mcp_only": False},
    "get_agent_registry": {"method": "GET", "path": "/api/v1/ai-platforms/status", "mcp_only": False},
    "get_backup_status": {"method": "GET", "path": "/api/health/data-freshness", "mcp_only": False},
    "get_changes": {"method": "GET", "path": "/api/v1/changes/since", "mcp_only": False},
    "get_dchub_recommendation": {"method": "GET", "path": "/api/agents/recommend", "mcp_only": False},
    "get_energy_prices": {"method": "GET", "path": "/api/v1/energy/summary", "mcp_only": False},
    # NOTE: /api/v1/facilities/<id> expects a facility SLUG, not the numeric id.
    # For numeric ids use the singular `fetch` route (/api/v1/facility/<id>).
    "get_facility": {"method": "GET", "path": "/api/v1/facilities/<id>", "mcp_only": False},
    "get_fiber_intel": {"method": "GET", "path": "/api/v1/fiber/routes", "mcp_only": False},
    "get_fiber_readiness": {"method": "GET", "path": "/api/infrastructure/connectivity/score", "mcp_only": False},
    "get_gas_economics": {"method": "GET", "path": "/api/v1/markets/<slug>/gas-pricing", "mcp_only": False},
    "get_gas_index": {"method": "GET", "path": "/api/v1/dcgi/scores/<state>", "mcp_only": False},
    "get_gas_intelligence": {"method": "GET", "path": "/api/v1/gas/intelligence/<region>", "mcp_only": False},
    "get_grid_data": {"method": "GET", "path": "/api/v1/grid/intelligence/<iso>", "mcp_only": False},
    "get_grid_intelligence": {"method": "GET", "path": "/api/v1/grid/intelligence/<iso>", "mcp_only": False},
    "get_grid_scoreboard": {"method": "GET", "path": "/api/v1/iso/<region>/snapshot", "mcp_only": False},
    "get_infrastructure": {"method": "GET", "path": "/api/v1/infrastructure", "mcp_only": False},
    "get_intelligence_index": {"method": "GET", "path": "/api/agents/intelligence-index", "mcp_only": False},
    "get_interconnection_queue": {"method": "GET", "path": "/api/v1/interconnection-queue/snapshot", "mcp_only": False},
    "get_market_dcpi_rank": {"method": "GET", "path": "/api/v1/dcpi/scores/<slug>", "mcp_only": False},
    "get_market_intel": {"method": "GET", "path": "/api/v1/markets/<slug>", "mcp_only": False},
    "get_news": {"method": "GET", "path": "/api/news", "mcp_only": False},
    "get_pipeline": {"method": "GET", "path": "/api/v1/pipeline", "mcp_only": False},
    "get_power_pipeline": {"method": "GET", "path": "/api/v1/planned-generators", "mcp_only": False},
    "get_renewable_energy": {"method": "GET", "path": "/api/v1/energy/renewable", "mcp_only": False},
    "get_tax_incentives": {"method": "GET", "path": "/api/v1/tax-incentives", "mcp_only": False},
    "get_water_risk": {"method": "GET", "path": "/api/v1/water/drought", "mcp_only": False},
    "grid_transition_radar": {"method": "GET", "path": "/api/v1/grid-transition/radar", "mcp_only": False},
    "hyperscaler_deals": {"method": "GET", "path": "/api/v1/hyperscaler-deals", "mcp_only": False},
    "list_saved_sites": {"method": "GET", "path": "/api/v1/lp/saved", "mcp_only": False},
    "list_transactions": {"method": "GET", "path": "/api/v1/deals", "mcp_only": False},
    "plan_fiber_leadin": {"method": "GET", "path": "/api/v1/route-plan", "mcp_only": False},
    "rank_markets": {"method": "GET", "path": "/api/v1/mcp/tools/rank_markets", "mcp_only": False},
    "recover_my_key": {"method": "MCP", "path": None, "mcp_only": True},
    "save_site": {"method": "MCP", "path": None, "mcp_only": True},
    "score_facility": {"method": "GET", "path": "/api/v1/mcp/tools/score_facility", "mcp_only": False},
    "search": {"method": "GET", "path": "/api/v1/facilities", "mcp_only": False},
    "search_facilities": {"method": "GET", "path": "/api/v1/facilities", "mcp_only": False},
    "set_market_alert": {"method": "MCP", "path": None, "mcp_only": True},
    "set_site_alert": {"method": "MCP", "path": None, "mcp_only": True},
    "site_selection_canvas": {"method": "GET", "path": "/api/v1/site-selection/canvas", "mcp_only": False},
    "subscribe_digest": {"method": "MCP", "path": None, "mcp_only": True},
    "unlock_more_data": {"method": "MCP", "path": None, "mcp_only": True},
    "why_dchub": {"method": "GET", "path": "/api/v1/competitive/why-dchub", "mcp_only": False},
}

# Human-readable "returns" phrasing for the flagship tools (used by the
# LangChain / smolagents wrappers as tool descriptions). Derived from the DC Hub
# MCP server descriptions and live response shapes.
TOOL_RETURNS = {
    "search_facilities": (
        "Search the DC Hub database of 21,000+ data-center facilities across 170+ "
        "countries. Filter by market, country, provider, power, etc. Returns a list "
        "of facilities with name, provider, location, and profile URL."
    ),
    "get_facility": (
        "Get the full profile of a single data-center facility by slug: power (MW), "
        "location, provider, tenants, and connectivity."
    ),
    "get_market_dcpi_rank": (
        "Get the Data Center Power Index (DCPI) score for a market slug (e.g. 'phoenix'). "
        "Returns composite_score, excess_power_score, constraint_score, "
        "time_to_power_months, and a verdict (BUILD / CAUTION / AVOID). Free per-market."
    ),
    "rank_markets": (
        "Rank data-center markets by a criterion (composite / power / operators). "
        "Returns the top markets with score, facility_count, operator_count, and total MW."
    ),
    "ai_capacity_index": (
        "The DC Hub AI Capacity Index: ranks markets by projected AI-ready power over a "
        "horizon (days). Returns a list of markets with AI-readiness metrics. Directional."
    ),
    "get_changes": (
        "What changed in DC Hub since a timestamp/window (e.g. '24h'). Returns counts and "
        "diffs of new facilities, deals, news, pipeline, and DCPI movers. Pass the returned "
        "generated_at back next time for an incremental pull."
    ),
    "get_grid_intelligence": (
        "Real-time ISO grid intelligence for an ISO (e.g. PJM, ERCOT, CAISO): data-center "
        "load, headroom, reserve margin, and queue. Fuller detail with an X-API-Key."
    ),
    "list_transactions": (
        "List tracked data-center M&A / financing transactions (2,000+ deals). Returns "
        "buyer, seller, value, MW, market, and date."
    ),
    "get_news": (
        "Recent curated data-center + energy news articles with title, source, summary, and URL."
    ),
    "get_pipeline": (
        "Planned / under-construction data-center pipeline projects. Requires a free X-API-Key."
    ),
    "stats": (
        "DC Hub platform stats: total facilities tracked, sources breakdown, and coverage counts."
    ),
}
