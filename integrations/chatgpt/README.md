# DC Hub × ChatGPT Custom GPT Integration

Create a Custom GPT powered by DC Hub's data center intelligence platform with direct API access via Actions.

## Quick Setup (5 minutes)

### Step 1: Create a Custom GPT
1. Go to https://chatgpt.com/gpts/editor
2. Click "Create a GPT"

### Step 2: Add Instructions
1. Click the "Configure" tab
2. Paste the contents of `dchub-custom-gpt-instructions.txt` into the Instructions field

### Step 3: Add Actions
1. Scroll down to "Actions" and click "Create new action"
2. Set Authentication to "None" (free tier endpoints require no auth)
3. Paste the contents of `dchub-openapi-chatgpt-actions.json` into the Schema field
4. Click "Test" to verify the connection

### Step 4: Configure Settings
- **Name:** DC Hub Intelligence (or your preferred name)
- **Description:** Data center market intelligence powered by DC Hub — facility search, energy pricing, M&A transactions, site scoring, and ESG analytics across 20,000+ facilities in 140+ countries.
- **Conversation starters:**
  - "How many data centers are in Virginia?"
  - "Compare energy costs in Texas vs California for a new facility"
  - "Show me recent data center M&A deals"
  - "Score Phoenix AZ as a data center location"

### Step 5: Publish
Click "Save" → Choose "Everyone" or "Only people with a link" → "Confirm"

## Available Actions (12 Tools)

| Action | Endpoint | Description |
|--------|----------|-------------|
| searchFacilities | /api/agent/facilities | Search 20,000+ facilities by country, state, city |
| getEnergyPrices | /api/energy/prices/{state} | State-level energy pricing |
| getGridFuelMix | /api/grid/fuel-mix | ISO/RTO fuel mix breakdown |
| getCarbonIntensity | /api/carbon/intensity | Grid carbon emissions per kWh |
| getRenewablePotential | /api/renewable/combined | Solar and wind potential |
| getSiteScore | /api/site-score | Multi-dimensional site scoring |
| getTransactions | /api/transactions | M&A deals database |
| getMarketReport | /api/market-report | Weekly market intelligence |
| getNews | /api/news | Real-time industry news |
| getWaterStress | /api/water/drought/state/{state} | Water stress index |
| getCapabilities | /api/agent/capabilities | Platform capability manifest |
| getGlobalStats | /api/v1/stats | Global platform statistics |

All 12 actions work with DC Hub's free tier — no API key required.

## Testing Your Custom GPT

After setup, try these prompts:

1. **Facility Search:** "How many data centers does DC Hub track in Germany?"
2. **Energy Analysis:** "What's the energy cost and fuel mix in ERCOT?"
3. **Site Selection:** "Score these coordinates for a data center: lat 39.0437, lon -77.4875"
4. **M&A Intelligence:** "Show me the latest data center transactions"
5. **ESG Assessment:** "Compare carbon intensity across Texas, Virginia, and California"

## Upgrading to Pro

The free tier provides preview data for facility searches. For full access:
- Complete facility database
- Full transaction metadata
- Capacity pipeline data
- Market comparisons

Visit https://dchub.cloud/connect to get a Pro API key, then update your Action's authentication to "API Key" with the Bearer token.

## Files in This Package

- `dchub-openapi-chatgpt-actions.json` — OpenAPI 3.1 schema for ChatGPT Actions
- `dchub-custom-gpt-instructions.txt` — Custom GPT system instructions
- `README.md` — This setup guide

## Links

- DC Hub Platform: https://dchub.cloud
- Integration Guide: https://dchub.cloud/connect
- Full API Reference: https://dchub.cloud/llms-full.txt
- MCP Server: https://dchub.cloud/mcp
- AI Wars Benchmark: https://dchub.cloud/ai-wars
