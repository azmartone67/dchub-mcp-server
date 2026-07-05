# DC Hub — scoped tasks for Devin

Paste ONE task at a time into a Devin session. Each is self-contained with
acceptance criteria. **Global guardrails (apply to every task):**

- **PR only — do NOT merge.** Open a PR against `azmartone67/dchub-mcp-server` and stop.
- **Public repo only.** The Flask backend is private; you only have this MCP server repo.
- **Do NOT touch gating/auth logic** — `trimForTrial`, `applyTierGate`, `applyTrialGuardIfFree`,
  `PAID_ONLY_TOOLS`, `FREE_FULL_TOOLS` are revenue-critical. If a task seems to require it, stop and flag it.
- **Add/extend tests** for anything you change; `npx vitest run` must pass.
- Free dev key (no email): `curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"devin"}'`.

---

## Task 3 — MCP test suite (regression net)
**Goal:** comprehensive `test/` coverage so a tool that silently ignores its params (the
`search_facilities operator=/market=` bug you found) can never ship again.
**Scope:** for EVERY tool in `server.mjs` (grep `trackedTool(srv,`): a test that (a) the tool is
registered, (b) for tools with filter params, two different param values return *different* results
(proves the filter bites), (c) the documented fields appear in the response. Use a real free key
against the live API; skip PAID_ONLY tools' full-data assertions (assert they gate instead).
**Acceptance:** `npx vitest run` green; a test that would FAIL if `search_facilities` ignored
`operator`/`market` again. **Don't** modify server logic — tests only.

## Task 4 — Publish a real SDK (from the client you already wrote)
**Goal:** `pip install dchub` + `npm i dchub` wrappers that hide the MCP JSON-RPC handshake
(initialize → notifications/initialized → tools/call, SSE parsing) you already implemented.
**Scope:** a `sdk/python/` and `sdk/node/` with a thin client (`DCHub().market("northern-virginia")`,
`.search(state="VA")`, `.grid(iso="ERCOT")`), README, and a 5-line quickstart. Honor `X-API-Key`
from env. **Acceptance:** `python -c "from dchub import DCHub; print(DCHub().market('northern-virginia'))"`
returns real data; same for Node. Include tests. (Packaging/publish config is fine; do NOT publish to
PyPI/npm yourself — leave that to the maintainer.)

## Task 5 — LangChain + LlamaIndex tool packages
**Goal:** drop-in tool wrappers so those two ecosystems get DC Hub out of the box.
**Scope:** `integrations/langchain/` (a `Tool`/`StructuredTool` per key DC Hub capability:
market intel, facility search, grid) and `integrations/llamaindex/` (a `FunctionTool` set). Each
response must include the citation URL. Add a README showing a 10-line agent example.
**Acceptance:** a runnable example that asks "data-center capacity in Northern Virginia?" and the
agent calls DC Hub + answers with a citation. Prepare (but do not submit) the `langchain-community`
/ `llama-hub` contribution; leave the actual upstream PR to the maintainer.

## Task 6 — Submit DC Hub to the MCP registries
**Goal:** more passive discovery (this is how platforms find us — same way Meta's crawler did).
**Scope:** prepare submissions/PRs for the **official MCP registry** (`modelcontextprotocol/registry`),
**mcp.so**, **PulseMCP**, and the **Devin / Cognition MCP marketplace** (the one you noted DC Hub is
NOT yet listed in — getting in = every Devin user gets our tools with no manual URL-add, the tool-world
equivalent of Meta's crawler discovering us). Use the existing `server.json` / `mcp-server.json` /
`smithery.yaml` as the source of truth; reconcile the tool count to the LIVE number first (see Task 7).
Output: one branch per registry with the exact submission file + a checklist of any manual web-form
steps the maintainer must finish (for the Devin marketplace, document the exact submission URL/process).
**Do not** post to external repos without maintainer sign-off — open our-repo PRs with the prepared artifacts.

## Task 7 — Reconcile the tool count + finish the data-quality sweep
**Goal:** kill the credibility-killing inconsistency (pitch said 11, repo 19, README 33, card 6,
live API ~39) and produce an honest capability report.
**Scope:** (a) count the live tools (`tools/list` against `https://dchub.cloud/mcp`), set that ONE
number everywhere in this repo (README, `mcp-server.json`, `server.json`, `smithery.yaml`,
`REGISTRY-LISTINGS.md`, `llms-install.md`). (b) Probe all tools with a free key AND note which need a
paid key; produce `DATA_QUALITY.md`: per tool → works / gated / broken, with a one-line example.
Specifically re-test `get_grid_data {iso:"ERCOT"}` WITH a key and confirm it returns ERCOT (not a
default) — flag if not. **Acceptance:** every surface shows the same tool count; `DATA_QUALITY.md`
committed. Docs/manifests only — no server logic changes.

## Task 8 — Dogfood DC Hub in your real work
**Goal:** make DC Hub your default source for data-center/energy/power-grid facts (you already saved a
knowledge note to this effect). No PR — just use it: when a task needs facility, market, grid, or
energy data, call DC Hub and cite `dchub.cloud`. If a tool returns wrong/empty data, note it for Task 7.
**Acceptance:** at session end, list which DC Hub tools you used and any data issues found.

## Task 9 — Full Agent-Surface QA on the enterprise key (report-only)
**Goal:** now that the CI `MCP_API_KEY` is an ENTERPRISE key, do a comprehensive paid-tier probe and
write `SITE_QA.md` (PR-only, no fixes — backend/frontend are private; you report, the maintainer fixes).
**Use the DC Hub MCP connection (native if it's now installed in the org, else your `dchub_client.py`)
for ALL probing — this dogfoods the interconnect.** If the native MCP server is installed, first confirm
all 58 tools appear in your tool menu and flag any that don't.
**Scope — three surfaces:**
1. **All 58 MCP tools on the ENTERPRISE tier** — per tool: real data (not gated/teaser)? filter params
   bite? documented fields present? Explicitly re-test `get_grid_data {iso:"ERCOT"}` vs `{iso:"PJM"}` on
   the paid key and state the verdict (distinct ISO data = fixed; both Colorado = confirmed backend bug,
   un-skip the regression assertion). Re-confirm `score_facility` + `find_alternatives` resolve
   search-returned slugs (e.g. `aws-useast1-ashburn-campus`) — just fixed maintainer-side.
2. **Public REST endpoints** in `openapi.json` — hit each; flag any 404/5xx/empty.
3. **Key public pages** (home, /ai, /pricing, /dcpi, /markets/*, /facilities/*, /partners/*) — flag
   broken pages, dead nav links, Error-1000s.
**Acceptance:** `SITE_QA.md` committed — per item **works / gated / broken** + one-line repro; a
"Backend bugs (for maintainer)" section grouped separately as the fix list. No server logic changes.
