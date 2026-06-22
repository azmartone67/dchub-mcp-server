#!/usr/bin/env node
// ============================================================================
// Single-source-of-truth for the MCP tool manifest.
//
// server.mjs (the live gateway) is the ONLY place tools are defined. This script
// DERIVES the tool list + count from its trackedTool() registrations and keeps
// the manifest surfaces in sync, so the version/tool-count drift that registries
// scrape (mcp-server.json had 42 while server.mjs registers 47) can't recur.
//
//   node scripts/sync-tools-manifest.mjs           # CHECK (CI guard; exit 1 on drift)
//   node scripts/sync-tools-manifest.mjs --fix     # rewrite mcp-server.json + version strings
//
// Canonical version  = server.json .version
// Canonical tool set = name+description of every trackedTool(srv, '<name>', '<desc>', …) in server.mjs
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = process.argv.includes('--fix');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJSON = (f) => JSON.parse(read(f));

// ---- canonical version -----------------------------------------------------
const VERSION = readJSON('server.json').version;

// ---- canonical tool list (parsed from server.mjs) --------------------------
// Matches: trackedTool(srv, 'name', '<string literal>' …  — handles single OR
// double quotes with escapes, across newlines. Falls back to the existing
// description if a literal can't be safely evaluated (e.g. concatenation).
function canonicalTools() {
  const src = read('server.mjs');
  const re = /trackedTool\(\s*srv\s*,\s*'([a-z_]+)'\s*,\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
  const existing = Object.fromEntries((tryReadTools() || []).map((t) => [t.name, t.description]));
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    let description = existing[name] || '';
    try { description = (0, eval)(m[2]); } catch { /* keep fallback */ }
    out.push({ name, description });
  }
  return out;
}
function tryReadTools() { try { return readJSON('mcp-server.json').tools; } catch { return null; } }

const tools = canonicalTools();
const COUNT = tools.length;
const names = new Set(tools.map((t) => t.name));

// ---- surfaces to keep in sync ---------------------------------------------
const problems = [];
const writes = [];

// mcp-server.json — the manifest that feeds registry scrapes
{
  const m = readJSON('mcp-server.json');
  const cur = (m.tools || []).map((t) => t.name);
  const missing = [...names].filter((n) => !cur.includes(n));
  const extra = cur.filter((n) => !names.has(n));
  if (m.version !== VERSION) problems.push(`mcp-server.json version ${m.version} != ${VERSION}`);
  if (missing.length) problems.push(`mcp-server.json MISSING ${missing.length} tools: ${missing.join(', ')}`);
  if (extra.length) problems.push(`mcp-server.json has ${extra.length} STALE tools: ${extra.join(', ')}`);
  if (FIX) { m.version = VERSION; m.tools = tools; if ('tools_count' in m) m.tools_count = COUNT;
    writes.push(['mcp-server.json', JSON.stringify(m, null, 2) + '\n']); }
}

// version strings in the other registry-facing files
for (const f of ['package.json', 'smithery.yaml']) {
  const txt = read(f);
  if (!txt.includes(VERSION)) problems.push(`${f} does not contain canonical version ${VERSION}`);
}

// smithery tool-count comments + README "N tools"
for (const f of ['smithery.yaml', 'README.md']) {
  const txt = read(f);
  const counts = [...txt.matchAll(/(\d+) tools/g)].map((x) => Number(x[1]));
  const wrong = counts.filter((c) => c !== COUNT && c > 20); // ignore small unrelated numbers
  if (wrong.length) {
    problems.push(`${f} has tool-count(s) ${[...new Set(wrong)].join('/')} != ${COUNT}`);
    if (FIX) writes.push([f, txt.replace(/\b(\d+) tools\b/g, (s, n) => (Number(n) > 20 ? `${COUNT} tools` : s))]);
  }
}

// ---- apply / report --------------------------------------------------------
if (FIX) {
  for (const [f, content] of writes) fs.writeFileSync(path.join(ROOT, f), content);
  console.log(`✓ synced to v${VERSION} / ${COUNT} tools — wrote: ${writes.map((w) => w[0]).join(', ') || '(nothing)'}`);
  process.exit(0);
}
console.log(`canonical: v${VERSION} / ${COUNT} tools`);
if (problems.length) { console.error('MANIFEST DRIFT:\n  - ' + problems.join('\n  - ') + '\n\nRun: node scripts/sync-tools-manifest.mjs --fix'); process.exit(1); }
console.log('✓ all manifest surfaces consistent');
