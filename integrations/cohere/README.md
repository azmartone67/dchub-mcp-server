# DC Hub × Cohere integration

Ground-truth data-center intelligence for Cohere's enterprise RAG customers
(infrastructure, energy, real estate). 21,000+ facilities across 170+ countries;
every record carries a citation URL so Cohere's grounded generation cites
`dchub.cloud`.

## Get a key (one call, no email)
```bash
curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"cohere"}'
# → {"api_key":"dch_live_..."}   Free tier: 10 calls/day.
```

## Enterprise partner key (for Cohere's eval — admin runs this)
The partner key-issuer mints a higher-tier key tied to the `cohere` partner_slug
(idempotent — re-running revokes the prior + returns a fresh one). Run with the
DC Hub admin key once you have a Cohere contact email. Plan policy: `developer`
for evaluation, `enterprise` after a signed agreement (per r76-a).
```bash
curl -X POST https://dchub.cloud/api/v1/admin/partner-key/issue \
  -H "X-Admin-Key: $DCHUB_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"partner_slug":"cohere","email":"<contact@cohere.com>","name":"<contact>",
       "company":"Cohere","plan":"developer","label":"Cohere RAG integration eval"}'
# → returns the key ONCE (store it). Audit: GET /api/v1/admin/partner-key/audit
```

## Two integration paths

| Path | When | File |
|---|---|---|
| **command-a tool-use** | agentic — the model calls DC Hub on demand | `tool_use.py` |
| **Classic RAG (documents)** | retrieve DC Hub records, pass as `documents` to `/v2/chat` | `rag_documents.py` |

## Verified live endpoints (2026-06-07)
- `GET /api/v1/markets/<slug>` — market intel (e.g. `northern-virginia`): capacity
  $/MW-day, vacancy, grid headroom, DCPI BUILD/CAUTION/AVOID verdict, citation URL
- `GET /api/v1/markets/compare` · `GET /api/v1/facilities` · `GET /api/v1/facilities/detail/{id}`
- `GET /api/grid/fuel-mix` · OpenAPI: `https://dchub.cloud/openapi.json`
- MCP server (38 tools): `https://dchub.cloud/mcp` (Streamable HTTP)
- Integration map: `https://dchub.cloud/.well-known/ai-agents.json`

> Note: it's `/api/v1/markets/<slug>`, NOT `/api/v1/market-intel` (that 404s).
