# DC Hub — MCP Registry Submissions (per-registry)

Each MCP catalog/registry has its own per-registry branch + PR under
`submit/<registry>`. This branch holds the **Cline Marketplace** submission.

**Source of truth:** `../server.json` + `../mcp-server.json` (38 tools).
**Live endpoint:** `https://dchub.cloud/mcp` (Streamable HTTP).
**Live server:** v2.1.24, 38 tools.

See `cline-marketplace.md` for the full submission artifact.
# DC Hub — MCP Registry & Marketplace Submissions (Task 6)

Ready-to-submit artifacts + a per-target checklist of the manual web-form / CLI
steps the **maintainer** must finish (each requires *your* registry/Devin
accounts — they can't be automated from here).

**Single source of truth:** `../server.json` (official MCP-registry schema,
validated) and `../mcp-server.json` (38 tools). Live endpoint:
`https://dchub.cloud/mcp` (Streamable HTTP). Live server: **v2.1.24, 38 tools**
(verified via `tools/list` + `serverInfo.version`).

> Paste copy (one-liner, short/long descriptions, tags, config snippets) lives in
> `../REGISTRY-LISTINGS.md`. This folder holds the **exact submission file per
> target** + the **manual checklist**.

| # | Target | Artifact in this repo | Submission type | Status |
|---|--------|-----------------------|-----------------|--------|
| 1 | Official MCP Registry (`registry.modelcontextprotocol.io`) | `../server.json` | `mcp-publisher` CLI (OIDC + DNS) | ⏳ needs one-time DNS verify |
| 2 | mcp.so | `mcp.so.md` | web form | ⏳ maintainer form |
| 3 | PulseMCP | `pulsemcp.md` | web form | ⏳ maintainer form |
| 4 | Smithery | `../smithery.yaml` | CLI / web | ⏳ maintainer publish |
| 5 | Glama | `../glama.json` | auto-index (repo) | ✅ auto; just Refresh |
| 6 | Devin / Cognition MCP Marketplace | `devin-cognition-marketplace.md` | "Suggest MCP Integration" | ⏳ see file |

See each file for exact values + steps. Nothing here is posted to an external
repo — these are prepared artifacts for the maintainer to submit.
