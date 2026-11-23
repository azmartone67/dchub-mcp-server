from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from dchub_client import DCHubError, call_tool


class DchubProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        api_key = (credentials or {}).get("dchub_api_key") or None
        if not api_key:
            return  # keyless use is supported
        try:
            call_tool("get_market_dcpi_rank", {"market_slug": "ashburn"}, api_key=api_key)
        except DCHubError as exc:
            raise ToolProviderCredentialValidationError(str(exc)) from None
