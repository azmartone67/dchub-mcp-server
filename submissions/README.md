# DC Hub — MCP Registry Submissions (per-registry)

Each MCP catalog/registry has its own per-registry branch + PR under
`submit/<registry>` so submissions can move at independent CI/review/merge
cadence. This branch holds the **Cognition / Devin MCP Marketplace** artifact
only.

**Source of truth:** `../server.json` (official MCP-registry schema) +
`../mcp-server.json` (38 tools).
**Live endpoint:** `https://dchub.cloud/mcp` (Streamable HTTP).
**Live server:** v2.1.24, 38 tools (verified via `tools/list` + `serverInfo.version`).

Paste copy (one-liner, short/long descriptions, tags, config snippets) lives in
`../REGISTRY-LISTINGS.md`. This folder holds the **exact submission file** for
this registry + the **manual checklist**.

See `devin-cognition-marketplace.md` for the full submission artifact.
