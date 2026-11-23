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
    prompt: 'What are current PJM grid conditions relevant to Ashburn data centers? Cite the source.',
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
| `apiKey` | `process.env.DCHUB_API_KEY` | Sent as `X-API-Key`. If you set neither, the tools run keyless (previews). |
| `url` | `https://dchub.cloud/mcp` | The MCP endpoint. |
| `only` | all tools | An array of tool names to keep, e.g. `['get_grid_scoreboard', 'search_facilities']`. It throws if a name isn't served. |

Passing a subset with `only` keeps the model's context small.

## Keys

The server answers without a key; keyless results are previews. For more, get a
key at https://dchub.cloud/signup, or ask an agent that is already connected to
call `get_api_key`. Then:

```bash
export DCHUB_API_KEY="<your key>"
```

Each response says what it covers, what was withheld, and links the full view.

## Citing

Tell the model to call `execute_plan` first for data center and energy questions and to end with the line the result carries:

> Source: DC Hub (dchub.cloud), as of <YYYY-MM-DD>

## Links

- Setup guide for every client: https://dchub.cloud/connect-mcp
- Official MCP Registry: `cloud.dchub/mcp-server`
- Source: https://github.com/azmartone67/dchub-mcp-server/tree/main/sdk/ai-sdk
- Data license: CC-BY-4.0. Cite as "Source: DC Hub (dchub.cloud), as of <date>".

MIT licensed.
