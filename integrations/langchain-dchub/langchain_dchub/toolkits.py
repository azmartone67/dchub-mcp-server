"""DC Hub toolkit for LangChain."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import BaseTool, BaseToolkit
from langchain_core.utils import secret_from_env
from pydantic import ConfigDict, Field, PrivateAttr, SecretStr

from langchain_dchub._client import DCHubMCPClient
from langchain_dchub.tools import CORE_TOOLS, NAME_PREFIX, DCHubMCPTool


class DCHubToolkit(BaseToolkit):
    """Toolkit for DC Hub data-center, power-grid and energy data.

    Setup:
        ```bash
        pip install -U langchain-dchub
        export DCHUB_API_KEY="dch_live_..."  # optional: anonymous calls get previews
        ```

    Key init args:
        api_key: DC Hub API key. Read from `DCHUB_API_KEY` when not passed.
        load_from_server: `False` (default) returns the five typed core tools
            without a network call. `True` reads `tools/list` from the server and
            returns every read-only tool it serves.
        tool_names: Keep only these tools (MCP names, e.g. `"get_grid_data"`).
        include_write_tools: With `load_from_server`, also return tools that are
            not marked read-only (alerts, saved sites, key and email binding).

    Instantiation:
        ```python
        from langchain_dchub import DCHubToolkit

        toolkit = DCHubToolkit()
        tools = toolkit.get_tools()
        ```

    Every tool on the server:
        ```python
        tools = DCHubToolkit(load_from_server=True).get_tools()
        ```

    The 10-tool core server:
        ```python
        tools = DCHubToolkit(
            endpoint="https://dchub.cloud/mcp/core", load_from_server=True
        ).get_tools()
        ```
    """

    dchub_api_key: SecretStr | None = Field(
        default_factory=secret_from_env("DCHUB_API_KEY", default=None),
        alias="api_key",
    )
    endpoint: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    timeout: int = 60
    load_from_server: bool = False
    tool_names: list[str] | None = None
    include_write_tools: bool = False
    name_prefix: str = NAME_PREFIX

    model_config = ConfigDict(populate_by_name=True)

    _client: DCHubMCPClient | None = PrivateAttr(default=None)

    @property
    def client(self) -> DCHubMCPClient:
        """The MCP client every tool from this toolkit shares."""
        if self._client is None:
            key = self.dchub_api_key.get_secret_value() if self.dchub_api_key else ""
            self._client = DCHubMCPClient(
                api_key=key, endpoint=self.endpoint, timeout=self.timeout, headers=self.headers
            )
        return self._client

    def _tool_kwargs(self) -> dict[str, Any]:
        return {
            "client": self.client,
            "api_key": self.dchub_api_key,
            "endpoint": self.endpoint,
            "headers": self.headers,
            "timeout": self.timeout,
        }

    def _wanted(self, mcp_name: str) -> bool:
        return self.tool_names is None or mcp_name in self.tool_names

    def get_tools(self) -> list[BaseTool]:
        """Return the DC Hub tools."""
        if not self.load_from_server:
            tools: list[BaseTool] = []
            for cls in CORE_TOOLS:
                tool = cls(**self._tool_kwargs())
                if self._wanted(tool.mcp_tool_name):
                    tools.append(tool)
            return tools

        tools = []
        for definition in self.client.list_tools():
            name = definition.get("name")
            if not name or not self._wanted(name):
                continue
            read_only = (definition.get("annotations") or {}).get("readOnlyHint") is True
            if not read_only and not self.include_write_tools:
                continue
            tools.append(
                DCHubMCPTool.from_mcp_definition(
                    definition, name_prefix=self.name_prefix, **self._tool_kwargs()
                )
            )
        return tools
