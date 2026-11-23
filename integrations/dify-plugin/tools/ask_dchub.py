from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from dchub_client import DCHubError, call_tool

MCP_TOOL = "execute_plan"
PARAMS = ['intent', 'market', 'iso', 'state', 'capacity_mw']


class AskDchubTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        api_key = (self.runtime.credentials or {}).get("dchub_api_key") or None
        args = {name: tool_parameters.get(name) for name in PARAMS}
        try:
            text = call_tool(MCP_TOOL, args, api_key=api_key)
        except DCHubError as exc:
            yield self.create_text_message(str(exc))
            return
        yield self.create_text_message(text)
