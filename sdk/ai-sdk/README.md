# dchub-ai-sdk: DC Hub tools for the Vercel AI SDK

This package brings live data on the physical infrastructure behind AI into
[AI SDK](https://ai-sdk.dev) agents: data-center facilities, market scores, live
ISO grid telemetry, interconnection queues, fiber, gas, water and disaster risk.
Every answer carries its source.

It is a thin wrapper over `@ai-sdk/mcp`. It opens a client on the DC Hub remote
MCP server (`https://dchub.cloud/mcp`) and returns that server's tools as an AI
SDK `ToolSet`. The package keeps no copy of the tool list, so it always matches
what the server serves.

## Install

```bash
npm install dchub-ai-sdk ai @ai-sdk/mcp
```

## Quickstart

```ts
import { generateText, gateway, isStepCount } from 'ai';
import { withDCHubTools } from 'dchub-ai-sdk';

const { text } = await withDCHubTools({}, ({ tools }) =>
  generateText({
    model: gateway('openai/gpt-5-mini'),
    tools,
    stopWhen: isStepCount(5),
    prompt: 'Which US grid has the most headroom right now? Cite the source.',
  }),
);

console.log(text);
```

`withDCHubTools` closes the MCP client when your function returns or throws.
If you need the client to stay open, use `createDCHubTools`, which returns
`{ tools, close }`. You then call `close()` yourself.

## Options

| Option | Default | Meaning |
|--------|---------|---------|
| `apiKey` | `process.env.DCHUB_API_KEY` | Sent as `X-API-Key`. If you set neither, the tools run keyless on the free tier. |
| `url` | `https://dchub.cloud/mcp` | The MCP endpoint. |
| `only` | all tools | An array of tool names to keep, e.g. `['get_grid_scoreboard', 'search_facilities']`. It throws if a name isn't served. |

Passing a subset with `only` keeps the model's context small.

## Keys and tiers

The server answers without a key on the free tier. For more, get a free key at
https://dchub.cloud/signup, or ask an agent that is already connected to call
`claim_free_key`. Then:

```bash
export DCHUB_API_KEY=dch_live_...
```

On the free tier some fields are previews. Each tool's response says what it
covers and what it does not.

## Links

- Setup guide for every client: https://dchub.cloud/connect-mcp
- Official MCP Registry: `cloud.dchub/mcp-server`
- Source: https://github.com/azmartone67/dchub-mcp-server/tree/main/sdk/ai-sdk
- Data license: CC-BY-4.0. Cite https://dchub.cloud.

MIT licensed.
