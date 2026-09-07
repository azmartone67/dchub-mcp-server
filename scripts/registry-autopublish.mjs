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
// ★2026-09-07 — IT NO LONGER BURNS A NUMBER THE REPO IS ABOUT TO USE.
// `sync-tools-manifest.mjs --fix` now patch-bumps server.json itself whenever it
// changes the manifest's content (the write-time half of the fix for the twice-
// stalled registry publish — see scripts/server-json-baseline.mjs). Those bumps ARE
// committed. This script used to compute max(repo, registry) + 1 unconditionally, so
// on the very next daily run it would publish a number one ABOVE the freshly committed
// version, publish-only, and revert. The repo would then reach that number legitimately
// a change or two later, find it already taken, and take the duplicate-version
// rejection — the exact silent stall this whole mechanism exists to end, re-created by
// the mechanism's own helper. (a1df751/#370, "85 tools cannot publish under a version
// already taken", is what that failure reads like.)
//
// So: if the repo's committed version is ALREADY strictly above everything published,
// publish THAT — no write, nothing to revert, and the registry ends up carrying the
// same number the repo does. The publish-only +1 remains for the two cases that still
// need it: the registry is level with or ahead of us, or we could not read it at all.
//
//   node scripts/registry-autopublish.mjs   # prints e.g. "2.3.4"; edits server.json
//                                           # ONLY when a publish-only bump is needed
// ============================================================================
import fs from 'node:fs';

import { pathToFileURL } from 'node:url';

// ★ Overridable ONLY so the decision below can be exercised end-to-end without
// egress — test/registry-version-bump-write-time.test.mjs points it at a dead
// port to drive the "registry unreadable" branch. Never set in production.
const REGISTRY = process.env.MCP_REGISTRY_SEARCH_URL
  || 'https://registry.modelcontextprotocol.io/v0/servers?search=cloud.dchub';
const NAME = 'cloud.dchub/datacenter-power-grid-fiber';

const parse = (v) => { const p = String(v).split('.').map((n) => parseInt(n, 10)); return [p[0] || 0, p[1] || 0, p[2] || 0]; };
const gt = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return false; };

/**
 * The whole decision, as a pure function — EXPORTED so it is tested as itself
 * rather than through a stubbed network. Wiring it up wrong is a two-line
 * mistake; getting this table wrong is a stalled cascade nobody sees for days.
 *
 * @param {string} repoVersion       server.json's committed version
 * @param {string[]} published       every version the registry lists for NAME.
 *                                   EMPTY means "could not read it", not "none".
 * @returns {{version: string, write: boolean, why: string}}
 *   write:false ⇒ publish server.json untouched (nothing for the caller to revert).
 */
export function choosePublishVersion(repoVersion, published) {
  let max = null;
  for (const v of published || []) if (max === null || gt(v, max)) max = v;

  if (max !== null && gt(repoVersion, max)) {
    // The repo already owns a number the registry has never seen — publish it AS
    // IS. Writing nothing is the point: the version the registry advertises is
    // then the version all eight of our publish surfaces declare, instead of a
    // publish-only number one higher that the repo will later collide with.
    return { version: repoVersion, write: false,
             why: `repo version ${repoVersion} is already above the registry's latest (${max}) — publishing it as-is, no publish-only bump` };
  }
  // Registry level with us, ahead of us, or unreadable: go strictly higher than
  // both, publish-only. Unreadable counts as "assume taken" on purpose — a bump
  // we did not need costs one number, and a duplicate costs a stale cascade.
  const base = (max !== null && gt(max, repoVersion)) ? max : repoVersion;
  const [a, b, c] = parse(base);
  return { version: `${a}.${b}.${c + 1}`, write: true,
           why: max === null
             ? `registry unreadable — publish-only bump from repo version ${repoVersion}`
             : `registry holds ${max} — publish-only bump above it` };
}

async function fetchPublished() {
  try {
    const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    return (data.servers || [])
      .filter((x) => x.server && x.server.name === NAME)
      .map((x) => x.server.version)
      .filter(Boolean);
  } catch (e) {
    console.error(`::warning::registry version fetch failed (${e.message}) — treating the registry as unreadable`);
    return [];
  }
}

// Main-guarded so the export above can be imported without publishing anything.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const sj = JSON.parse(fs.readFileSync('server.json', 'utf8'));
  const choice = choosePublishVersion(sj.version, await fetchPublished());
  console.error(`::notice::${choice.why}`);
  if (choice.write) {
    sj.version = choice.version;
    fs.writeFileSync('server.json', JSON.stringify(sj, null, 2) + '\n');
  }
  process.stdout.write(choice.version);
}
