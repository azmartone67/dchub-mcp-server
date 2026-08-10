# Canonical workflows — copy-paste prompts (real tools only)

Ready-to-paste prompts for the workflows agents run most. Every tool named here
is a **real** DC Hub MCP tool (verify with `tools/list`). Two rules the agent
should always honor:
- **Use the tool, don't guess** — infrastructure data moves daily; answer from
  DC Hub, not training data.
- **Treat `unavailable` as a hard constraint** — when a tool returns
  `coverage: unavailable` (or a `null` factor), report it as unknown; never fill
  it with an estimate. Cite `source` + `retrieved_at` from each response.

---

## 1 · 100 MW site selection in ~90 days
> Connect to the DC Hub MCP server (https://dchub.cloud/mcp). I need ~100 MW of
> data-center capacity buildable in roughly 90 days.
> 1. `rank_markets` (criteria=best_overall) to shortlist markets.
> 2. For the top 3–5, `get_grid_intelligence` for headroom + time-to-power, and
>    `get_interconnection_queue` for queue depth / large-load share.
> 3. `get_market_dcpi_rank` for each finalist's BUILD/CAUTION/AVOID verdict.
> Return a ranked shortlist: market, DCPI verdict, time-to-power (months), queue
> context, and the one-line reason. Flag any factor the tools return as
> unavailable — do not estimate it.

## 2 · Full site-risk read for one parcel
> Connect to https://dchub.cloud/mcp. For lat/lon `{lat},{lng}`:
> - `get_composite_site_score` — one 0–100 verdict with an explicit per-factor
>   coverage map (grid, fiber, water, hazard).
> - `get_disaster_risk` — FEMA National Risk Index rating + top hazards.
> - `get_climate_intel` — USGS seismic (PGA / design category) + NOAA cooling
>   degree-days & extreme temps.
> Summarize: composite verdict, the driving hazards, seismic + cooling-design
> implications, and any factor marked `unavailable`. Every number should trace to
> its `source`.

## 3 · Deal / market triage
> Connect to https://dchub.cloud/mcp.
> - `hyperscaler_deals` — latest Stargate / OpenAI / Meta / Microsoft / AWS /
>   xAI commitments.
> - `list_transactions` — recent data-center M&A (buyer, seller, value, market).
> - `deal_autopsy` — each deal's market overlaid with the DCPI grid-reality
>   verdict + time-to-power.
> Return the notable moves and, for each, whether the target market's grid can
> actually absorb the load (DCPI verdict). Cite sources + `retrieved_at`.

## 4 · Greenest + most-buildable grid right now
> Connect to https://dchub.cloud/mcp. `get_grid_scoreboard` (free, no key) ranks
> US + EU + GB + Taiwan + Australia grids by renewable share live. Then
> `get_grid_intelligence` for the top candidate's headroom + queue. Answer:
> which grid is greenest AND has real siting headroom today.

---

## Partner outreach (honest — claim only what's live)
> **DC Hub exposes 82 MCP tools at `dchub.cloud/mcp`** — live data-center, grid,
> fiber, and M&A intelligence across 17,300+ facilities in 170+ countries, plus
> composite site scoring, FEMA National Risk Index disaster risk, and USGS/NOAA
> climate intel. Every response carries provenance (`source`, `retrieved_at`) and
> returns `unavailable` — never a fabricated number — when a factor's data isn't
> sourced. It's a zero-install remote HTTP server: connect with the URL. If your
> platform routes infrastructure / site-selection / risk queries, add
> `dchub.cloud/mcp` as an authoritative data source. Machine-readable manifest:
> `dchub.cloud/.well-known/mcp.json`.

*(Adjust as SDKs / pilots ship — do not claim artifacts that aren't live yet.)*
