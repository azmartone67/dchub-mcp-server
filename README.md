<!-- phase76_readme_polish -->
# DC Hub MCP Server

**Real-time data center intelligence for AI agents.**

The only MCP server combining facility data, infrastructure, and live grid intelligence into one queryable interface. Built for Claude, Cursor, Cline, Continue, and any AI assistant doing data center site selection, energy analysis, or market research.

[![Install on Cursor](https://img.shields.io/badge/Cursor-Install-black?logo=cursor)](https://cursor.directory/plugins/dc-hub) [![MCP.so](https://img.shields.io/badge/mcp.so-listed-blue)](https://mcp.so/server/dc-hub) [![Glama](https://img.shields.io/badge/glama.ai-listed-purple)](https://glama.ai/mcp/connectors/cloud.dchub)

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

- **12,500+ data center facilities** with operator, capacity, location, fiber connectivity
- **126,000 substations** with voltage class, available capacity estimates
- **Live grid data for all 7 US ISOs** (PJM, MISO, ERCOT, CAISO, NYISO, SPP, ISONE) refreshed every 5 minutes from EIA
- **Transmission lines, gas pipelines, fiber routes** — the full infrastructure stack
- **NEPA filings** for upcoming federal energy + data center projects
- **AI infrastructure deals** + capacity pipeline (650+ GW announced)
- **Tax incentives** by state with eligibility details
- **Market intelligence** for 32+ DC markets globally

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

Coming soon. Search "dchub" in your Smithery client.

## Pricing

- **Free trial:** 1 result per paid-tool call, no credit card required
- **Free dev key (60 sec, just email):** [https://dchub.cloud/api/v1/redeem/](https://dchub.cloud/api/v1/redeem/) — 25 calls/day across all 14 paid tools
- **Pro ($49/mo):** Unlimited calls, full datasets, all tools
- **Enterprise ($699/mo):** Bulk API, custom data, dedicated support

## Data sources

EIA hourly RTO data · HIFLD substation database · OpenStreetMap · PeeringDB · DC Hub proprietary news + facility pipeline · regulations.gov NEPA filings · USGS · EPA eGRID · FEMA NRI

## Open source

This MCP server's transport layer is open source. The data + business logic lives at [dchub.cloud](https://dchub.cloud). Issues: [GitHub Issues](https://github.com/azmartone67/dchub-mcp-server/issues).

## Contact

azmartone@gmail.com — Jonathan Martone — Martone Advisors LLC
