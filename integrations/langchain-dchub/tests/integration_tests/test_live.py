"""Live checks against https://dchub.cloud (anonymous, QA User-Agent)."""

from __future__ import annotations

import pytest

from langchain_dchub import DCHubGridData, DCHubMarketIntel, DCHubToolkit
from langchain_dchub.tools import HIDDEN_PARAMS

pytestmark = pytest.mark.integration

QA_HEADERS = {
    "User-Agent": "dchub-qa-readonly/0.1 (langchain-dchub integration tests - exclude)",
    "X-DCHub-QA": "1",
}


def test_grid_iso_argument_reaches_the_server() -> None:
    tool = DCHubGridData(api_key=None, headers=QA_HEADERS)
    pjm = tool.invoke({"iso": "PJM"})
    ercot = tool.invoke({"iso": "ERCOT"})
    assert pjm
    assert ercot
    assert pjm != ercot


def test_market_intel_is_dated_and_cited() -> None:
    out = DCHubMarketIntel(api_key=None, headers=QA_HEADERS).invoke({"market": "dallas"})
    assert "as_of" in out
    assert "citation" in out or "dchub.cloud" in out


def test_toolkit_core_tools_exist_on_the_server() -> None:
    kit = DCHubToolkit(api_key=None, headers=QA_HEADERS, load_from_server=True)
    served = {t.mcp_tool_name for t in kit.get_tools()}  # type: ignore[attr-defined]
    for tool in DCHubToolkit().get_tools():
        assert tool.mcp_tool_name in served, tool.mcp_tool_name  # type: ignore[attr-defined]


def test_toolkit_from_server_hides_payment_params() -> None:
    tools = DCHubToolkit(api_key=None, headers=QA_HEADERS, load_from_server=True).get_tools()
    assert len(tools) > 50
    for t in tools:
        props = t.tool_call_schema.get("properties", {})  # type: ignore[union-attr]
        assert not HIDDEN_PARAMS & set(props), t.name


def test_core_endpoint_lists_its_tools() -> None:
    tools = DCHubToolkit(
        api_key=None,
        headers=QA_HEADERS,
        endpoint="https://dchub.cloud/mcp/core",
        load_from_server=True,
    ).get_tools()
    assert 1 <= len(tools) <= 20
