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
//   - Idempotent: skips a target if we're already listed OR an open PR from
//     our head branch already exists.
//   - Rate-limited: at most MAX_PR_PER_RUN new PRs per run (default 1) so we
//     never spam maintainers.
//   - Curated entries: each target has a hand-written, on-convention entry —
//     no auto-guessed categories.
// ============================================================================

import { appendFileSync } from 'node:fs';

const NAME = 'DC Hub';
const HOMEPAGE = 'https://dchub.cloud/mcp';
const REPO_URL = 'https://github.com/azmartone67/dchub-mcp-server';
const HEAD_BRANCH = 'add-dchub-mcp';
const MAX_PR_PER_RUN = Number(process.env.REGISTRY_PR_MAX || 1);
const PAT = process.env.REGISTRY_PR_PAT || '';
const LIVE = PAT && ['1', 'true', 'yes'].includes(String(process.env.REGISTRY_PR_LIVE || '').toLowerCase());
const DRY = !LIVE;

// display-name used for the alphabetical guard + PR title
// Counts kept current (was stale "70 tools / 300+ markets / 2,000+ deals" — the exact
// pre-stale-entry bug the 07-13 audit flagged). Update alongside the honest-numbers.
const DESC = 'Live data-center, power-grid, energy, interconnection-queue, fiber, natural-gas & M&A intelligence for AI agents — DC Hub Power Index (311 markets), ISO grid telemetry, fiber routes, 73 tools. Remote MCP at ' + HOMEPAGE + ' — query and cite.';

// PR-accepting, README-based awesome-mcp lists we're missing from. NB: wong2 +
// appcypher were dropped 2026-07-10 — their owners DISABLED pull requests (the
// pulls API 404s), so no one can submit there; the prCheck() guard below also
// auto-skips any future repo that disables PRs. TensorBlock (docs/<cat>.md
// subfiles + its own indexer) and toolsdk-ai (JSON registry) use different
// submission mechanisms — add them with bespoke handling later.
const TARGETS = [
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
    entry: `- [DC Hub](${REPO_URL}): Live data-center, power-grid, fiber, gas & M&A intelligence for AI agents — DC Hub Power Index (311 US markets, BUILD/CAUTION/AVOID), ISO grid telemetry, fiber routes, 4,000+ M&A deals; 73 tools. Streamable HTTP endpoint at https://dchub.cloud/mcp. Free tier, no signup. In the official MCP Registry. CC-BY-4.0.`,
  },
];

// REFRESH targets: curated lists that ALREADY list DC Hub but with STALE counts.
// (registry-pr-submit was ADD-only — the 07-14 audit found our biggest list, punkpeye
// (~180K users), still reads "33 tools / 232 markets / 2,000 deals".) This refreshes
// an existing entry IN PLACE. prCheck()/idempotency/blocked-fallback all still apply.
const REFRESH_TARGETS = [
  { key: 'punkpeye', upstream: 'punkpeye/awesome-mcp-servers', base: 'main', path: 'README.md' },
];

// Replace stale counts ONLY on lines that are our own entry (match the repo slug) so we
// never touch another server's text. Current honest numbers: 73 tools / 311 markets / 4,000+.
function refreshOurCounts(text) {
  const lines = text.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/azmartone67\/dchub|dchub-mcp-server/i.test(lines[i])) continue;
    const before = lines[i];
    lines[i] = lines[i]
      .replace(/\b\d{1,3}\s+tools\b/gi, '73 tools')
      .replace(/\b\d{2,3}\+?\s+(US\s+)?(power\s+)?markets\b/gi, (m, a = '', b = '') => `311 ${a}${b}markets`)
      .replace(/\b[\d,]+\+?\s+(tracked\s+)?M&A\s+deals\b/gi, (m, tr = '') => `4,000+ ${tr}M&A deals`);
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
  const headBranch = opts.branch || `add-dchub-${t.key}`;   // per-target so branches never collide across forks
  // 1) fork (idempotent). ★ Use the RETURNED full_name — you can only have one
  // fork of a repo per account, and when the basename collides GitHub renames
  // it (awesome-mcp-servers-1), so never assume {me}/{basename}.
  const forkRes = await gh('POST', `/repos/${t.upstream}/forks`);
  const fork = forkRes.json?.full_name;
  if (!fork) throw new Error(`fork failed ${forkRes.status}: ${JSON.stringify(forkRes.json).slice(0, 120)}`);
  console.log(`      fork=${fork} head=${me}:${headBranch}`);
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
  const existing = await gh('GET', `/repos/${t.upstream}/pulls?head=${me}:${headBranch}&state=open`);
  if (existing.ok && Array.isArray(existing.json) && existing.json.length) {
    return { skipped: `open PR already exists: ${existing.json[0].html_url}` };
  }
  // 4) branch off the fork's base (idempotent — 422 = already exists)
  const mkRef = await gh('POST', `/repos/${fork}/git/refs`, { ref: `refs/heads/${headBranch}`, sha: baseSha });
  if (!mkRef.ok && mkRef.status !== 422) throw new Error(`branch create failed ${mkRef.status}`);
  // 5) write the file on our branch
  const cur = await gh('GET', `/repos/${fork}/contents/${t.path}?ref=${headBranch}`);
  const putRes = await gh('PUT', `/repos/${fork}/contents/${t.path}`, {
    message: opts.message || `Add DC Hub MCP server`,
    content: Buffer.from(newContent, 'utf8').toString('base64'),
    branch: headBranch,
    sha: cur.json?.sha,
  });
  if (!putRes.ok) throw new Error(`contents PUT failed ${putRes.status}: ${JSON.stringify(putRes.json).slice(0, 160)}`);
  // 6) open the PR (retry once — cross-fork head can lag a beat after the push)
  const body = opts.body || `Adds **DC Hub** — a remote MCP server (streamable-http at ${HOMEPAGE}).\n\n${DESC}\n\nRepo: ${REPO_URL} · License CC-BY-4.0 · In the official MCP registry.`;
  let pr;
  for (let a = 0; a < 2; a++) {
    pr = await gh('POST', `/repos/${t.upstream}/pulls`, {
      title: opts.title || `Add DC Hub MCP server`, head: `${me}:${headBranch}`, base: t.base, body, maintainer_can_modify: true,
    });
    if (pr.ok) break;
    if (pr.status === 422 && /already exists/i.test(JSON.stringify(pr.json))) {
      return { skipped: 'PR already exists (422)' };
    }
    await sleep(4000);
  }
  if (pr.ok) return { url: pr.json.html_url };
  // GitHub sometimes blocks API-created PRs to popular repos (anti-spam) or the
  // token type can't createPullRequest on a non-owned repo. The fork+branch+entry
  // are READY — hand back the one-click compare URL so a human opens it in 1 click.
  const compare = `https://github.com/${t.upstream}/compare/${encodeURIComponent(t.base)}...${me}:${encodeURIComponent(headBranch)}?expand=1`;
  return { blocked: `${pr.status} ${JSON.stringify(pr.json).slice(0, 90)}`, compare };
}

(async () => {
  console.log(`▶ registry-pr-submit — mode=${DRY ? 'DRY-RUN' : 'LIVE'} (PAT=${PAT ? 'set' : 'absent'}, LIVE=${LIVE}), max ${MAX_PR_PER_RUN}/run\n`);
  let opened = 0;
  const readyLinks = [];   // blocked-but-ready: {key, compare} for the run summary
  for (const t of TARGETS) {
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
      const r = await openPR(t, updated);
      if (r.skipped) console.log(`      skip: ${r.skipped}`);
      else if (r.blocked) { console.log(`      ⚠️  auto-PR blocked (${r.blocked})`); console.log(`      → branch is READY — open the PR in 1 click:\n        ${r.compare}`); readyLinks.push({ key: t.key, compare: r.compare }); }
      else { console.log(`      ✅ PR opened: ${r.url}`); opened++; }
    } catch (e) { console.log(`      ❌ ${e.message}`); }
  }

  // REFRESH pass — fix stale counts on lists we're ALREADY in (was ADD-only before).
  for (const t of REFRESH_TARGETS) {
    const res = await fetch(raw(t.upstream, t.base, t.path));
    if (!res.ok) { console.log(`  ~ ${t.key} (refresh): fetch ${res.status} — skip`); continue; }
    const refreshed = refreshOurCounts(await res.text());
    if (!refreshed) { console.log(`  ✓ ${t.key} (refresh): our entry already current — skip`); continue; }
    console.log(`  ● ${t.key} (refresh): STALE → 73 tools / 311 markets / 4,000+ deals`);
    if (DRY) continue;
    if (opened >= MAX_PR_PER_RUN) { console.log(`      (rate-limit ${MAX_PR_PER_RUN}/run reached — next run)`); continue; }
    try {
      const r = await openPR(t, refreshed, {
        branch: `refresh-dchub-${t.key}`,
        title: 'Refresh DC Hub MCP entry (73 tools, 311 markets, 4,000+ deals)',
        message: 'Refresh DC Hub stats',
        body: `Updates the existing DC Hub entry to current stats: **73 tools**, **311 markets** (DC Hub Power Index), **4,000+ M&A deals**. In-place edit of our own line only. Repo: ${REPO_URL} · in the official MCP registry.`,
      });
      if (r.skipped) console.log(`      skip: ${r.skipped}`);
      else if (r.blocked) { console.log(`      ⚠️  auto-PR blocked (${r.blocked}) → ${r.compare}`); readyLinks.push({ key: `${t.key}-refresh`, compare: r.compare }); }
      else { console.log(`      ✅ refresh PR opened: ${r.url}`); opened++; }
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
})().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
