# DC Hub – Data Center Intelligence MCP Server

> Real-time data center infrastructure intelligence for AI agents. 50,000+ facilities across 140+ countries.

[![Official MCP Registry](https://img.shields.io/badge/MCP_Registry-cloud.dchub%2Fmcp--server-blue)](https://registry.modelcontextprotocol.io)
[![Glama](https://glama.ai/mcp/servers/badge)](https://glama.ai/mcp/servers/@azmartone67/dchub-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

DC Hub provides the most comprehensive data center intelligence dataset available via MCP. Our server exposes **15 specialized tools** covering facilities, markets, energy infrastructure, fiber connectivity, M&A transactions, construction pipeline, and site analysis — all accessible to any MCP-compatible AI client.

## Quick Start

### Streamable HTTP (Recommended)

Connect directly via the streamable HTTP endpoint:

```
https://dchub.cloud/mcp
```

### Client Configuration

**Claude Desktop / Claude Code:**
```json
{
  "mcpServers": {
    "dchub": {
      "type": "url",
      "url": "https://dchub.cloud/mcp"
    }
  }
}
```

**Cursor / Windsurf:**
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

## Tools (15)

| Tool | Description | Tier |
|------|-------------|------|
| `search_facilities` | Search and filter 50,000+ global data center facilities | Free (5 results) / Paid (full) |
| `get_facility` | Get detailed information about a specific data center facility | Free (basic) / Paid (full) |
| `get_market_intel` | Market intelligence: supply/demand, pricing, vacancy, and pipeline data | Free (limited) / Paid (full) |
| `get_pipeline` | Track 21+ GW of data center construction pipeline globally | Free (limited) / Paid (full) |
| `list_transactions` | Retrieve M&A transactions in the data center industry | Free (limited) / Paid (full) |
| `get_news` | Curated data center industry news from 40+ sources | Free (limited) / Paid (full) |
| `analyze_site` | Evaluate a geographic location for data center suitability | Paid |
| `compare_sites` | Compare 2–4 locations for data center suitability side-by-side | Paid |
| `get_energy_prices` | Retail electricity rates, natural gas prices, and grid data | Free (limited) / Paid (full) |
| `get_grid_data` | Real-time electricity grid data for US ISOs and international grids | Paid |
| `get_infrastructure` | Nearby power infrastructure: substations, transmission lines, pipelines | Paid |
| `get_fiber_intel` | Dark fiber routes, carrier networks, and connectivity intelligence | Free (limited) / Paid (full) |
| `get_renewable_energy` | Renewable energy capacity: solar farms, wind farms, generation data | Free (limited) / Paid (full) |
| `get_tax_incentives` | Data center tax incentives by US state | Free |
| `get_water_risk` | Water stress and drought risk for a data center location | Free (limited) / Paid (full) |

### Tool Details

#### `search_facilities`
Search the world's largest data center facility database with filters for location, capacity, operator, market, and more.

```
Example: "Search for data centers in Phoenix with more than 10MW capacity"
```

#### `analyze_site`
Comprehensive site suitability analysis including power infrastructure proximity, fiber connectivity, climate risk, water stress, carbon intensity, tax incentives, and market dynamics.

```
Example: "Analyze 33.4484° N, 112.0740° W for a 50MW data center"
```

#### `get_market_intel`
Real-time market intelligence including vacancy rates, absorption, pricing trends, and supply pipeline for major data center markets worldwide.

```
Example: "What's the current vacancy rate and pricing in Northern Virginia?"
```

#### `get_pipeline`
Track announced, under construction, and planned data center capacity across global markets — over 21 GW of tracked pipeline.

```
Example: "Show me the construction pipeline for the Dallas market"
```

#### `list_transactions`
M&A transaction data including buyer, seller, deal value, capacity, and market for data center acquisitions and investments.

```
Example: "List recent data center acquisitions over $500M"
```

## Access Tiers

| Tier | Price | Daily Limit | Results | Features |
|------|-------|-------------|---------|----------|
| **Free** | $0 | 10 calls/day | 5 per query | Basic fields, upgrade prompts |
| **Developer** | $49/mo | 1,000 calls/day | Full | All fields, all tools |
| **Pro** | Custom | Unlimited | Full | Priority support, custom integrations |
| **Enterprise** | Custom | Unlimited | Full | SLA, dedicated support, bulk data |

[Get a free API key →](https://dchub.cloud)
[Upgrade to Developer →](https://buy.stripe.com/7sY5kE8F4fs13ml0PEaZi0c)

## Data Coverage

- **50,000+** data center facilities
- **140+** countries
- **44** tracked markets
- **21+ GW** construction pipeline
- **79,000+** power substations
- **56,000+** transmission lines
- **50,000+** gas pipeline segments
- **1,069** dark fiber routes across 13 carriers
- **40+** news sources
- **50** US states with tax incentive data

## Authentication

All requests require an API key passed via the `X-API-Key` header. Free tier keys are available by registering at [dchub.cloud](https://dchub.cloud).

For MCP clients, the API key is passed automatically when configured:

```json
{
  "mcpServers": {
    "dchub": {
      "type": "url",
      "url": "https://dchub.cloud/mcp",
      "headers": {
        "X-API-Key": "your-api-key-here"
      }
    }
  }
}
```

## Also Listed On

- [Official MCP Registry](https://registry.modelcontextprotocol.io) — `cloud.dchub/mcp-server` v1.0.0
- [Glama](https://glama.ai/mcp/servers/@azmartone67/dchub-mcp-server)
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

## About DC Hub

[DC Hub](https://dchub.cloud) is a data center intelligence platform built for investors, developers, operators, and AI agents. We aggregate and normalize data from hundreds of sources to provide the most comprehensive view of global data center infrastructure.

Built by [Martone Advisors LLC](https://dchub.cloud) — 25+ years of data center infrastructure leadership.

## Support

- Email: support@dchub.cloud
- Website: [dchub.cloud](https://dchub.cloud)
- LinkedIn: [DC Hub](https://www.linkedin.com/company/dc-hub-intelligence)

## License

MIT — see [LICENSE](LICENSE) for details.
