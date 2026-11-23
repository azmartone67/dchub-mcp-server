# Changelog

User-visible changes to the DC Hub MCP server (`https://dchub.cloud/mcp`) and the
`dchub-mcp-server` npm launcher. DC Hub is the orchestration layer for data center
and energy intelligence: start with `execute_plan`.

Each entry is built from the GitHub Release for that version
(https://github.com/azmartone67/dchub-mcp-server/releases); the PR numbers link the
detail. The hosted server changes when `main` deploys. The npm launcher changes only
when a new version is published, so a version is cut only when tools, tool behaviour
or the launcher change (see "How releases are cut" at the end).

## 2.12.63 (2026-11-23)

- `get_backup_status` description says what it returns: the latest database backup (a pg_dump in Cloudflare R2: time, age, size, health) and the latest restore test (when, which dump, passed or failed), plus the per-feed freshness rows. Same tool name and output; 98 tools.

## 2.12.62 (2026-11-22)

- npm README says DC Hub is available in ChatGPT and links the ChatGPT apps listing and https://dchub.cloud/install/chatgpt. No tool or behaviour change.

## 2.12.61 (2026-11-22)

- Registry listing: server.json title is now "DC Hub: Data Center & Energy Intelligence" and the description names execute_plan, DCPI, power grid and fiber. README lead names site selection, colocation, capacity and energy. No behaviour change.

## 2.12.60 (2026-11-21)

- New `accept_capacity_intro` tool (98 tools): the operator of a Capacity Source listing accepts a buyer's registration by lead id, and gets back the acceptance receipt DC Hub records in its lead register. Nothing is sent without `confirm=true` and a lead id in the register's shape. The backend's `DCHUB_OPERATOR_TERMS_V1` is the switch: while it is off, the backend answers `not_enabled` and the tool points to the accept link in DC Hub's lead email. Not listed on `/mcp/claude`.

## 2.12.59 (2026-11-16)

- `report_finding` takes findings from any caller, with or without a key; new `request_enhancement` files feature and coverage requests to the same queue (97 tools) (#1475).
- `execute_plan`: block 0 opens with a three-line `fact_header` (source and as-of, entity, summary with the DCPI verdict); `compact: false` leaves it out (#1472).
- `execute_plan`: a larger answer budget with lossless de-duplication of repeated envelopes and step notes (#1474); keyless first answers keep each step's full-depth figures (#1469).
- Planner 5.29: several named states never give an empty plan, and `get_pipeline` stays on the named market or state, saying "Widened <metro> to <state>" when it widens (#1459, #1468).
- `get_pipeline` takes `market` and `state` (#1458).
- `compare_isos` lists every grid, labels and dates each queue figure, and gives coarse ISO bands where an answer withholds exact figures (#1460, #1476, #1479).
- One durable key per MCP session, with a reuse line and a save-key line on a new key's first answer (#1470); a key line ahead of the digest offer on digest-only answers (#1467).
- `?via=directory|partner&src=<slug>` attribution carries into the session (#1481).
- Copy: tool descriptions, annotations and results name no plan or price; `DCHUB_API_KEY` is optional; six email tools say what they collect and confirm first; server display name is "DC Hub" (#1454, #1461, #1462, #1464, #1466).

## 2.12.58 (2026-11-15)

- `execute_plan`: first-full plan steps run at full depth, with end-to-end tests (#1451).
- npm README and listing copy say what the server does and how to connect, and nothing else (#1452).
- npm package keywords (#1457).

## 2.12.57 (2026-11-15)

- Tool descriptions are about the data only, checked on every served tools/list (#1448).
- HTTP-client agents get a first full answer, once per session; the quota line states the real count; sited builds plan as capacity searches (#1447).
- README: one advertised endpoint (`/mcp`); the key is optional (#1449).

## 2.12.55 (2026-11-15)

- The official registry lists one remote, `https://dchub.cloud/mcp` (#1436).
- IDE hosts get a 10-tool list on `/mcp`; `?catalog=full` lists every tool (#1437).
- The core energy tools give the first full answer of the day without a key (#1438).
- Anonymous daily limits reset at the next UTC midnight (#1443).
- Planner: AI ranking on `rank_markets` `ai_ready`, relative time windows and places, a queue state caveat (#1432); named towns are geocoded and power is read beside permits (#1441).
- Results carry `cite_as_url` (#1439); per-layer licence footer and a fiber payload budget (#1428).
- A top-20 metro answer that is cut short is labelled partial (#1435).
- Docs: one-line setup for Codex CLI, GitHub Copilot CLI, opencode, VS Code and Windsurf (#1433).

## 2.12.54 (2026-11-14)

- New tool `dchub_services`, and an `execute_plan` next-step line (#1426).
- `claim_free_key` returns the calling client's config snippet under the key, and says the key does not expire (#1421).
- Answers lead with data rows, within a 30 KB budget per copy (#1418).
- Planner: per-state fan-out, two or more ISOs route to `compare_isos`, town fallback, MW and deadline binding (#1417).
- Codex plugin manifest (#1422).

## 2.12.53 (2026-11-14)

- Official registry metadata: one field removed from `server.json` `_meta` (#1424). No tool change.

## 2.12.52 (2026-11-14)

- Official registry title and description use the orchestration-layer copy (#1425).
- Every tracked file's tool count matches the catalog (#1407).

## 2.12.50 (2026-11-14)

- The npm launcher keeps the API key off the child process command line (#1416).
- Planner: Abilene air-permit and DCPI geography, an alternatives step, and answers name dropped filters (#1412).
- `request_capacity_intro` description keeps its "do not use to save or monitor a site" line on `/mcp` (#1413).

## 2.12.49 (2026-11-14)

- npm carries the orchestration-layer description (#1403, #1410).
- An `execute_plan`-first light tool list for CLI hosts (#1397, #1400).
- Planner: short power asks route to grid headroom; `execute_plan` `as_of` is never null; state-grain power steps are sourced (#1408, #1409).

## 2.12.48 (2026-11-12)

- One-click OAuth sign-in leads the offer on a limited result (#1391).
- `execute_plan` runs `get_air_permit_context` for air-permit asks (#1388) and ends capacity asks with `source_capacity` (#1386).
- Planner: markets outside a US RTO read the state's power timeline (#1383); WECC and SERC are not passed as an ISO to queue tools (#1385).

## 2.12.47 (2026-11-11)

- New tool `get_air_permit_context`: EPA nonattainment and TCEQ turbine permits (#1380).
- `/mcp`: Claude POST 400s fixed; GET and HEAD never answer 405 (#1353, #1363).
- `execute_plan` steps run under the caller's own key (#1354); a one-market siting question leads with its DCPI verdict (#1369); a comparison keeps its first-named market (#1376).
- Siting tools bridge to Capacity Source (#1359).

## 2.12.46 (2026-11-09)

- `execute_plan`: re-run a plan and get back only what changed (#1323).
- `set_market_alert` takes an email and arms the watch in one call (#1250).
- Email addresses are redacted from logged call parameters (#1252).
- Copilot empty-argument calls get safe input defaults (#1276).
- Every GitHub Release carries `gemini-extension.json`, so `gemini extensions install` works (#1266).

## 2.12.45 (2026-11-02)

- DCPI licence labels state the 30-day timing (#1237).
- Provenance: an evidence block per data layer (source, as-of, licence) (#1181, #1189).
- Every data answer names the next call (#1200); tools/list puts `execute_plan` first (#1196).
- Claude Code plugin (#1221); DC Hub formulas for Google Sheets and Excel (#1223).
- `analyze_site`: two full site analyses a day without a key (#1236).

## Earlier releases

Titles as published on GitHub Releases:

- 2.12.1 (2026-08-30): 83 tools, publish-surface integrity, first .dxt release asset.
- 2.12.0 (2026-08-14): 82 tools, 13 prompts, provenance envelope.
- 2.4.3 (2026-07-02): 53 tools, durable daily caps, consent and identity.
- 2.3.1 (2026-06-19): consent, identity and retention.
- 2.2.8 (2026-06-17): DC Hub: Data Center & Energy Intelligence (42 tools).

2.12.20 to 2.12.44 shipped with tool-count titles only; see GitHub Releases.
2.12.51 and 2.12.56 were never published.

## How releases are cut

A version is the number in `server.json`, `package.json`, `npm-launcher/package.json`
and `SERVER_VERSION` in `server.mjs`. Merging a change to that number publishes it:
npm (`.github/workflows/npm-publish.yml`), a GitHub Release
(`.github/workflows/github-release.yml`) and the official MCP registry. The hosted
server at `/mcp` deploys on every merge to `main` whether or not the version moves.

- Bump the version only when tools, tool behaviour or the launcher change. The
  required `check` (`scripts/version-bump-justified.mjs`) fails a bump that carries no
  tool, description or install-config change.
- A docs-only PR (README, CHANGELOG, `docs/`, `canonical/directories.json`) must not
  bump the version and must not edit `npm-launcher/`: the npm page only changes on a
  publish, so a launcher edit waits for the next release.
- A PR that bumps the version adds its entry at the top of this file, under the new
  number. `test/changelog-and-publish-gate.test.mjs` checks that the top entry matches
  `package.json`, and the GitHub Release uses that entry as its summary.
