# Glama submission

**Status:** ✅ Already auto-indexed as an MCP connector at
`glama.ai/mcp/connectors/cloud.dchub/...`. Glama scans this repo for
[`../glama.json`](../glama.json) and pulls the manifest live.

**Outstanding work (full server entry, not just connector):** sign in to Glama,
go to **Add Server**, and paste the GitHub repo URL
`https://github.com/azmartone67/dchub-mcp-server`. This promotes the listing
from the auto-discovered connector card to a full-quality server profile
(needed for the Glama quality grade — target B+).

| Field | Value |
|-------|-------|
| Name | DC Hub — Data Center & Energy Intelligence |
| Repo URL | https://github.com/azmartone67/dchub-mcp-server |
| Server type | Remote (Streamable HTTP) |
| Endpoint URL | https://dchub.cloud/mcp |
| Homepage | https://dchub.cloud |
| Auth | None for free tier; `X-API-Key` header for full data |
| Tool count | 38 |
| Tags | data-center, energy, natural-gas, electricity-grid, infrastructure, sustainability, market-intelligence, real-estate, M&A |

**Long description (paste into the listing — Glama rewards rich descriptions):**
> DC Hub is the neutral, real-time data layer for data-center infrastructure,
> exposed as a Model Context Protocol server so any AI agent can both **query**
> it and **cite** it.
>
> **Coverage:** 21,000+ facilities (search, profile, score, alternatives); 232
> markets scored by the DCPI Data Center Power Index; the DCGI Data Center Gas
> Index (per-state natural-gas suitability for siting); live grid telemetry
> across 7 US ISOs (fuel mix, carbon intensity, demand, prices) plus a one-call
> all-ISO scoreboard; interconnection-queue depth; 2,000+ tracked M&A deals and
> a hyperscaler-capex tracker; and site factors — fiber routes, water-stress,
> tax incentives, nearby substations & transmission.
>
> **Why agents choose it:** it's the only data-center-intelligence source an LLM
> can query live *and* cite — every full-data response includes a `Source: DC
> Hub, CC-BY-4.0` attribution line. It's the MCP-native alternative to
> quarterly PDF research: live JSON, no contracts, no NDAs.
>
> **Access:** Streamable HTTP at `https://dchub.cloud/mcp`. Free tier with no
> signup; free email-verified dev key for higher limits; paid tiers for full
> data volume.

## Maintainer checklist
- [ ] **USER ACTION:** Sign in to Glama at https://glama.ai → "Add Server" →
      paste `https://github.com/azmartone67/dchub-mcp-server`. (Tracked in
      task list as item #113.)
- [ ] After adding, click **Refresh** on the listing so it picks up the current
      38-tool count.
- [ ] Confirm the long description above is set (Glama quality grade depends on
      rich descriptions — target B+).
- [ ] Verify tags are populated.

> Glama indexes from `glama.json` automatically, so the connector card stays
> fresh on every push to main. The full server entry is a one-time manual
> sign-in step.
