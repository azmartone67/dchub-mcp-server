#!/usr/bin/env node
// Does what we SERVE match what we ARE?
//
// WHY THIS EXISTS (2026-08-06). /.well-known/mcp.json is the single artifact
// every MCP registry scrapes — LobeHub, Glama, PulseMCP and the rest all read
// it and faithfully republish whatever it says. It was serving:
//
//     version 2.5.0            while server.json said 2.11.1
//     "15,700+ facilities"     while live canon said 16,700+
//     "1,600+ tracked M&A"     while live canon said 1,700+
//
// Every registry was correct. We were the stale source. LobeHub's listing
// showed 2.5.0 because that is what we told it.
//
// ★ THE PART THAT MAKES THIS UNFIXABLE FROM THE REPO. /.well-known/mcp.json and
// /mcp answer with x-dc-worker-version 4.9.x — the OUT-OF-REPO Cloudflare zone
// worker (dchubapiproxy), owner-edited in the CF dashboard. /press and
// /api/v1/* answer with 4.62.x, the Pages _worker.js in dchub-frontend. A repo
// commit CANNOT change the served manifest. daily-manifest-sync keeps every
// repo surface honest and still cannot touch this one, which is exactly why the
// drift survived: nothing compared the served bytes to the source.
//
// So this check does not try to fix anything. It detects, and it prints the
// exact values to paste into the dashboard worker.
//
// THREE STATES, never two: OK / DRIFT / UNOBSERVED. A fetch failure is
// UNOBSERVED and exits 0 — a network blip must not be reported as drift, and
// must not be reported as health either.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVED = 'https://dchub.cloud/.well-known/mcp.json';
const CANON = 'https://dchub.cloud/api/v1/canon/phrases';

const j = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

async function getJson(url) {
  const bust = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
  const r = await fetch(bust, {
    headers: { 'User-Agent': 'dchub-served-manifest-check/1.0', Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { body: await r.json(), headers: r.headers };
}

// "15,700+ facilities" / "1,600+ tracked M&A deals" out of the description blob.
const qty = (text, re) => {
  const m = String(text || '').match(re);
  return m ? m[1] : null;
};

const drift = [];
const note = (field, served, expected, where) =>
  drift.push({ field, served: served ?? '(absent)', expected, where });

let servedDoc, canonDoc;
try {
  servedDoc = (await getJson(SERVED)).body;
} catch (e) {
  console.log(`UNOBSERVED  could not read ${SERVED} — ${e.message}`);
  console.log('Not a drift finding. Nothing is claimed about the served manifest.');
  process.exit(0);
}
try {
  canonDoc = (await getJson(CANON)).body;
} catch (e) {
  console.log(`UNOBSERVED  could not read ${CANON} — ${e.message}`);
  console.log('Cannot judge published quantities without the owner endpoint.');
  process.exit(0);
}

const canon = canonDoc?.data ?? canonDoc ?? {};
const sourceVersion = j('server.json').version;
const sourceTools = (j('mcp-server.json').tools || []).length;

// ── version ────────────────────────────────────────────────────────────────
if (servedDoc.version !== sourceVersion) {
  note('version', servedDoc.version, sourceVersion, 'server.json');
}

// ── tool count ─────────────────────────────────────────────────────────────
const servedTools = servedDoc.tools_count ?? (servedDoc.tools || []).length;
if (String(servedTools) !== String(sourceTools)) {
  note('tools_count', servedTools, sourceTools, 'mcp-server.json tools[]');
}
if (canon.tools && String(servedTools) !== String(canon.tools)) {
  note('tools_count (vs canon)', servedTools, canon.tools, CANON);
}

// ── quantities embedded in the description ─────────────────────────────────
const desc = servedDoc.description;
const checks = [
  ['facilities', /([\d,]+\+)\s*facilities/i, canon.facilities],
  ['deals', /([\d,]+\+)\s*tracked\s*M&A/i, canon.deals],
  ['countries', /([\d,]+\+)\s*countries/i, canon.countries],
];
for (const [name, re, expected] of checks) {
  if (!expected) continue;
  const seen = qty(desc, re);
  if (seen && seen !== expected) note(`description.${name}`, seen, expected, CANON);
}

// ── report ─────────────────────────────────────────────────────────────────
if (!drift.length) {
  console.log(`OK  served manifest matches source — v${sourceVersion}, ${sourceTools} tools, canon quantities aligned`);
  process.exit(0);
}

console.log(`DRIFT  ${SERVED} disagrees with source on ${drift.length} field(s):\n`);
for (const d of drift) {
  console.log(`  ${d.field}`);
  console.log(`      served:   ${d.served}`);
  console.log(`      should be: ${d.expected}   (source: ${d.where})`);
}
console.log(`
★ A REPO COMMIT WILL NOT FIX THIS.
  /.well-known/mcp.json is served by the OUT-OF-REPO Cloudflare zone worker
  (dchubapiproxy) — confirm with:
      curl -sSI https://dchub.cloud/.well-known/mcp.json | grep -i x-dc-worker-version
  A 4.9.x version is the zone worker (CF dashboard, owner-edited).
  A 4.6x.x version is the Pages _worker.js in dchub-frontend (repo-controlled).

  Fix by editing the zone worker's MCP_SERVER_INFO in the Cloudflare dashboard.
  Durable fix: make that worker FETCH the manifest from a repo-controlled origin
  instead of hardcoding it, so this can never rot again.

  Every MCP registry scrapes this file. While it is stale, every listing is
  stale, and the registries are not at fault.`);

// The CI job files this verbatim as an issue body. Composed here rather than in
// a YAML heredoc: heredoc lines start at column 0 and break the `run: |` block
// scalar, which is a parse error the workflow only reveals once it runs.
const table = drift
  .map((d) => `| \`${d.field}\` | \`${d.served}\` | \`${d.expected}\` | ${d.where} |`)
  .join('\n');
writeFileSync(join(ROOT, 'served-manifest-report.md'), `Every MCP registry (LobeHub, Glama, PulseMCP, Smithery, …) scrapes
\`${SERVED}\`. While it is behind source, every listing is stale — and the
registries are behaving correctly by republishing what we serve them.

| field | served | should be | source |
|---|---|---|---|
${table}

**This needs an owner action, not a PR.** That path is served by the out-of-repo
Cloudflare zone worker (\`dchubapiproxy\`), edited in the CF dashboard:

\`\`\`bash
curl -sSI ${SERVED} | grep -i x-dc-worker-version
\`\`\`

\`4.9.x\` = zone worker (dashboard, owner-edited). \`4.6x.x\` = Pages
\`_worker.js\` in dchub-frontend (repo-controlled, a PR reaches it).

Durable fix worth doing once: have the zone worker FETCH this manifest from a
repo-controlled origin instead of hardcoding \`MCP_SERVER_INFO\`, so
\`daily-manifest-sync\` propagates here automatically and it cannot rot again.

_Auto-maintained by \`.github/workflows/served-manifest-drift.yml\`; closes itself
when the served manifest catches up._
`);

process.exit(1);
