"""Build the public Postman collection for DC Hub (REST API + MCP endpoint).

    python3 build_collection.py            # reads https://dchub.cloud/openapi.json
    python3 build_collection.py spec.json  # or a local copy

Writes dchub.postman_collection.json next to this file (Postman Collection v2.1).
Write endpoints that register a deal or click a tracked link are left out, so
running the whole collection has no side effects beyond minting a free key.
"""
import json
import os
import sys
import urllib.request

SPEC_URL = "https://dchub.cloud/openapi.json"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dchub.postman_collection.json")
SKIP = {
    ("post", "/api/v1/listings/{slug_or_id}/intro"),
    ("post", "/api/v1/listings/terms/accept"),
    ("get", "/go/l/{slug}"),
}
# Example values for parameters and bodies the spec leaves without one, so each
# request runs as imported. Real ids as of 2026-11-09.
FALLBACK_PARAMS = {
    "facility_id": "8484",
    "slug_or_id": "phoenix-2-mw-colocation-available-now",
    "market_slug": "northern-virginia",
    "markets": "dallas,phoenix",
    "lat": "33.45",
    "lon": "-112.07",
    "state": "TX",
}
FALLBACK_BODIES = {
    "/api/v1/keys/claim": {"client_name": "postman/<your-workspace>"},
    "/api/v1/analyze-parcel": {"geometry": {"type": "Polygon", "coordinates": [[
        [-112.08, 33.44], [-112.06, 33.44], [-112.06, 33.46], [-112.08, 33.46], [-112.08, 33.44]]]},
        "capacity_mw": 50},
    "/api/v1/rank-sites": {"candidates": [
        {"id": "a", "lat": 33.45, "lng": -112.07, "power_mw": 120, "fiber_km": 2.1},
        {"id": "b", "lat": 32.78, "lng": -96.80, "power_mw": 80, "fiber_km": 0.8}],
        "objectives": {"power_mw": 1, "fiber_km": -0.5}},
}
MCP_HEADERS = [
    {"key": "Content-Type", "value": "application/json"},
    {"key": "Accept", "value": "application/json, text/event-stream"},
]


def load_spec(arg):
    if arg:
        with open(arg) as f:
            return json.load(f)
    # Cloudflare refuses the default Python-urllib user agent.
    req = urllib.request.Request(SPEC_URL, headers={"User-Agent": "postman-collection-builder/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def example(param):
    if param.get("name") in FALLBACK_PARAMS and not any(
            k in src for src in (param, param.get("schema", {})) for k in ("example", "examples", "default")):
        return FALLBACK_PARAMS[param["name"]]
    for src in (param, param.get("schema", {})):
        if "example" in src:
            return str(src["example"])
        if src.get("examples"):
            ex = src["examples"]
            first = ex[0] if isinstance(ex, list) else next(iter(ex.values())).get("value")
            return str(first)
        if "default" in src:
            return str(src["default"])
    return ""


def body_example(path, op):
    media = op.get("requestBody", {}).get("content", {}).get("application/json", {})
    if "example" in media:
        return media["example"]
    if media.get("examples"):
        return next(iter(media["examples"].values())).get("value", {})
    return FALLBACK_BODIES.get(path, {})


def rest_item(path, method, op):
    params = op.get("parameters", [])
    raw_path = path
    variables = []
    for p in params:
        if p.get("in") == "path":
            raw_path = raw_path.replace("{%s}" % p["name"], ":%s" % p["name"])
            variables.append({"key": p["name"], "value": example(p), "description": p.get("description", "")})
    query = [
        {"key": p["name"], "value": example(p), "description": p.get("description", ""),
         "disabled": not p.get("required", False)}
        for p in params if p.get("in") == "query"
    ]
    segments = [s for s in raw_path.split("/") if s]
    request = {
        "method": method.upper(),
        "header": [],
        "url": {
            "raw": "{{baseUrl}}" + raw_path + ("?" + "&".join(f"{q['key']}={q['value']}" for q in query if not q["disabled"]) if any(not q["disabled"] for q in query) else ""),
            "host": ["{{baseUrl}}"],
            "path": segments,
            "query": query,
            "variable": variables,
        },
        "description": (op.get("description") or op.get("summary") or "").strip(),
    }
    if "requestBody" in op:
        request["header"].append({"key": "Content-Type", "value": "application/json"})
        request["body"] = {"mode": "raw", "raw": json.dumps(body_example(path, op), indent=2),
                           "options": {"raw": {"language": "json"}}}
    return {"name": op.get("summary") or f"{method.upper()} {path}", "request": request}


def mcp_item(name, payload, description):
    return {
        "name": name,
        "request": {
            "method": "POST",
            "header": MCP_HEADERS,
            "url": {"raw": "{{baseUrl}}/mcp", "host": ["{{baseUrl}}"], "path": ["mcp"]},
            "body": {"mode": "raw", "raw": json.dumps(payload, indent=2), "options": {"raw": {"language": "json"}}},
            "description": description,
        },
    }


def build(spec):
    folders = {}
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            if method not in ("get", "post", "put", "patch", "delete") or (method, path) in SKIP:
                continue
            tag = (op.get("tags") or ["API"])[0]
            folders.setdefault(tag, []).append(rest_item(path, method, op))
    mcp = [
        mcp_item("initialize", {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "postman", "version": "1.0"}}},
            "Opens an MCP session. Optional for a single call: tools/list and tools/call also answer without it."),
        mcp_item("tools/list", {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
                 "Every tool with its input schema. /mcp serves the full catalog; /mcp/core serves 10."),
        mcp_item("tools/call: execute_plan", {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "execute_plan", "arguments": {"intent": "rank markets for a 200 MW AI campus"}}},
            "A multi-topic question answered in one call."),
        mcp_item("tools/call: get_grid_data", {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
            "name": "get_grid_data", "arguments": {"iso": "ERCOT"}}},
            "Live demand and fuel mix for one grid."),
        mcp_item("tools/call: source_capacity", {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {
            "name": "source_capacity", "arguments": {"min_mw": 10, "region": "north_america"}}},
            "Data-center capacity listed for sale or lease."),
    ]
    info = spec.get("info", {})
    return {
        "info": {
            "name": "DC Hub API and MCP",
            "description": (
                "Live, dated data on data centers and their power: facilities, markets (DCPI), grids, "
                "interconnection queues, energy prices, fiber, site risk and capacity for lease.\n\n"
                "No key is needed to start: anonymous calls return previews. Set the `apiKey` collection "
                "variable (sent as X-API-Key) for more; mint a free one with 'Mint a free DC Hub API key' "
                "or at https://dchub.cloud/connect. Cite figures as 'DC Hub (dchub.cloud), as of <date>'.\n\n"
                f"Generated from {SPEC_URL} (API version {info.get('version', '?')}) by "
                "integrations/postman/build_collection.py in github.com/azmartone67/dchub-mcp-server."
            ),
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "auth": {"type": "apikey", "apikey": [
            {"key": "key", "value": "X-API-Key", "type": "string"},
            {"key": "value", "value": "{{apiKey}}", "type": "string"},
            {"key": "in", "value": "header", "type": "string"},
        ]},
        "variable": [
            {"key": "baseUrl", "value": "https://dchub.cloud"},
            {"key": "apiKey", "value": "", "description": "Optional. Leave empty for free previews."},
        ],
        "item": [{"name": "MCP (Streamable HTTP)", "item": mcp}]
                + [{"name": f"REST: {tag}", "item": items} for tag, items in folders.items()],
    }


if __name__ == "__main__":
    collection = build(load_spec(sys.argv[1] if len(sys.argv) > 1 else None))
    with open(OUT, "w") as f:
        json.dump(collection, f, indent=2)
        f.write("\n")
    n = sum(len(folder["item"]) for folder in collection["item"])
    print(f"wrote {OUT}: {n} requests in {len(collection['item'])} folders")
