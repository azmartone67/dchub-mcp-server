<!-- phase76_readme_polish -->
# DC Hub MCP Server

**Real-time data-center, power & energy intelligence for AI agents.**

The only MCP server combining facility data, infrastructure, and live grid intelligence into one queryable interface. Built for Claude, Cursor, Cline, Continue, and any AI assistant doing data center site selection, energy analysis, or market research.

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP-0098FF?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=dchub&config=%7B%22name%22%3A%20%22dchub%22%2C%20%22type%22%3A%20%22http%22%2C%20%22url%22%3A%20%22https%3A//dchub.cloud/mcp%22%7D) [![Add to Cursor](https://img.shields.io/badge/Cursor-Add_MCP-black?logo=cursor)](https://cursor.com/install-mcp?name=dchub&config=eyJ1cmwiOiAiaHR0cHM6Ly9kY2h1Yi5jbG91ZC9tY3AifQ%3D%3D) [![smithery badge](https://smithery.ai/badge/azmartone67/dchub)](https://smithery.ai/servers/azmartone67/dchub) [![Glama score](https://glama.ai/mcp/servers/azmartone67/dchub-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/azmartone67/dchub-mcp-server) [![Tools](https://img.shields.io/badge/tools-49-blue)](https://dchub.cloud/.well-known/mcp.json) [![Used by](https://img.shields.io/badge/used%20by-Claude%20%C2%B7%20Cursor-green)](https://dchub.cloud/cited-by)

> ⭐ **Find DC Hub useful? [Star the repo](https://github.com/azmartone67/dchub-mcp-server)** — stars help agents (and people) discover it across the MCP registries.

---

## What you can do with it

```
"What's the current grid headroom in PJM?"
"Show me AWS data center construction pipeline in Ohio"
"Compare ERCOT vs PJM capacity prices over the last 30 days"
"Find data centers within 50km of Northern Virginia substations >230kV"
"What's the live demand and generation mix in CAISO right now?"
"Is behind-the-meter gas power cheaper than the grid in Texas?"
"What's the grid mix in Atlanta (SOCO) and is power available?"
"Get fiber routes between Ashburn and Atlanta"
```

Your AI assistant gets real-time, structured answers — not links to PDFs.

## What's inside

- **21,000+ data center facilities** across 170+ countries — operator, capacity, location, fiber connectivity
- **126,427 substations** with voltage class, available capacity estimates
- **Real-time grid telemetry** — live load + generation mix across the 7 US ISOs (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO-NE) + 40+ EIA balancing authorities (Atlanta, Carolinas, Florida, Pacific NW...), plus Great Britain (NESO), 24 European ENTSO-E zones, Taiwan & Australia — refreshed ~every 5 min
- **Interconnection-queue snapshots** with per-ISO BUILD/CAUTION/AVOID verdicts (e.g. ERCOT ~225 GW of data-center load in the interconnection queue)
- **2,000+ tracked M&A transactions** + AI capacity index + hyperscaler $1B+ deal tracker
- **Transmission lines, gas pipelines, fiber routes** — the full infrastructure stack
- **NEPA filings** for upcoming federal energy + data center projects
- **Tax incentives** by state with eligibility details
- **Market intelligence** — 232 US power markets scored daily with DCPI BUILD/CAUTION/AVOID verdicts, plus facilities tracked across 170+ countries

**49 MCP tools** across facility search, market intel, grid + interconnection, renewable-energy, site analysis, deals, fiber routing, and infrastructure. [Full tool list →](https://dchub.cloud/integrations/mcp)

**Actively used by Claude and Cursor** — see [/cited-by](https://dchub.cloud/cited-by).

## Guided prompts & resources

Beyond the 49 tools, DC Hub ships **6 guided prompts** — they surface as slash-commands in Claude Desktop, Cursor, and other MCP clients:

- `/dchub:analyze-site` — full buildability read for an address or lat,lon
- `/dchub:pick-a-market` — where to build N MW (DCPI-ranked, with time-to-power)
- `/dchub:power-availability` — headroom + time-to-power for an ISO
- `/dchub:site-report` — premium one-page site brief (power · gas · fiber · market · risk)
- `/dchub:compare-markets` — 2–4 markets head-to-head
- `/dchub:fiber-plan` — diverse fibre lead-in routes to a carrier hotel

Plus citable **resources**: `dchub://about`, `dchub://methodology` (DCPI/DCGI), `dchub://data-sources`, `dchub://coverage`.

## Why DC Hub vs other directories

|                          | DC Hub | datacenters.com | dcbyte | baxtel |
|--------------------------|:------:|:---------------:|:------:|:------:|
| Live grid data           |   ✅   |        ❌       |   ❌   |   ❌   |
| MCP / AI integration     |   ✅   |        ❌       |   ❌   |   ❌   |
| Facility + infra + grid  |   ✅   |        ❌       |   ❌   |   ❌   |
| Real-time API            |   ✅   |        ❌       |   ❌   |   ❌   |
| NEPA filings             |   ✅   |        ❌       |   ❌   |   ❌   |
| Free dev tier            |   ✅   |        ❌       |   ❌   |   ✅   |

Their strength: directories of facilities you can browse. Our strength: an API your AI assistant can query in real time across the full infrastructure stack.

## Install

### Claude Desktop / Claude Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp",
      "transport": "http"
    }
  }
}
```

### Cursor

Search for "DC Hub" in [Cursor MCP marketplace](https://cursor.directory/plugins/dc-hub) → click Install.

### Cline / Continue.dev

```json
{
  "name": "dchub",
  "url": "https://dchub.cloud/mcp",
  "transport": "http"
}
```

### Smithery.ai

Listed at [smithery.ai/servers/azmartone67/dchub](https://smithery.ai/servers/azmartone67/dchub). Add via Smithery CLI:

```
npx -y @smithery/cli install @azmartone67/dchub --client claude
```

## Pricing

- **Anonymous:** 10 calls/day, no API key needed
- **Free key (email signup, ~60 sec):** [https://dchub.cloud/signup](https://dchub.cloud/signup) — 50 calls/day
- **Starter ($9/mo):** 200 calls/day → [Stripe](https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g)
- **Developer ($49/mo):** 500 calls/day, full field access → [Stripe](https://buy.stripe.com/7sY5kE8F4fs13mI0PEaZi0c)
- **Pro ($299/mo):** 2,000 calls/day + bulk export, historical data
- **Enterprise (custom):** 100,000 calls/day, dedicated support, custom integrations
- **Credit pack:** $10 one-time = 1,000 API calls (no subscription) → [Stripe](https://buy.stripe.com/9B69AU08y2FfbSR55UaZi0i)

## Data sources

EIA hourly RTO data · HIFLD substation database · OpenStreetMap · PeeringDB · DC Hub proprietary news + facility pipeline · regulations.gov NEPA filings · USGS · EPA eGRID · FEMA NRI

## Open source

This MCP server's transport layer is open source. The data + business logic lives at [dchub.cloud](https://dchub.cloud). Issues: [GitHub Issues](https://github.com/azmartone67/dchub-mcp-server/issues).

## Contact

azmartone@gmail.com — Jonathan Martone — Martone Advisors LLC
