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


def test_stats_returns_counts():
    data = _client().stats()
    payload = data.get("data", data)
    # The headline facility count is withheld by design ("corroborated count
    # pending", owner contract); /api/v1/stats still serves its basis notes and
    # the other counts.
    assert "_facility_count_notes" in payload, payload
    assert "facility_count_status" in payload, payload
    assert payload.get("total_countries", 0) > 0, payload

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
