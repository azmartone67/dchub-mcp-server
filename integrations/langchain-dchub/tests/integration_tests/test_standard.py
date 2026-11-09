"""LangChain standard integration tests (langchain-tests) against the live DC Hub API.

Anonymous calls only, sent with DC Hub's QA User-Agent so they stay out of its
usage counts.
"""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.tools import BaseTool
from langchain_tests.integration_tests import ToolsIntegrationTests

from langchain_dchub import DCHubGridData, DCHubSearchFacilities

pytestmark = pytest.mark.integration

QA_HEADERS = {
    "User-Agent": "dchub-qa-readonly/0.1 (langchain-dchub integration tests - exclude)",
    "X-DCHub-QA": "1",
}


class TestGridDataIntegration(ToolsIntegrationTests):
    @property
    def tool_constructor(self) -> type[BaseTool]:
        return DCHubGridData

    @property
    def tool_constructor_params(self) -> dict[str, Any]:
        return {"api_key": None, "headers": QA_HEADERS}

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"iso": "ERCOT"}


class TestSearchFacilitiesIntegration(ToolsIntegrationTests):
    @property
    def tool_constructor(self) -> type[BaseTool]:
        return DCHubSearchFacilities

    @property
    def tool_constructor_params(self) -> dict[str, Any]:
        return {"api_key": None, "headers": QA_HEADERS}

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"state": "VA", "limit": 3}
