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
| `dc.call(tool, args)` | *any DC Hub tool, by name* | cleaned data payload |
| `dc.tools()` | `tools/list` | array of every tool name the server lists |

## Vercel AI SDK (`dchub/ai-sdk`)
```bash
npm i dchub ai            # ai >= 5
```
```js
import { generateText, stepCountIs } from "ai";
import { dchubTools } from "dchub/ai-sdk";

const { text } = await generateText({
  model,                                   // any AI SDK model
  tools: await dchubTools(),               // execute_plan, search_facilities, get_market_intel, get_grid_data, source_capacity
  stopWhen: stepCountIs(5),
  prompt: "Rank US markets for a 200 MW AI campus and cite the as-of date.",
});
```
No key is needed to start (free-tier previews). `dchubTools({ apiKey })` or
`DCHUB_API_KEY` sends `X-API-Key`. `tools: "all"` exposes every tool, or pass a list
of names; `prefix: "dchub_"` namespaces them; `via` names your app in DC Hub's
partner counts (default `"ai-sdk"`). Each tool returns DC Hub's text unchanged, so
`cite_as`, `as_of` and `human_url` reach the model. Docs: https://dchub.cloud/docs/ai-sdk

## Auth & tiers
Set `DCHUB_API_KEY` (sent as `X-API-Key`) for full data:
```bash
curl -X POST https://dchub.cloud/api/v1/keys/claim -d '{"client_name":"node-sdk"}'
export DCHUB_API_KEY=dch_live_...
```
`DCHUB_UA_SUFFIX` (or `new DCHub({ uaSuffix })`) appends a label to the User-Agent,
e.g. your app name: `dc-sdk-node/0.3.1 (acme-siting)`.

On the **free tier** some fields are masked and `grid` returns a gated preview;
the SDK strips the upsell wrapper and returns the real embedded payload either
way. Source/citation: https://dchub.cloud (CC-BY-4.0).

## Tests
```bash
npm test          # node --test — live, gate-graceful tests + offline argument-mapping tests
```

Published on npm as [`dchub`](https://www.npmjs.com/package/dchub).
