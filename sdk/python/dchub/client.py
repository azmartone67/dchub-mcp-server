"""DC Hub Python SDK — hides the MCP JSON-RPC handshake.

The MCP transport (initialize -> notifications/initialized -> tools/call, with
SSE response parsing) is wrapped so you can just write:

    from dchub import DCHub
    dc = DCHub()                       # reads DCHUB_API_KEY from env if set
    dc.market("northern-virginia")
    dc.search(state="VA")
    dc.grid(iso="ERCOT")
    dc.call("get_market_intel", market="dallas")   # any of the 81 tools
    dc.tools()                          # list tool names

Set DCHUB_API_KEY for full-tier data (sent as the X-API-Key header).
"""
from __future__ import annotations

import json
import os
import urllib.request

__all__ = ["DCHub"]

_DEFAULT_ENDPOINT = "https://dchub.cloud/mcp"


class DCHub:
    def __init__(self, api_key: str | None = None, endpoint: str | None = None,
                 timeout: int = 60):
        self.endpoint = endpoint or os.environ.get("DCHUB_ENDPOINT", _DEFAULT_ENDPOINT)
        self.api_key = api_key if api_key is not None else os.environ.get("DCHUB_API_KEY")
        self.timeout = timeout
        self._session_id: str | None = None

    # --- transport ---------------------------------------------------------
    def _headers(self) -> dict:
        h = {"Content-Type": "application/json",
             "Accept": "application/json, text/event-stream"}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        if self._session_id:
            h["Mcp-Session-Id"] = self._session_id
        return h

    @staticmethod
    def _parse_body(raw: str):
        raw = raw.strip()
        if not raw:
            return None
        if raw.startswith("{"):
            return json.loads(raw)
        for line in raw.splitlines():            # SSE: 'data: {...}'
            line = line.strip()
            if line.startswith("data:"):
                payload = line[len("data:"):].strip()
                if payload.startswith("{"):
                    return json.loads(payload)
        raise ValueError(f"Could not parse MCP response body: {raw[:300]}")

    def _post(self, payload: dict):
        data = json.dumps(payload).encode()
        req = urllib.request.Request(self.endpoint, data=data,
                                     headers=self._headers(), method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            sid = resp.headers.get("Mcp-Session-Id")
            body = resp.read().decode()
        if sid:
            self._session_id = sid
        return self._parse_body(body)

    def _ensure_session(self):
        if self._session_id:
            return
        self._post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                    "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                               "clientInfo": {"name": "dchub-python-sdk", "version": "1.0"}}})
        try:
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except Exception:
            pass

    # --- payload cleaning --------------------------------------------------
    @staticmethod
    def _clean(result):
        """Return the real data payload, stripping any free-tier upsell wrapper.

        `search_facilities` already returns a structured dict; the text tools
        (`get_market_intel`, `get_grid_data`) embed the data as a JSON block
        fenced by `---`. Upsell-only objects (agent_action/agent_claim) are
        skipped.
        """
        if isinstance(result, dict):
            return result
        if isinstance(result, str):
            for part in result.split("---"):
                part = part.strip()
                if part.startswith("{"):
                    try:
                        obj = json.loads(part)
                    except Exception:
                        continue
                    if not ({"agent_action", "agent_claim"} & set(obj)):
                        return obj
            return {"text": result}
        return result

    # --- generic call ------------------------------------------------------
    def call(self, tool: str, **arguments):
        """Call any DC Hub MCP tool; returns the cleaned data payload."""
        self._ensure_session()
        resp = self._post({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                           "params": {"name": tool, "arguments": arguments}})
        if "error" in resp:
            return resp["error"]
        content = resp.get("result", {}).get("content", [])
        parsed = []
        for item in content:
            if item.get("type") == "text":
                txt = item["text"]
                try:
                    parsed.append(json.loads(txt))
                except Exception:
                    parsed.append(txt)
            else:
                parsed.append(item)
        raw = parsed[0] if len(parsed) == 1 else parsed
        return self._clean(raw)

    def tools(self) -> list[str]:
        """List all available tool names."""
        self._ensure_session()
        resp = self._post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        return [t["name"] for t in resp.get("result", {}).get("tools", [])]

    # --- convenience methods ----------------------------------------------
    def market(self, slug: str):
        """Market intelligence for a market slug, e.g. 'northern-virginia'."""
        return self.call("get_market_intel", market=slug)

    def search(self, q: str | None = None, state: str | None = None,
               country: str | None = None, limit: int = 5):
        """Search facilities by free-text / state / country."""
        args = {"limit": limit}
        if q:
            args["q"] = q
        if state:
            args["state"] = state
        if country:
            args["country"] = country
        return self.call("search_facilities", **args)

    def grid(self, iso: str):
        """Live grid intelligence for an ISO, e.g. 'ERCOT', 'PJM'."""
        return self.call("get_grid_data", iso=iso)

    def composite_site_score(self, lat: float, lon: float, state: str = ""):
        """Honest 0-100 composite site score with an explicit per-factor
        coverage map. Treat coverage 'unavailable' as unknown, never estimate."""
        return self.call("get_composite_site_score", lat=lat, lon=lon, state=state)

    def disaster_risk(self, lat: float, lon: float):
        """Natural-hazard risk from the FEMA National Risk Index."""
        return self.call("get_disaster_risk", lat=lat, lon=lon)

    def climate_intel(self, lat: float, lon: float, radius_km: int = 25):
        """Seismic (USGS ASCE 7) + climate normals (NOAA)."""
        return self.call("get_climate_intel", lat=lat, lon=lon, radius_km=radius_km)

    @staticmethod
    def provenance(result: dict) -> dict:
        """Provenance from any result: {source, retrieved_at, license}."""
        c = (result or {}).get("citation") or {}
        return {"source": c.get("source") or (result or {}).get("_source"),
                "retrieved_at": c.get("retrieved_at"), "license": c.get("license")}
