# DC Hub MCP — Distribution Targets (turnkey outreach)

The technical + artifact foundation is done (82 tools, discoverable, provenance,
installers, SDKs, pilot pack, trust page). This is the go-to-market shortlist —
who to reach, why they fit, the exact ask, and how. Ordered by effort × payoff.

## The reusable one-paragraph pitch
> **DC Hub is the authoritative data layer for data-center & power infrastructure —
> 82 MCP tools at `dchub.cloud/mcp`** covering 18,400+ facilities in 170+ countries,
> live ISO grid telemetry, DCPI market verdicts, fiber, gas, 1,800+ M&A deals, plus
> composite site scoring, FEMA National Risk Index disaster risk, and USGS/NOAA
> climate intel. Every response carries provenance (`source`, `retrieved_at`) and
> returns `unavailable` — never a fabricated number — when data isn't sourced.
> Zero-install remote HTTP: connect with the URL. Manifest: `dchub.cloud/.well-known/mcp.json`.

The differentiator to lead with everywhere: **authoritative sources + explicit
unknowns = safe for institutional diligence.** That's the wedge no general tool has.

---

## Tier A — Registries / catalogs (submit; fast, one-time)
Prepare the metadata once (name, description, URL, 70-tool count, repo, categories:
`data-center, energy, grid, real-estate, infrastructure, finance`).

| Target | Why | How | Status |
|---|---|---|---|
| **Official MCP Registry** | canonical discovery source | auto-published via `daily-manifest-sync.yml` | ✅ live — verify at [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/) |
| **Smithery** | your main external client today | auto re-crawl | ✅ live — confirm 70 |
| **Glama** | high-traffic dev directory | **click Refresh** signed in as owner | 🔴 stale (was 33) — 1 click |
| **mcp.so** | largest public directory (~20k servers) | submit form | ⬜ submit |
| **awesome-mcp-servers** (punkpeye) | the canonical GitHub list devs grep | open a PR/issue with your entry | ⬜ submit |
| **MCP.Directory** | growing catalog | [mcp.directory/submit](https://mcp.directory/submit) | ⬜ submit |
| **Docker MCP Catalog** | container-workflow devs + enterprises | submit (note: DC Hub is remote HTTP, not a container — list as remote) | ⬜ submit |
| **Cursor directory / MCP Market** | in-editor discovery | submit + the one-click deep link (`docs/one-click-install.md`) | ⬜ submit |

**Ask (all):** "List DC Hub — remote MCP, 82 tools, `dchub.cloud/mcp`. Category:
data-center / energy / infrastructure." Attach the one-paragraph pitch.

### Microsoft / Copilot ecosystem (three lanes, ranked — researched 2026-07-31)
| Lane | What it gets us | Process | Status |
|---|---|---|---|
| **Copilot Studio tenant-level MCP attach** | any org connects DC Hub TODAY, no Microsoft approval | maker: Agent → Tools → Add a tool → MCP server → `https://dchub.cloud/mcp` (wizard, recommended per MS docs 2026-05-28); pro-dev: Power Platform custom connector from OpenAPI tagged `x-ms-agentic-protocol: mcp-streamable-1.0` | ✅ works now — our /integrations/copilot-studio page must TEACH it (fix queued 2026-07-31) |
| **MCP server certification (Agent 365 / Power Platform)** | listed in Microsoft's catalog for EVERY tenant — the Copilot equivalent of the Le Chat catalog | package the MCP server as a Power Platform connector; requires **verified publisher** (Partner Center — HUMAN/legal setup, operator-owned); meets Marketplace policies; certification itself is free. learn.microsoft.com/microsoft-agent-365/mcp-certification | ⬜ blocked on Partner Center verified-publisher setup (operator) |
| **Independent Publisher connector** | gallery listing via community PR (microsoft/PowerPlatformConnectors) | for publishers who do NOT own the API — not our lane (we own it); noted so nobody routes us there | ➖ wrong lane by design |

### Platform-catalog-gated lists (record the trigger, don't resubmit early)
| Target | Gate | Trigger to act |
|---|---|---|
| **awesome-mistral-connectors** (rdmgator12) | Scope ruling 2026-07-31 on [our PR #2](https://github.com/rdmgator12/awesome-mistral-connectors/pull/2): the list catalogs **Le Chat's own connector catalog** only; BYO custom MCP connectors are out of scope (routed to awesome-mcp-servers, where we're already listed — refresh [punkpeye#10161](https://github.com/punkpeye/awesome-mcp-servers/pull/10161) pending since 07-15). Maintainer: *"If DC Hub lands in the Le Chat catalog, we'd welcome a resubmission."* | **DC Hub appears in the Le Chat connector catalog** → resubmit with the catalog link. The catalog ask itself is the Mistral escalation (sent by Mistral's agent 2026-07-30); this closure is a new datum for the follow-up: even the community ecosystem defers to the catalog. |

## Tier B — Agent runtimes / clients (already connectable; ask = featuring)
These already consume remote MCP, so DC Hub *works* today — the ask is **discovery
placement**, not integration: Cursor, Cline, Continue, Windsurf, VS Code (Copilot
MCP), Goose (Block), LibreChat, Zed. Getting into their "recommended/featured
servers" lists is mostly downstream of Tier A directories + a short note to their
DevRel: *"DC Hub is the infra/site-selection data layer your users keep asking for —
here's a one-click install + a 4-workflow prompt pack."*

## Tier C — Enterprise MCP gateways (pilots; highest payoff, longest cycle)
These are where end-user *agents* actually invoke tools at scale. Run the pilot
pack (`docs/pilot-pack.md`) with each.

| Target | Why it fits | The ask |
|---|---|---|
| **AWS Bedrock AgentCore Gateway** | now supports existing MCP servers as a **target type** — register DC Hub as a target behind their gateway | "Add `dchub.cloud/mcp` as an infrastructure-data target; run our 10-scenario pilot." [AWS AgentCore MCP targets](https://aws.amazon.com/blogs/machine-learning/transform-your-mcp-architecture-unite-mcp-servers-through-agentcore-gateway/) |
| **Microsoft Foundry** | any runtime that consumes MCP can consume DC Hub; Foundry Toolboxes bundle MCP endpoints | "Include DC Hub in the infra/energy toolbox." [Foundry MCP how-to](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/model-context-protocol) |
| **Docker MCP Toolkit** | container-native enterprise teams | list in the catalog; offer a remote-server entry |
| **Gateway vendors** (Kong, Portkey, Lunar.dev MCPX, Solo agentgateway, obot, mcpmanager) | their enterprise customers route domain queries through curated MCP sets | "Add DC Hub to your recommended/curated infra data sources; we'll co-run a pilot." |

**Pitch (gateways):** lead with governance + trust — *"authoritative federal/
institutional sources, provenance on every response, explicit unknowns instead of
hallucinated fields. Safe to route into a decision. Zero-install remote HTTP, 70
tools, one-hour pilot pack with acceptance criteria."*

## Tier D — Vertical fit (the highest-conversion angle)
DC Hub is not a general tool — it's THE data-center/energy infra layer. The agents
that convert are in-vertical. Reach the platforms/teams building AI agents for:
- **Data-center developers & site selection** — the direct users (composite score, grid headroom, time-to-power).
- **Energy / grid analytics** — ISO telemetry, interconnection queues, gas economics.
- **Commercial real estate (CRE) platforms adding AI** — powered-land, hazard, climate diligence.
- **Infra / PE / project-finance diligence** — M&A comps, deal autopsy, board-ready risk.
- **The frontier AIs as amplifiers** (Claude, Grok, Gemini, ChatGPT, Copilot, Perplexity) — already engaged; keep them routing infra queries to `dchub.cloud/mcp`.

**Vertical ask:** "Your users ask 'where should I build a data center / what's the
hazard-water-grid risk here / who's buying whom' — that's a DC Hub call. One-click
install; here's the prompt pack." Highest conversion because the need is exact.

---

## Sequencing (2 weeks, mostly owner)
1. **Today:** Glama Refresh (1 click) + submit mcp.so, awesome-mcp-servers, MCP.Directory (metadata is ready).
2. **This week:** email 2–3 gateway teams (AWS AgentCore, Microsoft Foundry, one independent gateway) with the pilot pack.
3. **Ongoing:** 1–2 vertical platforms (CRE-AI, energy-analytics) with the vertical ask.
4. **Measure:** watch discovery→call conversion (the reach→usage number) + the `dchub.cloud/trust` sync status.

Outreach copy: see the honest snippet in `docs/canonical-workflows.md`.

Sources: [MCP registries 2026](https://roxyapi.com/blogs/mcp-registries-where-to-list-your-server) ·
[Best MCP gateways 2026](https://www.truefoundry.com/blog/best-mcp-gateways) ·
[AWS AgentCore Gateway + MCP](https://aws.amazon.com/blogs/machine-learning/transform-your-mcp-architecture-unite-mcp-servers-through-agentcore-gateway/) ·
[Microsoft Foundry MCP](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/model-context-protocol)
