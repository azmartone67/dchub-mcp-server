"""DC Hub MCP client (dchub.mcp) — hides the MCP JSON-RPC handshake.

The MCP transport (initialize -> notifications/initialized -> tools/call, with
SSE response parsing) is wrapped so you can just write:

    from dchub.mcp import DCHub       # also exported as dchub.DCHubMCP
    dc = DCHub()                       # reads DCHUB_API_KEY from env if set
    dc.market("northern-virginia")
    dc.search(state="VA")
    dc.grid(iso="ERCOT")
    dc.call("get_market_intel", market="dallas")   # any of the 94 tools
    dc.tools()                          # list tool names

Set DCHUB_API_KEY for full-tier data (sent as the X-API-Key header).
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

__all__ = ["DCHub", "check_via", "CLIENT_NAME"]

_DEFAULT_ENDPOINT = "https://dchub.cloud/mcp"
SDK_VERSION = "0.3.0"  # = pyproject.toml and dchub.__version__

# 2026-10-31: the client name was "dchub-python-sdk". server.mjs _INTERNAL_SELF_TAG
# (and the backend's normalize_write_platform) rewrite any name containing "dchub",
# "test", "check"... to platform 'dchub-internal', so every SDK call was excluded
# from usage counts. Neither the name nor the User-Agent may contain those words.
CLIENT_NAME = "dc-sdk-python"
_USER_AGENT = f"{CLIENT_NAME}/{SDK_VERSION}"

# Partner attribution (https://dchub.cloud/mcp/builders): sent as X-DCHub-Via.
VIA_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,39}$")


def check_via(via):
    if via in (None, ""):
        return None
    if not isinstance(via, str) or not VIA_RE.match(via):
        raise ValueError(f"via must match {VIA_RE.pattern} (lowercase letters, digits, . _ -; max 40), got {via!r}")
    return via


class DCHub:
    def __init__(self, api_key: str | None = None, endpoint: str | None = None,
                 timeout: int = 60, via: str | None = None):
        self.endpoint = endpoint or os.environ.get("DCHUB_ENDPOINT", _DEFAULT_ENDPOINT)
        self.api_key = api_key if api_key is not None else os.environ.get("DCHUB_API_KEY")
        self.via = check_via(via if via is not None else os.environ.get("DCHUB_VIA"))
        self.timeout = timeout
        self._session_id: str | None = None

    # --- transport ---------------------------------------------------------
    def _headers(self) -> dict:
        h = {"Content-Type": "application/json",
             "Accept": "application/json, text/event-stream",
             "User-Agent": _USER_AGENT}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        if self.via:
            h["X-DCHub-Via"] = self.via
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
                               "clientInfo": {"name": CLIENT_NAME, "version": SDK_VERSION}}})
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

    def call_raw(self, tool: str, arguments: dict | None = None) -> dict:
        """Call a tool and return the MCP result unchanged ({content, isError, ...})."""
        self._ensure_session()
        resp = self._post({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                           "params": {"name": tool, "arguments": arguments or {}}})
        if "error" in resp:
            e = resp["error"]
            return {"content": [{"type": "text", "text": f"DC Hub error {e.get('code')}: {e.get('message')}"}],
                    "isError": True}
        return resp.get("result", {})

    def list_tools(self) -> list[dict]:
        """Full tool definitions from tools/list."""
        self._ensure_session()
        resp = self._post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        return resp.get("result", {}).get("tools", [])

    def tools(self) -> list[str]:
        """List all available tool names."""
        return [t["name"] for t in self.list_tools()]

    # --- convenience methods ----------------------------------------------
    def market(self, slug: str):
        """Market intelligence for a market slug, e.g. 'northern-virginia'."""
        return self.call("get_market_intel", market=slug)

    def search(self, q: str | None = None, state: str | None = None,
               country: str | None = None, limit: int = 5, query: str | None = None):
        """Search facilities by free-text / state / country.

        `q` is the short name; the tool's declared argument is `query`. Sending `q`
        through was an undeclared argument, dropped before the handler, so the
        search came back unfiltered (the Node SDK was fixed the same way)."""
        args = {"limit": limit}
        text = query if query is not None else q
        if text:
            args["query"] = text
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
