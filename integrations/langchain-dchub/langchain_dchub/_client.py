"""MCP transport for `langchain-dchub`.

The JSON-RPC handshake, the Streamable HTTP / SSE body parsing and the
`tools/list` and `tools/call` requests come from the `dchub` SDK's MCP client
(`dchub.mcp.DCHub`). This module only changes how the client names itself and
lets callers add request headers.
"""

from __future__ import annotations

import os
from typing import Any

from dchub.mcp import DCHub as _SDKMCPClient

from langchain_dchub._version import __version__

DEFAULT_ENDPOINT = "https://dchub.cloud/mcp"
"""The full DC Hub MCP server. `https://dchub.cloud/mcp/core` serves a 10-tool set."""

CLIENT_NAME = "langchain-dc"
"""clientInfo.name sent on initialize, so DC Hub can count LangChain traffic.

The server treats any client name or User-Agent containing words such as
"dchub", "test" or "check" as its own internal traffic and leaves it out of
usage counts, so the name must not contain them.
"""


def _text_of(result: dict[str, Any]) -> str:
    """Join the text blocks of an MCP `tools/call` result into one string."""
    parts = [
        block.get("text", "")
        for block in result.get("content") or []
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    return "\n\n".join(p for p in parts if p)


class DCHubMCPClient(_SDKMCPClient):
    """DC Hub MCP client used by the LangChain tools.

    Args:
        api_key: DC Hub API key, sent as the `X-API-Key` header. An empty string
            means anonymous (previews). `None` falls back to `DCHUB_API_KEY`.
        endpoint: MCP endpoint URL. Defaults to `DCHUB_ENDPOINT` or
            `https://dchub.cloud/mcp`.
        timeout: Per-request timeout in seconds.
        headers: Extra request headers. They are applied last, so they can
            replace the default `User-Agent`.
    """

    def __init__(
        self,
        api_key: str | None = None,
        endpoint: str | None = None,
        timeout: int = 60,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key,
            endpoint=endpoint or os.environ.get("DCHUB_ENDPOINT") or DEFAULT_ENDPOINT,
            timeout=timeout,
        )
        self.extra_headers: dict[str, str] = dict(headers or {})

    def _headers(self) -> dict[str, str]:
        h = super()._headers()
        h["User-Agent"] = f"{CLIENT_NAME}/{__version__} {h.get('User-Agent', '')}".strip()
        h.update(self.extra_headers)
        return h

    def _ensure_session(self) -> None:
        if self._session_id:
            return
        self._post(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": CLIENT_NAME, "version": __version__},
                },
            }
        )
        try:
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except Exception:  # noqa: S110 - a notification has no reply to wait for
            pass

    def call_tool(self, name: str, arguments: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        """Call one MCP tool.

        Returns:
            The joined text content and the raw MCP result. DC Hub puts its
            citation, `as_of` dates and any preview notice inside that content,
            so it is returned unchanged.
        """
        result = self.call_raw(name, arguments)
        return _text_of(result), result
