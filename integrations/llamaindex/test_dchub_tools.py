"""Live tests for the DC Hub LlamaIndex tools (free tier; gate-graceful).

    pip install -r requirements.txt pytest
    pytest test_dchub_tools.py
"""
from dchub_tools import (DCHUB_TOOLS, dchub_grid, dchub_market_intel,
                         dchub_search_facilities)


def test_tools_registered():
    names = {t.metadata.name for t in DCHUB_TOOLS}
    assert names == {"dchub_market_intel", "dchub_search_facilities", "dchub_grid"}


def test_market_intel_returns_data_and_citation():
    d = dchub_market_intel("northern-virginia")
    assert d["citation"] == "https://dchub.cloud"
    assert d["stats"]["facility_count"] > 0


def test_search_returns_canonical_slugs_and_citation():
    d = dchub_search_facilities(state="VA", limit=3)
    assert d["citation"] == "https://dchub.cloud"
    rows = d.get("data", [])
    assert rows and all("slug" in r for r in rows)


def test_grid_iso_param_bites():
    """Regression net: the grid tool must honor `iso` (PJM != ERCOT)."""
    pjm = dchub_grid("PJM")
    erc = dchub_grid("ERCOT")
    assert pjm["citation"] == erc["citation"] == "https://dchub.cloud"
    assert pjm != erc


def test_functiontool_call_path():
    tool = {t.metadata.name: t for t in DCHUB_TOOLS}["dchub_market_intel"]
    out = tool.call(slug="dallas").raw_output
    assert out["citation"] == "https://dchub.cloud"
    assert out["stats"]["facility_count"] > 0
