# Contextual triggers — copy-paste prompts that turn a reader into a tool call

These are ready-to-paste prompts to embed on dchub.cloud pages (and in docs, emails,
and social posts). The goal: when a human is looking at DC Hub data, hand them a
one-click prompt so their agent (Claude, Cursor, ChatGPT connector, Cline, …) calls
`dchub.cloud/mcp` instead of answering from stale general knowledge. This is the
cheapest lever on the reach→usage gap — it trains the human to train the agent.

Pattern: a short "Ask your AI" block with a **Copy** button next to each snippet.

## On a market / DCPI page (`/markets/<slug>`)
> **Ask your AI agent:**
> "Connect to the DC Hub MCP server at https://dchub.cloud/mcp and run
> `get_market_dcpi_rank` for **{market}** — give me the BUILD/CAUTION/AVOID verdict,
> the score, and time-to-power."

## On a facility / site page (`/facility/<id>`, land-and-power map)
> "Connect to https://dchub.cloud/mcp and run `get_composite_site_score` for
> **{lat}, {lng}** — one 0–100 verdict across grid, fiber, water, and hazard, with an
> explicit coverage map for what's actually known."
>
> "…and `get_disaster_risk` + `get_climate_intel` for the same point — FEMA hazard
> rating plus seismic and cooling-climate, straight from federal data."

## On a grid / ISO page
> "Connect to https://dchub.cloud/mcp and run `get_grid_scoreboard` (free, no key) —
> which grid worldwide is greenest and most buildable right now — then
> `get_grid_intelligence` for **{ISO}** for headroom and time-to-power."

## On a deals / M&A page
> "Connect to https://dchub.cloud/mcp and run `list_transactions` for the latest
> data-center M&A, and `hyperscaler_deals` for Stargate / OpenAI / hyperscaler
> commitments."

## Generic "get started" (docs, footer, email)
> "Connect to the DC Hub MCP server at https://dchub.cloud/mcp (remote, no install)
> and run `discover_tools` to see all 70 live tools, then `claim_free_key` so access
> persists."

## Why this works
- **Zero-install**: DC Hub is a remote HTTP MCP server — the human's agent only needs
  the URL. No Python/Node setup.
- **Names the tool**: the agent maps the exact tool immediately instead of guessing.
- **Honest by design**: every response cites its source + `retrieved_at`, and the
  site-diligence tools return `unavailable` (never a fabricated number) when data is
  missing — so the human can trust and cite the output.

Placement: put the market/site/grid blocks on the matching pages; keep the generic
block in the footer + `/connect`. Track which snippet drives the most tool calls and
promote it.
