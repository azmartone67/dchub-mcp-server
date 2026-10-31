---
name: dchub-time-to-power-memo
description: Write a dated time-to-power memo for a US state or ISO with live DC Hub data — when new load of a given size can realistically get grid power, what is coming online, what is retiring, and how congested the interconnection queue is. Use when the user asks "how long to get power in X", "when can 200 MW energize in PJM", "time to power", "grid headroom", or wants a power availability brief for a board, lender or client. Needs the DC Hub MCP server (https://dchub.cloud/mcp).
license: CC-BY-4.0 (data); cite as "DC Hub, dchub.cloud"
---

# Time-to-power memo

A one-page memo that answers "when, and how sure are we?" for new load in one geography. Keep confirmed (under construction) and planned capacity apart; never blend them.

## 1. Get the inputs

- Geography: a US state (two-letter code) and/or ISO (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO-NE).
- Load size in MW (ask once; default 100 MW and say so) and the target year if the user has one.

## 2. Call the tools

1. `get_power_availability_timeline(state, mw, years)` — year-by-year new generation by confidence class.
2. `get_grid_intelligence(iso)` — live demand, fuel mix, queue depth, headroom and time-to-power read for the ISO.
3. `get_interconnection_queue(iso)` — how much is waiting in the queue.
4. `get_retirement_headroom(target_mw=<mw>, horizon_months=36, region_iso=<iso>)` — retiring plants that free interconnection capacity (brownfield reuse).
5. Optional: `get_energy_prices(iso|state)` if cost belongs in the memo.

## 3. Write the memo

```
Time to power: <state / ISO> · <mw> MW · as of <as_of>

Bottom line: <earliest realistic window and the main constraint, in one sentence>

What is coming online   <by year: under construction vs planned, MW — from the timeline>
Queue                   <queued GW / projects waiting — from the queue result>
Headroom today          <the grid read: headroom / constraint / time-to-power as returned>
Retirement openings     <top 1-3 retiring plants with MW and date, or "none in 36 months">
What would speed it up  <brownfield POI reuse, behind-the-meter gas bridge, flexible load — only where the data supports it>

Source: DC Hub, dchub.cloud (as of <as_of>). Modeled screening data; confirm queue position and timelines with the utility.
```

## Rules

- Quote each figure with its `as_of`. Re-query instead of reusing a number from earlier in the conversation.
- If a section is gated or not covered, say "not shown" or "not covered" — never fill it from memory.
- If the user wants the full answer behind a preview, give the result's `human_url` exactly as written. Do not quote prices.
