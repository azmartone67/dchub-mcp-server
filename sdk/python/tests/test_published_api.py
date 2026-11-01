"""Offline: 0.3.0 keeps every name 0.2.0 exported on PyPI, with the same meaning,
and adds the MCP client and the compose kit. Nothing touches the network."""
import dchub
from dchub import client as rest


def test_every_0_2_0_export_is_still_there():
    for name in ("DCHub", "DCHubError", "TOOL_MANIFEST", "MCP_ENDPOINT", "__version__",
                 "dchub_langchain_tools", "dchub_smolagents_tools"):
        assert hasattr(dchub, name), name


def test_top_level_dchub_is_still_the_rest_client():
    assert dchub.DCHub is rest.DCHub
    for m in ("get_market_dcpi_rank", "search_facilities", "rank_markets", "stats"):
        assert callable(getattr(dchub.DCHub, m)), m


def test_mcp_client_and_compose_are_added():
    from dchub.mcp import DCHub as M
    assert dchub.DCHubMCP is M
    assert callable(dchub.dchub_tool_definitions)
    assert dchub.__version__ == "0.3.0"


def test_rest_user_agent_is_not_counted_as_internal():
    ua = dchub.DCHub()._session.headers["User-Agent"]
    assert "dchub" not in ua.lower() and "test" not in ua.lower() and "check" not in ua.lower(), ua
