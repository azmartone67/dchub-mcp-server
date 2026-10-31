# DC Hub for Claude Code

Live, dated data on data centers and the power behind them, from [DC Hub](https://dchub.cloud): facilities, markets, grids, interconnection queues, energy prices, fiber, site risk and capacity for lease. This plugin connects Claude Code to the DC Hub remote MCP server (`https://dchub.cloud/mcp`) and adds four workflow skills that turn those tools into finished work.

## Skills

| Skill | What it produces |
|---|---|
| `dchub-site-screen` | A one-page go / caution / no-go screen for a site or search area (analyze_site, site_selection_canvas, find_sites). |
| `dchub-time-to-power-memo` | A dated time-to-power memo for a US state or ISO: what is coming online, what is retiring, how congested the queue is. |
| `dchub-market-compare` | Two to four data center markets side by side, with a recommendation for the user's load. |
| `dchub-capacity-sourcing` | Colocation, turnkey, powered shell or land to buy or lease through Capacity Source, and a provider introduction with the user's approval. |

## Install

```
/plugin marketplace add azmartone67/dchub-mcp-server
/plugin install dchub@dchub
```

## Access

Anonymous use returns previews with no key. A free key from [dchub.cloud/signup](https://dchub.cloud/signup) unlocks full answers; when a result is partial it carries a `human_url` with the next step. Every result is dated and carries a `cite_as` line, so answers can be cited as "DC Hub (dchub.cloud), as of <date>".

Source, issues and license (MIT): [github.com/azmartone67/dchub-mcp-server](https://github.com/azmartone67/dchub-mcp-server).
