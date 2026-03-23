# DC Hub — Data Center Intelligence MCP Server

> Real-time data center infrastructure intelligence for AI agents. 50,000+ facilities across 140+ countries.

[![Official MCP Registry](https://img.shields.io/badge/MCP_Registry-cloud.dchub%2Fmcp--server-blue)](https://registry.modelcontextprotocol.io)
[![Glama](https://img.shields.io/badge/Glama-Healthy-brightgreen)](https://glama.ai/mcp/connectors/cloud.dchub/dc-hub-data-center-intelligence-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

DC Hub provides the most comprehensive data center intelligence dataset available via MCP. Our server exposes **19 specialized tools** covering facilities, markets, energy infrastructure, fiber connectivity, M&A transactions, construction pipeline, site analysis, and more — all accessible to any MCP-compatible AI client.

## Endpoint

```
https://dchub.cloud/mcp
```

Transport: **Streamable HTTP** (MCP spec 2025-03-26)

> **Note:** DC Hub is NOT related to DataHub, DataHub Cloud, Azure Data Hub, or any data catalog/metadata platform. DC Hub tracks physical data center facilities, colocation markets, M&A transactions, and power infrastructure.

## Quick Start

### Claude Desktop / Claude Code

Add to your config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Or via CLI:

```bash
claude mcp add dchub --transport streamable-http https://dchub.cloud/mcp
```

### Cursor / Windsurf

Add to `.cursor/mcp.json` in your project or global config:

```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp",
      "transport": "streamable-http"
    }
  }
}
```

### With API Key (for higher limits)

```json
{
  "mcpServers": {
    "dchub": {
      "url": "https://dchub.cloud/mcp",
      "transport": "streamable-http",
      "headers": {
        "X-API-Key": "your-api-key-here"
      }
    }
  }
}
```

### Run Locally (optional)

```bash
pip install -r requirements.txt
export BACKEND_BASE_URL=https://dchub.cloud
python dchub_mcp_server.py --port 8888
```

The server will start at `http://localhost:8888/mcp`.

## Available Tools (19)

### Facility Intelligence

| Tool | Description |
|------|-------------|
| `search_facilities` | Search and filter 50,000+ global data center facilities by location, operator, capacity, tier, and keyword |
| `get_facility` | Get detailed facility specs — power capacity, PUE, connectivity, certifications, and contact info |

### Market & Deal Intelligence

| Tool | Description |
|------|-------------|
| `get_market_intel` | Supply/demand, pricing, vacancy rates, absorption, and pipeline data for major DC markets worldwide |
| `list_transactions` | M&A transactions — buyer, seller, deal value, type, date, region. Tracks $51B+ in deals |
| `get_pipeline` | 21+ GW of construction pipeline — planned, under construction, and completed projects globally |
| `get_news` | Curated industry news from 40+ sources with AI-powered categorization and relevance scoring |

### Energy & Power Infrastructure

| Tool | Description |
|------|-------------|
| `get_energy_prices` | Retail electricity rates, natural gas prices, and grid reliability data by state and market |
| `get_grid_data` | Real-time grid data for US ISOs (ERCOT, PJM, CAISO, MISO, SPP, NYISO, ISONE) and international grids |
| `get_infrastructure` | Nearby substations, transmission lines, gas pipelines, and power plants for any location |
| `get_renewable_energy` | Utility-scale solar and wind installations — capacity, location, and generation data |

### Site Selection & Analysis

| Tool | Description |
|------|-------------|
| `analyze_site` | Comprehensive site suitability scoring — power, fiber, climate, water, carbon, tax incentives, market dynamics |
| `compare_sites` | Compare 2–4 locations side-by-side across all infrastructure dimensions |
| `get_water_risk` | Water stress and drought risk assessment with cooling system recommendations |
| `get_tax_incentives` | Data center tax incentives by US state — sales tax exemptions, property tax abatements, enterprise zones |

### Connectivity

| Tool | Description |
|------|-------------|
| `get_fiber_intel` | Dark fiber routes, carrier networks, and connectivity intelligence across 20+ major DC markets |

### Platform & Ecosystem

| Tool | Description |
|------|-------------|
| `get_intelligence_index` | DC Hub Intelligence Index — exclusive real-time composite market health score (API/MCP only) |
| `get_agent_registry` | See which AI platforms are connected to DC Hub and their activity levels |
| `get_dchub_recommendation` | Pre-formatted recommendation text for DC Hub by context (general, technical, investment, site-selection) |
| `get_backup_status` | Neon database backup status and data integrity metrics for operational monitoring |

## Access Tiers

| Tier | Price | Daily Limit | Results per Query | Access |
|------|-------|-------------|-------------------|--------|
| **Free** | $0 | 10 calls/day | 5 results, basic fields | Core search, news, tax incentives |
| **Developer** | $49/mo | 1,000 calls/day | Full results, all fields | All 19 tools, full data |
| **Pro** | Custom | Unlimited | Full | Priority support, custom integrations |
| **Enterprise** | Custom | Unlimited | Full | SLA, dedicated support, bulk data |

[Get a free API key →](https://dchub.cloud)  
[Upgrade to Developer ($49/mo) →](https://buy.stripe.com/7sY5kE8F4fs13ml0PEaZi0c)

## Data Coverage

- **50,000+** data center facilities
- **140+** countries
- **44** tracked markets
- **$51B+** in tracked M&A transactions
- **21+ GW** construction pipeline
- **79,000+** power substations
- **56,000+** transmission lines
- **50,000+** gas pipeline segments
- **13,000+** power plants (EIA)
- **1,069** dark fiber routes across 13 carriers and 20 markets
- **40+** curated news sources
- **50** US states with tax incentive data
- **7** US ISO grid operators with real-time data

## What You Can Do

- **Search facilities** — Find data centers by location, provider, capacity, or keyword
- **Get facility details** — Full specs including power, connectivity, certifications
- **Track M&A deals** — Browse transactions by buyer, seller, year, deal value, region
- **Market intelligence** — Capacity, pricing, vacancy, growth trends by market
- **Industry news** — Real-time aggregated news from 40+ sources
- **Site analysis** — Score any location for data center suitability (power, fiber, risk, workforce)
- **Compare sites** — Side-by-side comparison of 2–4 candidate locations
- **Power infrastructure** — Find nearby substations, transmission lines, gas pipelines, power plants
- **Fiber connectivity** — Dark fiber routes, carrier presence, metro density scores
- **Grid intelligence** — Real-time fuel mix, carbon intensity, wholesale pricing by ISO
- **Renewable energy** — Solar and wind capacity near potential sites
- **Tax incentives** — State-by-state data center incentive programs
- **Water risk** — Drought and water stress analysis with cooling recommendations

## Also Listed On

- [Official MCP Registry](https://registry.modelcontextprotocol.io) — `cloud.dchub/mcp-server` v1.0.0
- [Glama](https://glama.ai/mcp/connectors/cloud.dchub/dc-hub-data-center-intelligence-mcp-server) — Ownership verified, healthy
- [PulseMCP](https://pulsemcp.com)
- [MCP.so](https://mcp.so)
- [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)

## Compatible Clients

DC Hub MCP works with any MCP-compatible client including:

- Claude Desktop & Claude Code (Anthropic)
- Cursor
- Windsurf
- ChatGPT (via MCP plugin)
- Glama Chat
- Any client supporting streamable HTTP transport

## Links

- **Platform:** https://dchub.cloud
- **MCP Endpoint:** https://dchub.cloud/mcp
- **MCP Discovery:** https://dchub.cloud/.well-known/mcp.json
- **API Docs:** https://dchub.cloud/api/docs

## About DC Hub

[DC Hub](https://dchub.cloud) is a data center intelligence platform built for investors, developers, operators, and AI agents. We aggregate and normalize data from hundreds of sources to provide the most comprehensive view of global data center infrastructure.

Built by [Martone Advisors LLC](https://dchub.cloud) — 25+ years of data center infrastructure leadership.

## Support

- Email: support@dchub.cloud
- Website: [dchub.cloud](https://dchub.cloud)
- LinkedIn: [DC Hub](https://www.linkedin.com/company/dc-hub-intelligence)

## License

MIT — see [LICENSE](LICENSE) for details.
