# DC Hub — Agent Skills

Agent Skills that teach Claude how to use the **DC Hub** MCP server
(`https://dchub.cloud/mcp` · registry `cloud.dchub/mcp-server`) effectively.

| Skill | Description |
|---|---|
| [`dc-hub-data-center-intelligence`](./dc-hub-data-center-intelligence/SKILL.md) | Answer data-center, power/grid, site-selection, and M&A questions with **live** DC Hub data — a global data-center facility map across 170+ countries, 300+ DCPI markets, 10 ISO grids, fiber, and 1,800+ tracked deals — instead of stale training data. Includes a tool-selection map and honest-attribution guidance. |
| [`dchub-site-screen`](../plugins/dchub/skills/dchub-site-screen/SKILL.md) | Screen a site or search area and write a one-page go / caution / no-go screen (analyze_site, site_selection_canvas, find_sites). |
| [`dchub-time-to-power-memo`](../plugins/dchub/skills/dchub-time-to-power-memo/SKILL.md) | A dated time-to-power memo for a US state or ISO: what is coming online, what is retiring, how congested the queue is. |
| [`dchub-market-compare`](../plugins/dchub/skills/dchub-market-compare/SKILL.md) | Compare two to four data center markets side by side and recommend one for the user's load. |
| [`dchub-capacity-sourcing`](../plugins/dchub/skills/dchub-capacity-sourcing/SKILL.md) | Find colocation, turnkey, powered shell or land to buy or lease through Capacity Source, and request a provider introduction with the user's approval. |

**Install in Claude Code** (MCP server + all skills):

```
/plugin marketplace add azmartone67/dchub-mcp-server
/plugin install dchub@dchub
```

Each skill is a self-contained folder with a `SKILL.md` (YAML frontmatter + instructions).
Free anonymous tier; a free dev key at [dchub.cloud/signup](https://dchub.cloud/signup) unlocks full results.
