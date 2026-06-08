# SITE_QA.md — Full Agent-Surface QA (report-only)

> **Re-probed 2026-06-08** against `https://dchub.cloud` (MCP **v2.2.4**) and `https://dchub.cloud/mcp`.
> MCP key: org `MCP_API_KEY` (`dchub_live_70c…`). REST/pages probed with a browser User-Agent.
> **No fixes applied — this is a report.** Backend bugs are grouped at the bottom as the maintainer's fix list.

## ⚠️ Top remaining finding — this ONE standalone CI key still resolves `free` (16 PAID_ONLY tools gate). NOT systemic.

**Scoped to this single CI key — not a systemic/revenue bug.** The systemic tier-detection fix is deployed and working: the maintainer independently verified that a *real* enterprise key returns full PAID_ONLY data live (`get_interconnection_queue {iso:"ERCOT"}` → ~426.9 GW, no gate). The `highest_of_3` cross-check (`14748fdc` + `cfe863b5`, which also un-trapped the `accepted_internal_keys` import that had been stuck inside a docstring → `NameError` → 500 → cached `free`) protects all real customers. The only thing still stuck is *this* key: `dchub_live_70c…` is a **standalone CI key** whose `mcp_dev_keys.tier` was `free` and isn't linked to an enterprise `users.plan`, so `highest_of_3` had nothing to elevate from. The maintainer set `mcp_dev_keys.tier='enterprise'` for it directly in Neon.

**Status at latest re-probe (2026-06-08, MCP v2.2.4, after the Neon tier set + a 5.5-min quiet keyCache-TTL window): the probe with this key STILL resolves trial/free.** Anonymous vs keyed responses differ (so the key IS recognized), but every PAID_ONLY tool comes back `trial_preview` / `paid_only current_tier:"free"` instead of enterprise data:

```
serverInfo → {"name":"DC Hub Intelligence","version":"2.2.4"}                    (deploy IS live)

PAID sweep (16 PAID_ONLY tools, enterprise key dchub_live_70c…):
  14/16 → trial_preview  (analyze_site, get_facility, get_pipeline, rank_markets, …)
   2/16 → {"error":"paid_only","current_tier":"free"}  (ai_capacity_index, hyperscaler_deals)
   compare_isos → -32602 on array arg (schema wants "PJM,ERCOT" string; see Minor)

save_site {lat:38.95, lon:-77.45}          → ok:true, site_id:2                 (PRO write works → key IS paid)
```

Concretely, `get_interconnection_queue {iso:"ERCOT"}` keyed → `{"trial_preview":true}` (not the ~426.9 GW a real enterprise key returns). So between `mcp_dev_keys.tier='enterprise'` in Neon and what the MCP server actually receives for *this* key, enterprise tier still isn't arriving — most likely the validate lookup for the exact row this key hashes to, or a cache that needs the MCP instance to clear. The same key's PRO writes (`save_site`) succeed, so it genuinely has paid entitlement at the Flask layer. **The real test is the tool probe, not reading `validate`** — and the probe still says trial. The 16 🔒 rows below stay BLOCKED on this one CI key until the probe returns enterprise data; this does **not** affect real enterprise keys.

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

`score_facility` resolves the short slug `stack-stafford-technology-campus` (composite 77.9, 5 alternatives), but no single slug works everywhere — `search_facilities` emits `id: "stack-stafford-va"`, which 404s on **all** of `score_facility`, `find_alternatives`, `get_facility` and the live page; the page/`get_facility` only accept the UUID-suffixed form `/api/v1/search` emits. The tools work individually with the *right* slug, but the **search → page/score round-trip** is broken because each surface expects a different slug. Full 3-way matrix + the new regression guard (PR #28) in bug #3.

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

### Bug #2 — This one standalone CI key still resolves `free` on v2.2.4 — OPEN (scoped, NOT systemic)
**Not a systemic/revenue bug.** The systemic tier-detection fix (`14748fdc` un-trapped the `accepted_internal_keys` import from a docstring; `cfe863b5` added the `highest_of_3` cross-check over `users.plan` + `api_keys.rate_limit_tier` + `mcp_dev_keys.tier`) is deployed and working — the maintainer independently verified a *real* enterprise key returns full PAID_ONLY data live (`get_interconnection_queue {iso:"ERCOT"}` → ~426.9 GW, no gate). Real customers are unaffected.

The stuck case is specific to the CI key `dchub_live_70c…`: it's a **standalone key** whose `mcp_dev_keys.tier` was `free` and that isn't linked to an enterprise `users.plan`, so `highest_of_3` had nothing to elevate from. The maintainer set `mcp_dev_keys.tier='enterprise'` for it directly in Neon.

**Symptom persists at latest re-probe (2026-06-08, after the Neon set + a 5.5-min quiet keyCache-TTL window):** the probe with this key still resolves `trial`/`free` for all 16 PAID_ONLY tools (e.g. `get_interconnection_queue {iso:"ERCOT"}` keyed → `{"trial_preview":true}`). Anon vs keyed differ, so the key is recognized; PRO writes (`save_site`) succeed, so it has Flask-layer entitlement — but enterprise tier still isn't reaching the MCP gate for this key. Likely the validate lookup for the exact row this key hashes to, or an MCP-instance cache that needs to clear.

**Maintainer action:** re-run the tool probe for this key (the probe is the real test — reading `validate` is moot). Once `get_interconnection_queue {iso:"ERCOT"}` returns real GW data on the key, the 🔒 rows in Surface A can be filled — ping and I'll re-run the paid sweep.

### Bug #3 — search → page/score round-trip broken (3-way slug fragmentation)
There is **no single canonical slug** — each surface accepts a different one, so any cross-tool round-trip dead-ends. Verified live 2026-06-08 for STACK Stafford Technology Campus:

| slug | `get_facility` | live `/facilities/<slug>` page | `score_facility` |
|------|----------------|--------------------------------|------------------|
| `stack-stafford-va` (what `search_facilities` returns) | 404 | 404 | 404 |
| `stack-stafford-technology-campus` (short form) | 404 | 404 | **200** (score 77.9) |
| `stack-infrastructure-stack-stafford-technology-campus-eb55e369` (what `/api/v1/search` returns) | **200** | **200** | 404 |

So the slug `search_facilities` emits resolves on **nothing**, and the two slugs that *do* work each cover only part of the surface. Across queries, **29** `search_facilities` slugs 404 on the live page. Fix: emit one canonical slug from `/api/v1/facilities` (the `search_facilities` source) that `get_facility`, the page, and `score_facility` all accept. **Now guarded** by a regression test (`test/regression.test.mjs` → "search → live page slug round-trip", PR #28) that fails until the slug source is aligned.

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
