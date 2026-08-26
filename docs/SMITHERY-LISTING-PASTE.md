# Smithery listing — owner paste (2026-08-26)

The Smithery listing copy is **owner-pasted on smithery.ai**; editing
`smithery.yaml` alone does not change it. This file is the paste source, kept in
the repo so the two cannot drift.

## Why change it

Measured 2026-08-26 against `registry.smithery.ai`:

| we rank #1 | we are ABSENT from the top 20 |
|---|---|
| data center (194) · datacenter (100) · infrastructure (145) · site selection (187) · colocation (101) · AI infrastructure (172) | **power (188)** · **energy (150)** · **electricity (116)** · **utility (165)** · real estate (131) |

We own the vocabulary only an expert already looking for us would type, and we
are invisible on the broad terms where discovery volume lives. The keywords
already contained `power`, `energy` and `electricity`, so keywords are NOT the
lever — the live displayName ("DC Hub — Data Center, Interconnection & Capacity
Intelligence") does not contain the word *power* at all.

Incumbents on those terms are thinner wrappers over data we already hold:
`zemloai/elecz` (1,758 uses), `cyanheads/eia-energy-mcp-server` (1,457),
`hartjustin6/energyai` (1,161).

★ This is a TEST, not a certainty: we already rank #1 on six terms and still see
only ~17 agents/week, so listing→install conversion is independently weak. More
impressions may not convert. Judge it on distinct agents/week 14 days after the
paste, against a 17/week baseline.

---

## 1 · Display name — paste into "Display name"

```
DC Hub — Power, Energy & Data Center Intelligence
```

## 2 · Description — paste into "Description"

```
Live electricity, power-grid and energy intelligence for AI agents — and the data centers drawing on it. Real-time utility and grid telemetry from 7 independent feeds across 49 grid regions and operators: every US ISO (PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO-NE) plus 40+ EIA balancing authorities, Great Britain, 24 European ENTSO-E bidding zones, Taiwan, Japan, South Korea, Brazil and Australia — fuel mix, renewable share and demand, right now. Plus 182,000 global power generating units across every status (operating, planned, cancelled, shelved, retired — a unit inventory, not a plant count), 13,000 US power plants, 127,000 substations, 95,000 transmission lines, 33,000 gas pipeline segments, electricity and natural-gas price feeds, renewable-generation data, and live ISO interconnection-queue snapshots with queue depth and per-ISO BUILD/CAUTION/AVOID verdicts. On the demand side: 18,800+ facilities across 170+ countries, 300+ markets scored daily (DC Hub Power Index), 64,000 fiber routes, tax incentives, water risk, per-facility tenants and 1,900+ tracked M&A deals. 82 tools. Every figure is citable and carries an as_of timestamp, and the ingest layer publishes its own freshness at /api/v1/ops/deadman — the only electricity, grid-interconnection and data-center intelligence source an LLM can both query and cite. Free tier (5 calls/day anonymous, 10/day with a free key) — paid from $9/mo.
```

## 3 · Keywords / tags — broad terms FIRST

```
electricity, power, energy, utility, utilities, power grid, electricity grid, utility grid, electric utility, grid, renewable energy, natural gas, data center, data centers, datacenter, renewables, fiber, hyperscale, hyperscaler, interconnection, interconnection queue, grid interconnection, ISO interconnection queue, interconnection queue snapshots, capacity, capacity pipeline, grid capacity, power availability, infrastructure, market intelligence, site selection, tax incentives, water risk, PPAs, PJM, ERCOT, CAISO, MISO, SPP, NYISO, ISO, transmission, substation, power plant, natural gas pipeline, M&A, DCPI
```

---

## 4 · While you are in there — the install config field

The live listing is an `external_shttp` proxy
(`dchub--azmartone67.run.tools` → `https://dchub.cloud/mcp`) and its page
payload carries **`configSchema: {}`**. Our `smithery.yaml` declares an
optional `apiKey` that injects as the `X-API-Key` header, but that listing type
ignores it — so **no Smithery user can supply a DC Hub key at install, and every
Smithery install is anonymous by construction.**

That is the root of the re-mint loop: ~22 key re-mints per distinct agent, 36%
of keys never make a single call, 0 conversions.

The server side already works — Smithery's gateway forwards a configured value
as a query param, and `POST /mcp?apiKey=…` has resolved to full caller identity
since 2026-08-18. Only the field is missing.

**Ask Smithery to render the `apiKey` config field on the listing** (or relist
under a type that reads `configSchema`). If they cannot, the fallback already
ships in the server: `claim_free_key` now returns a paste-ready `connect_url`
for the Smithery cohort, which replaces the Smithery connection with a direct,
identified one.
