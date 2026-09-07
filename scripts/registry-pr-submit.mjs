#!/usr/bin/env node
// ============================================================================
// registry-pr-submit.mjs — auto-onboard DC Hub to PR-based MCP registries.
//
// Most third-party registries can only be joined by a human (owner login / no
// API). The exception is the GitHub "awesome-mcp-servers" curated lists, which
// accept PRs. This opens a well-formatted, idempotent PR to each configured
// list we're MISSING from — the one automatable "onboard a new partner" path.
//
// SAFETY RAILS:
//   - DRY_RUN default: prints the exact PR it WOULD open, opens nothing.
//     Goes live only when REGISTRY_PR_PAT is set AND REGISTRY_PR_LIVE=1.
//   - Idempotent: skips a target if we're already listed OR ANY open PR of
//     ours exists on the upstream (★2026-09-02: was head-branch-only, which
//     let a second refresh PR open beside a hand-opened one — see prGate).
//   - Bounded: a REFRESH target stops after REFRESH_MAX_DECLINED of our PRs
//     were closed unmerged — a maintainer who declines is not re-asked weekly.
//   - Rate-limited: at most MAX_PR_PER_RUN new PRs per run (default 1) so we
//     never spam maintainers.
//   - Curated entries: each target has a hand-written, on-convention entry —
//     no auto-guessed categories.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NAME = 'DC Hub';
const HOMEPAGE = 'https://dchub.cloud/mcp';

// ★2026-07-30: canon quantities resolve from the committed snapshot + derived
// tool count — this file was a THIRD hand-pinned copy ("79 tools / 311 markets
// / 1,400+ deals") and its refresh pass was actively rewriting external
// listings back to stale numbers. Same resolution as sync-tools-manifest.mjs:
// canonical/canon_phrases.json first (refreshed daily from
// /api/v1/canon/phrases), pinned fallbacks only if the snapshot is unreadable.
const _ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const _readJ = (f) => { try { return JSON.parse(readFileSync(path.join(_ROOT, f), 'utf8')); } catch { return null; } };
const _snap = _readJ('canonical/canon_phrases.json') || {};
const _phrase = (v, fb) => (typeof v === 'string' && /^\d[\d,]*\+$/.test(v) ? v : fb);
const MARKETS = _phrase(_snap.markets, '300+');
const DEALS = _phrase(_snap.deals, '1,600+');
const N_TOOLS = (Number.isInteger(_snap.tools) && _snap.tools > 20 && _snap.tools < 500)
  ? _snap.tools
  : (_readJ('server.json')?._meta?.['io.modelcontextprotocol.registry/publisher-provided']?.toolCount || 81);
const REPO_URL = 'https://github.com/azmartone67/dchub-mcp-server';

// ★2026-09-07 — ONE spelling of our head-branch name. There were three live ones
// (openPR's `add-dchub-${key}` default, the refresh call site's
// `refresh-dchub-${key}`, and prGate's comment quoting a literal) plus a DEAD
// `HEAD_BRANCH = 'add-dchub-mcp'` declared here and referenced nowhere — a name
// that matched no branch this lane has ever pushed. The branch name is now a
// LOOKUP KEY, not just a push target: registry-verify-listed.mjs asks the pulls
// API for it by name to escape the search index's lag, so a fourth spelling
// would make the verifier look for a branch that does not exist and call our own
// PR missing.
export const headBranch = (t, kind = 'add') =>
  `${kind === 'refresh' ? 'refresh' : 'add'}-dchub-${t.key}`;
const MAX_PR_PER_RUN = Number(process.env.REGISTRY_PR_MAX || 1);
const PAT = process.env.REGISTRY_PR_PAT || '';
const LIVE = PAT && ['1', 'true', 'yes'].includes(String(process.env.REGISTRY_PR_LIVE || '').toLowerCase());
const DRY = !LIVE;

// display-name used for the alphabetical guard + PR title
// Counts kept current (was stale "70 tools / 300+ markets / 2,000+ deals" — the exact
// pre-stale-entry bug the 07-13 audit flagged). Update alongside the honest-numbers.
const DESC = `Live data-center, power-grid, energy, interconnection-queue, fiber, natural-gas & M&A intelligence for AI agents — DC Hub Power Index (${MARKETS} markets), ISO grid telemetry, fiber routes, ${N_TOOLS} tools. Remote MCP at ${HOMEPAGE} — query and cite.`;

// PR-accepting, README-based awesome-mcp lists we're missing from. NB: wong2 +
// appcypher were dropped 2026-07-10 — their owners DISABLED pull requests (the
// pulls API 404s), so no one can submit there; the prCheck() guard below also
// auto-skips any future repo that disables PRs. TensorBlock (docs/<cat>.md
// subfiles + its own indexer) and toolsdk-ai (JSON registry) use different
// submission mechanisms — add them with bespoke handling later.
export const TARGETS = [
  {
    key: 'mobinx', upstream: 'MobinX/awesome-mcp-list', base: 'main', path: 'README.md',
    listedRe: /dchub|dc[\s-]?hub/i,
    section: '### 🧮 Data Science Tools',
    alphabetical: false,               // MobinX categories aren't sorted — append at end
    entry: `-   **[DC Hub](${REPO_URL})** [![GitHub stars](https://img.shields.io/github/stars/azmartone67/dchub-mcp-server?style=social)](${REPO_URL}): ${DESC}`,
  },
  {
    // TensorBlock keeps entries in per-category docs/<cat>.md pages (not the README).
    key: 'tensorblock', upstream: 'TensorBlock/awesome-mcp-servers', base: 'main',
    path: 'docs/data-analysis--business-intelligence.md',
    listedRe: /dchub|dc[\s-]?hub/i,
    section: 'Data Analysis & Business Intelligence',
    alphabetical: false,
    entry: `- [DC Hub](${REPO_URL}): Live data-center, power-grid, fiber, gas & M&A intelligence for AI agents — DC Hub Power Index (${MARKETS} US markets, BUILD/CAUTION/AVOID), ISO grid telemetry, fiber routes, ${DEALS} M&A deals; ${N_TOOLS} tools. Streamable HTTP endpoint at https://dchub.cloud/mcp. Free tier, no signup. In the official MCP Registry. CC-BY-4.0.`,
  },
  {
    // YuzeHao2023 (1051★, hand-curated, github-repo entries). Terse em-dash convention:
    // `- Name — https://github.com/…` (no bold, no star badge). Vetted 2026-07-20 from
    // discover issue #73; best-fit section is "Research & Data" (datasets / domain data).
    key: 'yuzehao', upstream: 'YuzeHao2023/Awesome-MCP-Servers', base: 'main', path: 'README.md',
    listedRe: /dchub|dc[\s-]?hub/i,
    section: 'Category: Research & Data',   // header: "## Category: Research & Data (🧬)"
    alphabetical: false,                    // section isn't sorted — append at end
    entry: `- DC Hub — https://github.com/azmartone67/dchub-mcp-server (live data-center, power-grid, energy, interconnection-queue, fiber & gas intelligence for AI agents — DC Hub Power Index across ${MARKETS} markets, ISO grid telemetry, fiber routes; ${N_TOOLS} tools, free tier, no signup)`,
  },
  // ── VETTED 2026-09-06 · e2b-dev/awesome-mcp-gateways (★168) — NOT A FIT ──
  // Kept here DECLINED rather than deleted: discovery dedupes on presence in
  // this file, so removing the stub makes the crawl re-propose it every Monday
  // forever. This is the "we looked, and the answer was no" record.
  // Its two sections are "Open-source MCP Gateways" and "Commercial MCP
  // Gateways", and its entries are proxies/multiplexers (agentgateway, AIRIS
  // MCP Gateway). DC Hub is an MCP SERVER, not a gateway — there is nothing
  // for it to sit in front of. Submitting would waste a maintainer's review.
  {
    key: 'awesome-mcp-gateways', upstream: 'e2b-dev/awesome-mcp-gateways', base: 'main', path: 'README.md',
    enabled: false,
    declined: 'gateways/proxies only; DC Hub is a server, not a gateway',
    listedRe: /dchub|dc[\s-]?hub/i,
    section: 'n/a — declined, gateways only',
    alphabetical: false,
    entry: `- [DC Hub](${REPO_URL}): ${DESC}`,
  },
  // ── VETTED 2026-09-06 · AlexMili/Awesome-MCP (★146) — ENABLED ──
  // Passes its "is it really an MCP server?" test: the entry points at
  // dchub-mcp-server, whose reason for being IS the MCP server — remove it and
  // the repo has no purpose. (Pointing at dchub.cloud would FAIL that test, and
  // is the most common reason it closes PRs.)
  // ★ TABLE, not a bullet list. Columns are Server | Description | Lang |
  //   Activity | ⭐. Per its CONTRIBUTING only Name, Description and section
  //   must be right; Lang/Activity/⭐ are recomputed on merge, so the documented
  //   placeholders (`—`, `🟢 0d`, `0`) are correct rather than lazy.
  // ★ NO LINKS IN THE DESCRIPTION (their rule), so the shared DESC constant —
  //   which carries the homepage URL — cannot be used here.
  {
    key: 'awesome-mcp', upstream: 'AlexMili/Awesome-MCP', base: 'main', path: 'README.md',
    enabled: true,
    listedRe: /dchub|dc[\s-]?hub/i,
    section: '### Databases & Data',
    alphabetical: false,               // table is not sorted; CONTRIBUTING sets no order
    entry: `| [DC Hub](${REPO_URL}) | Live data-center, power-grid, fiber, gas and M&A intelligence for AI agents, with market power scores, ISO grid telemetry and interconnection-queue data queried by name or coordinate. | — | 🟢 0d | 0 |`,
  },
  // ── VETTED 2026-09-06 · bh-rat/awesome-mcp-enterprise (★120) — NOT A FIT ──
  // Every section is MCP TOOLING or PLATFORM: Private Registries, Gateways &
  // Proxies, Build Tools & Frameworks, MCP Apps, Security & Governance,
  // Infrastructure & Deployment, Directories & Marketplaces. Its "Infrastructure
  // & Deployment" reads as deployment platforms for MCP servers (Alpic, Blaxel,
  // Cloudflare Agents), not infrastructure DATA. There is no section a domain
  // data server belongs in, and inventing one is what its contributing rules
  // ask you not to do. Declined; kept so discovery stops re-proposing it.
  {
    key: 'awesome-mcp-enterprise', upstream: 'bh-rat/awesome-mcp-enterprise', base: 'main', path: 'README.md',
    enabled: false,
    declined: 'every section is MCP tooling/platforms; no home for a domain data server',
    listedRe: /dchub|dc[\s-]?hub/i,
    section: 'n/a — declined, MCP tooling only',
    alphabetical: false,
    entry: `- [DC Hub](${REPO_URL}): ${DESC}`,
  },
  // ── VETTED 2026-09-06 · AIAnytime/Awesome-MCP-Server (★67) — ENABLED ──
  // ★ ALPHABETICAL IS REQUIRED HERE and the scaffold defaulted it to false.
  //   Its CONTRIBUTING: "insert your entry in alphabetical order within that
  //   category". Appending at the end is a documented reason for closure, so
  //   this one flag is the difference between a merge and a decline.
  // Category chosen from its own list rather than invented ("don't invent a new
  // one unless you have three or more servers for it"): Cloud, ops & data.
  // Format copied from a live neighbour (Zopnight): bold name, backticked
  // transport, em-dash, then the description. Bullets, never numbers.
  {
    key: 'awesome-mcp-server', upstream: 'AIAnytime/Awesome-MCP-Server', base: 'main', path: 'README.md',
    enabled: true,
    listedRe: /dchub|dc[\s-]?hub/i,
    section: '### Cloud, ops & data',
    alphabetical: true,
    entry: `- **[DC Hub](${REPO_URL})** \`http\` — Live data-center, power-grid, fiber and energy intelligence: facilities worldwide, DC Hub Power Index market scores, ISO grid telemetry, interconnection queues, fiber routes and tracked M&A, queried by name or coordinate with cited sources. Install: \`claude mcp add --transport http dchub https://dchub.cloud/mcp\` — keyless at free-tier depth.`,
  },
  // ── VETTED 2026-09-06 · beriberikix/awesome-mcp-hardware (★51) — NOT A FIT ──
  // Scope is "MCP servers for interacting with hardware and the physical
  // world" — tinymcp ("control embedded devices"), embedded-debugger-mcp
  // ("embedded debugging with probe-rs"). DC Hub answers questions ABOUT
  // physical infrastructure and explicitly does not touch it; our own /mcp
  // envelope says "Nothing here connects to or operates your infrastructure."
  // Listing it here would contradict our own product statement. Declined.
  {
    key: 'awesome-mcp-hardware', upstream: 'beriberikix/awesome-mcp-hardware', base: 'main', path: 'README.md',
    enabled: false,
    declined: 'scope is servers that CONTROL hardware; DC Hub does not touch infrastructure',
    listedRe: /dchub|dc[\s-]?hub/i,
    section: 'n/a — declined, hardware control only',
    alphabetical: false,
    entry: `- [DC Hub](${REPO_URL}): ${DESC}`,
  },
  // ── AUTO-DISCOVERED RankSpotAI/awesome-seo-mcp (★85) — VET BEFORE ENABLING ──
  // A curated list of MCP servers for SEO. Search Console, keywords, backlinks, crawling, SERPs and AI s
  // TODO(human): confirm the README path + set the exact `section` header for
  // this list, then set enabled:true. Left disabled so the submit loop skips it
  // — a wrong section would blind-insert our entry in the wrong place.
  {
    key: 'awesome-seo-mcp', upstream: 'RankSpotAI/awesome-seo-mcp', base: 'main', path: 'README.md',
    enabled: false,
    listedRe: /dchub|dc[\s-]?hub/i,
    section: '### TODO: set the exact section header from this list',
    alphabetical: false,
    entry: `- [DC Hub](${REPO_URL}): ${DESC}`,
  },
];

// REFRESH targets: curated lists that ALREADY list DC Hub but with STALE counts.
// (registry-pr-submit was ADD-only — the 07-14 audit found our biggest list, punkpeye
// (~180K users), still reads "33 tools / 232 markets / 2,000 deals".) This refreshes
// an existing entry IN PLACE. prCheck()/idempotency/blocked-fallback all still apply.
export const REFRESH_TARGETS = [
  { key: 'punkpeye', upstream: 'punkpeye/awesome-mcp-servers', base: 'main', path: 'README.md' },
];

// Replace stale counts ONLY on lines that are our own entry (match the repo slug) so we
// never touch another server's text. Honest numbers resolve from the canon snapshot above.
// 2026-07-17: 4,000+ was an over-claim — it counted duplicate ROWS (the AUTO id embeds
// the ingest date, so one deal accrues a row per day). ~1,420 distinct. See
// canonical_stats.deals_phrase in dchub-backend.
function refreshOurCounts(text) {
  const lines = text.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/azmartone67\/dchub|dchub-mcp-server/i.test(lines[i])) continue;
    const before = lines[i];
    lines[i] = lines[i]
      .replace(/\b\d{1,3}\s+tools\b/gi, `${N_TOOLS} tools`)
      .replace(/\b\d{2,3}\+?\s+(US\s+)?(power\s+)?markets\b/gi, (m, a = '', b = '') => `${MARKETS} ${a}${b}markets`)
      .replace(/\b[\d,]+\+?\s+(tracked\s+)?M&A\s+deals\b/gi, (m, tr = '') => `${DEALS} ${tr}M&A deals`);
    if (lines[i] !== before) changed = true;
  }
  return changed ? lines.join('\n') : null;
}

const raw = (repo, br, path) => `https://raw.githubusercontent.com/${repo}/${br}/${path}`;
const nameOf = (line) => { const m = line.match(/\[([^\]]+)\]/); return (m ? m[1] : '').toLowerCase(); };

// Insert our entry into `text` under the target's section, return new text or
// null if we can't locate the section (never blindly append).
function insert(text, t) {
  const lines = text.split('\n');
  let h = lines.findIndex((l) => l.includes(t.section));
  if (h < 0) return null;
  // find the span of entry lines belonging to this section
  let i = h + 1;
  while (i < lines.length && !/^#{1,3}\s/.test(lines[i])) i++;  // until next header
  const secEnd = i;
  // match any list item that contains a [text](link) — covers plain `- [x](y)`,
  // bold `- **[x](y)**`, and icon-prefixed `- <img...> [x](y)` (appcypher).
  const isEntry = (l) => /^\s*[-*]\s+.*\[[^\]]+\]\(/.test(l);
  if (t.alphabetical) {
    const me = NAME.toLowerCase();
    let at = -1;
    for (let j = h + 1; j < secEnd; j++) {
      if (isEntry(lines[j]) && nameOf(lines[j]) > me) { at = j; break; }
    }
    if (at < 0) { // after the last entry in the section
      let last = h + 1; for (let j = h + 1; j < secEnd; j++) if (isEntry(lines[j])) last = j;
      at = last + 1;
    }
    lines.splice(at, 0, t.entry);
  } else {
    let last = h + 1; for (let j = h + 1; j < secEnd; j++) if (isEntry(lines[j])) last = j;
    lines.splice(last + 1, 0, t.entry);
  }
  return lines.join('\n');
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${PAT}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dchub-registry-pr-submit' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json; try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt }; }
  return { ok: res.ok, status: res.status, json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPR(t, newContent, opts = {}) {
  const me = (await gh('GET', '/user')).json.login;
  if (!me) throw new Error('PAT /user failed');
  // Skip repos whose owner DISABLED pull requests — the pulls API 404s (wong2 +
  // appcypher do exactly this). No fork/PR is possible there by anyone.
  const prCheck = await gh('GET', `/repos/${t.upstream}/pulls?per_page=1`);
  if (prCheck.status === 404) return { skipped: 'PRs disabled on this repo (owner setting) — cannot submit' };
  const head = opts.branch || headBranch(t, 'add');   // per-target so branches never collide across forks
  // 1) fork (idempotent). ★ Use the RETURNED full_name — you can only have one
  // fork of a repo per account, and when the basename collides GitHub renames
  // it (awesome-mcp-servers-1), so never assume {me}/{basename}.
  const forkRes = await gh('POST', `/repos/${t.upstream}/forks`);
  const fork = forkRes.json?.full_name;
  if (!fork) throw new Error(`fork failed ${forkRes.status}: ${JSON.stringify(forkRes.json).slice(0, 120)}`);
  console.log(`      fork=${fork} head=${me}:${head}`);
  // 2) wait for the fork's base branch to be ready (fork copy is async)
  const readBase = async () => {
    for (let k = 0; k < 15; k++) {
      const r = await gh('GET', `/repos/${fork}/git/ref/heads/${t.base}`);
      if (r.ok && r.json?.object?.sha) return r.json.object.sha;
      await sleep(3000);
    }
    return null;
  };
  if (!(await readBase())) throw new Error(`fork ${fork} base '${t.base}' not ready`);
  // ★ sync the fork's base with upstream FIRST — a stale fork (e.g. left over
  // from a prior attempt) would otherwise make the PR diff show every upstream
  // change since the fork, not just our one line. merge-upstream fast-forwards.
  await gh('POST', `/repos/${fork}/merge-upstream`, { branch: t.base });
  const baseSha = await readBase();
  if (!baseSha) throw new Error(`fork ${fork} base '${t.base}' not readable after sync`);
  // 3) idempotency: open PR from our head already?
  const existing = await gh('GET', `/repos/${t.upstream}/pulls?head=${me}:${head}&state=open`);
  if (existing.ok && Array.isArray(existing.json) && existing.json.length) {
    // ★ This came from `/pulls?head=…` — the PRIMARY STORE — so it is proof the
    //   PR exists right now. Hand the object back, not just a sentence: the
    //   caller records it, and the verify step must not re-discover it.
    const ex = existing.json[0];
    return { skipped: `open PR already exists: ${ex.html_url}`, pr: { number: ex.number, url: ex.html_url } };
  }
  // 4) branch off the fork's base (idempotent — 422 = already exists)
  const mkRef = await gh('POST', `/repos/${fork}/git/refs`, { ref: `refs/heads/${head}`, sha: baseSha });
  if (!mkRef.ok && mkRef.status !== 422) throw new Error(`branch create failed ${mkRef.status}`);
  // 5) write the file on our branch
  const cur = await gh('GET', `/repos/${fork}/contents/${t.path}?ref=${head}`);
  const putRes = await gh('PUT', `/repos/${fork}/contents/${t.path}`, {
    message: opts.message || `Add DC Hub MCP server`,
    content: Buffer.from(newContent, 'utf8').toString('base64'),
    branch: head,
    sha: cur.json?.sha,
  });
  if (!putRes.ok) throw new Error(`contents PUT failed ${putRes.status}: ${JSON.stringify(putRes.json).slice(0, 160)}`);
  // 6) open the PR (retry once — cross-fork head can lag a beat after the push)
  const body = opts.body || `Adds **DC Hub** — a remote MCP server (streamable-http at ${HOMEPAGE}).\n\n${DESC}\n\nRepo: ${REPO_URL} · License CC-BY-4.0 · In the official MCP registry.`;
  let pr;
  for (let a = 0; a < 2; a++) {
    pr = await gh('POST', `/repos/${t.upstream}/pulls`, {
      title: opts.title || `Add DC Hub MCP server`, head: `${me}:${head}`, base: t.base, body, maintainer_can_modify: true,
    });
    if (pr.ok) break;
    if (pr.status === 422 && /already exists/i.test(JSON.stringify(pr.json))) {
      return { skipped: 'PR already exists (422)' };
    }
    await sleep(4000);
  }
  if (pr.ok) return { url: pr.json.html_url, number: pr.json.number };
  // GitHub sometimes blocks API-created PRs to popular repos (anti-spam) or the
  // token type can't createPullRequest on a non-owned repo. The fork+branch+entry
  // are READY — hand back the one-click compare URL so a human opens it in 1 click.
  const compare = `https://github.com/${t.upstream}/compare/${encodeURIComponent(t.base)}...${me}:${encodeURIComponent(head)}?expand=1`;
  return { blocked: `${pr.status} ${JSON.stringify(pr.json).slice(0, 90)}`, compare };
}

// ★ 2026-09-02 — ONE open PR per upstream, and STOP refreshing a list whose
// maintainer keeps declining. Measured on punkpeye/awesome-mcp-servers at
// 2026-09-02T00:55Z: 19 PRs by us — 1 merged (#7462, 2026-06-11), 16 closed
// UNMERGED, and TWO open at once: #12454 (2026-08-19, a hand-opened fix on a
// different head) and #13272 (2026-08-31, opened by this file's refresh pass
// WHILE #12454 was still open). The idempotency check in openPR() only looks
// for OUR HEAD BRANCH (`refresh-dchub-punkpeye`), so a PR from any other head
// was invisible to it, and nothing anywhere counted the sixteen declines —
// a refresh PR went out to a maintainer who had closed every previous one.
//
// The gate reads the SAME author search registry-verify-listed.mjs reads
// (search by author, never /pulls?per_page=N — ours sit far outside a busy
// repo's recent window):
//   · ANY open PR of ours on the upstream → skip (add AND refresh paths);
//   · refresh path only: ≥ REFRESH_MAX_DECLINED closed-unmerged PRs of ours
//     → STOP and say so in the step summary. The count lives on GitHub,
//     which is the durable tracking state; a ledger file here would drift
//     from it (verify-listed already renders the same count as DECLINED);
//   · unreadable search → skip. Opening blind is the duplicate this exists to
//     prevent: a skip costs one week, a duplicate costs the maintainer.
// ============================================================================
// SUBMIT RECEIPTS — the third source, and the only one that never asks GitHub.
// ----------------------------------------------------------------------------
// ★2026-09-07, third pass. #379 stopped the false MISSING by reading the
// PRIMARY STORE alongside the search index, and #380 stopped it asserting an
// absence while a source was blind. Both still ask GitHub at verify time.
//
// The submitter does not have to ask. It HOLDS the number GitHub returned from
// the create call, in the previous step of the SAME JOB on the same runner — a
// fact about the wire, obtained before any index or replica could lag. So it
// writes it down and the verifier reads it off disk:
//
//   receipt   this run created #85. Correct by construction: no index, no
//             propagation, no second request, no failure mode of its own.
//   pulls     current, but one API call that can 500 — which is #380's case.
//   search    complete for history, late for the last few minutes.
//
// ★ WHAT A RECEIPT DOES NOT SAY. It records a CREATION, never a current state.
//   It is inserted LAST, so it can only contribute a PR neither live source
//   returned; a receipt must never be able to report a PR as open after a
//   maintainer closed it. Both live sources outrank it on state, by the same
//   insertion-order rule the primary store already uses over the index.
//
// ★ WHY prGate() DOES NOT READ THEM. It asks "is a PR of ours already open"
//   BEFORE openPR(), so within a run no receipt for that target exists yet, and
//   receipts are run-scoped so a later run sees none. Measured 2026-09-07:
//   TARGETS (9) and REFRESH_TARGETS (1) share no upstream, so there is no
//   second pass over the same repo either. Wiring them in would be inert code
//   that reads like a safeguard, and this repo has been bitten by present-but-
//   inert rules often enough. The head lookup is what covers prGate.
// ============================================================================

// state/ is gitignored and regenerated per run; on Actions the workspace is a
// fresh checkout, so a receipt cannot outlive the run that wrote it there.
export const RECEIPTS_PATH = process.env.REGISTRY_PR_RECEIPTS
  || path.join(_ROOT, 'state', 'registry-pr-receipts.json');

// A receipt is evidence about ONE run. On Actions the run id settles that;
// locally, fall back to a short TTL. Unscoped, one successful Monday would
// certify every later Monday and MISSING could never fire again.
const RECEIPT_TTL_MIN = Number(process.env.REGISTRY_RECEIPT_TTL_MIN || 60);

/** Receipts written by THIS run. Never throws; an unreadable file is no receipts. */
export function readPrReceipts(opts = {}) {
  const file = opts.path || RECEIPTS_PATH;
  const runId = opts.runId !== undefined ? opts.runId : (process.env.GITHUB_RUN_ID || '');
  const now = opts.now || Date.now();
  let recs;
  try { recs = JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
  if (!Array.isArray(recs)) return [];
  return recs.filter((r) => {
    if (!r || typeof r.upstream !== 'string' || !Number.isInteger(r.number)) return false;
    if (runId) return String(r.run || '') === String(runId);
    const age = (now - new Date(r.at || 0).getTime()) / 60000;
    return Number.isFinite(age) && age >= 0 && age <= RECEIPT_TTL_MIN;
  });
}

/** Record a PR we have PROVED exists — from a create response or a primary-store hit. */
export function recordPrReceipt(rec, opts = {}) {
  const file = opts.path || RECEIPTS_PATH;
  const entry = {
    ...rec,
    run: opts.runId !== undefined ? opts.runId : (process.env.GITHUB_RUN_ID || ''),
    at: opts.at || new Date().toISOString(),
  };
  let recs = [];
  try { const j = JSON.parse(readFileSync(file, 'utf8')); if (Array.isArray(j)) recs = j; } catch { /* first write */ }
  recs.push(entry);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(recs, null, 2));
  } catch (e) {
    // A receipt is evidence, not the submission. Losing it costs the verifier a
    // shortcut it already has two fallbacks for; failing the submit over it
    // would trade a false MISSING for a real outage.
    console.log(`      (receipt not written: ${e.message})`);
  }
  return entry;
}

/**
 * Every PR of OURS on `upstream`, newest first. `null` = we could not look.
 *
 * ★2026-09-07 — TWO SOURCES, because neither one is sufficient, and using only
 * the first cost a red weekly lane on a PR the lane had just opened itself.
 *
 *   (a) /search/issues?q=repo:X author:Y type:pr — sees a PR on ANY head, which
 *       is the only way to find hand-opened ones (#12454 was hand-opened on a
 *       different head and invisible to openPR's head check). But it is an
 *       INDEX, and the index LAGS creation by seconds to minutes.
 *   (b) /repos/X/pulls?head=owner:branch&state=all — the PRIMARY STORE. No lag,
 *       and it is the same call openPR() already trusts for idempotency. It only
 *       sees the deterministic heads this lane pushes, which is exactly the set
 *       "did WE submit?" is asking about.
 *
 * MEASURED, run 34097298531 (2026-09-07), one workflow run:
 *     07:48:41  PR opened  AlexMili/Awesome-MCP#191
 *     07:48:45  PR opened  AIAnytime/Awesome-MCP-Server#85
 *     07:48:49  verify: PENDING  AlexMili/Awesome-MCP — PR #191 open 0d   (+8.4s, indexed)
 *     07:48:50  verify: MISSING  AIAnytime/Awesome-MCP-Server            (+5.6s, NOT indexed)
 *               "not listed and no PR of ours exists"  -> exit 1
 * Both PRs were open the whole time. The older of two PRs opened four seconds
 * apart was in the index and the younger was not; that four seconds was the
 * entire difference between a green lane and a red one. Retrying would only have
 * hidden it — the fix is to stop asking an index a question about the present.
 *
 * ★ NOT a revert to `/pulls?per_page=N`. That was the FIRST version and it read
 * the 50 most recent PRs repo-wide, so ours sat outside a busy repo's window and
 * the verifier reported a clean LISTED while four of our PRs had been declined.
 * `head=` is a FILTER, not a pagination default; the author search stays for
 * everything outside our own branch names.
 *
 * ★ ABSENCE IS ONLY ASSERTED WHEN BOTH SOURCES COULD SPEAK. If the search is
 * unreadable and the head lookups found nothing, or a head lookup failed while
 * we were about to report "no PR at all", this returns null -> UNREADABLE.
 * "I could not look" is not "it is not there" — the rule this harness is built
 * on, applied to its own new source.
 *
 * @param {string} upstream          "owner/repo"
 * @param {object} o
 * @param {Function} [o.api]         gh(method, path) -> {ok,status,json}
 * @param {string} o.owner           our GitHub login
 * @param {string[]} [o.heads]       our deterministic branch names on that repo
 * @param {object[]} [o.receipts]    PRs THIS RUN opened (see readPrReceipts)
 * @returns {Promise<null | Array<{number,state,created_at,merged_at,indexed,viaReceipt}>>}
 */
export async function ourPullRequests(upstream, { api = gh, owner, heads = [], receipts = [] } = {}) {
  const q = encodeURIComponent(`repo:${upstream} author:${owner} type:pr`);
  const [searchRes, ...headRes] = await Promise.all([
    api('GET', `/search/issues?q=${q}&per_page=100`),
    ...heads.map((h) => api('GET',
      `/repos/${upstream}/pulls?head=${encodeURIComponent(`${owner}:${h}`)}&state=all&per_page=100`)),
  ]);

  // The two APIs disagree on shape: search nests merge state under
  // pull_request.merged_at, the pulls list puts it at the top level.
  const norm = (p) => ({
    number: p.number,
    state: p.state,
    created_at: p.created_at,
    merged_at: p.pull_request?.merged_at ?? p.merged_at ?? null,
  });

  const searched = searchRes?.ok && Array.isArray(searchRes.json?.items)
    ? searchRes.json.items.map(norm) : null;
  const byHead = headRes.map((r) => (r?.ok && Array.isArray(r.json) ? r.json.map(norm) : null));
  const headUnreadable = byHead.some((x) => x === null);

  const indexed = new Set((searched || []).map((p) => p.number));
  // The PRIMARY STORE goes in first and is never overwritten: it is current,
  // the index is a snapshot that can be minutes old on state as well as on
  // existence. The search then contributes only the PRs it alone can see.
  // ★ Receipts go in LAST, behind both live reads, and only for a number
  //   neither of them returned. That ordering IS the rule "a receipt records a
  //   creation, never a current state" — put them first and a receipt would
  //   report a PR open after a maintainer closed it.
  const merged = new Map();
  for (const p of byHead.flatMap((x) => x || [])) merged.set(p.number, p);
  for (const p of (searched || [])) if (!merged.has(p.number)) merged.set(p.number, p);
  const fromReceipt = new Set();
  for (const r of receipts) {
    if (r?.upstream !== upstream || !Number.isInteger(r.number) || merged.has(r.number)) continue;
    fromReceipt.add(r.number);
    merged.set(r.number, { number: r.number, state: 'open', created_at: r.at, merged_at: null });
  }
  const all = [...merged.values()]
    .map((p) => ({ ...p, indexed: indexed.has(p.number), viaReceipt: fromReceipt.has(p.number) }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // ★2026-09-07, second pass. `!all.length` was the wrong test for "did every
  //   source get to speak". A blind source is blind whether or not the readable
  //   one happened to return something — what matters is whether what it
  //   returned SETTLES the question. Only an open PR (PENDING) or a
  //   closed-unmerged one (DECLINED) does. History that supports neither falls
  //   through verdictFor() to MISSING, the one verdict that exits 1.
  //
  //   Measured against this file at 8f564dc: search readable and holding only
  //   an old MERGED PR (#1136 is exactly that shape), head lookup 500 —
  //   `all` = [#1136 closed+merged], non-empty, so the guard did not fire, and
  //   a target whose entry had been removed upstream read MISSING while the
  //   ONLY source that can see a just-opened PR had failed. Same false red as
  //   the index lag, one partial API failure away.
  //
  //   When `all` is empty this is identical to the old condition — a widening,
  //   not a change of meaning.
  const settled = all.some((p) => p.state === 'open' || (p.state === 'closed' && !p.merged_at));
  if (!settled && (searched === null || headUnreadable)) return null;
  return all;
}

export const REFRESH_MAX_DECLINED = Number(process.env.REGISTRY_REFRESH_MAX_DECLINED || 3);

export async function prGate(t, me, opts = {}) {
  const api = opts.gh || gh;
  const kind = opts.kind || 'add';
  const maxDeclined = Number.isFinite(opts.maxDeclined) ? opts.maxDeclined : REFRESH_MAX_DECLINED;
  // ★2026-09-07 — the SAME predicate the verifier uses, not a second spelling of
  // it. This gate had the identical index blind spot: a re-dispatch minutes after
  // a scheduled run asks the search index about a PR that is not in it yet, the
  // gate sees no open PR, and the lane opens the duplicate this gate exists to
  // prevent. openPR()'s own head check catches that for the SAME head, and only
  // for that head — which is precisely the hole #12454/#13272 went through.
  const items = await ourPullRequests(t.upstream, { api, owner: me,
    heads: [headBranch(t, 'add'), headBranch(t, 'refresh')] });
  if (!items) {
    return { skipped: `cannot read our PR history on ${t.upstream} — not opening a PR blind`, open: null, declined: null };
  }
  const open = items.filter((p) => p.state === 'open');
  const declined = items.filter((p) => p.state === 'closed' && !p.merged_at);
  if (open.length) {
    return {
      skipped: `an open PR of ours already exists on ${t.upstream} (${open.map((p) => `#${p.number}`).join(' ')}) — one at a time`,
      open: open.length, declined: declined.length,
    };
  }
  if (kind === 'refresh' && declined.length >= maxDeclined) {
    return {
      skipped: `STOPPED — ${declined.length} of our PRs to ${t.upstream} were closed unmerged (cap ${maxDeclined}); `
        + 'the maintainer is declining edits. Owner action: ask on the last closed PR, or accept the entry as frozen. '
        + 'REGISTRY_REFRESH_MAX_DECLINED raises the cap.',
      stopped: true, open: 0, declined: declined.length,
    };
  }
  return { skipped: null, open: 0, declined: declined.length };
}

// ★ ENTRYPOINT GUARD (2026-08-05). TARGETS/REFRESH_TARGETS are now exported so
// the listing VERIFIER can read the same table the submitter writes from — two
// copies of that table would drift, and a verifier checking a stale target list
// is worse than none. But this file is one top-level IIFE, so importing it USED
// TO RUN THE WHOLE SUBMITTER as a side effect of reading a constant. Only run
// when executed directly.
const _IS_MAIN = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (_IS_MAIN) (async () => {
  console.log(`▶ registry-pr-submit — mode=${DRY ? 'DRY-RUN' : 'LIVE'} (PAT=${PAT ? 'set' : 'absent'}, LIVE=${LIVE}), max ${MAX_PR_PER_RUN}/run\n`);
  let opened = 0;
  const readyLinks = [];   // blocked-but-ready: {key, compare} for the run summary
  const gated = [];        // gate verdicts (open PR exists / refresh stopped) for the summary
  let _me = null;
  // ★ Write down every PR this run PROVED exists — from the create response
  //   (`number`) or from the primary-store idempotency hit (`r.pr`). Both are
  //   facts about the wire; the verify step reads them off disk seconds later.
  const receipt = (t, kind, pr) => {
    if (!Number.isInteger(pr?.number)) return;
    recordPrReceipt({ key: t.key, upstream: t.upstream, kind, number: pr.number, url: pr.url });
  };
  const whoAmI = async () => {
    if (_me) return _me;
    _me = (await gh('GET', '/user')).json?.login;
    if (!_me) throw new Error('PAT /user failed');
    return _me;
  };
  for (const t of TARGETS) {
    // Auto-discovered stubs land here with enabled:false (registry-discover.mjs
    // opens the PR; a human vets the section + flips this). Skip until vetted so
    // a placeholder `section` can never blind-insert our entry in the wrong spot.
    // ★2026-09-06: a stub can be disabled for two OPPOSITE reasons — not vetted
    // yet, or vetted and DECLINED. Printing "awaiting human vet" for a decided
    // one invites someone to re-do the review that already happened, every week
    // forever. `declined` carries the finding; without it the message is
    // unchanged.
    if (t.enabled === false) {
      console.log(t.declined
        ? `  ⛔ ${t.key}: DECLINED — ${t.declined} — skip`
        : `  ⏸ ${t.key}: disabled stub — awaiting human vet (set enabled:true) — skip`);
      continue;
    }
    const res = await fetch(raw(t.upstream, t.base, t.path));
    if (!res.ok) { console.log(`  ~ ${t.key}: README fetch ${res.status} — skip`); continue; }
    const text = await res.text();
    if (t.listedRe.test(text)) { console.log(`  ✓ ${t.key}: already listed — skip`); continue; }
    const updated = insert(text, t);
    if (!updated) { console.log(`  ✗ ${t.key}: section "${t.section}" not found — skip (needs config update)`); continue; }
    const added = updated.split('\n').find((l) => l.includes(REPO_URL));
    console.log(`  ● ${t.key}: MISSING → would add under "${t.section}":`);
    console.log(`      ${added}`);
    if (DRY) continue;
    if (opened >= MAX_PR_PER_RUN) { console.log(`      (rate-limit ${MAX_PR_PER_RUN}/run reached — next run)`); continue; }
    try {
      const gate = await prGate(t, await whoAmI(), { kind: 'add' });
      if (gate.skipped) { console.log(`      ⏸ ${gate.skipped}`); gated.push({ key: t.key, why: gate.skipped }); continue; }
      const r = await openPR(t, updated);
      if (r.skipped) { console.log(`      skip: ${r.skipped}`); receipt(t, 'add', r.pr); }
      else if (r.blocked) { console.log(`      ⚠️  auto-PR blocked (${r.blocked})`); console.log(`      → branch is READY — open the PR in 1 click:\n        ${r.compare}`); readyLinks.push({ key: t.key, compare: r.compare }); }
      else { console.log(`      ✅ PR opened: ${r.url}`); receipt(t, 'add', r); opened++; }
    } catch (e) { console.log(`      ❌ ${e.message}`); }
  }

  // REFRESH pass — fix stale counts on lists we're ALREADY in (was ADD-only before).
  for (const t of REFRESH_TARGETS) {
    const res = await fetch(raw(t.upstream, t.base, t.path));
    if (!res.ok) { console.log(`  ~ ${t.key} (refresh): fetch ${res.status} — skip`); continue; }
    const refreshed = refreshOurCounts(await res.text());
    if (!refreshed) { console.log(`  ✓ ${t.key} (refresh): our entry already current — skip`); continue; }
    console.log(`  ● ${t.key} (refresh): STALE → ${N_TOOLS} tools / ${MARKETS} markets / ${DEALS} deals`);
    if (DRY) continue;
    if (opened >= MAX_PR_PER_RUN) { console.log(`      (rate-limit ${MAX_PR_PER_RUN}/run reached — next run)`); continue; }
    try {
      const gate = await prGate(t, await whoAmI(), { kind: 'refresh' });
      if (gate.skipped) { console.log(`      ⏸ ${gate.skipped}`); gated.push({ key: `${t.key}-refresh`, why: gate.skipped }); continue; }
      const r = await openPR(t, refreshed, {
        branch: headBranch(t, 'refresh'),
        title: `Refresh DC Hub MCP entry (${N_TOOLS} tools, ${MARKETS} markets, ${DEALS} deals)`,
        message: 'Refresh DC Hub stats',
        body: `Updates the existing DC Hub entry to current stats: **${N_TOOLS} tools**, **${MARKETS} markets** (DC Hub Power Index), **${DEALS} M&A deals**. In-place edit of our own line only. Repo: ${REPO_URL} · in the official MCP registry.`,
      });
      if (r.skipped) { console.log(`      skip: ${r.skipped}`); receipt(t, 'refresh', r.pr); }
      else if (r.blocked) { console.log(`      ⚠️  auto-PR blocked (${r.blocked}) → ${r.compare}`); readyLinks.push({ key: `${t.key}-refresh`, compare: r.compare }); }
      else { console.log(`      ✅ refresh PR opened: ${r.url}`); receipt(t, 'refresh', r); opened++; }
    } catch (e) { console.log(`      ❌ ${e.message}`); }
  }

  console.log(`\n${DRY ? 'DRY-RUN complete (no PRs opened).' : `Done — ${opened} PR(s) opened.`}`);
  // Surface blocked-but-ready PRs on the run's Summary page so they're one click
  // away (GitHub anti-spam blocks API PR-create on this account; human-initiated
  // PRs aren't blocked). Once the account flag clears, these auto-open instead.
  if (readyLinks.length && process.env.GITHUB_STEP_SUMMARY) {
    const md = ['## 🔗 Registry PRs ready to open (1 click each)\n',
      'Auto-PR is blocked by a GitHub account-level restriction; each branch is prepared with a clean +1 diff — click to open:\n',
      ...readyLinks.map((l) => `- **${l.key}** → [open PR](${l.compare})`), ''].join('\n');
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch (_) {}
  }
  if (gated.length && process.env.GITHUB_STEP_SUMMARY) {
    const md = ['## ⏸ Not opened — gated\n',
      'One open PR per upstream; a refresh stops after REFRESH_MAX_DECLINED closed-unmerged PRs (the count is read from GitHub, the durable state):\n',
      ...gated.map((g) => `- **${g.key}** — ${g.why}`), ''].join('\n');
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch (_) {}
  }
})().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
