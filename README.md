<!-- phase76_readme_polish -->
# DC Hub MCP Server

**Real-time data center intelligence for AI agents.**

The only MCP server combining facility data, infrastructure, and live grid intelligence into one queryable interface. Built for Claude, Cursor, Cline, Continue, and any AI assistant doing data center site selection, energy analysis, or market research.

[![Install on Cursor](https://img.shields.io/badge/Cursor-Install-black?logo=cursor)](https://cursor.directory/plugins/mcp-dchub) [![smithery badge](https://smithery.ai/badge/azmartone67/dchub)](https://smithery.ai/servers/azmartone67/dchub) [![Glama](https://img.shields.io/badge/glama.ai-verified-purple)](https://glama.ai/mcp/connectors/cloud.dchub/dc-hub-data-center-intelligence-mcp-server) [![Tools](https://img.shields.io/badge/tools-31-blue)](https://dchub.cloud/.well-known/mcp.json) [![Used by](https://img.shields.io/badge/used%20by-Claude%20%C2%B7%20Cursor-green)](https://dchub.cloud/cited-by)

---

## What you can do with it

```
"What's the current grid headroom in PJM?"
"Show me AWS data center construction pipeline in Ohio"
"Compare ERCOT vs PJM capacity prices over the last 30 days"
"Find data centers within 50km of Northern Virginia substations >230kV"
"What's the live demand and generation mix in CAISO right now?"
"Get fiber routes between Ashburn and Atlanta"
```

Your AI assistant gets real-time, structured answers — not links to PDFs.

## What's inside

- **21,000+ data center facilities** across 170+ countries — operator, capacity, location, fiber connectivity
- **126,427 substations** with voltage class, available capacity estimates
- **Real-time grid telemetry** — live load/headroom for CAISO, MISO, SPP, NYISO (refreshed ~every 5 min); coverage across PJM, ERCOT, ISO-NE + Hydro-Québec, AESO, Nord Pool
- **Interconnection-queue snapshots** with per-ISO BUILD/CAUTION/AVOID verdicts (ERCOT 410 GW / 87% DC, PJM 30 GW / 73% DC, etc.)
- **2,000+ tracked M&A transactions** + AI capacity index + hyperscaler $1B+ deal tracker
- **Transmission lines, gas pipelines, fiber routes** — the full infrastructure stack
- **NEPA filings** for upcoming federal energy + data center projects
- **Tax incentives** by state with eligibility details
- **Market intelligence** for 233 DC markets globally with daily DCPI verdicts

**33 MCP tools** across facility search, market intel, grid + interconnection, site analysis, deals, and infrastructure. [Full tool list →](https://dchub.cloud/integrations/mcp)

**Actively used by Claude and Cursor** — see [/cited-by](https://dchub.cloud/cited-by).

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
- **Free dev key (email signup, ~60 sec):** [https://dchub.cloud/signup](https://dchub.cloud/signup) — 1,000 calls/day
- **Starter ($9/mo):** 10,000 calls/day → [Stripe](https://buy.stripe.com/8x2dRa5sS0x75uteGuaZi0g)
- **Developer ($49/mo):** Unlimited paid tools, full field access → [Stripe](https://buy.stripe.com/7sY5kE8F4fs13mI0PEaZi0c)
- **Pro ($199/mo):** All Pro tools + bulk export, historical data
- **Enterprise ($699+/mo):** Dedicated support, custom integrations

## Data sources

EIA hourly RTO data · HIFLD substation database · OpenStreetMap · PeeringDB · DC Hub proprietary news + facility pipeline · regulations.gov NEPA filings · USGS · EPA eGRID · FEMA NRI

## Open source

This MCP server's transport layer is open source. The data + business logic lives at [dchub.cloud](https://dchub.cloud). Issues: [GitHub Issues](https://github.com/azmartone67/dchub-mcp-server/issues).

## Contact

azmartone@gmail.com — Jonathan Martone — Martone Advisors LLC
