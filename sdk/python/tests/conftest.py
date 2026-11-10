"""Shared setup for the SDK tests.

Several tests call the live DC Hub server. Mark them as DC Hub's own run so its usage counts
drop them (dchub-backend routes/mcp_funnel_events.OWN_SDK_RUN_UA_MARK): the MCP client appends
DCHUB_UA_SUFFIX to its User-Agent, and the marker changes nothing in the response.
"""
import os

os.environ.setdefault("DCHUB_UA_SUFFIX", "(dc-own-run)")
