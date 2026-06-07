# DC Hub SDKs

Thin clients that hide the MCP JSON-RPC handshake (`initialize` →
`notifications/initialized` → `tools/call`, SSE parsing) behind a few methods.
Both expose the same surface: `.market(slug)`, `.search(...)`, `.grid(iso)`,
`.call(tool, ...)`, `.tools()`. **Zero runtime dependencies.**

| SDK | Install | Quickstart |
|-----|---------|-----------|
| [Python](python/) | `pip install ./sdk/python` | `from dchub import DCHub; DCHub().market("northern-virginia")` |
| [Node](node/) | `npm i ./sdk/node` | `import { DCHub } from "dchub"; await new DCHub().market("northern-virginia")` |

Set `DCHUB_API_KEY` (sent as `X-API-Key`) for full-tier data; the free tier works
without one (some fields masked). Get a key:
```bash
curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"sdk"}'
```

Both packages are **packaging-ready but not published** — the maintainer ships to
PyPI / npm. See each subdir's README for the publish command and tests.
