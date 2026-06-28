#!/usr/bin/env python3
"""Probe a running MCP server and print its tools/list count.

Used by the docker-build-check workflow to assert the containerized server (the
exact thing Glama builds + introspects) exposes the canonical number of tools.

Usage: introspect_probe.py [base_url]   (default http://127.0.0.1:8088)
"""
import json, sys, urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8088").rstrip("/")


def post(payload, sid=None):
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if sid:
        h["Mcp-Session-Id"] = sid
    req = urllib.request.Request(BASE + "/mcp", data=json.dumps(payload).encode(), headers=h, method="POST")
    resp = urllib.request.urlopen(req, timeout=20)
    sid2 = resp.headers.get("Mcp-Session-Id")
    body = resp.read().decode()
    for line in body.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:].strip()), sid2
    return json.loads(body), sid2


def main():
    _, sid = post({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                   "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                              "clientInfo": {"name": "ci-introspect", "version": "1"}}})
    tl, _ = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, sid)
    print(len(tl.get("result", {}).get("tools", [])))


if __name__ == "__main__":
    main()
