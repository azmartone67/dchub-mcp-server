import importlib
import json
import os
import sys
from types import SimpleNamespace

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import dchub_client  # noqa: E402
from dchub_client import DCHubError, call_tool, parse_rpc  # noqa: E402

ANSWER = "Ashburn: DCPI verdict (preview). Source: DC Hub (dchub.cloud), as of 2026-11-23"


class FakeResp:
    def __init__(self, text, status=200):
        self.text = text
        self.status_code = status


def ok(text=ANSWER):
    return json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": text}]}})


@pytest.fixture()
def seen(monkeypatch):
    calls = []

    def fake_post(url, json, headers, timeout):
        calls.append(SimpleNamespace(url=url, body=json, headers=headers, timeout=timeout))
        return FakeResp(ok())

    monkeypatch.setattr(dchub_client.requests, "post", fake_post)
    return calls


def test_call_tool_posts_jsonrpc_and_drops_empty_args(seen):
    assert call_tool("execute_plan", {"intent": "DCPI for Ashburn?", "market": "", "iso": None}) == ANSWER
    c = seen[0]
    assert c.url == "https://dchub.cloud/mcp"
    assert c.body["method"] == "tools/call"
    assert c.body["params"] == {"name": "execute_plan", "arguments": {"intent": "DCPI for Ashburn?"}}
    assert "X-API-Key" not in c.headers
    assert c.timeout == 90


def test_api_key_header(seen):
    call_tool("get_market_dcpi_rank", {"market_slug": "ashburn"}, api_key="k")
    assert seen[0].headers["X-API-Key"] == "k"


def test_sse_parsing_and_garbage():
    assert parse_rpc("event: message\ndata: " + ok("hi") + "\n\n")["result"]["content"][0]["text"] == "hi"
    with pytest.raises(DCHubError):
        parse_rpc("event: ping\n\n")


def test_http_rpc_and_tool_errors(monkeypatch):
    monkeypatch.setattr(dchub_client.requests, "post", lambda *a, **k: FakeResp("", 503))
    with pytest.raises(DCHubError, match="HTTP 503"):
        call_tool("execute_plan", {"intent": "x"})
    err = json.dumps({"error": {"code": -32602, "message": "bad"}})
    monkeypatch.setattr(dchub_client.requests, "post", lambda *a, **k: FakeResp(err))
    with pytest.raises(DCHubError, match="-32602"):
        call_tool("execute_plan", {"intent": "x"})
    tool_err = json.dumps({"result": {"isError": True, "content": [{"type": "text", "text": "timed out"}]}})
    monkeypatch.setattr(dchub_client.requests, "post", lambda *a, **k: FakeResp(tool_err))
    with pytest.raises(DCHubError, match="timed out"):
        call_tool("execute_plan", {"intent": "x"})


def test_error_never_leaks_key(monkeypatch):
    def boom(*a, **k):
        raise dchub_client.requests.ConnectionError("https://dchub.cloud key=secret-key")

    monkeypatch.setattr(dchub_client.requests, "post", boom)
    with pytest.raises(DCHubError) as exc:
        call_tool("execute_plan", {"intent": "x"}, api_key="secret-key")
    assert "secret-key" not in str(exc.value)


def _tool(mod, cls, creds):
    tool = getattr(mod, cls).__new__(getattr(mod, cls))
    tool.runtime = SimpleNamespace(credentials=creds)
    tool.create_text_message = lambda t: ("text", t)
    return tool


@pytest.mark.parametrize(
    "module,cls,mcp,params",
    [
        ("tools.ask_dchub", "AskDchubTool", "execute_plan", {"intent": "q", "market": "columbus"}),
        ("tools.dcpi_verdict", "DcpiVerdictTool", "get_market_dcpi_rank", {"market_slug": "ashburn"}),
        ("tools.interconnection_queue", "InterconnectionQueueTool", "get_interconnection_queue", {"iso": "PJM"}),
        ("tools.grid_conditions", "GridConditionsTool", "get_grid_intelligence", {"iso": "PJM"}),
    ],
)
def test_tools_map_to_mcp_names(monkeypatch, module, cls, mcp, params):
    mod = importlib.import_module(module)
    calls = []

    def fake_call(name, args, api_key=None):
        calls.append((name, args, api_key))
        return ANSWER

    monkeypatch.setattr(mod, "call_tool", fake_call)
    assert list(_tool(mod, cls, {"dchub_api_key": "k"})._invoke(params)) == [("text", ANSWER)]
    assert calls[0][0] == mcp and calls[0][2] == "k"
    for k, v in params.items():
        assert calls[0][1][k] == v


def test_tool_error_becomes_message(monkeypatch):
    mod = importlib.import_module("tools.ask_dchub")

    def bad(*a, **k):
        raise DCHubError("DC Hub returned HTTP 503")

    monkeypatch.setattr(mod, "call_tool", bad)
    assert list(_tool(mod, "AskDchubTool", {})._invoke({"intent": "x"})) == [("text", "DC Hub returned HTTP 503")]


def test_provider_validation(monkeypatch):
    mod = importlib.import_module("provider.dchub")
    from dify_plugin.errors.tool import ToolProviderCredentialValidationError

    prov = mod.DchubProvider.__new__(mod.DchubProvider)
    prov._validate_credentials({})  # keyless is fine
    monkeypatch.setattr(mod, "call_tool", lambda *a, **k: ANSWER)
    prov._validate_credentials({"dchub_api_key": "k"})

    def bad(*a, **k):
        raise DCHubError("DC Hub returned HTTP 401")

    monkeypatch.setattr(mod, "call_tool", bad)
    with pytest.raises(ToolProviderCredentialValidationError):
        prov._validate_credentials({"dchub_api_key": "k"})


def test_yaml_files_are_consistent():
    import yaml

    prov = yaml.safe_load(open(os.path.join(ROOT, "provider/dchub.yaml")))
    assert prov["credentials_for_provider"]["dchub_api_key"]["required"] is False
    for rel in prov["tools"]:
        spec = yaml.safe_load(open(os.path.join(ROOT, rel)))
        assert os.path.exists(os.path.join(ROOT, spec["extra"]["python"]["source"]))
        assert spec["identity"]["author"] == "dchub"
    man = yaml.safe_load(open(os.path.join(ROOT, "manifest.yaml")))
    assert man["privacy"] == "PRIVACY.md" and man["icon"] == "icon.png"
    assert os.path.exists(os.path.join(ROOT, "_assets", man["icon"]))
