"""Offline: attribution headers, the clientInfo rename, the search() argument and
compose definitions. urlopen is replaced; nothing touches the network."""
import io
import json
import re
from pathlib import Path

import pytest

import dchub.mcp as client_mod
from dchub.mcp import DCHub, CLIENT_NAME, check_via
from dchub import dchub_tool_definitions, STARTER_TOOLS

ROOT = Path(__file__).resolve().parents[3]

TOOLS = [{"name": n, "description": f"{n} does a thing.",
          "inputSchema": {"type": "object", "properties": {"iso": {"type": "string"}}}} for n in STARTER_TOOLS]
TOOLS.append({"name": "analyze_site", "description": "x", "inputSchema": {"type": "object"}})


class _Resp(io.BytesIO):
    def __init__(self, body):
        super().__init__(json.dumps(body).encode())
        self.headers = {"Mcp-Session-Id": "s1"}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def wire(monkeypatch):
    seen = []

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode())
        seen.append({"headers": {k.lower(): v for k, v in req.header_items()}, "body": body})
        result = {}
        if body.get("method") == "tools/list":
            result = {"tools": TOOLS}
        if body.get("method") == "tools/call":
            result = {"content": [{"type": "text", "text": json.dumps({"echo": body["params"], "cite_as": "DC Hub"})}]}
        return _Resp({"jsonrpc": "2.0", "id": body.get("id"), "result": result})

    monkeypatch.setattr(client_mod.urllib.request, "urlopen", fake_urlopen)
    return seen


def _internal_regexes():
    src = (ROOT / "server.mjs").read_text()
    fn = src[src.index("function _INTERNAL_SELF_TAG("):]
    fn = fn[:fn.index("\n}\n")]
    pats = re.findall(r"/(\^?\([^\n]+?\)\$?)/\.test\(safe\)", fn)
    assert len(pats) >= 2
    return [re.compile(p) for p in pats]


def test_client_name_and_ua_are_not_internal(wire):
    DCHub(via="acme-energy").tools()
    init = next(s for s in wire if s["body"].get("method") == "initialize")
    name = init["body"]["params"]["clientInfo"]["name"]
    assert name == CLIENT_NAME
    assert not any(rx.search(name) for rx in _internal_regexes())
    assert any(rx.search("dchub-python-sdk") for rx in _internal_regexes())  # must-fail control
    for s in wire:
        assert s["headers"]["x-dchub-via"] == "acme-energy"
        assert "dchub" not in s["headers"]["user-agent"].lower()


def test_bad_via_refused():
    for bad in ["Acme", "-acme", "a b", "x" * 41, "acme/1"]:
        with pytest.raises(ValueError):
            check_via(bad)
    assert check_via("acme.energy_1-2") == "acme.energy_1-2"
    assert check_via("") is None


def test_search_sends_query_not_q(wire):
    DCHub().search(q="Ashburn")
    call = next(s for s in wire if s["body"].get("method") == "tools/call")
    assert call["body"]["params"]["arguments"] == {"limit": 5, "query": "Ashburn"}


def test_definitions_prefix_and_passthrough(wire):
    defs = dchub_tool_definitions(via="acme-energy")
    assert [d["name"] for d in defs] == list(STARTER_TOOLS)
    assert all(d["description"].startswith("From DC Hub (dchub.cloud): ") for d in defs)
    grid = next(d for d in defs if d["name"] == "get_grid_data")
    r = grid["call"]({"iso": "PJM"})
    assert json.loads(r["content"][0]["text"]) == {"echo": {"name": "get_grid_data", "arguments": {"iso": "PJM"}}, "cite_as": "DC Hub"}


def test_unknown_tool_raises(wire):
    with pytest.raises(ValueError, match="does not serve: nope"):
        dchub_tool_definitions(tools=["nope"])
