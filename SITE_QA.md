# SITE_QA.md — Full Agent-Surface QA (report-only)

> **Re-probed 2026-06-07** against `https://dchub.cloud` (MCP v2.1.24) and `https://dchub.cloud/mcp`.
> MCP key: org `MCP_API_KEY` (`dchub_live_70c…`). REST/pages probed with a browser User-Agent.
> **No fixes applied — this is a report.** Backend bugs are grouped at the bottom as the maintainer's fix list.

## ⚠️ Top remaining finding — tier detection still resolves `free` for this key

Server v2.1.24 is deployed (the `7666a43` don't-cache-free-downgrade fix and the iso repoint are live). The PRO-only tools `save_site`, `list_saved_sites`, `export_dataset` still succeed — confirming the key is paid. **But every PAID_ONLY MCP tool still resolves `current_tier: "free"` and gates**, even after a full 5-min `keyCache` expiry cycle.

```
save_site {lat:38.95, lon:-77.45}          → ok:true, site_id:2          (PRO write works)
get_interconnection_queue {iso:"ERCOT"}     → paid_only, current_tier:"free"   (PAID_ONLY still gates)
```

**Diagnosis:** The fix stopped caching a transient validate failure as `free`, but the downgrade is **consistent** — `POST /api/v1/keys/validate` genuinely returns `tier: "free"` for this key (`dchub_live_70c…`). Either this key's `mcp_dev_keys.tier` row hasn't been set to `enterprise`, or the validate endpoint reads a different table/column. The key value I hold may differ from the one whose tier was updated (e.g., the CI secret could be a different key).

**Consequence for this QA:** I cannot verify "do the 16 PAID_ONLY tools return real data" — the tier bug blocks them before they reach the backend. Those rows are marked 🔒 BLOCKED below.

---

## Surface A — MCP tools (38) — v2.1.24

Legend: ✅ real data · 🔒 gated as `free` (blocked by tier issue) · 🟣 PRO works on this key · ❌ broken · 🔧 FIXED (was broken)

| # | Tool | Status | Filter bites? | Note / repro |
|---|------|--------|---------------|--------------|
| 1 | `search_facilities` | ✅ | yes (VA[0]=VA ≠ TX[0]=TX) | `{country:"US",state:"VA"}` → VA rows |
| 2 | `get_facility` | 🔒 | — | `{facility_id:"…"}` → `paid_only`, tier:free |
| 3 | `get_market_intel` | ✅ | yes | `{market:"northern-virginia"}` → 739 fac / 13,442 MW |
| 4 | `get_market_dcpi_rank` | ❌ | — | `{market:"northern-virginia"}` → **API 404** |
| 5 | `get_gas_index` | ✅ | yes (TX 68.8 ≠ CA 48.2) | `{state:"TX"}` → DCGI 68.8 |
| 6 | `get_grid_scoreboard` | ✅ | n/a | `{}` → ranked ISOs |
| 7 | `compare_isos` | 🔒 | — | `{isos:"PJM,ERCOT"}` → `paid_only` |
| 8 | `get_intelligence_index` | 🔒 | — | `trial_preview` |
| 9 | `list_transactions` | 🔒 | — | `trial_preview` |
| 10 | `get_news` | ✅ | yes | `{limit:3}` → 3 articles |
| 11 | `get_pipeline` | 🔒 | — | `trial_preview` |
| 12 | `get_interconnection_queue` | 🔒 | — | `paid_only`, tier:free |
| 13 | `get_grid_data` | 🔧 ✅ | **yes — iso now bites** | ERCOT ≠ PJM; returns `demand_mw`, `generation_mix`, `headroom`. **FIXED in v2.1.24** (repointed to `/api/v1/grid/intelligence/<iso>`). Assertion un-skipped. |
| 14 | `get_changes` | ✅ | yes | `{since:"7d"}` → delta |
| 15 | `save_site` | 🟣 | n/a | `{lat:38.95,lon:-77.45}` → ok, site_id:2 |
| 16 | `list_saved_sites` | 🟣 | n/a | `{}` → count:2+ |
| 17 | `set_market_alert` | ✅ | n/a | `{channel:"webhook",…}` → ok, subscription_id |
| 18 | `export_dataset` | 🟣 | n/a | `{format:"csv"}` → raw CSV |
| 19 | `analyze_site` | 🔒 | — | `paid_only`, tier:free |
| 20 | `compare_sites` | 🔒 | — | `trial_preview` |
| 21 | `get_infrastructure` | 🔒 | — | `trial_preview` |
| 22 | `get_fiber_intel` | 🔒 | — | `trial_preview` |
| 23 | `get_energy_prices` | ✅ | yes (TX ≠ NY) | `{state:"TX"}` → avg rate, by-sector |
| 24 | `get_renewable_energy` | ✅ | yes | `{energy_type:"solar",state:"TX"}` → PPAs |
| 25 | `get_tax_incentives` | 🔒 | — | `trial_preview` |
| 26 | `get_water_risk` | ✅ | yes | `{state:"AZ"}` → drought %, suitability |
| 27 | `get_grid_intelligence` | 🔒 | — | `trial_preview` |
| 28 | `get_agent_registry` | ✅ | n/a | `{}` → platforms |
| 29 | `get_backup_status` | ✅ | n/a | `{}` → feed health |
| 30 | `get_dchub_recommendation` | 🔒 | — | `trial_preview` |
| 31 | `rank_markets` | 🔒 | — | `trial_preview` |
| 32 | `find_alternatives` | 🔧 ✅ | n/a | `{facility_id:"stack-stafford-technology-campus"}` → 5 comps. **FIXED** (canonical slug). See note below. |
| 33 | `score_facility` | 🔧 ✅ | n/a | `{facility_id:"stack-stafford-technology-campus"}` → composite_score **77.9**. **FIXED** (canonical slug). See note below. |
| 34 | `ai_capacity_index` | 🔒 | — | `trial_preview` |
| 35 | `hyperscaler_deals` | 🔒 | — | `trial_preview` |
| 36 | `site_selection_canvas` | ✅ | yes | `{capacity_mw:100,region:"TX"}` → shortlist + citation |
| 37 | `grid_transition_radar` | ✅ | yes | `{max_months:24}` → emerging markets |
| 38 | `deal_autopsy` | ✅ | yes | `{limit:5}` → deals + citation |

**A-totals:** ✅ 16 real (incl. 3 newly fixed) · 🟣 3 PRO-works · 🔒 16 blocked-by-tier-issue · ❌ 1 broken (get_market_dcpi_rank 404).
Filter-bites verified for all ✅ tools (consistent with the merged regression suite in `test/regression.test.mjs`).

### score_facility / find_alternatives — FIXED but search round-trip still broken

The scoring backend now resolves the **canonical slug** `stack-stafford-technology-campus` (composite 77.9, 5 alternatives). However, **`search_facilities` returns a different id** for the same facility: `id: "stack-stafford-va"` (name: "STACK Stafford Technology Campus"). The search-returned id `stack-stafford-va` still 404s in `score_facility`, `find_alternatives`, and the page `/facilities/stack-stafford-va`. So the tools work individually but the **search → score round-trip** is broken (search emits an id that score doesn't accept). See bug #3.

### Explicit re-tests requested

- **`get_grid_data` {iso:"ERCOT"} vs {iso:"PJM"} on the paid key → VERDICT: FIXED (v2.1.24).** ERCOT and PJM now return **distinct** data (different `demand_mw`, `generation_mix`, `headroom`). Repointed to `/api/v1/grid/intelligence/<iso>`. The `it.skip` assertion in `test/regression.test.mjs` has been **un-skipped** and passes.
- **`score_facility` + `find_alternatives` → VERDICT: FIXED with canonical slug.** `stack-stafford-technology-campus` → score 77.9, 5 comps. But `search_facilities`-returned id `stack-stafford-va` still 404s. Round-trip broken. See bug #3.

---

## Surface B — Public REST endpoints (from `integrations/chatgpt/openapi.json`)

| Method/Path | Status | Note |
|-------------|--------|------|
| `GET /api/agent/facilities` | ✅ 200 | `?country=US&state=VA` → facilities |
| `GET /api/energy/prices/{state}` | 🔒 403 | `plan_required` (needs key) |
| `GET /api/grid/fuel-mix` | 🔒 403 | `plan_required` |
| `GET /api/carbon/intensity` | ✅ 200 | works with `?state=TX` or `?lat&lon`; doc says `region` (param mismatch) |
| `GET /api/renewable/combined` | ✅ 200 | `?state=TX` |
| `GET /api/site-score` | 🔒 403 | `plan_required` |
| `GET /api/transactions` | ✅ 200 | `?limit=3` |
| `GET /api/market-report` | ✅ 200 | `?country=US` |
| `GET /api/news` | ✅ 200 | `?limit=3` |
| `GET /api/v1/stats` | ✅ 200 | global stats |
| `GET /api/water/drought/state/{state}` | ❌ 404 | **documented but 404s** for all path/query variants. See bug #4 |
| `GET /api/agent/capabilities` | ✅ 200 | agent identity + discovery files |

### Discovery files
| Path | Status | Note |
|------|--------|------|
| `/.well-known/mcp.json` | ✅ 200 | OK |
| `/api/v1/ai-agents.json` | ✅ 200 | OK |
| `/.well-known/openapi.json` | ❌ 403 | **Cloudflare Error 1000 "DNS points to prohibited IP"**. See bug #5 |

**B-totals:** ✅ 8 · 🔒 3 (plan-gated) · ❌ 2 (water-drought 404, openapi.json Error-1000).

---

## Surface C — Public pages

| Page | Status | Note |
|------|--------|------|
| `/` (home) | ✅ 200 | OK |
| `/ai` | ✅ 200 | OK |
| `/pricing` | ✅ 200 | OK |
| `/dcpi` | ✅ 200 | OK (a benign JS string `[Ask DCPI] DOM elements not found` — not a broken page) |
| `/markets/` | ✅ 200 | OK |
| `/markets/northern-virginia` | ✅ 200 | OK |
| `/facilities` | ❌ 403 | Cloudflare bot-challenge interstitial |
| `/facilities/` | ❌ timeout | read times out (then 403). See bug #6 |
| `/facilities/stack-stafford-va` | ❌ 404 | "Facility not found" for the id `search_facilities` returns. See bug #3 |
| `/partners`, `/partners/` | ✅ 200 | OK |
| `/partners/nvidia` (+ cohere, coreweave, groq, lambda, mistral, perplexity, …) | ✅ 200 | real partner pages OK |
| `/partners/telegeography` | ✅ (expected 404) | not a real partner — not in the partner list |
| `/docs` | ❌ 403 | **Cloudflare Error 1000 "DNS points to prohibited IP"**. See bug #5 |
| `/api` | ❌ 403 | **Cloudflare Error 1000**. See bug #5 |

**C-totals:** ✅ home/ai/pricing/dcpi/markets/partners all good · ❌ facilities index (403/timeout), facility detail pages 404 for search slugs, `/docs` + `/api` Error-1000.

---

## Backend bugs (for maintainer) — the fix list

### ~~Bug #1 — `get_grid_data` ignores `iso`~~ — FIXED in v2.1.24
Repointed to `/api/v1/grid/intelligence/<iso>`. ERCOT and PJM now return distinct data (`demand_mw`, `generation_mix`, `headroom`). Regression assertion un-skipped and passing.

### Bug #2 — Tier detection still resolves `free` for this paid key
On v2.1.24 (post `7666a43` fix), after a full `keyCache` TTL expiry, `validateKey()` → `/api/v1/keys/validate` still returns `tier: "free"` for the `dchub_live_70c…` key — even though PRO writes succeed (proving the key has paid entitlement). All 16 PAID_ONLY MCP tools gate as a result. Either this key's `mcp_dev_keys.tier` hasn't been set to `enterprise`, or the org-saved key differs from the one whose tier was updated.

### Bug #3 — search → score/find round-trip broken (slug mismatch)
`search_facilities` returns `id: "stack-stafford-va"` (name: "STACK Stafford Technology Campus"), but `score_facility` and `find_alternatives` only accept the **canonical slug** `stack-stafford-technology-campus`. The search-returned id `stack-stafford-va` 404s in both tools and the `/facilities/` page. The search index emits one slug; the scoring/detail catalog expects a different one. Fix: synchronize the id in `search_facilities` output to match the canonical slug accepted by scoring.

### Bug #4 — `GET /api/water/drought/state/{state}` 404 (documented endpoint dead)
Documented in `openapi.json` (`getWaterStress`) but 404s for every variant (`/state/AZ`, `/AZ`, `?state=AZ`). The MCP `get_water_risk` works, so the data exists under a different route. Fix the route or update the OpenAPI spec.

### Bug #5 — Cloudflare Error 1000 "DNS points to prohibited IP" on `/.well-known/openapi.json`, `/docs`, `/api`
These three paths return a Cloudflare 1000 error (the origin DNS for that route points to a prohibited/Cloudflare IP). The OpenAPI discovery file being unreachable is notable — agents that look for `/.well-known/openapi.json` get an error page. Fix the DNS/route config for these paths.

### Bug #6 — `/facilities` index page 403 / `/facilities/` times out
The facilities listing index serves a Cloudflare bot-challenge (403) or hangs (read timeout). Inconsistent and unreachable for agents and headless clients.

### Minor — param/doc mismatches
- `compare_isos` MCP schema expects `isos` as a **string** (`"PJM,ERCOT"`); an array throws `-32602`. Either accept arrays or document the string form.
- `get_market_dcpi_rank` 404s consistently (CF route shadow per its own error hint).
- REST `/api/carbon/intensity` works with `state`/`lat`+`lon` but the OpenAPI doc lists `region`.
- Probe left test rows in the saved-sites account (`save_site` test); there is no `delete_site` tool to clean them up.
