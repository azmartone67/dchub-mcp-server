# SITE_QA.md — Full Agent-Surface QA (report-only)

> **Re-probed 2026-06-07** against `https://dchub.cloud` (MCP **v2.2.4**) and `https://dchub.cloud/mcp`.
> MCP key: org `MCP_API_KEY` (`dchub_live_70c…`). REST/pages probed with a browser User-Agent.
> **No fixes applied — this is a report.** Backend bugs are grouped at the bottom as the maintainer's fix list.

## ⚠️ Top remaining finding — v2.2.4 IS deployed, but the enterprise key STILL resolves `free` (16 PAID_ONLY tools gate)

**Root cause identified by the maintainer** (commits `14748fdc` + `cfe863b5`): the `from internal_auth import accepted_internal_keys` import was trapped inside a module docstring in `flask_mcp_endpoints.py`, so it never executed. Every `POST /api/v1/keys/validate` raised `NameError: name 'accepted_internal_keys' is not defined` → 500, which `server.mjs`'s `keyCache` recorded as `tier:"free"` for 5 min — exactly the signature this QA caught.

**Status at re-probe (2026-06-07, MCP v2.2.4, two sweeps ~15 min apart — stable, not a cache artifact): the deploy landed but the key still gates as `free`.** The `NameError` is gone (validate no longer 500s — externally it now returns `forbidden`, i.e. it's reachable and rejecting unauthenticated callers rather than crashing), yet every PAID_ONLY tool still resolves `current_tier:"free"`:

```
serverInfo → {"name":"DC Hub Intelligence","version":"2.2.4"}                    (deploy IS live)

PAID sweep (16 PAID_ONLY tools, enterprise key dchub_live_70c…):
  14/16 → trial_preview  (analyze_site, get_facility, get_pipeline, rank_markets, …)
   2/16 → {"error":"paid_only","current_tier":"free"}  (ai_capacity_index, hyperscaler_deals)
   compare_isos → -32602 on array arg (schema wants "PJM,ERCOT" string; see Minor)

save_site {lat:38.95, lon:-77.45}          → ok:true, site_id:2                 (PRO write works → key IS paid)
```

**This is no longer a deploy-timing issue.** The key has paid entitlement at the Flask layer (PRO writes succeed) but the MCP upfront gate on `validateKey()` → `/api/v1/keys/validate` still resolves this key as `free`. Two stable sweeps rule out the 5-min `keyCache` TTL. Likely the `highest_of_3` lookup still maps this key/user to `free` (e.g. the `users.plan = enterprise` backfill isn't being joined for this key), or the MCP→validate hop is failing closed. I can't read the validator directly — `POST /api/v1/keys/validate` is `forbidden` to external callers (needs the internal `X-Internal-Key`) — so this needs a maintainer-side check. The 16 🔒 rows below stay BLOCKED until the validator returns `tier:"enterprise"` for this key.

**Verified now (deploy-independent, real data on this key):** the keyed-free *bonus* tools return full data — `get_market_intel` (NoVA 739 fac / 13,442 MW, **not** masked), `get_grid_data`, `get_energy_prices`, `get_renewable_energy`, `get_water_risk` — and the `get_grid_data` iso fix is live (PJM 85,089 MW ≠ ERCOT 55,993 MW at re-probe; see below).

---

## Surface A — MCP tools (38) — v2.2.4

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

### ~~Bug #1 — `get_grid_data` ignores `iso`~~ — FIXED in v2.2.4 (verified)
Repointed to `/api/v1/grid/intelligence/<iso>`. ERCOT and PJM now return distinct live demand curves (live values fluctuate; at the latest re-probe PJM 85,089 MW ≠ ERCOT 55,993 MW). Regression assertion un-skipped and **passing** (`test/regression.test.mjs` → `get_grid_data: iso=PJM vs iso=ERCOT should differ`).

### Bug #2 — Tier detection STILL resolves `free` for this paid key on v2.2.4 (deploy landed, key still gates) — OPEN
Root cause (maintainer, `14748fdc` + `cfe863b5`): `from internal_auth import accepted_internal_keys` was trapped inside a module docstring in `flask_mcp_endpoints.py`, so it never ran. `POST /api/v1/keys/validate` raised `NameError` → 500 → `server.mjs` `keyCache` recorded `tier:"free"` for 5 min. `cfe863b5` adds a `highest_of_3` cross-check (`users.plan` + `api_keys.rate_limit_tier` + `mcp_dev_keys.tier`).

**The `NameError` fix is live (v2.2.4, validate no longer 500s) but the symptom persists.** Re-probed twice ~15 min apart: the enterprise key `dchub_live_70c…` still resolves `current_tier:"free"` for all 16 PAID_ONLY tools, even though the same key's PRO writes (`save_site`) succeed — so the key genuinely has paid entitlement, but the MCP gate's `validateKey()` → `/api/v1/keys/validate` lookup returns `free`. Two stable sweeps rule out the 5-min `keyCache` TTL, so this is **not** deploy timing. Likely the `highest_of_3` lookup still maps this key/user to `free` (e.g. the `users.plan = enterprise` backfill isn't being joined for this key), or the MCP→validate hop is failing closed.

**Maintainer action (only readable server-side — the validate endpoint is `forbidden` to external callers):**
```
curl -X POST https://dchub-backend-production.up.railway.app/api/v1/keys/validate \
  -H "X-Internal-Key: <internal>" -d '{"api_key":"dchub_live_70c…"}' | jq .
# Expected: {"valid":true,"tier":"enterprise","tier_source":"highest_of_3",
#            "tier_detail":{"users_plan":"enterprise","effective":"enterprise"}}
# Observed (inferred from MCP gating): effective tier resolves "free".
```
Once `validate` returns `enterprise` for this key, re-run the paid sweep to fill the 🔒 rows in Surface A.

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
