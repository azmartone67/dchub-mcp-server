#!/usr/bin/env node
// ============================================================================
// version-bump-justified.mjs (owner item D3, 2026-11-14) — a version bump must
// carry a RELEASE change: tools, descriptions, or install config.
//
// WHY. Every bump publishes: npm (npm-publish.yml), a GitHub release
// (github-release.yml), the official MCP registry and its mirrors
// (registry-refresh.yml). Five releases went out on 2026-11-14 alone; one of them
// (2.12.53, #1424) moved only registry metadata in server.json _meta. The owner's
// rule: bump only when tools, descriptions or install config change.
//
// WHAT IT CHECKS. On a PR whose server.json version differs from the base
// branch's, it finds the commit that set the BASE version (the content already
// published under it) and asks whether any release surface differs between that
// commit and HEAD. None differs -> exit 1. Comparing against the published
// commit, not the PR base, means a change that landed without a release (the
// 2.12.49 shape: npm description merged under 2.12.48, then a version-only PR)
// still justifies the bump that finally ships it.
//
// RELEASE SURFACES (every version string normalised out):
//   tools         mcp-server.json `tools` (name + description of every tool,
//                 generated from server.mjs and pinned by sync-tools-manifest),
//                 server.json _meta toolCount
//   descriptions  server.json title/description, package.json description,
//                 npm-launcher/package.json description and README.md,
//                 smithery.yaml, dxt/manifest.json
//   install       server.json remotes/packages, npm-launcher/package.json (bin,
//                 dependencies, files, engines, mcpName), npm-launcher/bin/*,
//                 dxt/manifest.json, smithery.yaml, mcp.json
// server.json is read through releaseView() (scripts/server-json-baseline.mjs),
// the same projection the write-time fence and the Python backstop use, so the
// three cannot disagree about what a server.json release change is.
//
// NOT SEEN: a change to a tool's inputSchema alone (mcp-server.json carries name
// + description only). Such a PR carries the `release-ok` label, which the
// workflow passes as RELEASE_OK=true; the run says so out loud.
//
// FAILS OPEN on history it cannot read (no git, shallow clone, unknown base),
// with a line saying the check did not run. manifest-consistency.yml checks out
// with fetch-depth: 0.
//
// Usage: node scripts/version-bump-justified.mjs --base <sha>   (default origin/main)
// ============================================================================
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseView } from './server-json-baseline.mjs';

export const RELEASE_OK_LABEL = 'release-ok';

function git(cwd, args) {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }) };
  } catch { return { ok: false, out: '' }; }
}
const show = (cwd, rev, file) => { const r = git(cwd, ['show', `${rev}:${file}`]); return r.ok ? r.out : null; };
const json = (t) => { try { return t == null ? null : JSON.parse(t); } catch { return null; } };
const versionAt = (cwd, rev) => json(show(cwd, rev, 'server.json'))?.version ?? null;
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const stripVersion = (o) => { if (!o || typeof o !== 'object') return o; const { version: _v, ...r } = o; return r; };
// smithery.yaml carries `version: "x.y.z"` on one line; comments are not release content.
const yamlSurface = (t) => (t == null ? null : t.split('\n').filter((l) => !/^\s*#/.test(l) && !/^version:/.test(l)).join('\n').trim());

/** Every release surface at a revision, as one comparable object (null = file absent). */
export function releaseSurfaces(cwd, rev) {
  const sj = json(show(cwd, rev, 'server.json'));
  const pkg = json(show(cwd, rev, 'package.json'));
  const launcher = json(show(cwd, rev, 'npm-launcher/package.json'));
  const binList = git(cwd, ['ls-tree', '-r', '--name-only', rev, '--', 'npm-launcher/bin']);
  const bin = {};
  for (const f of (binList.ok ? binList.out.split('\n').filter(Boolean) : [])) bin[f] = show(cwd, rev, f);
  return sortKeys({
    tools: json(show(cwd, rev, 'mcp-server.json'))?.tools ?? null,
    server_json: sj ? releaseView(sj) : null,
    package_description: pkg?.description ?? null,
    npm_launcher: stripVersion(launcher),
    npm_launcher_bin: bin,
    npm_launcher_readme: show(cwd, rev, 'npm-launcher/README.md'),
    dxt_manifest: stripVersion(json(show(cwd, rev, 'dxt/manifest.json'))),
    smithery: yamlSurface(show(cwd, rev, 'smithery.yaml')),
    mcp_json: json(show(cwd, rev, 'mcp.json')),
  });
}

/** The commit that SET `version` on the first-parent history of `rev` (the content published under it). */
export function commitThatSet(cwd, rev, version) {
  const log = git(cwd, ['log', '--format=%H', rev, '--', 'server.json']);
  const commits = log.ok ? log.out.split('\n').filter(Boolean) : [];
  let setter = null;
  for (const c of commits) {
    if (versionAt(cwd, c) === version) setter = c; else if (setter) return setter; else break;
  }
  // Walked off the end still on `version`: in a full clone the oldest commit set it;
  // in a shallow one the history simply stops, so do not invent a verdict.
  const shallow = git(cwd, ['rev-parse', '--is-shallow-repository']);
  return setter && shallow.ok && shallow.out.trim() === 'false' ? setter : null;
}

/** {ok, ran, reason, changed?} — ok:false ONLY when a bump is proven to carry no release change. */
export function judge(cwd, base, { releaseOk = false, head = 'HEAD' } = {}) {
  if (!git(cwd, ['rev-parse', '--git-dir']).ok) return { ok: true, ran: false, reason: 'not a git repo — check did not run' };
  if (!git(cwd, ['rev-parse', '--verify', `${base}^{commit}`]).ok) return { ok: true, ran: false, reason: `base ${base} is not in this clone — check did not run` };
  const baseVer = versionAt(cwd, base);
  const headVer = versionAt(cwd, head);
  if (!baseVer || !headVer) return { ok: true, ran: false, reason: 'server.json version unreadable on one side — check did not run' };
  if (baseVer === headVer) return { ok: true, ran: true, reason: `no version bump (${headVer}) — nothing to justify` };
  const setter = commitThatSet(cwd, base, baseVer);
  if (!setter) return { ok: true, ran: false, reason: `could not find the commit that set ${baseVer} (shallow history?) — check did not run` };
  const then = releaseSurfaces(cwd, setter);
  const now = releaseSurfaces(cwd, head);
  const changed = Object.keys(now).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(then[k]));
  if (changed.length) {
    return { ok: true, ran: true, changed, reason: `${baseVer} -> ${headVer} carries a release change since ${setter.slice(0, 7)}: ${changed.join(', ')}` };
  }
  if (releaseOk) {
    return { ok: true, ran: true, changed, reason: `${baseVer} -> ${headVer} changes no release surface since ${setter.slice(0, 7)}; allowed by the '${RELEASE_OK_LABEL}' label (a tool inputSchema change is the case this check cannot see)` };
  }
  return {
    ok: false, ran: true, changed,
    reason: `${baseVer} -> ${headVer} is a version bump with no tool, description or install-config change since `
      + `${baseVer} was set in ${setter.slice(0, 7)}. Every bump publishes (npm, GitHub release, MCP registry), so `
      + `drop the bump and let this change ride with the next release. If a tool's inputSchema changed (this check `
      + `reads tool names and descriptions only), add the '${RELEASE_OK_LABEL}' label and re-run.`,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--base');
  const base = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const releaseOk = /^(1|true|yes)$/i.test(String(process.env.RELEASE_OK || ''));
  const v = judge(root, base, { releaseOk });
  if (v.ok) {
    console.log(`[version-bump-justified] ${v.reason}`);
    process.exit(0);
  }
  console.log(`::error::${v.reason}`);
  console.error(`[version-bump-justified] FAIL\n${v.reason}`);
  process.exit(1);
}
