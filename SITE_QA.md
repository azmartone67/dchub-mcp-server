# SITE_QA.md — Full Agent-Surface QA (report-only)

> Probed 2026-06-07 against `https://dchub.cloud` and `https://dchub.cloud/mcp`.
> MCP key: org `MCP_API_KEY` (`dchub_live_70c…`). REST/pages probed with a browser User-Agent.
> **No fixes applied — this is a report.** Backend bugs are grouped at the bottom as the maintainer's fix list.

## ⚠️ Top finding — tier detection is broken for PAID_ONLY tools

The provided key **is a paid key**: the PRO-only tools `save_site`, `list_saved_sites`, and `export_dataset` all succeed (a site persisted with `site_id: 2`, `list_saved_sites` returns `count: 2`). **But every PAID_ONLY MCP tool still resolves `current_tier: "free"` and gates.**

```
save_site {lat:38.95, lon:-77.45}          → ok:true, site_id:2          (PRO write works)
list_saved_sites {}                         → count:2                     (PRO read works)
get_interconnection_queue {iso:"ERCOT"}     → paid_only, current_tier:"free"   (PAID_ONLY gates)
```

**Why:** PRO features are gated at the Flask backend against the forwarded `X-API-Key`, so they see the real entitlement. PAID_ONLY tools are gated *upfront in the MCP server* using the `tier` from `validateKey()` → `POST /api/v1/keys/validate`, which resolves to `free`. Per `server.mjs:632`, when that validate hop is non-ok the tier silently falls back to `free`. Net effect: **a genuinely-paid customer gets free-tier gating on all 16 PAID_ONLY tools** — revenue-critical.

**Consequence for this QA:** I cannot verify "do the 16 PAID_ONLY tools return real data on a paid tier" — the tier bug blocks them before they reach the backend. Those rows are marked 🔒 BLOCKED below.

---

## Surface A — MCP tools (38)

Legend: ✅ real data · 🔒 gated as `free` (blocked by tier bug above) · 🟣 PRO works on this key · ❌ broken · ⚠️ runs but wrong data

| # | Tool | Status | Filter bites? | Note / repro |
|---|------|--------|---------------|--------------|
| 1 | `search_facilities` | ✅ | yes (VA[0]=VA ≠ TX[0]=TX) | `{country:"US",state:"VA"}` → VA rows |
| 2 | `get_facility` | 🔒 | — | `{facility_id:"stack-stafford-va"}` → `paid_only`, tier:free |
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
| 13 | `get_grid_data` | ⚠️ | **NO — iso ignored** | ERCOT & PJM both → CO (lat 39.7405). See bug #1 |
| 14 | `get_changes` | ✅ | yes | `{since:"7d"}` → delta |
| 15 | `save_site` | 🟣 | n/a | `{lat:38.95,lon:-77.45}` → ok, site_id:2 |
| 16 | `list_saved_sites` | 🟣 | n/a | `{}` → count:2 |
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
| 32 | `find_alternatives` | ❌ | — | `{facility_id:"stack-stafford-va"}` → **404 facility not found** |
| 33 | `score_facility` | ❌ | — | `{facility_id:"stack-stafford-va"}` → **404 facility not found** |
| 34 | `ai_capacity_index` | 🔒 | — | `trial_preview` |
| 35 | `hyperscaler_deals` | 🔒 | — | `trial_preview` |
| 36 | `site_selection_canvas` | ✅ | yes | `{capacity_mw:100,region:"TX"}` → shortlist + citation |
| 37 | `grid_transition_radar` | ✅ | yes | `{max_months:24}` → emerging markets |
| 38 | `deal_autopsy` | ✅ | yes | `{limit:5}` → deals + citation |

**A-totals:** ✅ 15 real · 🟣 3 PRO-works · 🔒 16 blocked-by-tier-bug · ❌ 3 broken · ⚠️ 1 wrong-data.
Filter-bites verified for all ✅ tools (consistent with the merged regression suite in `test/regression.test.mjs`).

### Explicit re-tests requested

- **`get_grid_data` {iso:"ERCOT"} vs {iso:"PJM"} on the paid key → VERDICT: CONFIRMED BACKEND BUG.** Both return the identical Colorado location (lat 39.7405, lon −105.1686). The `iso` param is ignored. (See bug #1.)
- **`score_facility` + `find_alternatives` resolving search-returned slugs → VERDICT: STILL BROKEN.** `search_facilities` returns `id: "stack-stafford-va"`; both tools 404 "facility not found" for it. Not fixed. (See bug #3.)

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
| `/facilities/stack-stafford-va` | ❌ 404 | "Facility not found" for a slug `search_facilities` returns. See bug #3 |
| `/partners`, `/partners/` | ✅ 200 | OK |
| `/partners/nvidia` (+ cohere, coreweave, groq, lambda, mistral, perplexity, …) | ✅ 200 | real partner pages OK |
| `/partners/telegeography` | ✅ (expected 404) | not a real partner — not in the partner list |
| `/docs` | ❌ 403 | **Cloudflare Error 1000 "DNS points to prohibited IP"**. See bug #5 |
| `/api` | ❌ 403 | **Cloudflare Error 1000**. See bug #5 |

**C-totals:** ✅ home/ai/pricing/dcpi/markets/partners all good · ❌ facilities index (403/timeout), facility detail pages 404 for search slugs, `/docs` + `/api` Error-1000.

---

## Backend bugs (for maintainer) — the fix list

### Bug #1 — `get_grid_data` ignores `iso` (CONFIRMED on paid key)
`/api/v1/grid/status` returns the default Colorado location regardless of `iso`. `{iso:"ERCOT"}` and `{iso:"PJM"}` are byte-identical (lat 39.7405, lon −105.1686, CO). Fix the backend to filter by `iso`; then un-skip the `get_grid_data: ERCOT ≠ PJM` assertion in `test/regression.test.mjs`.

### Bug #2 — Tier detection downgrades paid keys to `free` for PAID_ONLY tools (REVENUE-CRITICAL)
A paid key (PRO writes succeed) resolves to `current_tier:"free"` via `validateKey()` → `/api/v1/keys/validate`, so all 16 PAID_ONLY MCP tools gate. Either `/api/v1/keys/validate` returns the wrong tier, or the server→backend validate hop is failing and `server.mjs:632` defaults to `free`. Verify the validate endpoint returns the correct tier for `dchub_live_…` keys and that the internal call (with `INTERNAL_KEY`) actually reaches the backend (it is Cloudflare-blocked from outside — error 1010/1000).

### Bug #3 — `score_facility` / `find_alternatives` / facility pages 404 on search-returned slugs
`search_facilities` returns `id:"stack-stafford-va"`, but `score_facility`, `find_alternatives`, and the public page `/facilities/stack-stafford-va` all 404 "facility not found." The scoring/detail catalog is not synchronized with the search index. Reported as "just fixed" — **still broken** as of this probe.

### Bug #4 — `GET /api/water/drought/state/{state}` 404 (documented endpoint dead)
Documented in `openapi.json` (`getWaterStress`) but 404s for every variant (`/state/AZ`, `/AZ`, `?state=AZ`). The MCP `get_water_risk` works, so the data exists under a different route. Fix the route or update the OpenAPI spec.

### Bug #5 — Cloudflare Error 1000 "DNS points to prohibited IP" on `/.well-known/openapi.json`, `/docs`, `/api`
These three paths return a Cloudflare 1000 error (the origin DNS for that route points to a prohibited/Cloudflare IP). The OpenAPI discovery file being unreachable is notable — agents that look for `/.well-known/openapi.json` get an error page. Fix the DNS/route config for these paths.

### Bug #6 — `/facilities` index page 403 / `/facilities/` times out
The facilities listing index serves a Cloudflare bot-challenge (403) or hangs (read timeout). Inconsistent and unreachable for agents and headless clients.

### Minor — param/doc mismatches
- `compare_isos` MCP schema expects `isos` as a **string** (`"PJM,ERCOT"`); an array throws `-32602`. Either accept arrays or document the string form.
- `get_market_dcpi_rank` 404s intermittently (CF route shadow per its own error hint).
- REST `/api/carbon/intensity` works with `state`/`lat`+`lon` but the OpenAPI doc lists `region`.
- Probe left two test rows in the saved-sites account (`save_site` test); there is no `delete_site` tool to clean them up.
