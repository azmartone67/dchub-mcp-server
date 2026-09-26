# dchub — Node SDK

Live data-center, power & gas intelligence for AI agents. Hides the MCP JSON-RPC
handshake (`initialize` → `notifications/initialized` → `tools/call`, SSE
parsing) behind a thin client. **Zero runtime dependencies** (global `fetch`,
Node ≥ 18).

## Install
```bash
npm i dchub               # published on npm as `dchub`; from this repo: npm i ./sdk/node
```

## Quickstart (5 lines)
```js
import { DCHub } from "dchub";
const dc = new DCHub();                          // reads DCHUB_API_KEY from env
console.log(await dc.market("northern-virginia"));   // market intel
console.log(await dc.search({ state: "VA" }));       // facility search
console.log(await dc.grid("ERCOT"));                 // live grid intel
```

## API
| Method | Tool | Returns |
|--------|------|---------|
| `dc.market(slug)` | `get_market_intel` | by-status counts, operators, recent facilities |
| `dc.search({ q, state, country, limit })` | `search_facilities` (`q` is sent as the tool's `query` argument) | rows w/ canonical slug, provider, location |
| `dc.grid(iso)` | `get_grid_data` | live demand / mix / headroom |
| `dc.call(tool, args)` | *any of the 92 tools* | cleaned data payload |
| `dc.tools()` | `tools/list` | array of tool names (92 today) |

## Auth & tiers
Set `DCHUB_API_KEY` (sent as `X-API-Key`) for full data:
```bash
curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"node-sdk"}'
export DCHUB_API_KEY=dch_live_...
```
On the **free tier** some fields are masked and `grid` returns a gated preview;
the SDK strips the upsell wrapper and returns the real embedded payload either
way. Source/citation: https://dchub.cloud (CC-BY-4.0).

## Tests
```bash
npm test          # node --test — live, gate-graceful tests + offline argument-mapping tests
```

Published on npm as [`dchub`](https://www.npmjs.com/package/dchub).
