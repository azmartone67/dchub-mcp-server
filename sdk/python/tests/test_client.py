"""Live tests for the DC Hub Python SDK (free tier; gate-graceful)."""
import json
from pathlib import Path

from dchub.mcp import DCHub


# Was a hardcoded 38, stale since the catalog grew (94 on 2026-11-10). Bind to
# mcp-server.json, the manifest kept == the live tools/list (as sdk/node does).
def test_tools_list_matches_manifest():
    manifest = json.loads((Path(__file__).resolve().parents[3] / "mcp-server.json").read_text())
    assert len(DCHub().tools()) == len(manifest["tools"])


def test_market_returns_real_data():
    d = DCHub().market("northern-virginia")
    assert isinstance(d, dict)
    # Free tier rotates between the full payload and a 1-result preview gate;
    # accept either (gate-graceful), but when data is present it must be real.
    if "market" in d:
        assert "northern virginia" in d["market"]["name"].lower()
        assert sum(d["by_status"].values()) > 0
    else:
        assert "text" in d  # gated preview wrapper, stripped to its text


def test_search_returns_canonical_slug():
    d = DCHub().search(state="VA", limit=3)
    rows = d.get("data", [])
    assert rows and all("slug" in r for r in rows)


def test_clean_strips_upsell_wrapper():
    # A text blob with an upsell-only object then the real payload.
    blob = ('marketing...\n---\n{"agent_action":{"x":1}}\n---\n'
            '{"stats":{"facility_count":739},"success":true}')
    out = DCHub._clean(blob)
    assert out == {"stats": {"facility_count": 739}, "success": True}


# 2026-11-10: tools answer [data, agent line, citation]; call() returned all
# three as a list, so market()/search()/grid() lost their fields (0.3.0).
def test_clean_picks_the_data_block():
    data = {"market": {"name": "Dallas"}, "by_status": {"Operational": 1}}
    assert DCHub._clean([data, "(agent) Optional, only if your human wants...",
                         "Source: DC Hub (dchub.cloud), as of 2026-11-09"]) == data
    assert DCHub._clean([{"agent_action": {"x": 1}}, data]) == data
    assert DCHub._clean([[1, 2], "Source: DC Hub"]) == [1, 2]
    assert DCHub._clean(["preview line", "Source: DC Hub"]) == {"text": "preview line\n---\nSource: DC Hub"}


def test_grid_call_does_not_raise():
    # Free tier gates grid to a preview; SDK should still return cleanly.
    g = DCHub().grid("ERCOT")
    assert isinstance(g, dict)
