#!/usr/bin/env python3
"""ci_dchub_checks_envkey.py — DC Hub CI checks (env-key edition).

Partner-authored CI harness, adapted for the live MCP transport. Three checks:

  1. MANIFEST  — GET https://dchub.cloud/.well-known/mcp.json and assert
                 tools_count >= 74.
  2. KEY       — read the API key from the environment (X_API_KEY, falling back
                 to DC_HUB_API_KEY). CI never mints keys: a missing key is a
                 hard fail, not a claim_free_key call.
  3. PAID PATH — call analyze_site over the live MCP endpoint with that key and
                 assert EITHER a well-formed paid_only preview
                 (structuredContent.error == "paid_only" with a human_message)
                 OR full data. Both are success — the check is that the paid
                 gate answers coherently, not which side of it the key lands on.

Transport note (verified live 2026-07-18): https://dchub.cloud/mcp speaks the
MCP Streamable-HTTP protocol. A naive single-POST tools/call happens to be
accepted by the current worker, but the contract-correct flow — which this
script uses, mirroring test/mcp.test.mjs — is:

    POST initialize            -> capture the Mcp-Session-Id response header
    POST notifications/initialized (with Mcp-Session-Id)
    POST tools/call            (with Mcp-Session-Id)

Responses arrive as SSE (text/event-stream): the JSON-RPC payload is on
"data:" lines, possibly split across several, inside blank-line-separated
events. This parser mirrors test/mcp.test.mjs / selfheal v1.3.6.

Canonical failure flags (verbatim, greppable):
    MANIFEST_FAIL: tools_count = <n>
    MISSING_KEY_FAIL
    PAID_PREVIEW_FAIL: <json>

Exit codes:
    0  ALL_CHECKS_PASSED
    2  manifest check failed
    3  no API key in the environment
    4  paid-preview / MCP-call check failed

On success the provenance line (structuredContent.citation.cite_as +
retrieved_at) is printed so the CI log carries the citation trail.
"""

import json
import os
import sys

import requests

MANIFEST_URL = os.environ.get("DCHUB_MANIFEST_URL", "https://dchub.cloud/.well-known/mcp.json")
MCP_URL = os.environ.get("MCP_URL", "https://dchub.cloud/mcp")
MIN_TOOLS_COUNT = 74
PROTOCOL_VERSION = "2025-11-25"
TIMEOUT_S = 30


# ── check 1: manifest ────────────────────────────────────────────────────────

def check_manifest() -> int:
    """Assert tools_count >= MIN_TOOLS_COUNT in the public manifest."""
    try:
        resp = requests.get(MANIFEST_URL, timeout=TIMEOUT_S)
        resp.raise_for_status()
        tools_count = resp.json().get("tools_count")
    except Exception as exc:  # network / JSON errors count as a manifest fail
        print(f"MANIFEST_FAIL: tools_count = unavailable ({exc})")
        sys.exit(2)
    if not isinstance(tools_count, int) or tools_count < MIN_TOOLS_COUNT:
        print(f"MANIFEST_FAIL: tools_count = {tools_count}")
        sys.exit(2)
    print(f"manifest OK: tools_count = {tools_count} (>= {MIN_TOOLS_COUNT})")
    return tools_count


# ── check 2: env key (no minting in CI) ──────────────────────────────────────

def read_env_key() -> str:
    key = os.environ.get("X_API_KEY") or os.environ.get("DC_HUB_API_KEY")
    if not key or not key.strip():
        print("MISSING_KEY_FAIL")
        sys.exit(3)
    print(f"key OK: using env key ...{key.strip()[-6:]}")
    return key.strip()


# ── MCP transport (initialize → initialized → tools/call, SSE-aware) ─────────

def _parse_sse_jsonrpc(text: str):
    """Extract the first JSON-RPC payload from an SSE body (or plain JSON)."""
    # Plain-JSON fallback: some deployments answer application/json directly.
    try:
        candidate = json.loads(text)
        if isinstance(candidate, dict) and ("result" in candidate or "error" in candidate):
            return candidate
    except ValueError:
        pass
    # SSE: blank-line-separated events; each event's payload spans "data:" lines.
    for event in text.replace("\r\n", "\n").split("\n\n"):
        data_lines = [
            line[len("data:"):].lstrip()
            for line in event.split("\n")
            if line.startswith("data:")
        ]
        if not data_lines:
            continue
        try:
            candidate = json.loads("\n".join(data_lines))
        except ValueError:
            continue
        if isinstance(candidate, dict) and (
            "result" in candidate or "error" in candidate or candidate.get("jsonrpc")
        ):
            return candidate
    return None


def mcp_call_tool(api_key: str, tool: str, arguments: dict) -> dict:
    """Full MCP handshake + one tools/call. Returns the JSON-RPC payload dict."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "X-API-Key": api_key,
    }
    session = requests.Session()

    # 1) initialize — the session id comes back in the Mcp-Session-Id header.
    init_resp = session.post(
        MCP_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "clientInfo": {"name": "dchub-ci-checks-envkey", "version": "1.0.0"},
                "capabilities": {},
            },
        },
        timeout=TIMEOUT_S,
    )
    init_resp.raise_for_status()
    session_id = init_resp.headers.get("Mcp-Session-Id") or init_resp.headers.get("mcp-session-id")
    if not session_id:
        raise RuntimeError(
            f"initialize returned no Mcp-Session-Id header (status {init_resp.status_code})"
        )
    session_headers = {**headers, "Mcp-Session-Id": session_id}

    # 2) notifications/initialized — completes the handshake (expects 202).
    session.post(
        MCP_URL,
        headers=session_headers,
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        timeout=TIMEOUT_S,
    )

    # 3) tools/call — SSE response, JSON-RPC payload on data: lines.
    call_resp = session.post(
        MCP_URL,
        headers=session_headers,
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": tool, "arguments": arguments},
        },
        timeout=TIMEOUT_S,
    )
    call_resp.raise_for_status()
    payload = _parse_sse_jsonrpc(call_resp.text)
    if payload is None:
        raise RuntimeError(f"no JSON-RPC payload in tools/call response: {call_resp.text[:300]}")
    if payload.get("error"):
        raise RuntimeError(f"MCP protocol error: {json.dumps(payload['error'])}")
    return payload


# ── check 3: analyze_site paid path (preview OR full data both pass) ─────────

def _looks_like_full_data(sc: dict) -> bool:
    """Full-data heuristic: no gate error + at least one substantive field."""
    if sc.get("error"):
        return False
    substantive = ("overall_score", "scores", "fiber", "location", "power_cost", "success")
    return any(k in sc for k in substantive)


def check_paid_preview(api_key: str) -> None:
    try:
        payload = mcp_call_tool(api_key, "analyze_site", {"lat": 33.44, "lon": -112.07})
    except Exception as exc:
        print(f"PAID_PREVIEW_FAIL: {json.dumps({'transport_error': str(exc)})}")
        sys.exit(4)

    result = payload.get("result") or {}
    sc = result.get("structuredContent")
    if not isinstance(sc, dict):
        print(f"PAID_PREVIEW_FAIL: {json.dumps({'missing_structuredContent': result})[:2000]}")
        sys.exit(4)

    is_preview = sc.get("error") == "paid_only" and bool(sc.get("human_message"))
    is_full = _looks_like_full_data(sc)
    if not (is_preview or is_full):
        print(f"PAID_PREVIEW_FAIL: {json.dumps(sc)[:2000]}")
        sys.exit(4)

    mode = "paid_only preview (with human_message)" if is_preview else "full data"
    print(f"analyze_site OK: served as {mode}")

    # Provenance trail for the CI log.
    citation = sc.get("citation") if isinstance(sc.get("citation"), dict) else {}
    cite_as = citation.get("cite_as") or sc.get("_cite") or "n/a"
    retrieved_at = citation.get("retrieved_at") or sc.get("retrieved_at") or "n/a"
    print(f"provenance: cite_as={cite_as} retrieved_at={retrieved_at}")


def main() -> None:
    check_manifest()
    api_key = read_env_key()
    check_paid_preview(api_key)
    print("ALL_CHECKS_PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
