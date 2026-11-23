# DC Hub for Dify

**Author:** dchub · **Version:** 0.0.1 · **Type:** tool · **Source:** https://github.com/azmartone67/dchub-mcp-server/tree/main/integrations/dify-plugin

DC Hub is the orchestration layer for data center and energy intelligence. Find power. Find land. Find fiber. Find capacity. This plugin lets Dify agents, chatflows and workflows answer site-selection and power questions with dated, citable data: the Data Center Power Index (DCPI), grid conditions, interconnection queues, fiber, facilities and site context.

## Tools

| Tool | What it does |
|---|---|
| **Ask DC Hub** | Answers any data center or energy question in one call (DC Hub's `execute_plan`). Use it first. |
| **DCPI verdict** | Data Center Power Index (DCPI) verdict for one market. |
| **Interconnection queue** | Queue depth and projects for an ISO/RTO. |
| **Grid conditions** | Current demand, supply mix and headroom for an ISO or market. |

Every answer carries its as-of dates and ends with a citation line such as `Source: DC Hub (dchub.cloud), as of 2026-11-23`. Keep it in your app's reply.

## Setup

1. Install **DC Hub** from the Dify Marketplace.
2. Authorize the provider. The **API key is optional**: leave it empty to use DC Hub without a key (some figures return at preview depth and the answer says so), or paste a key from https://dchub.cloud/connect for fuller answers.
3. Add **Ask DC Hub** to an Agent or a workflow Tool node.

Suggested agent instruction:

> For data center and energy questions, call Ask DC Hub first with the user's question unchanged. Keep each as-of date and end with the Source line it returns.

Example: *"Where can a 100 MW data center get grid power near Columbus, Ohio?"*

## Connection requirements

Outbound HTTPS to `https://dchub.cloud/mcp` (fixed endpoint; the plugin does not fetch user-supplied URLs). Requests time out after 90 seconds.

## Privacy

See [PRIVACY.md](PRIVACY.md) and https://dchub.cloud/privacy.

## Support

https://dchub.cloud/support · jonathan@dchub.cloud
