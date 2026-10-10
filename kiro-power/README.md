# DC Hub power for Kiro

Live data center, power, grid, fiber and deal data for AI agents and site selection.

This directory is a [Kiro power](https://kiro.dev/docs/powers/) in the
[Agent Plugins](https://agent-plugins.org) format. It connects Kiro to the
remote DC Hub MCP server at `https://dchub.cloud/mcp` (Streamable HTTP) for live
data center market, power and grid, interconnection queue, energy price, fiber
and site selection data. Nothing runs locally.

## Contents

| File | Purpose |
| --- | --- |
| `plugin.json` | Power manifest: name, version, description, author, license and activation keywords |
| `mcp.json` | MCP server configuration: `dchub`, `streamable-http`, `https://dchub.cloud/mcp` |
| `skills/dc-hub-live-data/SKILL.md` | Which DC Hub tool to call for which question, and how to cite the results |

## Install

- In Kiro: Powers panel → **Add Custom Power** → **Import power from GitHub**, and
  enter `https://github.com/azmartone67/dchub-mcp-server/tree/main/kiro-power`.
- From a local clone: Powers panel → **Add Custom Power** → **Import power from a
  folder**, and select this `kiro-power` directory.

The power activates when a conversation mentions its keywords, for example
"data center", "site selection", "interconnection queue" or "energy prices".

## Authentication

None is needed for the free tier: anonymous calls return previews. For more
calls, ask the agent to run `claim_free_key`. To use a key you already have, add
an `X-API-Key` header to the `dchub` server, or get one at
https://dchub.cloud/connect.

## Example prompts

- "Rank US markets for a 200 MW AI campus."
- "How deep is the PJM interconnection queue right now?"
- "Compare water and disaster risk for sites near Phoenix and Dallas."
- "What are wholesale electricity prices in ERCOT today?"
- "Which fiber routes and subsea cables land near Virginia Beach?"

## Privacy policy

https://dchub.cloud/privacy

## Support

- Email: jonathan@dchub.cloud
- Support page: https://dchub.cloud/support
- Issues: https://github.com/azmartone67/dchub-mcp-server/issues

## License

MIT. See [LICENSE](LICENSE).
