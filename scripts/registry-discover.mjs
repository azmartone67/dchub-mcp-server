#!/usr/bin/env node
// ============================================================================
// registry-discover.mjs — find NEW MCP registries DC Hub is missing from.
//
// The gap this closes: registry-pr-submit.mjs only submits to a HARDCODED
// target list. When a brand-new "awesome-mcp-servers" list launches, nothing
// notices — adding it is a manual edit. This crawl is the discovery half:
//   1. GitHub-search for curated MCP lists (awesome-mcp* repos, by stars).
//   2. Drop the ones we already know (targets, manual PRs, dead repos, our own).
//   3. For each unknown list, verify it's actually joinable + we're missing:
//        - has a README.md   (README-based list, not an app/SDK)
//        - PRs are ENABLED   (pulls API != 404 — wong2/appcypher disabled theirs)
//        - we are NOT already listed (README has no dchub entry)
//   4. Report survivors — and (LIVE) open/refresh ONE tracking issue on our own
//      repo so a human can add the good ones to TARGETS. Never PRs a stranger's
//      repo automatically; discovery proposes, pr-submit (curated) disposes.
//
// SAFETY: read-only against third parties (plain fetches). The only write is an
// issue on OUR repo, gated on GITHUB_TOKEN + DISCOVER_LIVE=1. Default = report.
// ============================================================================

const TOKEN = process.env.GITHUB_TOKEN || process.env.REGISTRY_PR_PAT || '';
const LIVE = TOKEN && ['1', 'true', 'yes'].includes(String(process.env.DISCOVER_LIVE || '').toLowerCase());
const SELF = 'azmartone67/dchub-mcp-server';
const ISSUE_TITLE = '🔎 New MCP registry candidates (auto-discovery)';
const MIN_STARS = Number(process.env.DISCOVER_MIN_STARS || 40);
const MAX_CANDIDATES = Number(process.env.DISCOVER_MAX || 12);
const LISTED_RE = /dchub|dc[\s-]?hub/i;
// Onboard-PR half (2026-07-17): when LIVE, also open ONE same-repo PR that
// appends a DISABLED TARGETS stub to registry-pr-submit.mjs, so onboarding is
// propose-only-automated (a human vets the section + flips enabled:true) rather
// than a manual edit. Same-repo → GITHUB_TOKEN with contents+pull-requests write
// is enough (no PAT/fork). Kill-switch: DISCOVER_PR_DISABLE=1 keeps the tracking
// issue but skips the PR.
const SUBMIT_PATH = 'scripts/registry-pr-submit.mjs';
const DEFAULT_BRANCH = process.env.DISCOVER_BASE_BRANCH || 'main';
const PR_ENABLED = !['1', 'true', 'yes'].includes(String(process.env.DISCOVER_PR_DISABLE || '').toLowerCase());

// Registries we ALREADY handle or have deliberately ruled out — keep in sync with
// TARGETS in registry-pr-submit.mjs. A repo whose full_name matches any of these
// (case-insensitive) is not "new" and is filtered out silently.
//   live pr-submit targets ....... MobinX/awesome-mcp-list, TensorBlock/awesome-mcp-servers
//   manual / owner-blocked ........ punkpeye (PR #8200), wong2, appcypher (PRs disabled)
//   non-PR submission mechanism ... toolsdk-ai (JSON), lobehub / glama / smithery (owner UI)
//   PR open, awaiting merge ....... jaw9c, sylviangth (2026-07-14, bespoke table/heading
//                                    formats — self-drop once merged via listedRe)
//   live pr-submit target (added) . YuzeHao2023 (2026-07-20, Research & Data section)
//   vetted-out from #73 (07-20) ... PipedreamHQ + ever-works (AUTO-GENERATED from
//                                    Pipedream's hosted-app catalog — a PR is clobbered
//                                    on regen); win4r/Awesome-Claude (tiny 112-line list,
//                                    no data/energy category — poor fit); mctrinh
//                                    (44★, low reach — deferred, not worth a PR)
// ── RELEVANCE GATE (2026-08-08) ─────────────────────────────────────────────
// WHY: the crawl was healthy and useless. Its 2026-08-06 run surfaced 12
// candidates -- Chinese-language resources, DevOps twice, security, web3,
// crypto, medical, OSINT, Korea, Solana, and awesome-mcp-CLIENTS (we are a
// server) -- and not one of them lists anything like DC Hub. A human opened
// issue #73, correctly concluded "none of these", and the roster never grew.
// Ranking by stars finds the BIGGEST lists, not the ones we belong on.
//
// ★ THE SPLIT THAT MAKES THIS WORK: niche is tested against the repo NAME and
// DESCRIPTION only -- never the README body. A general-purpose list's README
// legitimately contains the words "crypto" and "medical" as SECTION HEADERS;
// testing the body would reject exactly the lists we most want. The name and
// description are where a list DECLARES its scope. Domain terms, by contrast,
// are searched in the body too: a general list carrying an Energy or Data
// section is a list we fit into.
const DOMAIN_RE = new RegExp([
  'data[\\s-]?cent(er|re)', 'datacent', 'power[\\s-]?grid', 'electric',
  'energy', 'fiber[\\s-]?optic|fibre', 'colocation', 'hyperscale',
  'telecom', 'interconnect', 'renewab', 'substation', 'megawatt|\\bMW\\b',
  // NOT 'utilit': it matched "testing utilities" on a devtools list and let
  // punkpeye/awesome-mcp-devtools through as a domain match. NOT 'fiber' bare
  // and NOT 'infrastructur': "infrastructure-as-code" is a DevOps list.
].join('|'), 'i');

// A scope that structurally EXCLUDES a data-center/energy server. "client" is
// here because awesome-mcp-clients catalogues MCP clients and we ship a server.
const NICHE_RE = new RegExp([
  'crypto', 'web3', 'solana', 'blockchain', 'defi', 'nft',
  'medical', 'health', 'clinical', 'bio',
  'osint', 'security', 'pentest', 'hacking',
  'devops', 'kubernetes', 'k8s', 'sre',
  'korea', 'japan', 'chinese', 'zh\\b', '-zh$', 'espa', 'brasil',
  'client', 'devtool', 'sdk', 'framework',
  'game|gaming', 'music', 'trading', 'legal', 'academic', 'finance|fintech',
  // Regional scopes: '-cn' and 'mainland' are how a China-only list names
  // itself; 'zh' alone missed LeslieLeung/awesome-mcp-server-cn.
  '\\bcn\\b|-cn$|mainland',
  // Frontend/mobile stacks — an Ionic/React list carries UI tooling, not a
  // remote infrastructure server.
  'ionic|react|vue|angular|flutter|mobile[\\s-]?app',
  // Language- and vendor-scoped lists: a .NET or Swift list will not carry a
  // remote data-center server, and a single-product list (oceanbase) is that
  // vendor's own catalogue.
  'swift', 'dotnet|\\.net\\b', '\\bjava\\b', '\\bruby\\b', 'golang|\\bgo\\b',
  'reverse[\\s-]?eng|\\bre-mcp', 'bug[\\s-]?bounty', 'oceanbase',
  'database|postgres|mysql|mongo',
].join('|'), 'i');

// Verdict for one candidate. Returns {keep, why} — `why` is printed and shown
// in the tracking issue so a rejection is auditable, never silent.
function relevance(nameAndDesc, readmeBody) {
  if (DOMAIN_RE.test(nameAndDesc)) return { keep: true, why: 'domain match (name/desc)' };
  const niche = NICHE_RE.exec(nameAndDesc);
  if (niche) return { keep: false, why: `scoped to "${niche[0]}" — excludes a data-center server` };
  // ★ A SECTION, NOT A MENTION. The first cut tested DOMAIN_RE against the whole
  // README, so one stray "energy" anywhere in a long document passed a bug-bounty
  // list. What actually matters is whether the list has a HEADING we could be
  // filed under — that is the difference between "this word appears" and "there
  // is a place for us here".
  const heading = readmeBody &&
    readmeBody.split('\n').find((ln) => /^#{1,4}\s/.test(ln) && DOMAIN_RE.test(ln));
  if (heading) {
    return { keep: true, why: `has section "${heading.replace(/^#+\s*/, '').trim().slice(0, 40)}"` };
  }
  return { keep: true, why: 'general-purpose list' };
}

// ── INSTALL SURFACES (2026-08-08) ───────────────────────────────────────────
// WHY THIS IS A SEPARATE MODE: the GitHub crawl above searches for `awesome-mcp*`
// repos. Docker's MCP Catalog, Glama, Smithery and PulseMCP are none of those
// things, so the crawl STRUCTURALLY CANNOT SEE THEM -- which is why the Docker
// catalog, the one surface that one-click-installs into Claude Desktop, Cursor
// and VS Code, went unnoticed until a human went looking.
//
// A reading surface earns a ranking. An INSTALL surface produces an agent. This
// mode enumerates the install surfaces explicitly and checks presence, because
// the universe of them is small and knowable -- unlike awesome-lists, you cannot
// find them by searching for a naming convention.
//
// present=false is a WORK ORDER, not an error. Unreadable is neither: a probe we
// could not fetch renders null and is reported as unknown, never as missing.
const INSTALL_SURFACES = [
  {
    id: 'docker_mcp_catalog',
    name: 'Docker MCP Catalog (ships in Docker Desktop MCP Toolkit)',
    url: 'https://raw.githubusercontent.com/docker/mcp-registry/main/servers/dchub/server.yaml',
    submit: 'https://github.com/docker/mcp-registry/pulls',
    note: 'one-click install into Claude Desktop / Cursor / VS Code',
  },
  {
    id: 'official_mcp_registry',
    name: 'Official MCP Registry',
    url: 'https://registry.modelcontextprotocol.io/v0/servers?search=cloud.dchub',
    submit: 'https://github.com/modelcontextprotocol/registry',
    note: 'consumed by the VS Code / Copilot MCP gallery',
  },
  {
    id: 'smithery',
    name: 'Smithery',
    // r-smitheryslug (2026-08-08): was /server/<...>, which 301s to /servers/.
    // Found by this file's own redirect guard on its first run.
    url: 'https://smithery.ai/servers/azmartone67/dchub',
    submit: 'https://smithery.ai/new',
    note: 'hosted proxy + one-click connect',
  },
  {
    id: 'glama',
    name: 'Glama',
    url: 'https://glama.ai/api/mcp/v1/servers/azmartone67/dchub-mcp-server',
    submit: 'https://glama.ai/mcp/servers',
    note: 'read surface; its copy feeds other listings',
  },
];

// Probe one install surface. Three-valued by construction: true (present),
// false (readable and we are absent), null (could not read -- NOT absence).
async function probeSurface(sfc) {
  try {
    const r = await fetch(sfc.url, {
      headers: { 'User-Agent': 'dchub-registry-discover/2.0 (+https://dchub.cloud)' },
      redirect: 'follow',
    });
    if (r.status === 404) return { present: false, detail: 'HTTP 404 — not listed' };
    if (!r.ok) return { present: null, detail: `HTTP ${r.status} — UNREADABLE, absence not concluded` };
    // A redirect to a different PATH means we asked about the wrong resource.
    try {
      const asked = new URL(sfc.url), got = new URL(r.url);
      if (asked.pathname.replace(/\/$/, '') !== got.pathname.replace(/\/$/, '')) {
        return { present: null, detail: `redirected to ${r.url} — probe URL has rotted` };
      }
    } catch { /* unparseable — fall through and score the body */ }
    const body = await r.text();
    return LISTED_RE.test(body)
      ? { present: true, detail: 'listed' }
      : { present: false, detail: 'readable but DC Hub absent' };
  } catch (e) {
    return { present: null, detail: `fetch failed: ${String(e.message).slice(0, 60)} — UNREADABLE` };
  }
}

const KNOWN = new Set([
  'mobinx/awesome-mcp-list',
  'tensorblock/awesome-mcp-servers',
  'yuzehao2023/awesome-mcp-servers',
  'punkpeye/awesome-mcp-servers',
  'wong2/awesome-mcp-servers',
  'appcypher/awesome-mcp-servers',
  'toolsdk-ai/awesome-mcp-registry',
  'jaw9c/awesome-remote-mcp-servers',
  'sylviangth/awesome-remote-mcp-servers',
  // vetted-out from discover issue #73 (2026-07-20) — see note above
  'pipedreamhq/awesome-mcp-servers',
  'ever-works/awesome-mcp-servers',
  'win4r/awesome-claude-mcp-servers',
  'mctrinh/awesome-mcp-servers',
].map((s) => s.toLowerCase()));

async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dchub-registry-discover',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const txt = await res.text();
  let json; try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt }; }
  return { ok: res.ok, status: res.status, json };
}

// Does this repo accept PRs? The pulls endpoint 404s when an owner disables them.
async function prsEnabled(full) {
  const r = await gh(`/repos/${full}/pulls?per_page=1`);
  return r.status !== 404;
}

// Fetch README (default branch) raw; null if none.
async function readme(full, branch) {
  for (const p of ['README.md', 'readme.md', 'Readme.md']) {
    const r = await fetch(`https://raw.githubusercontent.com/${full}/${branch}/${p}`);
    if (r.ok) return await r.text();
  }
  return null;
}

// Build a DISABLED TARGETS stub for a candidate. section/entry are placeholders
// a human completes — auto-guessing a list's category is exactly what we must
// NOT do (registry-pr-submit refuses to blind-append), so it ships enabled:false.
function buildStub(c) {
  const key = c.full.split('/').pop().replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
  const text = [
    `  // ── AUTO-DISCOVERED ${c.full} (★${c.stars}) — VET BEFORE ENABLING ──`,
    `  // ${c.desc || 'curated MCP list'}`,
    '  // TODO(human): confirm the README path + set the exact `section` header for',
    '  // this list, then set enabled:true. Left disabled so the submit loop skips it',
    '  // — a wrong section would blind-insert our entry in the wrong place.',
    '  {',
    `    key: '${key}', upstream: '${c.full}', base: '${c.base}', path: 'README.md',`,
    '    enabled: false,',
    '    listedRe: /dchub|dc[\\s-]?hub/i,',
    "    section: '### TODO: set the exact section header from this list',",
    '    alphabetical: false,',
    '    entry: `- [DC Hub](${REPO_URL}): ${DESC}`,',
    '  },',
  ].join('\n');
  return { key, text };
}

// Insert the stub just before the TARGETS array's closing `];` (never touches
// REFRESH_TARGETS, which closes later). Returns null if the array isn't found.
function insertStub(src, stubText) {
  const start = src.indexOf('const TARGETS = [');
  if (start < 0) return null;
  const close = src.indexOf('\n];', start);
  if (close < 0) return null;
  return src.slice(0, close) + '\n' + stubText + src.slice(close);
}

// Open ONE same-repo PR appending a disabled stub for the top not-yet-scaffolded
// candidate. Idempotent (skips a candidate already referenced in the file, and a
// branch/PR that already exists). Fail-soft: logs + returns on any hiccup.
async function openScaffoldPR(candidates) {
  const owner = SELF.split('/')[0];
  const cur = await gh(`/repos/${SELF}/contents/${SUBMIT_PATH}`);
  if (!cur.ok || !cur.json.content) { console.log(`  ! can't read ${SUBMIT_PATH} (${cur.status}) — skip scaffold PR`); return; }
  const src = Buffer.from(cur.json.content, 'base64').toString('utf8');
  const pick = candidates.find((c) => !src.includes(c.full));
  if (!pick) { console.log('  ✓ all candidates already scaffolded in registry-pr-submit.mjs — no PR'); return; }
  const { key, text } = buildStub(pick);
  const branch = `discover/add-target-${key}`;
  const open = await gh(`/repos/${SELF}/pulls?head=${owner}:${branch}&state=open`);
  if (open.ok && Array.isArray(open.json) && open.json.length) { console.log(`  ↳ scaffold PR already open: ${open.json[0].html_url}`); return; }
  const updated = insertStub(src, text);
  if (!updated) { console.log('  ! TARGETS array not found — skip scaffold PR'); return; }
  const ref = await gh(`/repos/${SELF}/git/ref/heads/${DEFAULT_BRANCH}`);
  const baseSha = ref.json?.object?.sha;
  if (!baseSha) { console.log(`  ! can't resolve ${DEFAULT_BRANCH} head — skip scaffold PR`); return; }
  const mk = await gh(`/repos/${SELF}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }) });
  if (!mk.ok && mk.status !== 422) { console.log(`  ! branch create failed ${mk.status} — skip`); return; }
  const put = await gh(`/repos/${SELF}/contents/${SUBMIT_PATH}`, { method: 'PUT', body: JSON.stringify({
    message: `chore(registry): scaffold onboarding target ${pick.full} (auto-discovery, disabled)`,
    content: Buffer.from(updated, 'utf8').toString('base64'), branch, sha: cur.json.sha,
  }) });
  if (!put.ok) { console.log(`  ! contents PUT failed ${put.status} — skip`); return; }
  const prBody = [
    `Auto-discovered curated MCP list ${pick.full} (★${pick.stars}) that accepts PRs and does not yet list DC Hub.`,
    '',
    'Appends a DISABLED TARGETS stub to scripts/registry-pr-submit.mjs so onboarding is propose-only-automated.',
    'Before merging: confirm the README path, set the exact section header, and flip enabled:true.',
    'Left enabled:false so the submit loop skips it until vetted.',
    '',
    `List: ${pick.url}`,
    '',
    'Opened by registry-discover.mjs. Safe to close if the list is not a fit.',
  ].join('\n');
  const pr = await gh(`/repos/${SELF}/pulls`, { method: 'POST', body: JSON.stringify({
    title: `Scaffold onboarding target: ${pick.full} (disabled — vet + enable)`,
    head: branch, base: DEFAULT_BRANCH, body: prBody,
  }) });
  if (pr.ok) console.log(`  🆕 scaffold PR opened: ${pr.json.html_url}`);
  else console.log(`  ! scaffold PR create failed ${pr.status}: ${JSON.stringify(pr.json).slice(0, 120)}`);
}

(async () => {
  console.log(`▶ registry-discover — mode=${LIVE ? 'LIVE (will file/refresh issue)' : 'REPORT-ONLY'} · min ★${MIN_STARS}\n`);
  if (!TOKEN) console.log('  (no token — GitHub search is unauthenticated; results may be rate-limited)\n');

  // 1) search for curated MCP lists. Two complementary queries; dedupe by full_name.
  //    `fork:false` keeps the thousands of list forks out. Sort by stars desc.
  const queries = [
    'awesome-mcp-servers in:name fork:false',
    'awesome-mcp in:name fork:false',
  ];
  const seen = new Map(); // lower(full_name) -> repo
  for (const q of queries) {
    const r = await gh(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=40`);
    if (!r.ok) { console.log(`  ! search failed (${r.status}) for "${q}"`); continue; }
    for (const item of r.json.items || []) {
      const full = item.full_name.toLowerCase();
      if (!seen.has(full)) seen.set(full, item);
    }
  }
  console.log(`  scanned ${seen.size} candidate list repos\n`);

  // 2) filter to genuinely-new, joinable, missing-us lists
  const candidates = [];
  const rejected = [];   // audited, never silent
  for (const item of seen.values()) {
    const full = item.full_name;
    const low = full.toLowerCase();
    if (low === SELF.toLowerCase()) continue;              // ourselves
    if (KNOWN.has(low)) continue;                          // already handled/ruled out
    if (item.archived) continue;                           // dead
    if ((item.stargazers_count || 0) < MIN_STARS) continue; // low-signal / noise
    // README-based + PR-accepting + not already listing us
    const rm = await readme(full, item.default_branch || 'main');
    if (rm == null) continue;                              // no README → not a curated list we can PR
    if (LISTED_RE.test(rm)) continue;                      // already lists DC Hub
    // Relevance BEFORE the PR-enabled probe: an extra API call per candidate we
    // were going to discard anyway is pure rate-limit burn.
    const rel = relevance(`${full} ${item.description || ''}`, rm);
    if (!rel.keep) { rejected.push({ full, why: rel.why }); continue; }
    if (!(await prsEnabled(full))) { console.log(`  – ${full}: PRs disabled — skip`); continue; }
    candidates.push({
      relevance: rel.why,
      full, stars: item.stargazers_count || 0, url: item.html_url,
      base: item.default_branch || 'main',
      desc: (item.description || '').slice(0, 100),
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  candidates.sort((a, b) => b.stars - a.stars);

  // Never a silent cap: a filtered-out candidate is printed with its reason, so
  // "0 candidates" can always be told apart from "the gate ate everything".
  if (rejected.length) {
    console.log(`  ⊘ ${rejected.length} filtered as off-domain:`);
    for (const r of rejected) console.log(`      ${r.full} — ${r.why}`);
    console.log('');
  }

  // ── install-surface sweep (runs regardless of what the list crawl found) ──
  console.log('▶ install surfaces:');
  const surfaces = [];
  for (const sfc of INSTALL_SURFACES) {
    const res = await probeSurface(sfc);
    surfaces.push({ ...sfc, ...res });
    const mark = res.present === true ? '✓' : res.present === false ? '✗' : '?';
    console.log(`  ${mark} ${sfc.name} — ${res.detail}`);
  }
  const missingSurfaces = surfaces.filter((x) => x.present === false);
  const unknownSurfaces = surfaces.filter((x) => x.present === null);
  console.log(`  → ${surfaces.length - missingSurfaces.length - unknownSurfaces.length} present, `
    + `${missingSurfaces.length} MISSING, ${unknownSurfaces.length} unreadable\n`);

  if (!candidates.length && !missingSurfaces.length) {
    console.log('  ✓ no new registries and every install surface carries DC Hub.');
    return;
  }
  if (candidates.length) {
    console.log(`  ● ${candidates.length} NEW registry candidate(s):`);
    for (const c of candidates) console.log(`      ★${c.stars}  ${c.full} — ${c.desc}  [${c.relevance}]`);
  } else {
    console.log('  ✓ no new on-domain lists — but an install surface needs work (below).');
  }

  // 3) file / refresh ONE tracking issue on our own repo (LIVE only)
  const surfaceRow = (x) => `| ${x.present === true ? '✓' : x.present === false ? '**✗**' : '?'} `
    + `| [${x.name}](${x.url}) | ${x.detail} | ${x.present === false ? `[submit](${x.submit})` : '—'} |`;

  const body = [
    '## Install surfaces',
    '',
    'An install surface produces an agent; a reading surface earns a ranking. These are',
    'enumerated explicitly because they are NOT `awesome-mcp*` repos — the GitHub crawl',
    'below structurally cannot find them, which is how the Docker catalog went unnoticed.',
    '',
    '| | Surface | State | |',
    '|:-:|---|---|---|',
    ...surfaces.map(surfaceRow),
    '',
    missingSurfaces.length
      ? `**${missingSurfaces.length} install surface(s) missing DC Hub — this is the highest-value row in this issue.**`
      : '_Every install surface carries DC Hub._',
    unknownSurfaces.length
      ? `\n_${unknownSurfaces.length} unreadable — absence NOT concluded._`
      : '',
    '',
    '## New list candidates',
    '',
    candidates.length
      ? 'Curated MCP lists that **accept PRs**, **don\'t yet list DC Hub**, are **not** in `TARGETS`,'
        + ' and survived the domain-relevance gate. Vet each, then add a curated entry — do **not** bulk-submit.'
      : '_No on-domain list candidates this run._',
    '',
    ...(candidates.length ? [
      '| ★ | List | What it is | Why it passed |',
      '|---:|---|---|---|',
      ...candidates.map((c) => `| ${c.stars} | [${c.full}](${c.url}) | ${c.desc || '—'} | ${c.relevance} |`),
      '',
    ] : []),
    ...(rejected.length ? [
      '<details><summary>' + `${rejected.length} filtered as off-domain` + '</summary>',
      '',
      '| List | Reason |', '|---|---|',
      ...rejected.map((r) => `| ${r.full} | ${r.why} |`),
      '',
      'Scope is read from the repo NAME and DESCRIPTION only — never the README body,',
      'since a general list legitimately carries "crypto" and "medical" as section headers.',
      '</details>',
      '',
    ] : []),
    '<sub>Refreshed by `registry-discover.mjs`. Close once triaged; it reopens/updates if new lists or missing surfaces appear.</sub>',
  ].join('\n');

  if (!LIVE) {
    console.log('\n  (report-only — set DISCOVER_LIVE=1 with a token to file the tracking issue)');
    return;
  }
  const found = await gh(`/search/issues?q=${encodeURIComponent(`repo:${SELF} in:title "${ISSUE_TITLE}" state:open`)}`);
  const existing = (found.json.items || [])[0];
  if (existing) {
    await gh(`/repos/${SELF}/issues/${existing.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    console.log(`\n  ↻ refreshed tracking issue #${existing.number}`);
  } else {
    const created = await gh(`/repos/${SELF}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: ISSUE_TITLE, body, labels: ['registry', 'discovery'] }),
    });
    console.log(`\n  🆕 opened tracking issue: ${created.json.html_url || `(status ${created.status})`}`);
  }

  // Onboard proposal (propose-only-automated): open ONE same-repo PR appending a
  // disabled TARGETS stub for the top candidate, gated for human merge. This is
  // the "discover -> onboard" close: discovery no longer stops at a tracking
  // issue a human must hand-translate into code.
  if (PR_ENABLED && candidates.length) {
    console.log('\n▶ scaffold onboarding PR:');
    await openScaffoldPR(candidates);
  } else if (PR_ENABLED) {
    console.log('\n  (no on-domain candidate to scaffold — install-surface work is tracked in the issue)');
  } else {
    console.log('\n  (scaffold PR disabled via DISCOVER_PR_DISABLE)');
  }
})().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
