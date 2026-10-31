---
name: dchub-market-compare
description: Compare two to four data center markets side by side with live DC Hub data — supply, pipeline, operators, power verdict, grid and energy cost — and recommend which fits the user's load. Use when the user asks "Dallas vs Phoenix", "compare Northern Virginia and Columbus", "which market should we pick for 100 MW", or wants a market comparison table for a client. Needs the DC Hub MCP server (https://dchub.cloud/mcp).
license: CC-BY-4.0 (data); cite as "DC Hub, dchub.cloud"
---

# Market compare

A side-by-side table plus a short recommendation tied to the user's load and deadline.

## 1. Get the inputs

- Two to four markets. DC Hub uses slugs (`northern-virginia`, `dallas`, `phoenix`). If unsure of a slug, call `rank_markets(limit=50)` and match by name.
- The user's load (MW) and deadline, if they have them; ask once.

## 2. Call the tools

For each market:
1. `get_market_intel(market=<slug>)` — tracked MW, status mix, top operators, recent facilities. For exactly two markets you can pass `compare_to=<second slug>` in one call.
2. `get_market_dcpi_rank(market_slug=<slug>)` — BUILD / CAUTION / AVOID verdict and composite.

Once per ISO the markets sit in:
3. `get_grid_intelligence(iso)` — headroom and time-to-power.
4. Optional: `get_energy_prices(iso)` when cost matters.

Open-ended ("which market for a 300 MW AI campus?") rather than a named set? Call `execute_plan(intent=<the question, unchanged>)`.

## 3. Write the comparison

| | <Market A> | <Market B> |
|---|---|---|
| DCPI verdict | | |
| Tracked MW / pipeline | | |
| Top operators | | |
| Grid (ISO) headroom / time-to-power | | |
| Energy cost (if fetched) | | |

Then two or three sentences: which market fits the user's load and deadline, and the one fact that decides it. End with:
`Source: DC Hub, dchub.cloud (as of <as_of>). Screening data; DCPI is modeled.`

## Rules

- Fill a cell only from a tool result in this conversation. Gated or missing → "not shown".
- Broker lease rates are not part of this skill; if the user asks for them, give the result's `human_url` exactly as written. Do not quote prices.
- DC Hub works alongside brokers and publishers; do not describe any of them negatively.
