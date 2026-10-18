# DC Hub Power & Grid (second server) - R2 design and publish plan

Grok MCP platform ranking plan, 2026-10-18, R2. Status: DRAFT PR; nothing published, no listing claimed.

## What it is
`https://dchub.cloud/mcp/power`, a pack path on the existing server (`MCP_PACKS` in `server.mjs`, `pack: power`).
Same backend, same keys, same gates and free tier as `/mcp`. It is a **listing scope, not an entitlement scope**:
it advertises 15 tools; `tools/call` still accepts any DC Hub tool by name under the caller's own key.

15 tools = 11 listed + the 4-tool shared spine every pack carries (a pack must never be a dead end):

| Question an energy/utility searcher asks | Tool |
|---|---|
| Which markets have the best power right now (DCPI rank) | `get_market_dcpi_rank` |
| When can power actually be delivered | `get_power_availability_timeline` |
| What is waiting in the interconnection queue | `get_interconnection_queue` |
| Grid headroom, substations, constraint reads | `get_grid_intelligence`, `get_grid_scoreboard` |
| Electricity / energy prices | `get_energy_prices` |
| One ISO versus another | `compare_isos` |
| Feeder load capacity, retiring-plant headroom | `get_hosting_capacity`, `get_retirement_headroom` |
| Does this site / where should I look | `analyze_site`, `find_sites` |
| spine | `discover_tools`, `claim_free_key`, `unlock_more_data`, `summarize_for_citation` |

Deliberately left to `/mcp/grid` (17 tools) and `/mcp`: `get_refined_queue`, `get_power_pipeline`, `get_grid_data`,
`get_iso_context`, `get_infra_projects`, `execute_plan`. Swap any of them in `MCP_PACKS` and bump
`power` in `test/mcp-packs.test.mjs` in the same commit if the first-week data says so.

`/mcp/grid` is unchanged. The new path exists so the registry can list a second *entry*: the registry refuses a
remote URL already used by another server, and deprecating the other entry does not release it
(REGISTRY-LISTINGS.md, "TWO ENTRIES, ONE MAINTAINED"). `/mcp/power` is used by this entry only.

## Registry manifest
`registry/power-grid.server.json` - name `cloud.dchub/power-grid`, title and description inside the schema's
100-character limits (checked by `test/power-grid-listing.test.mjs`), no prices or plan names, one remote.
It is NOT picked up by `scripts/registry-autopublish.mjs` (which publishes `server.json` only), so merging
this changes nothing live.

## Publish plan (owner steps in bold)
1. Merge this PR, let the MCP server deploy, then verify from outside:
   `curl -s -X POST https://dchub.cloud/mcp/power -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` returns 15 tools.
   (GET on any `/mcp/*` path answers 200 from the zone health blob; only POST proves the mount.)
2. **Official registry:** `./mcp-publisher publish registry/power-grid.server.json` (DNS auth for `cloud.dchub`
   is already in place for the other entry). Re-publishing needs a version bump; follow `server.json`'s version.
3. **Claim listings** (one per directory, new entry each time, use `https://dchub.cloud/mcp/power`):
   Smithery (`smithery mcp publish "https://dchub.cloud/mcp/power" -n azmartone67/dchub-power-grid`),
   Glama, PulseMCP, LobeHub, mcp.so. Title for forms: "DC Hub Power & Grid"; one-liner = the manifest description.
4. Do not add `/mcp/power` to `REGISTRY_REMOTE_PATHS` of the first entry (the URL would then belong to both).
5. Measure after a week by path (`/mcp/power` rides ctx.path on every call) before adding tools.

Constraints kept: `/mcp/chatgpt` untouched; no price or plan wording anywhere in this server's copy.
