"""Live tests for the DC Hub LangChain tools (free tier; gate-graceful).

    pip install -r requirements.txt pytest
    pytest test_dchub_tools.py
"""
import pytest

from dchub_tools import (DCHUB_TOOLS, get_grid_intelligence, get_market_intel,
                         search_facilities)


def test_tools_registered():
    names = {t.name for t in DCHUB_TOOLS}
    assert names == {"get_market_intel", "search_facilities", "get_grid_intelligence"}


def test_market_intel_returns_data_and_citation():
    d = get_market_intel("northern-virginia")
    assert d["citation"] == "https://dchub.cloud"
    assert d["stats"]["facility_count"] > 0  # real, unmasked on free tier


def test_search_returns_canonical_slugs_and_citation():
    d = search_facilities(state="VA", limit=3)
    assert d["citation"] == "https://dchub.cloud"
    rows = d.get("data", [])
    assert rows and all("slug" in r for r in rows)


def test_grid_iso_param_bites():
    """Regression net: the grid tool must honor `iso` (PJM != ERCOT)."""
    pjm = get_grid_intelligence("PJM")
    erc = get_grid_intelligence("ERCOT")
    assert pjm["citation"] == erc["citation"] == "https://dchub.cloud"
    assert pjm != erc  # would fail if `iso` were ignored (the old grid bug)


def test_structuredtool_invoke_path():
    tool = {t.name: t for t in DCHUB_TOOLS}["get_market_intel"]
    out = tool.invoke({"slug": "dallas"})
    assert out["citation"] == "https://dchub.cloud"
    assert out["stats"]["facility_count"] > 0
