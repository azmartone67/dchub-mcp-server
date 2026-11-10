"""The optional User-Agent suffix on the MCP client (offline)."""
import re

from dchub.mcp import DCHub, user_agent

BARE = re.compile(r"^dc-sdk-python/\d+\.\d+\.\d+$")


def test_suffix_is_appended_when_printable_and_short():
    assert re.match(r"^dc-sdk-python/\d+\.\d+\.\d+ \(dc-own-run\)$", user_agent("(dc-own-run)"))
    assert BARE.match(user_agent(None)) and BARE.match(user_agent("  "))


def test_unsafe_or_long_suffix_is_dropped():
    assert user_agent("bad\r\nX-Inject: 1") == user_agent(None)
    assert user_agent("x" * 61) == user_agent(None)


def test_client_header_reads_the_option_then_the_env(monkeypatch):
    assert DCHub(ua_suffix="(acme)")._headers()["User-Agent"] == user_agent("(acme)")
    monkeypatch.setenv("DCHUB_UA_SUFFIX", "(dc-own-run)")
    assert DCHub()._headers()["User-Agent"] == user_agent("(dc-own-run)")
    monkeypatch.delenv("DCHUB_UA_SUFFIX")
    assert BARE.match(DCHub()._headers()["User-Agent"])


def test_the_test_run_itself_is_marked():
    # conftest.py: every live test in this suite runs as DC Hub's own run.
    import os
    assert os.environ.get("DCHUB_UA_SUFFIX") == "(dc-own-run)"
