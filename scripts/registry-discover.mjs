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

// Registries we ALREADY handle or have deliberately ruled out — keep in sync with
// TARGETS in registry-pr-submit.mjs. A repo whose full_name matches any of these
// (case-insensitive) is not "new" and is filtered out silently.
//   live pr-submit targets ....... MobinX/awesome-mcp-list, TensorBlock/awesome-mcp-servers
//   manual / owner-blocked ........ punkpeye (PR #8200), wong2, appcypher (PRs disabled)
//   non-PR submission mechanism ... toolsdk-ai (JSON), lobehub / glama / smithery (owner UI)
//   PR open, awaiting merge ....... jaw9c, sylviangth (2026-07-14, bespoke table/heading
//                                    formats — self-drop once merged via listedRe)
const KNOWN = new Set([
  'mobinx/awesome-mcp-list',
  'tensorblock/awesome-mcp-servers',
  'punkpeye/awesome-mcp-servers',
  'wong2/awesome-mcp-servers',
  'appcypher/awesome-mcp-servers',
  'toolsdk-ai/awesome-mcp-registry',
  'jaw9c/awesome-remote-mcp-servers',
  'sylviangth/awesome-remote-mcp-servers',
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
    if (!(await prsEnabled(full))) { console.log(`  – ${full}: PRs disabled — skip`); continue; }
    candidates.push({
      full, stars: item.stargazers_count || 0, url: item.html_url,
      desc: (item.description || '').slice(0, 100),
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  candidates.sort((a, b) => b.stars - a.stars);

  if (!candidates.length) {
    console.log('  ✓ no new registries — coverage is complete for known PR-based lists.');
    return;
  }
  console.log(`  ● ${candidates.length} NEW registry candidate(s):`);
  for (const c of candidates) console.log(`      ★${c.stars}  ${c.full} — ${c.desc}`);

  // 3) file / refresh ONE tracking issue on our own repo (LIVE only)
  const body = [
    'Auto-discovered curated MCP lists that **accept PRs**, **don\'t yet list DC Hub**, and are **not** in `TARGETS`',
    '(`scripts/registry-pr-submit.mjs`). Vet each, then add a curated entry to `TARGETS` — do **not** bulk-submit.',
    '',
    '| ★ | List | What it is |',
    '|---:|---|---|',
    ...candidates.map((c) => `| ${c.stars} | [${c.full}](${c.url}) | ${c.desc || '—'} |`),
    '',
    '<sub>Refreshed by `registry-discover.mjs`. Close this issue once triaged; it reopens/updates if new lists appear.</sub>',
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
})().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
