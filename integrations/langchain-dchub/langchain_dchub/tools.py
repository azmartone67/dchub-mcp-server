"""LangChain tools for DC Hub (dchub.cloud).

Each tool calls one tool on the DC Hub MCP server
(`https://dchub.cloud/mcp`). Results come back as the server wrote them,
including the citation, `as_of` dates and, for anonymous callers, the preview
notice and its link.
"""

from __future__ import annotations

import copy
import urllib.error
from typing import Any, Literal

from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool, ToolException
from langchain_core.utils import secret_from_env
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from langchain_dchub._client import DCHubMCPClient

NAME_PREFIX = "dchub_"

# Payment parameters (Stripe MPP) and an experiment tag. They are left out of
# every schema this package gives a model, so an LLM cannot start a payment.
HIDDEN_PARAMS = frozenset({"mpp_pay", "mpp_credential", "cohort"})


class DCHubBaseTool(BaseTool):
    """Base class for tools that call one DC Hub MCP tool.

    Setup:
        Install `langchain-dchub`. A key is optional: without one DC Hub
        returns previews.

        ```bash
        pip install -U langchain-dchub
        export DCHUB_API_KEY="<your dch_live_ key>"  # optional
        ```
    """

    mcp_tool_name: str = ""
    """Name of the tool on the DC Hub MCP server."""

    dchub_api_key: SecretStr | None = Field(
        default_factory=secret_from_env("DCHUB_API_KEY", default=None),
        alias="api_key",
    )
    """DC Hub API key. Read from `DCHUB_API_KEY` when not passed. Optional."""

    endpoint: str | None = None
    """MCP endpoint. Defaults to `DCHUB_ENDPOINT` or `https://dchub.cloud/mcp`."""

    headers: dict[str, str] = Field(default_factory=dict)
    """Extra HTTP headers sent with every request."""

    timeout: int = 60
    """Per-request timeout in seconds."""

    client: Any = Field(default=None, exclude=True)
    """A shared `DCHubMCPClient`. Built from the fields above when not given."""

    response_format: Literal["content", "content_and_artifact"] = "content_and_artifact"
    """The text goes to the model; the raw MCP result is kept as the artifact."""

    handle_tool_error: bool = True  # type: ignore[assignment]
    """Return DC Hub errors to the model as text instead of raising."""

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _build_client(self) -> DCHubBaseTool:
        if self.client is None:
            key = self.dchub_api_key.get_secret_value() if self.dchub_api_key else ""
            self.client = DCHubMCPClient(
                api_key=key,
                endpoint=self.endpoint,
                timeout=self.timeout,
                headers=self.headers,
            )
        return self

    def _run(
        self,
        *args: Any,
        run_manager: CallbackManagerForToolRun | None = None,
        **kwargs: Any,
    ) -> tuple[str, dict[str, Any]]:
        arguments = {k: v for k, v in kwargs.items() if v is not None}
        try:
            text, result = self.client.call_tool(self.mcp_tool_name, arguments)
        except urllib.error.HTTPError as e:
            msg = f"DC Hub returned HTTP {e.code} for {self.mcp_tool_name}."
            raise ToolException(msg) from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            msg = f"Could not reach DC Hub ({self.mcp_tool_name}): {e}"
            raise ToolException(msg) from e
        if result.get("isError"):
            raise ToolException(text or f"DC Hub reported an error for {self.mcp_tool_name}.")
        return text, result


# --- execute_plan -----------------------------------------------------------


class ExecutePlanInput(BaseModel):
    """Input for `DCHubExecutePlan`."""

    intent: str = Field(
        description=(
            "The user's question, passed through unchanged, for example "
            "'compare Dallas vs Phoenix for a 100 MW AI campus'."
        )
    )
    market: str | None = Field(
        default=None, description="Metro slug or name to pin the analysis to, e.g. 'ashburn'."
    )
    iso: str | None = Field(default=None, description="ISO/RTO code, e.g. 'PJM' or 'ERCOT'.")
    state: str | None = Field(default=None, description="US state code, e.g. 'VA'.")
    capacity_mw: float | None = Field(default=None, description="Target capacity in MW.")
    lat: float | None = Field(default=None, description="Latitude of a specific site.")
    lon: float | None = Field(default=None, description="Longitude of a specific site.")


class DCHubExecutePlan(DCHubBaseTool):
    """Answer a multi-part data-center question in one call.

    Instantiation:
        ```python
        from langchain_dchub import DCHubExecutePlan

        tool = DCHubExecutePlan()
        ```

    Invocation with args:
        ```python
        tool.invoke({"intent": "rank markets for a 200 MW AI campus"})
        ```
    """

    name: str = NAME_PREFIX + "execute_plan"
    mcp_tool_name: str = "execute_plan"
    description: str = (
        "Use this when a data-center question spans several topics (markets, grid "
        "power and interconnection queues, site selection, fiber, energy prices, "
        "incentives, water and climate risk, deals). DC Hub plans the lookups, runs "
        "them and returns every step's dated, cited result. Pass the question "
        "unchanged as intent."
    )
    args_schema: type[BaseModel] = ExecutePlanInput


# --- search_facilities --------------------------------------------------------


class SearchFacilitiesInput(BaseModel):
    """Input for `DCHubSearchFacilities`."""

    query: str | None = Field(
        default=None,
        description="Free text over facility name, operator and location, e.g. 'Ashburn'.",
    )
    country: str | None = Field(
        default=None, description="ISO 3166-1 alpha-2 country code, e.g. 'US', 'GB', 'SG'."
    )
    state: str | None = Field(default=None, description="US state code or region, e.g. 'VA'.")
    city: str | None = Field(default=None, description="City, e.g. 'Ashburn'.")
    operator: str | None = Field(default=None, description="Operator, e.g. 'Equinix'.")
    min_capacity_mw: float | None = Field(default=None, description="Minimum capacity in MW.")
    max_capacity_mw: float | None = Field(default=None, description="Maximum capacity in MW.")
    limit: int | None = Field(default=None, ge=1, le=500, description="Maximum rows (1-500).")


class DCHubSearchFacilities(DCHubBaseTool):
    """Search DC Hub's global data-center facility map.

    Instantiation:
        ```python
        from langchain_dchub import DCHubSearchFacilities

        tool = DCHubSearchFacilities()
        ```

    Invocation with args:
        ```python
        tool.invoke({"operator": "Equinix", "state": "VA", "limit": 5})
        ```
    """

    name: str = NAME_PREFIX + "search_facilities"
    mcp_tool_name: str = "search_facilities"
    description: str = (
        "Use this when the user asks which data centers exist or who operates in a "
        "city, state or country. Filters: country, state, city, operator, MW range "
        "or free text. Returns name, operator, location, market and status, with MW "
        "where disclosed. No match returns empty data: broaden the filters."
    )
    args_schema: type[BaseModel] = SearchFacilitiesInput


# --- get_market_intel ---------------------------------------------------------


class MarketIntelInput(BaseModel):
    """Input for `DCHubMarketIntel`."""

    market: str = Field(
        description="Market slug, e.g. 'northern-virginia', 'dallas', 'frankfurt', 'singapore'."
    )
    compare_to: str | None = Field(
        default=None, description="Optional second market slug to compare against."
    )


class DCHubMarketIntel(DCHubBaseTool):
    """Data-center market intelligence for one metro.

    Instantiation:
        ```python
        from langchain_dchub import DCHubMarketIntel

        tool = DCHubMarketIntel()
        ```

    Invocation with args:
        ```python
        tool.invoke({"market": "dallas"})
        ```
    """

    name: str = NAME_PREFIX + "get_market_intel"
    mcp_tool_name: str = "get_market_intel"
    description: str = (
        "Use this when the user asks about one data-center market (metro): facility "
        "count, tracked MW, status mix, top providers, recent facilities and lease "
        "pricing with its basis. Pass the market as a slug such as "
        "'northern-virginia'."
    )
    args_schema: type[BaseModel] = MarketIntelInput


# --- get_grid_data ------------------------------------------------------------


class GridDataInput(BaseModel):
    """Input for `DCHubGridData`."""

    iso: str = Field(
        description=(
            "Grid code: a US ISO (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISONE), TVA, "
            "BPA, a utility balancing authority, or a non-US grid such as NGESO, "
            "EU_DE_LU, AEMO or EMA."
        )
    )
    metric: str | None = Field(
        default=None, description="Optional focus: fuel_mix, demand or demand_curve."
    )


class DCHubGridData(DCHubBaseTool):
    """Live electricity grid data (demand and fuel mix) for one grid.

    Instantiation:
        ```python
        from langchain_dchub import DCHubGridData

        tool = DCHubGridData()
        ```

    Invocation with args:
        ```python
        tool.invoke({"iso": "ERCOT"})
        ```
    """

    name: str = NAME_PREFIX + "get_grid_data"
    mcp_tool_name: str = "get_grid_data"
    description: str = (
        "Use this when the user asks for live electricity grid data for one grid: "
        "demand, the 24-hour demand curve and the generation fuel mix, each with "
        "its own timestamp. Covers the 7 US ISOs, TVA, BPA, US utility balancing "
        "authorities and grids in Canada, Great Britain, Europe, Japan, Korea, "
        "Taiwan, Brazil, Australia and Singapore."
    )
    args_schema: type[BaseModel] = GridDataInput


# --- source_capacity ----------------------------------------------------------


class SourceCapacityInput(BaseModel):
    """Input for `DCHubSourceCapacity`."""

    min_mw: float | None = Field(
        default=None, description="Size needed in MW, matched against deliverable blocks."
    )
    min_kw: float | None = Field(default=None, description="Size needed in kW (instead of MW).")
    region: str | None = Field(
        default=None,
        description=(
            "Comma-separated regions: north_america, latin_america, europe, "
            "asia_pacific, middle_east_africa (aliases emea, apac, latam, americas)."
        ),
    )
    location: str | None = Field(
        default=None, description="Free text matched to region, country, state and metro."
    )
    market: str | None = Field(default=None, description="Market name, e.g. 'Dallas'.")
    state: str | None = Field(default=None, description="Two-letter US state, e.g. 'TX'.")
    delivery_type: Literal["land", "powered_shell", "turnkey", "colocation"] | None = Field(
        default=None, description="How the capacity is delivered."
    )
    available_by: str | None = Field(default=None, description="Month deadline, YYYY-MM.")
    limit: int | None = Field(default=None, ge=1, le=500, description="Maximum listings.")


class DCHubSourceCapacity(DCHubBaseTool):
    """Search data-center capacity listed for sale or lease (DC Hub Capacity Source).

    Instantiation:
        ```python
        from langchain_dchub import DCHubSourceCapacity

        tool = DCHubSourceCapacity()
        ```

    Invocation with args:
        ```python
        tool.invoke({"min_mw": 5, "region": "europe"})
        ```
    """

    name: str = NAME_PREFIX + "source_capacity"
    mcp_tool_name: str = "source_capacity"
    description: str = (
        "Use this when the user needs data-center or colocation capacity to buy or "
        "lease: powered land, powered shells, turnkey or colocation. Search by size "
        "(MW or kW) and location. Returns listing cards with market, capacity, "
        "delivery type and availability; provider identity is not shown."
    )
    args_schema: type[BaseModel] = SourceCapacityInput


CORE_TOOLS: tuple[type[DCHubBaseTool], ...] = (
    DCHubExecutePlan,
    DCHubSearchFacilities,
    DCHubMarketIntel,
    DCHubGridData,
    DCHubSourceCapacity,
)
"""The tools `DCHubToolkit` returns by default."""


# --- any tool from tools/list -------------------------------------------------


def clean_input_schema(schema: dict[str, Any] | None) -> dict[str, Any]:
    """Return a copy of an MCP inputSchema without the hidden parameters."""
    out = copy.deepcopy(schema or {})
    out.pop("$schema", None)
    out.setdefault("type", "object")
    props = out.get("properties") or {}
    out["properties"] = {k: v for k, v in props.items() if k not in HIDDEN_PARAMS}
    if "required" in out:
        out["required"] = [r for r in out["required"] if r not in HIDDEN_PARAMS]
        if not out["required"]:
            out.pop("required")
    return out


class DCHubMCPTool(DCHubBaseTool):
    """Any DC Hub MCP tool, built from its `tools/list` definition.

    `DCHubToolkit(load_from_server=True)` builds these. To build one by hand:

        ```python
        from langchain_dchub import DCHubMCPTool

        tool = DCHubMCPTool.from_mcp_definition(definition)
        ```
    """

    args_schema: dict[str, Any] = Field(  # type: ignore[assignment]
        default_factory=lambda: {"type": "object", "properties": {}}
    )

    @classmethod
    def from_mcp_definition(
        cls,
        definition: dict[str, Any],
        *,
        name_prefix: str = NAME_PREFIX,
        **kwargs: Any,
    ) -> DCHubMCPTool:
        """Build a tool from one entry of the server's `tools/list` result."""
        mcp_name = definition["name"]
        return cls(
            name=f"{name_prefix}{mcp_name}",
            mcp_tool_name=mcp_name,
            description=definition.get("description") or mcp_name,
            args_schema=clean_input_schema(definition.get("inputSchema")),
            **kwargs,
        )
