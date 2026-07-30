# DC Hub — turnkey outreach emails

Copy-paste, tailored per target. **Send only after merging #60 + #61** so every
link resolves (installers, SDKs, pilot pack, trust page). Attach or link
`docs/pilot-pack.md`. Keep the wedge in every one: *authoritative sources +
explicit unknowns = safe for institutional diligence.*

---

## 1 · AWS Bedrock AgentCore Gateway
**To:** the AgentCore Gateway / Bedrock agents team (via AWS partner contact or
the AgentCore feedback channel)
**Subject:** Add DC Hub as an infrastructure-data MCP target for AgentCore Gateway

> Hi — AgentCore Gateway now supports existing MCP servers as a target type, and
> DC Hub is a clean fit for any agent doing data-center / energy / site-selection
> work. It's a remote HTTP MCP server (`https://dchub.cloud/mcp`, 81 tools) over
> 15,300+ facilities, live ISO grid telemetry, DCPI market verdicts, plus
> composite site scoring, FEMA National Risk Index disaster risk, and USGS/NOAA
> climate intel.
>
> The reason it's safe to route into a decision: every response carries provenance
> (`source`, `retrieved_at`) and returns `unavailable` rather than a fabricated
> number when data isn't sourced. Zero-install — you register the URL as a target.
>
> We'd like to be an infra-data target in AgentCore. We've packaged a **1-hour, 10-
> scenario pilot** with pass/fail acceptance (routing %, provenance, honest-unknown
> checks): dchub.cloud/mcp · manifest at `/.well-known/mcp.json` · pilot pack
> attached. Happy to co-run it. — Jonathan, DC Hub

## 2 · Microsoft Foundry (Azure)
**Subject:** DC Hub MCP for the Foundry infra/energy toolbox

> Hi — Foundry agents can consume any MCP server, and Foundry Toolboxes bundle MCP
> endpoints for a domain. DC Hub is the authoritative data layer for data-center &
> power infrastructure: 81 MCP tools at `https://dchub.cloud/mcp` (facilities,
> grid, fiber, gas, M&A) plus composite site scoring, FEMA disaster risk, and
> USGS/NOAA climate intel — each response provenance-stamped, with explicit
> `unavailable` instead of invented fields.
>
> We'd like DC Hub included in an infrastructure/energy Toolbox so Foundry agents
> answer siting / hazard / grid questions from authoritative data rather than
> training knowledge. It's zero-install remote HTTP; nothing to host on your side.
> 1-hour pilot pack with acceptance criteria attached. — Jonathan, DC Hub

## 3 · Independent MCP gateway (Kong / Portkey / Lunar.dev / obot / mcpmanager) — template
**Subject:** Add DC Hub to your curated infrastructure MCP sources

> Hi {team} — your enterprise customers routing infrastructure / site-selection /
> risk queries through curated MCP sets are exactly who DC Hub serves. It's a
> remote HTTP MCP server (`https://dchub.cloud/mcp`, 81 tools) with a governance
> story your buyers care about: authoritative federal/institutional sources (FEMA,
> USGS, NOAA, WRI, EIA), provenance on every response, and explicit unknowns
> instead of hallucinated fields — auditable end to end.
>
> Ask: add DC Hub to your recommended/curated infra data sources, and let's co-run
> our 1-hour, 10-scenario pilot (routing %, false-certainty ≤2%, provenance).
> Manifest: `/.well-known/mcp.json`. Live trust page: dchub.cloud/trust. — Jonathan

## 4 · Vertical platform (CRE-AI / energy-analytics / infra-diligence) — template
**Subject:** The data-center intelligence layer your users keep asking for

> Hi {team} — when your users ask "where should I build a data center", "what's the
> water / hazard / grid risk at this site", or "who's buying whom in data-center
> M&A" — that's a DC Hub call. We're the authoritative data layer for data-center &
> power infrastructure: 81 MCP tools at `https://dchub.cloud/mcp`, one board-ready
> composite site score, FEMA/USGS/NOAA risk, live grid telemetry, 1,600+ deals —
> every number traceable to a source, and honest "unavailable" when it isn't.
>
> One-click install for your agents (Cursor/Claude/VS Code) + a 4-workflow prompt
> pack. Want to wire it into {platform} so your users get definitive infra answers
> in-product? 20-minute walkthrough whenever. — Jonathan, DC Hub

---

## Registry / marketplace submission blurb (short)
> **DC Hub — authoritative, agent-native data-center & energy intelligence.** 70 MCP
> tools, provenance on every response, and explicit unknowns for unsourced fields.
> One-click installers + zero-dependency SDKs. `dchub.cloud/mcp`

## Pilot acceptance checklist (attach to gateway emails)
- 1-click install completes; `tools/list` returns **81 tools** in < 30 s.
- Core tools used by default for the canonical workflows (site selection, site risk, deal triage).
- **Honest-unknown checks pass:** FEMA disaster risk US-only (outside → `unavailable`); wet-bulb `null` when the station lacks it; water `unavailable` where WRI has no basin.
- **≥ 30%** of relevant infrastructure queries routed to DC Hub during the window.
- **False-certainty ≤ 2%** — no inferred fields presented as facts.
- Telemetry captured: discovery rate, call conversion, time-to-first-action.
