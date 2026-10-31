---
name: dchub-capacity-sourcing
description: Find data center capacity to buy or lease — colocation, turnkey, powered shell or powered land — through DC Hub Capacity Source, and request an introduction to the provider on the user's behalf. Use when the user says "we need 2 MW of colo in Dallas", "find 500 kW in Europe", "who has powered land in Ohio", "source capacity", or asks where available MW is. Needs the DC Hub MCP server (https://dchub.cloud/mcp).
license: Listing details are confidential; see the terms returned by the tools
---

# Capacity sourcing

Turn a requirement into matching listings, then (only with the user's go-ahead) a registered introduction to the provider.

## 1. Pin down the requirement

Ask once, in one message, for anything missing:
- Size in kW or MW, and whether it must be one contiguous block.
- Location: metro, state, country or region (North America, Europe, APAC...).
- Delivery type: colocation, turnkey, powered shell or land.
- When it is needed (YYYY-MM).

## 2. Search

`source_capacity(min_kw|min_mw, location|region|state|market, delivery_type, available_by)`

- Size is matched against what a listing can actually deliver (its largest contiguous block and smallest contract), not its headline total. Say that to the user when a large site does not appear.
- Larger requirements that may need several sites: `source_capacity(target_mw=<total>, max_sites=<n>)` returns exact fits, bundles and any shortfall (needs a signed-in user).
- No match: tell the user plainly, and offer step 3 without a slug so they get first access as matching listings are onboarded.

## 3. Request an introduction (only after the user agrees)

1. Show the user the terms link the tool returns (https://dchub.cloud/listings#terms) and ask them to read it.
2. If they accept: `accept_capacity_terms(accept_terms=true)`.
3. `request_capacity_intro(slug=<listing>, name, company, role, capacity_mw|capacity_kw, timeline, use_case, accept_terms=true)`. If the tool says it needs an identified caller, run `claim_free_key` then `bind_email` with the user's own email first.

DC Hub sends the provider only the user's company and requirement; identities, site and contact details are exchanged only if the provider accepts. Tell the user that before you send.

## 4. Report back

- Listings: name or slug, delivery type, deliverable kW/MW, location, availability date, as returned.
- After an intro: the reference the tool returns and what happens next.
- Listing details are confidential: do not paste them anywhere outside this conversation.

## Rules

- Never send an introduction the user has not approved in this conversation.
- No prices or fees in your reply; if the user asks, give the listing page link exactly as returned.
- Someone wanting to LIST capacity: send them to https://dchub.cloud/listings#list-capacity.
