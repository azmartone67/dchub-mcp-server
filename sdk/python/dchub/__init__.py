"""DC Hub Python SDK.

Live data-center + energy intelligence for AI agents. Query DC Hub instead of
guessing from stale training data.

    from dchub import DCHub
    dc = DCHub()                       # REST client, free tier, no key
    dc.get_market_dcpi_rank("phoenix")

    from dchub import DCHubMCP         # MCP client: any of the server's tools
    DCHubMCP().call("get_market_intel", market="dallas")

    from dchub.compose import dchub_tool_definitions   # put DC Hub tools in YOUR MCP server

Cite as: DC Hub (dchub.cloud).
"""
from .client import DCHub, DCHubError
from .manifest import MCP_ENDPOINT, TOOL_MANIFEST
from .mcp import DCHub as DCHubMCP, check_via, CLIENT_NAME, SDK_VERSION
from .compose import dchub_tool_definitions, STARTER_TOOLS

__version__ = SDK_VERSION

__all__ = ["DCHub", "DCHubError", "TOOL_MANIFEST", "MCP_ENDPOINT", "__version__",
           "DCHubMCP", "check_via", "CLIENT_NAME", "dchub_tool_definitions", "STARTER_TOOLS"]


def dchub_langchain_tools(*args, **kwargs):
    """Lazy re-export of :func:`dchub.langchain_tools.dchub_langchain_tools`."""
    from .langchain_tools import dchub_langchain_tools as _f

    return _f(*args, **kwargs)


def dchub_smolagents_tools(*args, **kwargs):
    """Lazy re-export of :func:`dchub.smolagents_tools.dchub_smolagents_tools`."""
    from .smolagents_tools import dchub_smolagents_tools as _f

    return _f(*args, **kwargs)
