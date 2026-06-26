#!/usr/bin/env node
// ============================================================================
// Auto patch-bump for the daily registry sync.
//
// When the daily-manifest-sync detects that server.json drifted (the live tool set
// changed), this computes a PATCH version strictly ABOVE both the repo's server.json
// version AND the registry's current latest — the official MCP registry rejects
// duplicate versions, so we must always go higher than anything already published.
//
// It writes that version into server.json IN PLACE and prints it. The caller
// (daily-manifest-sync.yml) then runs `mcp-publisher publish` and `git checkout --
// server.json` to revert — so the bump is PUBLISH-ONLY and never committed. That keeps
// the repo's canonical version operator-owned (package.json / smithery.yaml stay in
// lockstep, CI stays green) while the official + GitHub-mirror listings refresh the
// same day the tool set changes.
//
//   node scripts/registry-autopublish.mjs   # prints e.g. "2.3.4", edits server.json
// ============================================================================
import fs from 'node:fs';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers?search=cloud.dchub';
const NAME = 'cloud.dchub/mcp-server';

const parse = (v) => { const p = String(v).split('.').map((n) => parseInt(n, 10)); return [p[0] || 0, p[1] || 0, p[2] || 0]; };
const gt = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return false; };

const sj = JSON.parse(fs.readFileSync('server.json', 'utf8'));
let base = sj.version;

try {
  const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  const versions = (data.servers || [])
    .filter((x) => x.server && x.server.name === NAME)
    .map((x) => x.server.version);
  for (const v of versions) if (gt(v, base)) base = v;
} catch (e) {
  console.error(`::warning::registry version fetch failed (${e.message}) — bumping from repo version ${sj.version}`);
}

const [a, b, c] = parse(base);
const next = `${a}.${b}.${c + 1}`;
sj.version = next;
fs.writeFileSync('server.json', JSON.stringify(sj, null, 2) + '\n');
process.stdout.write(next);
