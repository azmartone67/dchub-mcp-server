# DATA_QUALITY.md — DC Hub MCP Tool Status Report

> Probed 2026-06-07 against `https://dchub.cloud/mcp` with a free dev key
> (`dch_live_…`, 100 calls/day, claimed via `/api/v1/keys/claim`).
>
> Authoritative tool count: **38** (live `tools/list` = 38 `trackedTool` registrations in `server.mjs`).

## Status Legend

| Status | Meaning |
|--------|---------|
| ✅ WORKS | Returns real, useful data on the free key |
| 🔒 GATED | Returns `paid_only` / `trial_preview` / upgrade stub on free key — real data expected on paid |
| 🔒 PRO | Returns 402 `upgrade_required` — requires PRO tier ($299/mo) |
| ⚠️ BUG | Tool runs but returns incorrect/default data (param ignored) |
| ❌ BROKEN | Returns 404 or unexpected error regardless of tier |

## Per-Tool Status (free key)

| # | Tool | Free Key Status | One-Line Example / Note |
|---|------|----------------|------------------------|
| 1 | `search_facilities` | ✅ WORKS | `{country:"US", state:"VA"}` → 3 VA facilities w/ name, lat/lon, provider |
| 2 | `get_facility` | 🔒 GATED | `{facility_id:"stack-stafford-va"}` → `paid_only` stub |
| 3 | `get_market_intel` | ✅ WORKS | `{market:"northern-virginia"}` → 739 facilities, 13,442 MW aggregate |
| 4 | `get_market_dcpi_rank` | ❌ BROKEN | `{market:"northern-virginia"}` → API 404 (intermittent CF route shadow) |
| 5 | `get_gas_index` | ✅ WORKS | `{state:"TX"}` → DCGI score, verdict, methodology |
| 6 | `get_grid_scoreboard` | ✅ WORKS | `{}` → ranked ISOs by renewable %, coverage, source |
| 7 | `compare_isos` | 🔒 GATED | `{isos:"PJM,ERCOT"}` → `paid_only` |
| 8 | `get_intelligence_index` | 🔒 GATED | `{market:"northern-virginia"}` → `trial_preview` stub |
| 9 | `list_transactions` | 🔒 GATED | `{year:2026}` → `trial_preview` stub |
| 10 | `get_news` | ✅ WORKS | `{limit:3}` → 3 articles w/ title, source, date |
| 11 | `get_pipeline` | 🔒 GATED | `{operator:"Amazon"}` → `trial_preview` stub |
| 12 | `get_interconnection_queue` | 🔒 GATED | `{iso:"ERCOT"}` → `trial_preview` stub (numbers masked) |
| 13 | `get_grid_data` | ⚠️ BUG | `{iso:"ERCOT"}` and `{iso:"PJM"}` both return **identical** CO location (lat 39.74, lon −105.17). **`iso` param ignored.** See § Backend Bugs. |
| 14 | `get_changes` | ✅ WORKS | `{since:"7d"}` → DCPI movers, new facilities, new deals delta |
| 15 | `save_site` | 🔒 PRO | `{lat:39.04, lon:-77.48}` → 402 `upgrade_required` (PRO $299/mo) |
| 16 | `list_saved_sites` | 🔒 PRO | `{}` → 402 `upgrade_required` (PRO $299/mo) |
| 17 | `set_market_alert` | ✅ WORKS | `{market:"northern-virginia", channel:"webhook", destination:"https://…"}` → `{ok:true, subscription_id}` |
| 18 | `export_dataset` | 🔒 PRO | `{format:"csv"}` → 402 `upgrade_required` (PRO $299/mo) |
| 19 | `analyze_site` | 🔒 GATED | `{lat:33.45, lon:-112.07}` → `trial_preview` stub |
| 20 | `compare_sites` | 🔒 GATED | `{locations:"33.45,-112.07;39.04,-77.48"}` → `trial_preview` stub |
| 21 | `get_infrastructure` | 🔒 GATED | `{lat:39.96, lon:-82.99, radius_km:30}` → `trial_preview` stub |
| 22 | `get_fiber_intel` | 🔒 GATED | `{lat:39.96, lon:-82.99}` → `trial_preview` stub |
| 23 | `get_energy_prices` | ✅ WORKS | `{state:"TX"}` → avg rate, by-sector breakdown, industrial rate |
| 24 | `get_renewable_energy` | ✅ WORKS | `{energy_type:"solar", state:"TX"}` → installed capacity, PPAs |
| 25 | `get_tax_incentives` | 🔒 GATED | `{state:"VA"}` → `trial_preview` stub |
| 26 | `get_water_risk` | ✅ WORKS | `{state:"AZ"}` → drought %, severity, data-center suitability note |
| 27 | `get_grid_intelligence` | 🔒 GATED | `{region_id:"PJM"}` → `trial_preview` stub |
| 28 | `get_agent_registry` | ✅ WORKS | `{}` → MCP platform count, connected platforms |
| 29 | `get_backup_status` | ✅ WORKS | `{}`→ feed health summary, generated_at timestamp |
| 30 | `get_dchub_recommendation` | 🔒 GATED | `{}` → `trial_preview` stub |
| 31 | `rank_markets` | 🔒 GATED | `{criteria:"cheapest_power"}` → `trial_preview` stub |
| 32 | `find_alternatives` | ❌ BROKEN | `{facility_id:"stack-stafford-va"}` → 404 "facility not found" (search-returned IDs not recognized) |
| 33 | `score_facility` | ❌ BROKEN | `{facility_id:"stack-stafford-va"}` → 404 "facility not found" (same ID mismatch) |
| 34 | `ai_capacity_index` | 🔒 GATED | `{}` → `trial_preview` stub |
| 35 | `hyperscaler_deals` | 🔒 GATED | `{limit:3}` → `trial_preview` stub |
| 36 | `site_selection_canvas` | ✅ WORKS | `{capacity_mw:100, region:"TX"}` → shortlist w/ matched sites, citation |
| 37 | `grid_transition_radar` | ✅ WORKS | `{max_months:24}` → emerging markets, grid headroom, ISO rollup |
| 38 | `deal_autopsy` | ✅ WORKS | `{limit:5}` → M&A deals w/ DCPI autopsy overlay, citation |

## Summary

| Category | Count | Tools |
|----------|-------|-------|
| ✅ WORKS (free) | 17 | search_facilities, get_market_intel, get_gas_index, get_grid_scoreboard, get_news, get_changes, set_market_alert, get_energy_prices, get_renewable_energy, get_water_risk, get_agent_registry, get_backup_status, site_selection_canvas, grid_transition_radar, deal_autopsy, get_grid_data (with bug caveat) |
| 🔒 GATED (paid) | 15 | get_facility, compare_isos, get_intelligence_index, list_transactions, get_pipeline, get_interconnection_queue, analyze_site, compare_sites, get_infrastructure, get_fiber_intel, get_tax_incentives, get_grid_intelligence, get_dchub_recommendation, rank_markets, ai_capacity_index, hyperscaler_deals |
| 🔒 PRO ($299/mo) | 3 | save_site, list_saved_sites, export_dataset |
| ❌ BROKEN | 3 | get_market_dcpi_rank (404), score_facility (404), find_alternatives (404) |
| ⚠️ BUG | 1 | get_grid_data (iso param ignored) |

## Backend Bugs (flagged for maintainer)

### 1. `get_grid_data` ignores `iso` parameter ← **CONFIRMED**

```
get_grid_data {iso: "ERCOT"} → lat 39.74, lon −105.17, state: CO
get_grid_data {iso: "PJM"}   → lat 39.74, lon −105.17, state: CO   ← IDENTICAL
```

Both return the same Colorado "teaser" location regardless of the ISO passed. This is the same class of param-ignore bug as the original `search_facilities` issue. The backend route `/api/v1/grid/status` does not filter by the `iso` param.

**Impact:** Any agent asking "What's the grid situation in ERCOT?" gets Colorado data, which is factually wrong and harmful.

**Fix:** Backend (`/api/v1/grid/status`) must pass `iso` to its DB/API query. Once fixed, un-skip the regression assertion in `test/regression.test.mjs` (`get_grid_data: ERCOT ≠ PJM`).

**Enterprise key re-test:** Pending. Once the CI `MCP_API_KEY` is set to an enterprise key, the regression suite will re-verify. If the enterprise tier returns distinct ISO data, the bug is free-tier-only; if it persists, it's a universal backend bug.

### 2. `get_market_dcpi_rank` returns API 404

The tool calls a backend path that Cloudflare intermittently shadows with a zone-level MCP-landing page rule. The error detail says: _"AI agent? See https://dchub.cloud/api/v1/ai-agents.json for the canonical integration map. (The .well-known/ path is intermittently shadowed by the zone-level MCP-landing)"_.

**Impact:** Tool appears in `tools/list` but 404s when called. Intermittent (sometimes works — passed in CI earlier).

**Fix:** Cloudflare routing rule needs to exclude the backend API paths from the MCP-landing-page rewrite.

### 3. `score_facility` / `find_alternatives` return 404 for search-returned IDs

When calling `score_facility {facility_id: "stack-stafford-va"}` or `find_alternatives {facility_id: "stack-stafford-va"}` (an ID returned by `search_facilities`), the backend returns 404 "facility not found." The facility catalog used by the scoring/alternatives endpoints is not synchronized with the search index.

**Impact:** Users can't score or find alternatives for facilities they just searched for.

**Fix:** Sync the scoring/alternatives backend DB with the search catalog, or alias the slug-format IDs to match.

---

## Additional Notes

- **`semantic_search`** is advertised in smithery.yaml but does NOT appear in the live `tools/list` (38 tools, all in `server.mjs`). Removed from the manifest tools list in this reconciliation.
- **`set_market_alert`** is described as PRO but actually succeeds on a free key (returns `{ok:true, subscription_id}`). Either the gating is missing or it intentionally allows free subscriptions.
- **`get_grid_data`** does return *some* real data (grid headroom MW, nearest substation) — just always for the default Colorado location regardless of the `iso` param.
- The `integrations/copilot/README.md` and `integrations/chatgpt/README.md` list tool subsets (10 and 12 respectively) that include some non-existent tool names (e.g., `get_grid_fuel_mix`, `get_site_score`). These integration docs need a separate reconciliation pass.
