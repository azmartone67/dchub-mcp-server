# DC Hub — MCP Registry Submissions (per-registry)

Each MCP catalog/registry has its own per-registry branch + PR under
`submit/<registry>`. This branch holds the **MCPHive** submission artifact.

**Source of truth:** `../server.json` + `../mcp-server.json` (38 tools).
**Live endpoint:** `https://dchub.cloud/mcp` (Streamable HTTP).
**Live server:** v2.1.24, 38 tools.

> ⚠️ **MCPHive is currently flagged `broken_backend`** in the dchub crawler
> config (task #60). See `mcphive.md` for details — this PR is HOLD until
> MCPHive's submission backend is back up.
