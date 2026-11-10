"""LangChain standard unit tests (langchain-tests) for every typed DC Hub tool."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import BaseTool
from langchain_tests.unit_tests import ToolsUnitTests

from langchain_dchub import (
    DCHubExecutePlan,
    DCHubGridData,
    DCHubMarketIntel,
    DCHubSearchFacilities,
    DCHubSourceCapacity,
)

_ENV = ({"DCHUB_API_KEY": "dch_live_unit"}, {}, {"dchub_api_key": "dch_live_unit"})


class _Base(ToolsUnitTests):
    @property
    def init_from_env_params(self) -> tuple[dict[str, str], dict[str, Any], dict[str, Any]]:
        return _ENV


class TestExecutePlanUnit(_Base):
    @property
    def tool_constructor(self) -> type[BaseTool]:
        return DCHubExecutePlan

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"intent": "compare Dallas vs Phoenix for a 100 MW AI campus"}


class TestSearchFacilitiesUnit(_Base):
    @property
    def tool_constructor(self) -> type[BaseTool]:
        return DCHubSearchFacilities

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"state": "VA", "operator": "Equinix", "limit": 3}


class TestMarketIntelUnit(_Base):
    @property
    def tool_constructor(self) -> type[BaseTool]:
        return DCHubMarketIntel

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"market": "dallas"}


class TestGridDataUnit(_Base):
    @property
    def tool_constructor(self) -> type[BaseTool]:
        return DCHubGridData

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"iso": "ERCOT"}


class TestSourceCapacityUnit(_Base):
    @property
    def tool_constructor(self) -> type[BaseTool]:
        return DCHubSourceCapacity

    @property
    def tool_invoke_params_example(self) -> dict[str, Any]:
        return {"min_mw": 5, "region": "europe"}
