# DC Hub MCP — Distribution Targets (turnkey outreach)

The technical + artifact foundation is done (81 tools, discoverable, provenance,
installers, SDKs, pilot pack, trust page). This is the go-to-market shortlist —
who to reach, why they fit, the exact ask, and how. Ordered by effort × payoff.

## The reusable one-paragraph pitch
> **DC Hub is the authoritative data layer for data-center & power infrastructure —
> 81 MCP tools at `dchub.cloud/mcp`** covering 15,300+ facilities in 180+ countries,
> live ISO grid telemetry, DCPI market verdicts, fiber, gas, 1,600+ M&A deals, plus
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

**Ask (all):** "List DC Hub — remote MCP, 81 tools, `dchub.cloud/mcp`. Category:
data-center / energy / infrastructure." Attach the one-paragraph pitch.

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
