# Cline Marketplace submission

**Target:** https://github.com/cline/mcp-marketplace. Submissions are a GitHub
**issue** from the `mcp-server-submission.yml` template, not a PR. The template
asks for three things: the repo URL, a 400×400 PNG logo, and two confirmations
(Cline can install the server from README.md / llms-install.md alone, and the
server is stable).

## State (2026-09-26)

- **Open:** cline/mcp-marketplace#1823, filed 2026-06-19 by azmartone67. No
  labels, no comments, no maintainer response.
- **Closed as duplicates by us:** #1024, #1025, #1026, #1499, #1668.
  **Do not file a seventh.** Refresh #1823 in place and leave one comment.
- Logo: `dchub-logo.png` at the repo root, measured 400×400.
- Install copy the reviewers will hand to Cline: `llms-install.md`. Its Cline
  block uses `"type": "streamableHttp"`; without that field Cline treats the
  entry as stdio.
- Keyless install measured live 2026-09-26: `initialize`, `tools/list` (92)
  and a `tools/call` all return 200 with no key.

## Refreshed body for #1823 (paste over the existing body)

The figures follow repo canon (`node scripts/sync-tools-manifest.mjs` prints
them). Re-read before pasting.

```markdown
**GitHub Repository URL:** https://github.com/azmartone67/dchub-mcp-server

**Logo (400×400 PNG):** https://raw.githubusercontent.com/azmartone67/dchub-mcp-server/main/dchub-logo.png

**Server type:** remote, Streamable HTTP, at `https://dchub.cloud/mcp`. There is nothing to clone or build. `llms-install.md` gives Cline the exact `cline_mcp_settings.json` entry (`"type": "streamableHttp"`).

**Why it benefits Cline users**
DC Hub is live data on the physical infrastructure behind AI: 92 tools across 24,600+ data-center facilities in 170+ countries, 300+ scored markets, live ISO grid telemetry, interconnection queues, fiber, gas and water risk, and 1,600+ tracked M&A deals. Every answer carries its source and states what it does not cover. Cline can query and cite current infrastructure data for site selection, energy and market research instead of relying on training data.

**Installation testing**
- [x] Cline can set up this server using only README.md / llms-install.md
- [x] The server is stable and ready for public use

**Also listed in:** the official MCP Registry as `cloud.dchub/mcp-server`, Smithery, and Glama.

**License:** MIT (code). Data is CC-BY-4.0.
```

## One comment on #1823 (after the body edit)

```markdown
Hi Cline team, I refreshed this submission with current figures and the exact Cline config (`"type": "streamableHttp"`). The earlier DC Hub issues were duplicates that I've closed, so this is the only one. Happy to provide anything else you need for review.
```
