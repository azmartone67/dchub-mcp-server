"""Live smoke tests against the free DC Hub endpoints.

These hit the real API (no key required). Run with:  pytest -q
Set DCHUB_API_KEY to exercise the keyed path (optional).
"""
import os

from dchub import DCHub

TIMEOUT = 15


def _client():
    return DCHub(api_key=os.environ.get("DCHUB_API_KEY"), timeout=TIMEOUT)


def test_import_clean():
    import dchub  # noqa: F401

    assert dchub.__version__


def test_stats_returns_facility_count():
    data = _client().stats()
    # /api/v1/stats wraps payload in "data"
    payload = data.get("data", data)
    notes = payload.get("_facility_count_notes", {})
    count = notes.get("primary_count") or notes.get("discovered_total")
    if count is None:
        # fall back: any integer count-ish field present
        count = payload.get("facilities") or payload.get("total_facilities")
    assert count is None or int(str(count).split()[0]) if isinstance(count, str) else True
    assert notes.get("discovered_total", 0) > 1000, notes


def test_dcpi_phoenix_is_free_and_numeric():
    d = _client().get_market_dcpi_rank("phoenix")
    assert isinstance(d.get("composite_score"), (int, float)), d
    assert d["composite_score"] > 0
    # Known-live values at build time: composite ~21.3, verdict AVOID.
    assert "verdict" in d
    assert "time_to_power_months" in d


def test_ai_capacity_index_returns_markets():
    d = _client().ai_capacity_index(horizon=90)
    markets = d.get("markets") or d.get("rankings") or d.get("data")
    assert isinstance(markets, list) and len(markets) > 0, d


def test_rank_markets_returns_results():
    d = _client().rank_markets(by="composite")
    results = d.get("results") or d.get("data")
    assert isinstance(results, list) and len(results) > 0, d


def test_generic_call_matches_concrete():
    dc = _client()
    a = dc.call("get_market_dcpi_rank", slug="phoenix")
    b = dc.get_market_dcpi_rank("phoenix")
    assert a["market_slug"] == b["market_slug"]


if __name__ == "__main__":
    dc = _client()
    print("stats build:", dc.stats().get("build"))
    px = dc.get_market_dcpi_rank("phoenix")
    print("phoenix composite_score:", px["composite_score"], "verdict:", px.get("verdict"))
    aci = dc.ai_capacity_index()
    print("ai_capacity_index markets:", len(aci.get("markets", [])))
    print("OK")
