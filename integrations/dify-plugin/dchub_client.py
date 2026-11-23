"""Minimal client for the hosted DC Hub MCP server (JSON-RPC tools/call over HTTPS)."""

import json
from typing import Any, Optional

import requests

ENDPOINT = "https://dchub.cloud/mcp"
USER_AGENT = "dify-plugin-dchub/0.0.1"
TIMEOUT_SECONDS = 90


class DCHubError(Exception):
    """Raised when DC Hub returns an error. Never includes the API key."""


def call_tool(name: str, arguments: dict[str, Any], api_key: Optional[str] = None) -> str:
    """Call one DC Hub tool and return its text answer (with as-of dates and Source line)."""
    args = {k: v for k, v in arguments.items() if v not in (None, "")}
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": USER_AGENT,
    }
    if api_key:
        headers["X-API-Key"] = api_key
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}
    try:
        resp = requests.post(ENDPOINT, json=body, headers=headers, timeout=TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise DCHubError(f"DC Hub request failed: {type(exc).__name__}") from None
    if resp.status_code >= 400:
        raise DCHubError(f"DC Hub returned HTTP {resp.status_code}")
    payload = parse_rpc(resp.text)
    if "error" in payload:
        err = payload["error"] or {}
        raise DCHubError(f"DC Hub error {err.get('code')}: {err.get('message')}")
    result = payload.get("result") or {}
    text = "\n".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text").strip()
    if result.get("isError"):
        raise DCHubError(f"DC Hub tool error: {text}")
    return text


def parse_rpc(text: str) -> dict[str, Any]:
    """Parse a JSON-RPC response sent as plain JSON or as server-sent events."""
    stripped = text.lstrip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    for line in reversed(text.splitlines()):
        if line.startswith("data:"):
            chunk = line[5:].strip()
            try:
                parsed = json.loads(chunk)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and ("result" in parsed or "error" in parsed):
                return parsed
    raise DCHubError("DC Hub returned no JSON-RPC payload")
