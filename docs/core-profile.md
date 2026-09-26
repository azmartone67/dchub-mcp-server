# /mcp/core: the core tool profile

`/mcp/core` is a separate MCP endpoint that lists ten read-only tools instead of the full
catalog. It is aimed at hosts that choose tools by reading their descriptions, such as
Microsoft Copilot Studio, Claude and ChatGPT. `/mcp` is unchanged.

## What it is

- **Transport:** streamable HTTP, stateless. POST JSON-RPC, and send
  `Accept: application/json, text/event-stream`, as you would for `/mcp`. No session ID is
  issued, and GET and DELETE return 405.
- **Tools:** `plan_and_answer`, `find_sites`, `evaluate_site`, `compare_sites`,
  `market_snapshot`, `rank_markets`, `grid_power`, `fiber_connectivity`, `facility_lookup` and
  `get_evidence`.
  - Every tool has a title and `annotations.readOnlyHint: true`.
  - Titles and descriptions are plain ASCII, with no URLs, pricing or instructions to the
    model.
- **Composition:** each core tool calls the existing canonical tool handlers in the same
  process, so the core layer has no data logic of its own. The allowlist of reachable
  handlers is `CORE_DELEGATES` in `lib/core-profile.mjs`.
- **Access:** calls run with the caller's own key and tier, through the same gates, previews
  and quotas as `/mcp`. Credentials are resolved by the same code as `/mcp`: X-API-Key
  header, Bearer (DC Hub OAuth token or WorkOS/AuthKit JWT), query parameter or inline
  argument. The same OAuth and invalid-bearer challenges apply.

## Response envelope

Every tool returns the same top-level fields, in both text and structuredContent:

| field | meaning |
|---|---|
| `as_of`, `as_of_status` | Taken from the source's own provenance. When there are several sections, this is the oldest `as_of` among them. It is null with `not_provided_by_source` when the source gives none. |
| `sources`, `source_status`, `license` | Upstream sources named by the source. `platform_only` means the source only named DC Hub itself. |
| `headline`, `headline_status` | Fixed headline fields that are always present. Each null value has a status: `withheld`, `null_in_source` or `not_provided`. |
| `access` | One of `full`, `preview`, `headline`, `withheld` or `partial`, plus the withheld fields and row counts. |
| `unavailable` | Each factor or section that could not be served, with the reason. Values are never estimated to fill the gap. |
| `sections` | One per delegated call: `derived_from`, status, `as_of`, sources and the cleaned data. |

Delegated output passes through an outermost scrub (`coreScrub`), followed by a final check
(`toToolResult`). The scrub removes:
- agent-directed instructions, such as "include this verbatim";
- upgrade, checkout and payment blocks, including machine payment and x402;
- key material and trial keys;
- session plumbing;
- sentences that point at tools this profile does not list.

## evaluate_site without a key

A caller without Land & Power access gets the headline:
- the verdict, confidence and coverage map;
- the name of the limiting factor.

The composite score and every factor score and figure are null, and the response says they
are withheld. This uses the same `_lpPreviewPayload` reduction that a free key gets on
`/mcp`, and is limited per caller (`DCHUB_CORE_HEADLINE_PER_HOUR`, default 30).

This deliberately differs from the 2026-09-22 Land & Power rule, under which no key means no
data. To turn it off, set `DCHUB_CORE_KEYLESS_HEADLINE=0`; `evaluate_site` then reports
`withheld` for callers without a key.

## Microsoft Copilot Studio: static OAuth client (provider configuration, not code)

Copilot Studio's MCP connector with OAuth 2.0 needs a **static** client ID and secret. It
does not use dynamic client registration. Setting this up happens in the identity provider
and in Copilot Studio; nothing in this repository changes:

1. In the identity provider that issues the Bearer tokens this server accepts (WorkOS
   AuthKit), create a confidential OAuth application for Copilot Studio.
2. Add the redirect URI that Copilot Studio shows when you create the connector.
3. In Copilot Studio, add an MCP tool with:
   - server URL `https://dchub.cloud/mcp/core`;
   - authentication OAuth 2.0;
   - that application's client ID and secret;
   - the provider's authorization and token URLs;
   - the scopes this server advertises (`openid profile email offline_access`).
4. Create a reviewer account that Microsoft can sign in with, and confirm which tier it
   maps to. That tier decides whether reviewers see full results or previews.

Check after deploy: the protected-resource metadata names `https://dchub.cloud/mcp` as the
resource. If a host requires the resource to match `/mcp/core` exactly, add that path to the
metadata and to the token audience configuration.

## Testing

```bash
npx vitest run test/core-profile.test.mjs

curl -s -X POST https://<host>/mcp/core -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s -X POST https://<host>/mcp/core -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"evaluate_site","arguments":{"lat":39.04,"lon":-77.48,"state":"VA"}}}'
```
