---
name: dchub-site-screen
description: Screen a data center site or search area with live DC Hub data and write a one-page go / caution / no-go screen. Use when the user gives a coordinate, address, parcel or county and asks "does this site work", "screen this site", "is this a good data center site", or wants candidate areas for a target MW in a state or ISO. Needs the DC Hub MCP server (https://dchub.cloud/mcp).
license: CC-BY-4.0 (data); cite as "DC Hub, dchub.cloud"
---

# Site screen

Produce a short, cited first-pass screen for one site (or a shortlist when the user has no site yet). It is a screening read, not a utility study: say so in the last line.

## 1. Get the inputs

- A site: `lat` + `lon` (geocode an address yourself, and say you did), and the target `capacity_mw` (ask once; default 100 MW and say so).
- No site yet: a state, ISO or region plus the target MW and a deadline in months.

## 2. Call the tools

**One site:**
1. `analyze_site(lat, lon, capacity_mw)` — composite, verdict, power, gas, fiber, market and risk reads, nearby infrastructure.
2. `get_grid_intelligence(iso=<the ISO analyze_site names>)` — headroom, queue depth, time-to-power for that grid.
3. Only if the user cares about it: `get_water_risk`, `get_disaster_risk`, `get_tax_incentives(state)`.

**No site yet:**
1. `site_selection_canvas(capacity_mw, state|iso|region, max_months)` — ranked shortlist of markets.
2. `find_sites(state, min_voltage_kv, max_gas_km, max_fiber_km)` — candidate search areas inside the top market.
3. Then screen the best candidate with the one-site steps above.

Multi-part question in one sentence ("best site in Texas for 300 MW with gas and fiber")? Call `execute_plan(intent=<the question, unchanged>)` instead and write the screen from its results.

## 3. Write the screen

```
Site screen: <name or lat, lon> · <capacity_mw> MW · as of <as_of>
Verdict: <BUILD / CAUTION / AVOID as returned> — <one-line reason: the limiting factor>
Power:   <substation / kV / distance, ISO headroom, time-to-power>
Gas:     <nearest pipeline + distance, or "not a gas site">
Fiber:   <nearest route / provider + distance>
Risk:    <the top hazard returned, if any>
Next:    <the one check that would change the verdict>
Source: DC Hub, dchub.cloud (as of <as_of>). Screening only; confirm with the utility.
```

## Rules

- Every figure comes from a tool result in this conversation, with its `as_of`. If a field is gated or missing, write "not shown" — never estimate it.
- If a result carries `human_url` or `unlock_url`, give it to the user exactly as written when they want the full report. Do not quote prices.
- Offer `save_site` (and `set_site_alert` with the user's email) so the user is told when the site's score or grid moves.
