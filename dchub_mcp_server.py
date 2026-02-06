"""
DC Hub MCP Server v3 — Streamable HTTP Transport
Requires: mcp==1.26.0 (already installed)

This replaces the old SSE-based server. Uses stateless Streamable HTTP
which is the recommended production transport as of MCP spec 2025-03-26.

Run standalone: python dchub_mcp_server.py
Runs on port 8888 internally, proxied through Flask on port 5000 at /mcp
"""

import os
import json
import logging
import sqlite3
from datetime import datetime, timezone
from contextvars import ContextVar

import requests as http_requests
from mcp.server.fastmcp import FastMCP

# Context variable to store API key from incoming requests
_current_api_key: ContextVar[str] = ContextVar("current_api_key", default="")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BACKEND_BASE = os.environ.get(
    "BACKEND_BASE_URL",
    "http://127.0.0.1:5000"  # Flask backend on same machine
)

DB_PATH = os.environ.get("DB_PATH", "dchub_data.db")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dchub_mcp")

# ---------------------------------------------------------------------------
# FastMCP Server — Stateless HTTP with JSON responses
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "DC Hub Nexus",
    stateless_http=True,
    json_response=True,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _api_get(path: str, params: dict = None) -> dict:
    """Call the Flask backend API and return JSON, forwarding API key if present."""
    url = f"{BACKEND_BASE}{path}"
    
    # Build headers, forwarding API key if available
    headers = {}
    api_key = _current_api_key.get()
    if api_key:
        headers["X-API-Key"] = api_key
        logger.debug(f"Forwarding API key to backend: {api_key[:16]}...")
    
    try:
        resp = http_requests.get(url, params=params or {}, headers=headers, timeout=15)
        resp.raise_for_status()
        return resp.json()
    except http_requests.RequestException as exc:
        logger.error("API call failed: %s %s — %s", path, params, exc)
        return {"error": f"Backend request failed: {str(exc)}"}


def _track_mcp_request(tool_name: str, params: dict, source: str = "mcp"):
    """Log MCP tool invocations to SQLite for analytics."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mcp_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                tool TEXT,
                params TEXT,
                source TEXT
            )
        """)
        conn.execute(
            "INSERT INTO mcp_requests (timestamp, tool, params, source) VALUES (?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), tool_name, json.dumps(params), source),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning("Failed to track MCP request: %s", exc)


# ---------------------------------------------------------------------------
# MCP Tools
# ---------------------------------------------------------------------------

@mcp.tool(
    name="search_facilities",
    annotations={
        "title": "Search Data Center Facilities",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def search_facilities(
    query: str = "",
    country: str = "",
    state: str = "",
    city: str = "",
    provider: str = "",
    limit: int = 25,
) -> str:
    """Search 50,000+ global data center facilities by location, provider, or keyword.

    Args:
        query: Free-text search (e.g. 'Equinix Dallas' or 'hyperscale')
        country: Filter by country name or ISO code (e.g. 'US', 'Germany')
        state: Filter by state/province (e.g. 'Texas', 'Virginia')
        city: Filter by city (e.g. 'Dallas', 'Frankfurt')
        provider: Filter by operator/provider name (e.g. 'Equinix', 'Digital Realty')
        limit: Max results to return (1-100, default 25)

    Returns:
        JSON with matching facilities including name, location, provider, capacity, and coordinates.
    """
    params = {
        k: v for k, v in {
            "query": query, "country": country, "state": state,
            "city": city, "provider": provider, "limit": min(limit, 100),
        }.items() if v
    }
    _track_mcp_request("search_facilities", params)
    result = _api_get("/api/v1/facilities", params)
    return json.dumps(result, indent=2)


@mcp.tool(
    name="get_facility",
    annotations={
        "title": "Get Facility Details",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def get_facility(facility_id: str) -> str:
    """Get detailed information about a specific data center facility.

    Args:
        facility_id: The unique facility identifier (e.g. 'equinix-da1' or numeric ID)

    Returns:
        JSON with full facility details: name, address, coordinates, provider,
        power capacity (MW), certifications, connectivity, and nearby infrastructure.
    """
    _track_mcp_request("get_facility", {"facility_id": facility_id})
    result = _api_get(f"/api/v1/facilities/{facility_id}")
    return json.dumps(result, indent=2)


@mcp.tool(
    name="list_transactions",
    annotations={
        "title": "List M&A Transactions",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def list_transactions(
    year: int = 0,
    buyer: str = "",
    seller: str = "",
    limit: int = 25,
) -> str:
    """List data center M&A transactions with deal values and details.

    Args:
        year: Filter by transaction year (e.g. 2024, 2025). 0 = all years.
        buyer: Filter by acquiring company name
        seller: Filter by selling company name
        limit: Max results (1-100, default 25)

    Returns:
        JSON array of transactions with buyer, seller, deal value,
        MW capacity, market, and announcement date.
    """
    params = {
        k: v for k, v in {
            "year": year if year else None,
            "buyer": buyer, "seller": seller,
            "limit": min(limit, 100),
        }.items() if v
    }
    _track_mcp_request("list_transactions", params)
    result = _api_get("/api/v1/transactions", params)
    return json.dumps(result, indent=2)


@mcp.tool(
    name="get_market_intel",
    annotations={
        "title": "Get Market Intelligence",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def get_market_intel(
    market: str = "",
    metric: str = "overview",
) -> str:
    """Get data center market intelligence and statistics.

    Args:
        market: Target market (e.g. 'Dallas', 'Northern Virginia', 'Frankfurt').
                Empty = global overview.
        metric: Type of data: 'overview', 'capacity', 'pricing', 'growth', 'power'

    Returns:
        JSON with market statistics including total MW, facility count,
        absorption rates, pricing benchmarks, and growth trends.
    """
    _track_mcp_request("get_market_intel", {"market": market, "metric": metric})
    if market:
        # Specific market details (may require auth)
        result = _api_get(f"/api/v1/markets/{market}")
    else:
        # Global overview - free endpoint
        result = _api_get("/api/v1/markets/list")
    return json.dumps(result, indent=2)


@mcp.tool(
    name="get_news",
    annotations={
        "title": "Get Industry News",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def get_news(
    topic: str = "",
    source: str = "",
    limit: int = 10,
) -> str:
    """Get latest data center industry news aggregated from 40+ sources.

    Args:
        topic: Filter by topic keyword (e.g. 'AI', 'power', 'expansion', 'acquisition')
        source: Filter by news source (e.g. 'DatacenterDynamics', 'BroadGroup')
        limit: Max articles (1-50, default 10)

    Returns:
        JSON array of news articles with title, source, date, summary, and URL.
    """
    params = {
        k: v for k, v in {
            "topic": topic, "source": source, "limit": min(limit, 50),
        }.items() if v
    }
    _track_mcp_request("get_news", params)
    result = _api_get("/api/v1/news", params)
    return json.dumps(result, indent=2)


@mcp.tool(
    name="analyze_site",
    annotations={
        "title": "Analyze Site for Data Center",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def analyze_site(
    latitude: float = 0.0,
    longitude: float = 0.0,
    address: str = "",
    radius_miles: int = 25,
) -> str:
    """Evaluate a location for data center suitability using DC Hub's scoring engine.

    Analyzes power infrastructure, fiber connectivity, flood/seismic risk,
    labor market, tax incentives, and nearby facilities.

    Args:
        latitude: Site latitude (e.g. 32.7767)
        longitude: Site longitude (e.g. -96.7970)
        address: Street address (alternative to lat/lng)
        radius_miles: Analysis radius in miles (default 25)

    Returns:
        JSON with composite site score (0-100), component scores for power,
        connectivity, risk, and workforce, plus nearby facilities and infrastructure.
    """
    params = {
        k: v for k, v in {
            "lat": latitude if latitude else None,
            "lng": longitude if longitude else None,
            "address": address,
            "radius": radius_miles * 1609,  # Convert miles to meters
        }.items() if v
    }
    _track_mcp_request("analyze_site", params)
    result = _api_get("/api/v1/energy/site-analysis", params)
    return json.dumps(result, indent=2)


# ---------------------------------------------------------------------------
# ASGI Middleware to capture API key from incoming requests
# ---------------------------------------------------------------------------

class APIKeyMiddleware:
    """ASGI middleware that captures X-API-Key header and sets context variable."""
    
    def __init__(self, app):
        self.app = app
    
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            # Extract X-API-Key from request headers
            headers = dict(scope.get("headers", []))
            api_key = headers.get(b"x-api-key", b"").decode("utf-8")
            
            # Also check for api_key query param
            if not api_key:
                query_string = scope.get("query_string", b"").decode("utf-8")
                for param in query_string.split("&"):
                    if param.startswith("api_key="):
                        api_key = param.split("=", 1)[1]
                        break
            
            # Set the context variable for this request
            token = _current_api_key.set(api_key)
            try:
                await self.app(scope, receive, send)
            finally:
                _current_api_key.reset(token)
        else:
            await self.app(scope, receive, send)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import uvicorn
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8888)
    args = parser.parse_args()
    
    logger.info(f"Starting DC Hub MCP server (streamable-http) on port {args.port}...")
    logger.info(f"  Endpoint: http://0.0.0.0:{args.port}/mcp")
    logger.info(f"  API backend: http://127.0.0.1:5000")
    logger.info(f"  Tools: {len(mcp._tool_manager._tools)} | Resources: 2 | Prompts: 2")
    logger.info(f"  API key forwarding: ENABLED")
    
    # Get the ASGI app from FastMCP and wrap with API key middleware
    base_app = mcp.streamable_http_app()
    app = APIKeyMiddleware(base_app)
    uvicorn.run(app, host="0.0.0.0", port=args.port)
