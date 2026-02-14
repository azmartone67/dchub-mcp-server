# DC Hub × Copilot MCP Integration

This repository describes how to integrate Microsoft Copilot (via Copilot Studio)
with DC Hub's MCP server to power cross-border data center investment analysis,
including facility intelligence, energy and ESG data, transactions, and capacity
pipeline.

## 1. Prerequisites

- Access to **Copilot Studio** with MCP support enabled.
- A **DC Hub account**:
  - Free tier: no authentication, limited rate (100 requests/day, 10/min).
  - Pro tier: API token for higher rate limits (10,000 requests/day, 100/min).
- Basic familiarity with:
  - YAML configuration files.
  - HTTP APIs and JSON responses.

DC Hub documentation and connection guides:
- https://dchub.cloud/connect

## 2. MCP Server Registration

1. Open **Copilot Studio** and navigate to the MCP / tool configuration section.
2. Create a new MCP server named `dchub`.
3. Paste the YAML manifest from `dchub-mcp.yaml` (the manifest generated in this package).
   - Ensure:
     - `base_url` is set to `https://dchub.cloud/mcp`.
     - `transport` is `http` and `stream` is enabled.
4. Configure authentication:
   - **Free tier**:
     - Select the `free` auth mode (no headers required).
   - **Pro tier**:
     - Select the `pro` auth mode.
     - Add your DC Hub API token; Copilot Studio will inject it as:
       - `Authorization: Bearer <your_token>`
5. Save and test the connection.

## 3. Tools Overview

The MCP server exposes 10 tools:

1. `search_facilities` — search facilities by country, region, provider, or query.
2. `get_energy_prices` — energy pricing stats for a grid/market region.
3. `get_grid_fuel_mix` — fuel mix and renewable share for a region.
4. `get_site_score` — composite site score for coordinates.
5. `get_carbon_intensity` — carbon intensity metrics for a region.
6. `get_transactions` — M&A transactions and pricing for a country.
7. `get_capacity_pipeline` — capacity pipeline MW by status and market.
8. `get_market_report` — summarized market report for a country/metro.
9. `get_renewable_potential` — renewable potential and constraints for a market.
10. `get_news` — recent news for a market.

Each tool is defined in the YAML manifest with:
- HTTP method and path.
- Parameter schema (types, required flags, defaults).
- Response description.

## 4. Testing Each Tool Call Individually

After registering the MCP server:

1. Open a **test chat** with Copilot configured to use the `dchub` server.
2. Use simple prompts to exercise each tool:

### 4.1 `search_facilities`

**Prompt:**
> Use DC Hub to list data center facilities in the United States. Call `search_facilities` with country="US", limit=10.

**Expected behavior:**
- Copilot calls `GET /api/v1/facilities?country=US&limit=10&offset=0`.
- Response: JSON array of facilities with IDs, names, locations, and capacity fields.

### 4.2 `get_energy_prices`

**Prompt:**
> Call `get_energy_prices` for region="PJM" with window="12m" and summarize average and peak prices.

**Expected behavior:**
- Copilot calls `GET /api/v1/energy/prices?region=PJM&window=12m`.
- Response: JSON with average, peak, off-peak, and volatility metrics.

### 4.3 `get_grid_fuel_mix`

**Prompt:**
> Call `get_grid_fuel_mix` for region="DE" and report the renewable percentage.

**Expected behavior:**
- Copilot calls `GET /api/v1/energy/fuel-mix?region=DE`.
- Response: JSON with percentages by fuel type.

### 4.4 `get_site_score`

**Prompt:**
> Call `get_site_score` for Ashburn, VA (lat=39.0438, lon=-77.4874) and show connectivity and environmental scores.

**Expected behavior:**
- Copilot calls `GET /api/v1/site-score?lat=39.0438&lon=-77.4874`.
- Response: JSON with overall and sub-scores.

### 4.5 `get_carbon_intensity`

**Prompt:**
> Call `get_carbon_intensity` for region="SG" with window="12m" and summarize average kgCO2e/MWh.

### 4.6 `get_transactions`

**Prompt:**
> Call `get_transactions` for country="DE" since "2022-01-01" and list the last 5 deals with price per MW.

### 4.7 `get_capacity_pipeline`

**Prompt:**
> Call `get_capacity_pipeline` for country="BR" and summarize total pipeline MW by status.

### 4.8 `get_market_report`

**Prompt:**
> Call `get_market_report` for market="US" and summarize total facilities, total MW, and key risks.

### 4.9 `get_renewable_potential`

**Prompt:**
> Call `get_renewable_potential` for market="ZA" and describe solar and wind potential.

### 4.10 `get_news`

**Prompt:**
> Call `get_news` for market="SG" with limit=10 and list the most recent regulatory or ESG-related headlines.

## 5. Expected Response Schemas (High-Level)

While exact schemas may evolve, you can expect:

- **search_facilities**: `facilities` array with `id`, `name`, `country`, `region`, `lat`, `lon`, `it_mw`, `status`, `provider`
- **get_energy_prices**: `region`, `window`, `stats` (avg, peak, offpeak, min, max, std_dev), optional `series`
- **get_grid_fuel_mix**: `region`, `mix` (gas, coal, nuclear, wind, solar, hydro, other as percentages)
- **get_site_score**: `lat`, `lon`, `overall_score`, `connectivity_score`, `power_score`, `environmental_risk_score`, `regulatory_score`
- **get_carbon_intensity**: `region`, `window`, `avg_kgCO2e_per_MWh`, optional `series`
- **get_transactions**: `transactions` array with `id`, `country`, `date`, `price`, `mw`, `price_per_mw`, `cap_rate_estimate`, `asset_type`
- **get_capacity_pipeline**: `country`, `total_pipeline_mw`, `by_status` (planned, under_construction, announced), optional `by_market`
- **get_market_report**: `market`, `total_facilities`, `total_mw`, `pricing_summary`, `key_risks`, `key_opportunities`
- **get_renewable_potential**: `market`, `solar_potential`, `wind_potential`, `hydro_potential`, `other`, `policy_context`
- **get_news**: `market`, `items` array with `title`, `source`, `url`, `published_at`, `tags`

## 6. Using the Planner Prompt

To reproduce the $8.7B cross-border due diligence workflow:

1. Register the MCP server with the YAML manifest.
2. Configure a Copilot agent with the **planner system prompt** provided in this package.
3. Invoke the agent with a portfolio description (47 facilities across US, DE, SG, BR, JP, ZA).
4. The planner will:
   - Chain 54 DC Hub calls in the defined sequence.
   - Normalize results into a country-level feature matrix.
   - Build 8-dimension risk scores.
   - Produce a scenario-based IRR and risk-adjusted recommendation suitable for an investment committee deck.

## 7. Further Documentation

For the latest DC Hub API details, authentication, and examples, see:
- https://dchub.cloud/connect
- https://dchub.cloud/llms-full.txt
- https://dchub.cloud/.well-known/openapi.json
- https://dchub.cloud/api-docs
