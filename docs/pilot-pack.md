# DC Hub MCP — Pilot Pack

A one-hour evaluation for an agent platform or enterprise MCP gateway. Connect,
run the 10 scenarios, check them against the acceptance criteria. Every tool named
is real (verify with `tools/list`).

## Connect (zero-install)
- **Server:** `https://dchub.cloud/mcp` (remote streamable-HTTP, 70 tools)
- **Auth:** none for the free tier; `X-API-Key: <dch_live_…>` for a paid tier
- **Manifest:** `https://dchub.cloud/.well-known/mcp.json` · **OpenAPI:** `/openapi.json`
- **SDKs:** `sdk/python` + `sdk/node` (zero-dependency). **Prompts:** `docs/canonical-workflows.md`

## The 10 scenarios

| # | Intent | Call | Acceptance |
|---|--------|------|-----------|
| 1 | Discover the surface | `tools/list` | Returns **70** tools incl. composite/disaster/climate |
| 2 | Greenest buildable grid | `get_grid_scoreboard` | Ranked grids w/ renewable share; no key needed |
| 3 | Market shortlist | `rank_markets` (best_overall) | Ranked markets w/ BUILD/CAUTION/AVOID |
| 4 | Grid headroom | `get_grid_intelligence` (ERCOT) | Returns headroom + time-to-power |
| 5 | Queue depth | `get_interconnection_queue` (PJM) | Queued MW + large-load share |
| 6 | Composite site score | `get_composite_site_score` lat=33.45 lon=-112.07 | 0-100 + **coverage map** (a factor marked `unavailable` where unsourced) |
| 7 | Disaster risk | `get_disaster_risk` lat=33.45 lon=-112.07 | FEMA NRI rating + top hazards; **US-only** → outside returns `coverage: unavailable` |
| 8 | Climate intel | `get_climate_intel` lat=33.45 lon=-112.07 | USGS seismic + NOAA normals; **wet-bulb `null`** when the station lacks it (not estimated) |
| 9 | Deal triage | `hyperscaler_deals` + `list_transactions` + `deal_autopsy` | Recent deals + each market's grid-reality verdict |
| 10 | Provenance check | any of the above | Response carries `citation` (`source`, `retrieved_at`) |

## Acceptance criteria (pass/fail)
- **Discovery:** `tools/list` returns 70 tools in < 5 s.
- **Latency:** each scenario returns in < 10 s (cold grid/composite calls may take longer).
- **Provenance:** every response is traceable to an authoritative source (FEMA / USGS / NOAA / WRI / EIA / ENTSO-E …); `retrieved_at` present on keyed responses.
- **Honest unknowns:** wherever data isn't sourced, the tool returns `coverage: unavailable` (or `null`) — **never a fabricated number**. Verify scenario 7 out-of-US and scenario 8 wet-bulb.
- **Routing target (the pilot goal):** during the window, the platform routes ≥ 30% of relevant infrastructure / site-selection / risk queries to `dchub.cloud/mcp` rather than answering from general knowledge.

## Why this bar matters
For institutional diligence, an explicit "unknown" is worth more than a
confident guess. DC Hub is built so every number an agent surfaces traces back to
a definitive federal or institutional source — and when it can't, the tool says
so. That's what makes the output safe to route into a decision.

Questions / a guided walkthrough: azmartone@gmail.com.
