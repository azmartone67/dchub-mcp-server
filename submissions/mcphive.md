# MCPHive submission

**Target:** https://mcphive.com

**Status:** ⚠️ **HOLD — MCPHive marked `broken_backend`** in dchub's crawler
config (task #60, 2026-05-29). Their submission backend was returning 5xx /
silently failing form posts when last probed (task #55 confirmed UI click but
no listing materialized — task #60 marked it broken).

**Recommendation:** **Don't open the PR for active submission yet.** Either:
1. **Skip this lane** — close this branch with a note (and re-open later when
   MCPHive backend recovers), or
2. **Hold the PR in draft** until MCPHive's submission backend is back up.

This artifact is the **paste-ready submission** for when the backend recovers
or when the maintainer wants to retry manually.

| Field | Value |
|-------|-------|
| Name | DC Hub — Data Center & Energy Intelligence |
| Repo URL | https://github.com/azmartone67/dchub-mcp-server |
| Server type | Remote (Streamable HTTP) |
| Endpoint URL | https://dchub.cloud/mcp |
| Homepage | https://dchub.cloud |
| Auth | None for free tier; `X-API-Key` header for full data |
| Tool count | 38 |
| Tags | data-center, energy, natural-gas, electricity-grid, infrastructure, market-intelligence |

**Short description (≤300 chars):**
> DC Hub is the live data-center & energy intelligence MCP: 21k+ facilities,
> 232 markets, 10 ISO grids, the DCPI power index, the DCGI gas index,
> interconnection queues, M&A, fiber, water & tax. 38 tools an agent can query
> and cite (CC-BY-4.0). Free tier, no signup.

**Manifest URL (if asked):** `https://dchub.cloud/.well-known/mcp-server.json`

## Maintainer checklist
- [ ] **Probe MCPHive submission backend first** (`curl -I https://mcphive.com/submit`
      or check the form returns 200 on POST). If still broken, skip and revisit
      later.
- [ ] If working: paste the values above into the submission form at
      https://mcphive.com.
- [ ] After listing, confirm tool count shows **38** and endpoint is correct.
- [ ] If submission backend is still broken, send a note to MCPHive maintainers
      (or open an issue on their GitHub if they have one) flagging the
      submission backend regression. Including this artifact's contents speeds
      up the listing once they fix it.

## Why this is on hold
Per memory `reference_dchub_brain_findings_schema.md` and task #55/#60: the
dchub crawler attempted submission on 2026-05-29; the form returned no
acknowledgement and no listing showed up. Adding to crawler config as
`broken_backend` so we stop wasting probe cycles. Re-evaluate weekly.
