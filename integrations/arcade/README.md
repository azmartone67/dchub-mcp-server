# DC Hub in Arcade

DC Hub is a remote Streamable HTTP MCP server, so Arcade can carry it directly as a
**Remote MCP** server. No toolkit package or wrapper is needed: Arcade calls
`https://dchub.cloud/mcp`, and you choose which tools each MCP gateway exposes.

DC Hub provides live, dated data on data centers and their power for AI agents. It covers
facilities and operators, market power verdicts (DCPI BUILD/CAUTION/AVOID), live ISO grid
data, interconnection queues, energy and gas prices, fiber and subsea routes, site selection
and site risk, M&A, and available colocation and powered-land capacity. Every result carries
`cite_as` and `as_of`.

The machine-readable version of this page is [`arcade-remote-server.json`](./arcade-remote-server.json).

## 1. Register the server (once per Arcade project or organization)

1. In the Arcade dashboard, open **MCP servers**, then **Add Server**, then **Remote MCP**.
2. Enter **ID** `dchub` and **URI** `https://dchub.cloud/mcp`.
3. Open **Advanced settings** and add the custom header `X-DCHub-Via: arcade`. It only tags
   the traffic so DC Hub can count calls that arrive through Arcade. It grants no access.
4. Optional, recommended for anything beyond evaluation: store a DC Hub key as the header
   secret `DCHUB_API_KEY` and add the header `X-API-Key: ${secret:DCHUB_API_KEY}`.
5. Save. DC Hub needs no sign-in, so Arcade lists the tools straight away. Set the scope to
   `Global` to share the server with every project in the organization.

## 2. Build a gateway

Open **MCP Gateways**, then **Create Gateway**, then **Select tools**, and filter by `dchub`.
Use one of these profiles:

**Lean (recommended default, 12 tools):** `execute_plan`, `search_facilities`,
`get_facility`, `get_market_intel`, `get_market_dcpi_rank`, `rank_markets`, `get_grid_data`,
`get_interconnection_queue`, `find_sites`, `get_fiber_intel`, `source_capacity`,
`summarize_for_citation`.

**Read-only (67 tools):** every tool except the key, email, alert, shortlist, saved-site,
capacity-terms and other write tools. This is the same set as the `/mcp/claude` directory
profile. The list is `gateway_profiles.read_only` in the JSON.

**Core endpoint (alternative):** register `https://dchub.cloud/mcp/core` as a second server
with ID `dchub-core`. It exposes ten composite read-only tools that share one
`as_of`/`sources`/`access` envelope. See [`docs/core-profile.md`](../../docs/core-profile.md).

Clients connect to the gateway at `https://api.arcade.dev/mcp/<your-gateway-slug>`. From the
Arcade SDK, call tools as `dchub.<tool>`, for example `dchub.get_market_intel`.

## Auth options

| Mode | What to set in Arcade | Who it identifies |
|---|---|---|
| Keyless (default) | nothing | nobody: previews on every tool |
| API key | header `X-API-Key: ${secret:DCHUB_API_KEY}` | the project: one key for every gateway user |
| OAuth (optional) | register URI `https://dchub.cloud/mcp/oauth` instead | each end user, on their first call |

- **Keyless calls are counted per source IP.** Every user of an Arcade gateway reaches DC Hub
  from Arcade's egress addresses, so they share one keyless allowance. Use keyless calls to
  evaluate, and a key for real traffic. A capped call still returns a preview with
  `human_url`; it is not an error, so do not retry it in a loop.
- **Keys.** A free key comes from `claim_free_key` on `https://dchub.cloud/mcp`. For a
  gateway serving many users, ask for a partner key at partnerships@dchub.cloud. A partner
  key has its own allowance and is not tied to an IP.
- **OAuth.** `/mcp/oauth` answers `401` with an RFC 9728 `WWW-Authenticate` challenge.
  Discovery is at `https://dchub.cloud/.well-known/oauth-protected-resource/mcp`, and the
  authorization server (WorkOS AuthKit) supports dynamic client registration and PKCE.
  This path has not yet been run end to end from Arcade.

## What Arcade does not carry

Arcade passes tools only, not MCP prompts, resources or sampling. So the server's
`instructions` and the `dchub://instructions` resource never reach an Arcade agent. DC Hub
does not depend on them: each tool result carries `cite_as`, `as_of`, and on a partial result
`human_url` and `human_message`. Agents should cite "DC Hub (dchub.cloud), as of <date>" and
show the user `human_message` when a result is partial.

## Check before registering

```bash
node integrations/arcade/check-arcade-compat.mjs                    # lean profile on /mcp
node integrations/arcade/check-arcade-compat.mjs --profile read_only
node integrations/arcade/check-arcade-compat.mjs --profile core_endpoint
DCHUB_API_KEY=... node integrations/arcade/check-arcade-compat.mjs   # as Arcade sends the secret
```

The script mirrors Arcade's requirements. It runs a Streamable HTTP `initialize`, then
`tools/list`, and checks that every profile tool is listed with `readOnlyHint: true`. It then
makes one keyless tool call that must return `cite_as` and `as_of`. It sends DC Hub's QA
markers, so the check is not counted as Arcade traffic. Arcade's own MCP Debugger works too.

## Sources

- Arcade, "Add remote MCP servers": https://docs.arcade.dev/guides/mcp-gateways/add-remote-servers
- Arcade, "Bring a third-party MCP server to Arcade": https://www.arcade.dev/blog/bring-third-party-mcp-server-to-arcade
- Tavily's Arcade partner setup (the same Remote MCP path): https://docs.tavily.com/documentation/integrations/arcade-dev
- DC Hub builders page (composition, rate limits, attribution): https://dchub.cloud/mcp/builders
