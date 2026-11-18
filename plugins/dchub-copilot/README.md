# DC Hub for GitHub Copilot CLI

DC Hub: the orchestration layer for data center and energy intelligence. One server for data center and energy intelligence: facilities, colocation, power and grid, interconnection queues, electricity and gas prices, fiber and site selection. Call `execute_plan` first: it chains the right tools and returns one dated, cited answer.

This plugin connects GitHub Copilot CLI to the DC Hub remote MCP server (`https://dchub.cloud/mcp`, Streamable HTTP) and adds three workflow skills.

## Install

```bash
copilot plugin marketplace add azmartone67/dchub-mcp-server
copilot plugin install dchub@dchub
```

Server only, no skills:

```bash
copilot mcp add --transport http dchub "https://dchub.cloud/mcp?via=copilot-cli"
```

`DCHUB_API_KEY` is optional. To add one, edit `~/.copilot/mcp-config.json` and set a header `"X-API-Key": "<your key>"` on the `dchub` server. Keys: https://dchub.cloud/connect.

## Skills

| Skill | What it produces |
|---|---|
| `dchub-site-screen` | A go / caution / avoid screen for one site or a shortlist of markets for a load |
| `dchub-time-to-power-memo` | A one-page "when, and how sure" power memo for new load in one geography |
| `dchub-market-compare` | A side-by-side comparison of two to five markets, including the Data Center Power Index (DCPI) verdict |

Every result is dated and carries a `cite_as` line, so answers can be cited as "DC Hub (dchub.cloud), as of <date>". The `?via=copilot-cli` tag on the URL only records which install path was used; it changes nothing about the answers.

## Try

```text
How soon can a 100 MW data center get grid power in ERCOT, and what are electricity prices there?
```
