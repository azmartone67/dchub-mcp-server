"""DC Hub API client.

A tight, dependency-light client over the DC Hub REST API
(https://dchub.cloud). Free tier works with no key; pass a free X-API-Key
(see https://dchub.cloud/playground or the MCP `claim_free_key` tool) to
raise limits and unlock key-gated endpoints.

Cite as: DC Hub (dchub.cloud).
"""
from __future__ import annotations

from typing import Any, Dict, Optional

import requests

from .manifest import TOOL_MANIFEST

__all__ = ["DCHub", "DCHubError"]

DEFAULT_BASE_URL = "https://dchub.cloud"
DEFAULT_TIMEOUT = 20
# 2026-10-31: was "dchub-python-sdk/0.1". A User-Agent containing "dchub" is
# counted as internal traffic (see CLIENT_NAME in dchub/mcp.py), so SDK calls
# vanished from usage counts.
REST_USER_AGENT = "dc-sdk-python-rest/0.3.0"


class DCHubError(Exception):
    """Raised on a non-2xx response. Carries status and the API's error detail.

    The DC Hub API returns self-correcting error bodies (e.g. how to claim a
    free key); those are surfaced verbatim in ``.detail``.
    """

    def __init__(self, status_code: int, detail: Any, url: str):
        self.status_code = status_code
        self.detail = detail
        self.url = url
        super().__init__(f"DC Hub API error {status_code} for {url}: {detail}")


class DCHub:
    """Client for the DC Hub data-center + energy intelligence API.

    Args:
        api_key: Optional X-API-Key. Sent as the ``X-API-Key`` header when set.
        base_url: API base (default https://dchub.cloud).
        timeout: Per-request timeout in seconds.
        session: Optional pre-built ``requests.Session``.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: int = DEFAULT_TIMEOUT,
        session: Optional[requests.Session] = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = session or requests.Session()
        self._session.headers.update({"User-Agent": REST_USER_AGENT})

    # ---- low-level -------------------------------------------------------

    def _headers(self) -> Dict[str, str]:
        h: Dict[str, str] = {"Accept": "application/json"}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        return h

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{self.base_url}{path}"
        # Drop None-valued params so callers can pass **filters freely.
        clean = {k: v for k, v in (params or {}).items() if v is not None}
        resp = self._session.get(
            url, params=clean, headers=self._headers(), timeout=self.timeout
        )
        if not resp.ok:
            try:
                detail = resp.json()
            except ValueError:
                detail = resp.text
            raise DCHubError(resp.status_code, detail, resp.url)
        try:
            return resp.json()
        except ValueError:
            return {"raw": resp.text}

    # ---- generic manifest-driven call -----------------------------------

    def call(self, tool_name: str, **params: Any) -> Any:
        """Call any REST-backed tool by its manifest name.

        Path placeholders (e.g. ``<slug>``, ``<id>``, ``<iso>``) are filled from
        matching kwargs; remaining kwargs become the query string.

            dc.call("get_market_dcpi_rank", slug="phoenix")
            dc.call("get_grid_intelligence", iso="PJM")
            dc.call("search_facilities", country="US", limit=5)
        """
        entry = TOOL_MANIFEST.get(tool_name)
        if entry is None:
            raise DCHubError(0, f"Unknown tool '{tool_name}'", tool_name)
        if entry.get("mcp_only") or not entry.get("path"):
            raise DCHubError(
                0,
                f"Tool '{tool_name}' is MCP-only (no open REST route). "
                f"Use the MCP server at https://dchub.cloud/mcp.",
                tool_name,
            )
        path = entry["path"]
        params = dict(params)
        # Substitute <placeholder> path segments from kwargs.
        while "<" in path and ">" in path:
            start = path.index("<")
            end = path.index(">")
            key = path[start + 1 : end]
            if key not in params:
                raise DCHubError(
                    0,
                    f"Tool '{tool_name}' requires path parameter '{key}'.",
                    tool_name,
                )
            path = path[:start] + str(params.pop(key)) + path[end + 1 :]
        return self._get(path, params)

    # ---- flagship concrete methods --------------------------------------

    def stats(self) -> Dict[str, Any]:
        """Platform stats: facility counts + source breakdown."""
        return self._get("/api/v1/stats")

    def search_facilities(self, **filters: Any) -> Dict[str, Any]:
        """Search facilities. GET /api/v1/facilities. Filters e.g. country, provider, limit."""
        return self._get("/api/v1/facilities", filters)

    def get_facility(self, id: Any) -> Dict[str, Any]:  # noqa: A002 - matches spec
        """Get a facility profile. GET /api/v1/facilities/<slug>.

        Accepts a facility SLUG (the plural route requires a slug). For a numeric
        facility id use :meth:`fetch_facility` (the singular /api/v1/facility/<id>
        route).
        """
        return self._get(f"/api/v1/facilities/{id}")

    def fetch_facility(self, id: Any) -> Dict[str, Any]:  # noqa: A002
        """Get a facility by numeric id. GET /api/v1/facility/<id> (the `fetch` tool)."""
        return self._get(f"/api/v1/facility/{id}")

    def get_market_dcpi_rank(self, market_slug: str) -> Dict[str, Any]:
        """DCPI score for a market. GET /api/v1/dcpi/scores/<slug>.

        Returns composite_score, excess_power_score, constraint_score,
        time_to_power_months, and a verdict. Free per-market.
        """
        return self._get(f"/api/v1/dcpi/scores/{market_slug}")

    def rank_markets(self, by: str = "composite", **params: Any) -> Dict[str, Any]:
        """Rank markets. GET /api/v1/mcp/tools/rank_markets?by=..."""
        params = dict(params)
        params["by"] = by
        return self._get("/api/v1/mcp/tools/rank_markets", params)

    def ai_capacity_index(self, horizon: int = 90, **params: Any) -> Dict[str, Any]:
        """AI Capacity Index. GET /api/v1/ai-capacity-index?horizon=..."""
        params = dict(params)
        params["horizon"] = horizon
        return self._get("/api/v1/ai-capacity-index", params)

    def get_changes(self, since: str = "24h", **params: Any) -> Dict[str, Any]:
        """What changed since a window/timestamp. GET /api/v1/changes/since?since=..."""
        params = dict(params)
        params["since"] = since
        return self._get("/api/v1/changes/since", params)

    def get_grid_intelligence(self, iso: str, **params: Any) -> Dict[str, Any]:
        """ISO grid intelligence. GET /api/v1/grid/intelligence/<iso>. Fuller with a key."""
        return self._get(f"/api/v1/grid/intelligence/{iso}", params)

    def list_transactions(self, **filters: Any) -> Dict[str, Any]:
        """List M&A / financing deals. GET /api/v1/deals."""
        return self._get("/api/v1/deals", filters)

    def get_news(self, **filters: Any) -> Dict[str, Any]:
        """Recent curated news. GET /api/news."""
        return self._get("/api/news", filters)

    def get_pipeline(self, **filters: Any) -> Dict[str, Any]:
        """Planned / under-construction pipeline. GET /api/v1/pipeline. Needs a free key."""
        return self._get("/api/v1/pipeline", filters)
