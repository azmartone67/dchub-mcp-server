"""Compose DC Hub into your own MCP server (Python).

    from dchub.compose import dchub_tool_definitions

    for t in dchub_tool_definitions(via="acme-energy"):   # 5 starter tools
        t["name"], t["description"], t["inputSchema"]     # register these on your server
        t["call"]({"iso": "PJM"})                          # -> the MCP result, unchanged

Descriptions are prefixed "From DC Hub (dchub.cloud):" and results pass through
unchanged (cite_as, as_of and human_url stay intact). `via` names your server in
DC Hub's per-partner counts (https://dchub.cloud/mcp/builders). Wire the
definitions into the low-level `mcp.server.lowlevel.Server` list_tools / call_tool
handlers; see sdk/COMPOSE.md.
"""
from __future__ import annotations

from .client import DCHub, check_via

__all__ = ["dchub_tool_definitions", "STARTER_TOOLS", "DESCRIPTION_PREFIX"]

STARTER_TOOLS = ("execute_plan", "search_facilities", "get_market_intel", "get_grid_data", "source_capacity")
DESCRIPTION_PREFIX = "From DC Hub (dchub.cloud): "


def dchub_tool_definitions(via: str | None = None, api_key: str | None = None,
                           endpoint: str | None = None, tools=STARTER_TOOLS,
                           client: DCHub | None = None) -> list[dict]:
    """Plain definitions: [{name, description, inputSchema, annotations, call(args)}].

    tools="all" returns every DC Hub tool; a name DC Hub does not serve raises ValueError.
    """
    dc = client or DCHub(api_key=api_key, endpoint=endpoint, via=check_via(via))
    listed = dc.list_tools()
    by_name = {t["name"]: t for t in listed}
    wanted = None if tools == "all" else list(tools)
    if wanted is not None:
        missing = [n for n in wanted if n not in by_name]
        if missing:
            raise ValueError(f"DC Hub does not serve: {', '.join(missing)}")
    out = []
    for t in listed:
        if wanted is not None and t["name"] not in wanted:
            continue
        name = t["name"]
        out.append({
            "name": name,
            "description": DESCRIPTION_PREFIX + (t.get("description") or ""),
            "inputSchema": t.get("inputSchema") or {"type": "object", "properties": {}},
            "annotations": t.get("annotations"),
            "call": (lambda args=None, _n=name: dc.call_raw(_n, args or {})),
        })
    return out
