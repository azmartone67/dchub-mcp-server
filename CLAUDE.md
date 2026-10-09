# dchub-mcp-server

The DC Hub MCP server. `main` deploys; land changes by pull request, never push to main. Gate: `npx vitest run`.

## Two Railway services
The same `main` deploys to TWO services, resourceful-essence and zonal-liberation. An env flag must be set on both, and resourceful-essence may not redeploy on a variable set: after `set-variables`, confirm each service actually started a deploy and redeploy by hand if it did not.

## Tier and field gating
- A free-tier gate on a tool that is not paywalled must read the pack credit balance (`_getCredits`), or it downgrades someone who paid for a pack.
- The internal key is provenance, not entitlement.
- Keep sibling detail out of public PR text: the repo is public, so fix text doubles as disclosure.
- QA probes use the read-only markers `User-Agent: dchub-qa-readonly` or `X-DCHub-QA: 1`, not an invented UA.

## Agent workflow
Procedure and checks live in user-level Claude config: `/ship-dchub-change`, `/verify-no-regression`, `/verify-a-guard`, `/handoff-and-goal` (goal + untracked progress note in `~/dchub-progress/`), and the read-only `evidence-reviewer` subagent for checking "fixed / live / verified" claims.
