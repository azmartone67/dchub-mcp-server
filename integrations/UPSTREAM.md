# Upstream contributions (prepared — NOT submitted)

Per Task 5 guardrails, the upstream PRs are left to the maintainer. The in-repo
packages under `integrations/langchain/` and `integrations/llamaindex/` are the
source of truth; below is exactly what to file upstream and how.

---

## 1. LangChain (`langchain-community`)

Two routes — pick one:

**A. `langchain-community` tool module (classic):**
- Add `libs/community/langchain_community/tools/dchub/` containing the three
  `StructuredTool`s from `integrations/langchain/dchub_tools.py` (market intel,
  facility search, grid).
- Register in `langchain_community/tools/__init__.py` + add a unit test under
  `libs/community/tests/`.
- Docs page under `docs/docs/integrations/tools/dchub.ipynb` (mirror the README's
  10-line agent example).

**B. Standalone partner package `langchain-dchub` (preferred, newer pattern):**
- `pip`-installable package exporting `DCHUB_TOOLS`; list it in LangChain's
  integrations registry (`libs/packages.yml`) + add the docs page above.

Maintainer checklist:
- [ ] Choose A or B; copy `dchub_tools.py` verbatim (deps: `langchain-core`, `requests`, `pydantic`).
- [ ] Add the docs notebook from the README example.
- [ ] Open PR against `langchain-ai/langchain`; sign the CLA.

---

## 2. LlamaIndex (`llama-hub` / `llama-index-tools-dchub`)

LlamaIndex tools now ship as `llama-index-tools-*` packages (the old `llama-hub`
repo is archived/redirected into the monorepo).

- Add `llama-index-integrations/tools/llama-index-tools-dchub/` with a
  `DCHubToolSpec(BaseToolSpec)` wrapping the three functions from
  `integrations/llamaindex/dchub_tools.py`.
- Include `pyproject.toml`, `README.md` (the 10-line example), and a test.

Maintainer checklist:
- [ ] Scaffold the package (`llama-index-tools-dchub`) with a `BaseToolSpec`.
- [ ] Copy the three tool functions; keep the `citation` field on every return.
- [ ] Open PR against `run-llama/llama_index`; sign the CLA.

---

## Verified live (2026-06-07, free tier, no key)
- `GET https://api.dchub.cloud/api/v1/markets/northern-virginia` → 739 facilities, 13,442 MW
- `GET https://api.dchub.cloud/api/v1/facilities?state=VA` → canonical slugs (e.g. `stack-stafford-technology-campus`)
- `GET https://api.dchub.cloud/api/v1/grid/intelligence/{ERCOT|PJM}` → distinct, iso-aware demand/mix/headroom

All three carry `citation: https://dchub.cloud` (added by the wrappers) and are
covered by the gate-graceful pytest suites in each integration dir.
