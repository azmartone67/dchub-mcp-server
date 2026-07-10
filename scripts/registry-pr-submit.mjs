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

const NAME = 'DC Hub';
const HOMEPAGE = 'https://dchub.cloud/mcp';
const REPO_URL = 'https://github.com/azmartone67/dchub-mcp-server';
const HEAD_BRANCH = 'add-dchub-mcp';
const MAX_PR_PER_RUN = Number(process.env.REGISTRY_PR_MAX || 1);
const PAT = process.env.REGISTRY_PR_PAT || '';
const LIVE = PAT && ['1', 'true', 'yes'].includes(String(process.env.REGISTRY_PR_LIVE || '').toLowerCase());
const DRY = !LIVE;

// display-name used for the alphabetical guard + PR title
const DESC = 'Live data-center, power-grid, fiber, gas & M&A intelligence for AI agents — DC Hub Power Index (300+ markets), ISO grid telemetry, fiber routes, 70 tools. Remote MCP at ' + HOMEPAGE + ' — query and cite.';

const TARGETS = [
  {
    key: 'wong2', upstream: 'wong2/awesome-mcp-servers', base: 'main', path: 'README.md',
    listedRe: /dchub|dc[\s-]?hub/i,
    section: '## Community Servers',
    alphabetical: true,
    entry: `- **[DC Hub](${REPO_URL})** - ${DESC}`,
  },
  {
    key: 'appcypher', upstream: 'appcypher/awesome-mcp-servers', base: 'main', path: 'README.md',
    listedRe: /dchub|dc[\s-]?hub/i,
    section: 'name="research-data"',   // match the Research & Data header line
    alphabetical: false,               // append at end of the category
    entry: `- [DC Hub](${REPO_URL}) - ${DESC}`,
  },
];

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

async function openPR(t, newContent) {
  const me = (await gh('GET', '/user')).json.login;
  if (!me) throw new Error('PAT /user failed');
  const fork = `${me}/${t.upstream.split('/')[1]}`;
  // 1) fork (idempotent)
  await gh('POST', `/repos/${t.upstream}/forks`);
  for (let k = 0; k < 10; k++) { if ((await gh('GET', `/repos/${fork}`)).ok) break; await sleep(3000); }
  // 2) idempotency: open PR from our head already?
  const existing = await gh('GET', `/repos/${t.upstream}/pulls?head=${me}:${HEAD_BRANCH}&state=open`);
  if (existing.ok && Array.isArray(existing.json) && existing.json.length) {
    return { skipped: `open PR already exists: ${existing.json[0].html_url}` };
  }
  // 3) branch off the fork's base
  const baseRef = await gh('GET', `/repos/${fork}/git/ref/heads/${t.base}`);
  const baseSha = baseRef.json?.object?.sha;
  if (!baseSha) throw new Error(`no base sha for ${fork}`);
  const mkRef = await gh('POST', `/repos/${fork}/git/refs`, { ref: `refs/heads/${HEAD_BRANCH}`, sha: baseSha });
  if (!mkRef.ok && mkRef.status !== 422) throw new Error(`branch create failed ${mkRef.status}`);
  // 4) write the file on our branch
  const cur = await gh('GET', `/repos/${fork}/contents/${t.path}?ref=${HEAD_BRANCH}`);
  const putRes = await gh('PUT', `/repos/${fork}/contents/${t.path}`, {
    message: `Add DC Hub MCP server`,
    content: Buffer.from(newContent, 'utf8').toString('base64'),
    branch: HEAD_BRANCH,
    sha: cur.json?.sha,
  });
  if (!putRes.ok) throw new Error(`contents PUT failed ${putRes.status}: ${JSON.stringify(putRes.json).slice(0, 160)}`);
  // 5) open the PR
  const body = `Adds **DC Hub** — a remote MCP server (streamable-http at ${HOMEPAGE}).\n\n${DESC}\n\nRepo: ${REPO_URL} · License CC-BY-4.0 · In the official MCP registry.`;
  const pr = await gh('POST', `/repos/${t.upstream}/pulls`, {
    title: `Add DC Hub MCP server`, head: `${me}:${HEAD_BRANCH}`, base: t.base, body, maintainer_can_modify: true,
  });
  if (!pr.ok) throw new Error(`PR create failed ${pr.status}: ${JSON.stringify(pr.json).slice(0, 200)}`);
  return { url: pr.json.html_url };
}

(async () => {
  console.log(`▶ registry-pr-submit — mode=${DRY ? 'DRY-RUN' : 'LIVE'} (PAT=${PAT ? 'set' : 'absent'}, LIVE=${LIVE}), max ${MAX_PR_PER_RUN}/run\n`);
  let opened = 0;
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
      else { console.log(`      ✅ PR opened: ${r.url}`); opened++; }
    } catch (e) { console.log(`      ❌ ${e.message}`); }
  }
  console.log(`\n${DRY ? 'DRY-RUN complete (no PRs opened).' : `Done — ${opened} PR(s) opened.`}`);
})().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
