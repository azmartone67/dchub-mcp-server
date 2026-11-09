"""Unit tests for langchain-dchub. No network: run with --disable-socket."""

from __future__ import annotations

import io
import json
import re
import urllib.error
from typing import Any

import pytest
from langchain_core.messages import ToolMessage

from langchain_dchub import (
    DCHubGridData,
    DCHubMarketIntel,
    DCHubMCPClient,
    DCHubMCPTool,
    DCHubSearchFacilities,
    DCHubToolkit,
)
from langchain_dchub._client import CLIENT_NAME, _text_of
from langchain_dchub.tools import CORE_TOOLS, HIDDEN_PARAMS, clean_input_schema

CITED = json.dumps(
    {
        "iso": "ERCOT",
        "as_of": "2026-11-09T07:00:00Z",
        "citation": {"source": "DC Hub (dchub.cloud)", "url": "https://dchub.cloud"},
    }
)
PREVIEW_LINE = "Preview: anonymous callers get previews. Full answers: https://dchub.cloud/u/abc"


class FakeClient:
    """Stands in for DCHubMCPClient; records each call."""

    def __init__(self, result: dict[str, Any] | None = None, exc: Exception | None = None):
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.result = result or {
            "content": [{"type": "text", "text": CITED}, {"type": "text", "text": PREVIEW_LINE}]
        }
        self.exc = exc
        self.definitions: list[dict[str, Any]] = []

    def call_tool(self, name: str, arguments: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        self.calls.append((name, arguments))
        if self.exc:
            raise self.exc
        return _text_of(self.result), self.result

    def list_tools(self) -> list[dict[str, Any]]:
        return self.definitions


@pytest.fixture(autouse=True)
def _no_env_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DCHUB_API_KEY", raising=False)
    monkeypatch.delenv("DCHUB_ENDPOINT", raising=False)


def _tool_call(tool: Any, args: dict[str, Any]) -> ToolMessage:
    return tool.invoke({"args": args, "id": "1", "name": tool.name, "type": "tool_call"})


# --- calling ------------------------------------------------------------------


def test_invoke_calls_the_named_mcp_tool_and_drops_unset_args() -> None:
    fake = FakeClient()
    tool = DCHubSearchFacilities(client=fake)
    tool.invoke({"state": "VA", "limit": 3})
    assert fake.calls == [("search_facilities", {"state": "VA", "limit": 3})]


def test_each_core_tool_maps_to_its_own_mcp_tool() -> None:
    names = {cls(client=FakeClient()).mcp_tool_name for cls in CORE_TOOLS}
    assert names == {
        "execute_plan",
        "search_facilities",
        "get_market_intel",
        "get_grid_data",
        "source_capacity",
    }


def test_citation_and_preview_notice_reach_the_model_unchanged() -> None:
    fake = FakeClient()
    msg = _tool_call(DCHubGridData(client=fake), {"iso": "ERCOT"})
    assert isinstance(msg, ToolMessage)
    assert CITED in msg.content
    assert PREVIEW_LINE in msg.content
    assert msg.artifact == fake.result


def test_plain_invoke_returns_text() -> None:
    out = DCHubGridData(client=FakeClient()).invoke({"iso": "PJM"})
    assert isinstance(out, str)
    assert "dchub.cloud" in out


def test_required_argument_is_enforced() -> None:
    with pytest.raises(ValueError, match="market"):
        DCHubMarketIntel(client=FakeClient()).invoke({})


def test_mcp_error_result_goes_back_to_the_model_as_text() -> None:
    fake = FakeClient(
        result={"isError": True, "content": [{"type": "text", "text": "Unknown market 'x'"}]}
    )
    msg = _tool_call(DCHubMarketIntel(client=fake), {"market": "x"})
    assert msg.status == "error"
    assert "Unknown market 'x'" in msg.content


def test_http_error_goes_back_to_the_model_as_text() -> None:
    err = urllib.error.HTTPError("https://dchub.cloud/mcp", 503, "busy", {}, io.BytesIO(b""))  # type: ignore[arg-type]
    msg = _tool_call(DCHubGridData(client=FakeClient(exc=err)), {"iso": "PJM"})
    assert msg.status == "error"
    assert "HTTP 503" in msg.content


async def test_async_invoke() -> None:
    fake = FakeClient()
    out = await DCHubGridData(client=fake).ainvoke({"iso": "CAISO"})
    assert "dchub.cloud" in out
    assert fake.calls == [("get_grid_data", {"iso": "CAISO"})]


# --- key, headers and client identity -------------------------------------------


def test_api_key_from_env_is_sent_and_never_printed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DCHUB_API_KEY", "dch_live_secret123")
    tool = DCHubGridData()
    assert tool.client._headers()["X-API-Key"] == "dch_live_secret123"
    assert "dch_live_secret123" not in repr(tool)
    assert "dch_live_secret123" not in str(tool.model_dump())


def test_explicit_api_key_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DCHUB_API_KEY", "from_env")
    tool = DCHubGridData(api_key="explicit")
    assert tool.client._headers()["X-API-Key"] == "explicit"


def test_anonymous_sends_no_key() -> None:
    assert "X-API-Key" not in DCHubGridData().client._headers()


def test_anonymous_explicit_none_ignores_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DCHUB_API_KEY", "from_env")
    assert "X-API-Key" not in DCHubGridData(api_key=None).client._headers()


def test_default_user_agent_names_this_package() -> None:
    ua = DCHubGridData().client._headers()["User-Agent"]
    assert ua.startswith(f"{CLIENT_NAME}/")


def test_extra_headers_replace_the_user_agent() -> None:
    h = DCHubGridData(
        headers={"User-Agent": "dchub-qa-readonly", "X-DCHub-QA": "1"}
    ).client._headers()
    assert h["User-Agent"] == "dchub-qa-readonly"
    assert h["X-DCHub-QA"] == "1"


def test_client_name_is_not_counted_as_internal_traffic() -> None:
    # Mirrors _INTERNAL_SELF_TAG in server.mjs: a name matching this is dropped
    # from DC Hub's usage counts, so LangChain traffic would be invisible.
    internal = re.compile(
        r"(dchub|verify|probe|audit|harness|test|check|diag|sweep|selfheal|canary|smoke|regression)"
    )
    assert len(CLIENT_NAME) > 2
    assert not internal.search(CLIENT_NAME)
    default_ua = DCHubMCPClient(api_key="")._headers()["User-Agent"].lower()
    assert not internal.search(default_ua)


def test_initialize_sends_this_package_as_client_info() -> None:
    client = DCHubMCPClient(api_key="")
    sent: list[dict[str, Any]] = []

    def fake_post(payload: dict[str, Any]) -> dict[str, Any]:
        sent.append(payload)
        client._session_id = "s1"
        return {}

    client._post = fake_post  # type: ignore[method-assign]
    client._ensure_session()
    assert sent[0]["method"] == "initialize"
    assert sent[0]["params"]["clientInfo"]["name"] == CLIENT_NAME


def test_endpoint_defaults_and_env(monkeypatch: pytest.MonkeyPatch) -> None:
    assert DCHubGridData().client.endpoint == "https://dchub.cloud/mcp"
    monkeypatch.setenv("DCHUB_ENDPOINT", "https://dchub.cloud/mcp/core")
    assert DCHubGridData().client.endpoint == "https://dchub.cloud/mcp/core"
    assert (
        DCHubGridData(endpoint="https://x.example/mcp").client.endpoint == "https://x.example/mcp"
    )


def test_text_of_joins_text_blocks_only() -> None:
    result = {
        "content": [
            {"type": "text", "text": "a"},
            {"type": "image", "data": "x"},
            {"type": "text", "text": "b"},
        ]
    }
    assert _text_of(result) == "a\n\nb"


# --- schemas ------------------------------------------------------------------


def test_typed_schemas_have_no_payment_params() -> None:
    for cls in CORE_TOOLS:
        props = cls(client=FakeClient()).tool_call_schema.model_json_schema()["properties"]
        assert not HIDDEN_PARAMS & set(props), cls.__name__


def test_clean_input_schema_strips_payment_params() -> None:
    raw = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "iso": {"type": "string"},
            "mpp_pay": {"type": "boolean"},
            "mpp_credential": {"type": "string"},
        },
        "required": ["iso", "mpp_credential"],
    }
    out = clean_input_schema(raw)
    assert set(out["properties"]) == {"iso"}
    assert out["required"] == ["iso"]
    assert "$schema" not in out
    assert "mpp_pay" in raw["properties"]  # the original is not mutated


# --- toolkit ------------------------------------------------------------------


def test_toolkit_default_returns_core_tools_without_network() -> None:
    tools = DCHubToolkit().get_tools()
    assert [t.name for t in tools] == [
        "dchub_execute_plan",
        "dchub_search_facilities",
        "dchub_get_market_intel",
        "dchub_get_grid_data",
        "dchub_source_capacity",
    ]
    assert len({id(t.client) for t in tools}) == 1  # one shared client


def test_toolkit_tool_names_filter() -> None:
    tools = DCHubToolkit(tool_names=["get_grid_data"]).get_tools()
    assert [t.name for t in tools] == ["dchub_get_grid_data"]


def _definitions() -> list[dict[str, Any]]:
    return [
        {
            "name": "get_water_risk",
            "description": "Water risk.",
            "inputSchema": {
                "type": "object",
                "properties": {"state": {"type": "string"}, "mpp_pay": {"type": "boolean"}},
            },
            "annotations": {"readOnlyHint": True},
        },
        {
            "name": "set_site_alert",
            "description": "Create an alert.",
            "inputSchema": {"type": "object", "properties": {"lat": {"type": "number"}}},
            "annotations": {"readOnlyHint": False},
        },
        {
            "name": "no_annotations",
            "description": "x",
            "inputSchema": {"type": "object", "properties": {}},
        },
    ]


def test_toolkit_from_server_keeps_read_only_tools() -> None:
    kit = DCHubToolkit(load_from_server=True)
    fake = FakeClient()
    fake.definitions = _definitions()
    kit._client = fake  # type: ignore[assignment]
    tools = kit.get_tools()
    assert [t.name for t in tools] == ["dchub_get_water_risk"]
    tool = tools[0]
    assert isinstance(tool, DCHubMCPTool)
    assert set(tool.tool_call_schema["properties"]) == {"state"}  # type: ignore[index]
    tool.invoke({"state": "AZ"})
    assert fake.calls == [("get_water_risk", {"state": "AZ"})]


def test_toolkit_from_server_can_include_write_tools() -> None:
    kit = DCHubToolkit(load_from_server=True, include_write_tools=True, name_prefix="")
    fake = FakeClient()
    fake.definitions = _definitions()
    kit._client = fake  # type: ignore[assignment]
    assert [t.name for t in kit.get_tools()] == [
        "get_water_risk",
        "set_site_alert",
        "no_annotations",
    ]
