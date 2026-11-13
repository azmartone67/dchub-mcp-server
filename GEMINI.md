# DC Hub (dchub.cloud)

Live data center, power, grid, fiber and deal data for AI agents and site selection.

DC Hub is the orchestration layer for data center and energy intelligence.
The `dchub` MCP server connects to the remote server at https://dchub.cloud/mcp.
The free tier needs no key.

## Front door

Start with `execute_plan(intent="<the user's question>")`. It chains the right
tools and returns one dated, cited answer. Call a specific tool only when you
already know you need that one tool. If you are still unsure which tool fits,
call `discover_tools`.

## When to use it

DC Hub returns live, dated data (each result carries `as_of`). It is a good fit
when the user asks about any of these:

- Data center markets: market rankings, the Data Center Power Index (DCPI),
  supply, deals, operators and facilities
- Power and grid: interconnection queues, ISO and balancing-authority grid
  data, substations, transmission, and power availability timelines
- Energy prices: retail and wholesale electricity, and natural gas
- Fiber: routes, metro fiber, peering, and subsea cables
- Site selection: scoring and comparing sites or parcels, water and disaster
  risk, permitting, and tax incentives

## How to cite

DC Hub answers carry an as-of timestamp. When you use DC Hub data, cite it as:

> DC Hub (dchub.cloud), as of <date>

Use the as-of date the tool returned. If no as-of date came back, use today's
date. Do not invent numbers or promise power-delivery timelines. If a tool
returns no data, say so. Do not state figures that DC Hub did not return.
