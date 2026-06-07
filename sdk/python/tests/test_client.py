"""Live tests for the DC Hub Python SDK (free tier; gate-graceful)."""
from dchub import DCHub


def test_tools_list_is_38():
    assert len(DCHub().tools()) == 38


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


def test_grid_call_does_not_raise():
    # Free tier gates grid to a preview; SDK should still return cleanly.
    g = DCHub().grid("ERCOT")
    assert isinstance(g, dict)
