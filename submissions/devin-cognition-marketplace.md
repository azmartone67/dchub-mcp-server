# Devin / Cognition MCP Marketplace

Goal: get DC Hub into the **curated Devin MCP Marketplace** so it's discoverable
to *all* Devin users (organic, "Meta-crawler"-style discovery).

## What I found (verified this session via Devin's `list_integrations`)

1. **DC Hub is already installed as a custom MCP in this org.** The org's MCP list
   contains an entry:
   ```json
   { "name": "DCHUB", "slug": "dchub", "description": "DCHUB",
     "is_installed": true, "is_enabled": true,
     "setup_url": "/settings/mcp-marketplace/setup/dchub" }
   ```
   So within *this* org it already works. **But** it is an org-scoped *custom*
   server, **not** a curated marketplace listing visible to other orgs.

2. **The curated marketplace is Cognition-managed.** The catalog entries that
   every Devin user sees are either Cognition-built (`cognition-*`: AlloyDB,
   BigQuery, Redshift, …) or onboarded partners (Asana, Atlassian, Amplitude,
   CircleCI, Browserless, …). There is **no self-serve "publish to the global
   marketplace" form** — listings are added by Cognition.

3. **The two real paths** (per https://docs.devin.ai/work-with-devin/mcp):
   - **Add Your Own** (org admin): adds a custom MCP for *your* org only. Already
     done here.
   - **Suggest MCP Integration**: the request channel to get a server added to the
     *curated* marketplace for all users. This is the path that matters for the
     "all Devin users" goal — and it must be initiated by the maintainer from a
     Devin account.

## ⚠️ Quick win — the org listing has a placeholder description

The existing `DCHUB` entry's `description` is literally `"DCHUB"` and the display
name is all-caps `DCHUB`. Compare to curated entries that carry a full sentence.
Fix it at `/settings/mcp-marketplace/configure/...` for a much stronger listing:

- **Display name:** `DC Hub — Data Center & Energy Intelligence`
- **Short description:** `Live data-center, power & gas intelligence for AI agents — 58 tools, query and cite (CC-BY-4.0).`
- **Icon:** a DC Hub logo URL or an emoji (e.g. ⚡).

## Custom-MCP config (for the "Add Your Own" form, any org)

- **Transport:** HTTP (Streamable HTTP)
- **Server URL:** `https://dchub.cloud/mcp`
- **Headers (optional, for full data):** `X-API-Key: <dchub_live_…>`
- After saving, click **Test listing tools** → should discover **58 tools**.

## Maintainer checklist
- [ ] **Suggest MCP Integration** in Settings → MCP Marketplace to request a
      *curated* DC Hub listing for all Devin users. Provide: name, endpoint
      `https://dchub.cloud/mcp`, the short description above, and the 58-tool
      count. (Requires a Devin account — Devin can't submit this programmatically.)
- [ ] Fix this org's `DCHUB` custom listing description/name/icon (placeholder
      `"DCHUB"` → values above).
- [ ] Confirm **Test listing tools** discovers 58 tools (tier-gating note: free
      tier connects fine; full data needs a valid `X-API-Key` whose backend tier
      resolves correctly — see `SITE_QA.md` bug #2, still open).

> Note: a curated listing is the single highest-leverage discovery channel here —
> it's the only one that exposes DC Hub to *every* Devin org by default.

---

## Ready-to-paste "Suggest MCP Integration" copy

Paste these into the **Suggest MCP Integration** form (Settings → MCP Marketplace).
Field labels vary; map by intent.

**Integration name:** `DC Hub`

**Display title:** `DC Hub — Data Center & Energy Intelligence`

**MCP server URL:** `https://dchub.cloud/mcp`  (transport: Streamable HTTP)

**Category / tags:** Data & Analytics · Infrastructure · Energy

**Auth:** None required for the free tier (connects anonymously). Optional
`X-API-Key` header unlocks full data; keys are free (`POST https://dchub.cloud/api/v1/keys/claim`).

**Short description (one line, ≤100 chars):**
> Live data-center, power & gas intelligence for AI agents — 58 tools, query and cite (CC-BY-4.0).

**Long description:**
> DC Hub gives Devin agents ground-truth data-center & energy data instead of
> stale training knowledge. 58 MCP tools over Streamable HTTP: search 21,000+
> facilities, score build sites, rank 300+ markets (DCPI power index), check the
> DCGI gas index, compare US ISO grids live, and pull interconnection queues,
> M&A, fiber, water & tax data. Every response is citation-ready (CC-BY-4.0).
> Free tier, no signup. Connect once and any "where should I build / how much
> capacity / which grid is greenest" question gets a real, sourced answer.

**Why list it (value to Devin users):**
> Infra, energy, real-estate and diligence workflows currently force agents to
> guess at facility, power and grid facts. DC Hub turns those into live,
> attributable lookups — useful by default to every Devin org, no per-user
> setup. It's a remote server (nothing to install) with a working free tier, so
> the listing is zero-friction to try.

**Example prompts that trigger it:**
> "Where should I build a data center?" · "How much data-center capacity is in
> Northern Virginia?" · "Which US grid is greenest right now?" · "Which states
> are gas-advantaged for DC power?"

**Tool count:** 58 · **Repo:** https://github.com/azmartone67/dchub-mcp-server ·
**Homepage:** https://dchub.cloud · **License:** CC-BY-4.0

**Maintainer contact:** `<your email>`

> ⚠️ Before submitting, fix the **PAID_ONLY tier** bug (`SITE_QA.md` #2) so a
> reviewer testing with a key sees full data, not `current_tier:"free"`. On the
> free tier the listing still connects and discovers all 58 tools.
